/**
 * tests/offline-pdf-ocr-scan.test.mjs
 *
 * Unit test suite untuk Tahap B4:
 * Integrasi OCR PDF scan dan PDF hybrid/campuran secara offline.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OFFLINE_SCANNER_MIME_TYPES,
  OFFLINE_SCANNER_PDF_MIME,
  OfflineScannerError,
  isOfflineScannerMimeType,
  isPdfOfflineScannerMimeType,
  processOfflineScannerFile,
} from '../src/services/offlineScanner.js';
import {
  OFFLINE_DOCUMENT_ENGINE_VERSIONS,
  OfflineDocumentEngineError,
} from '../src/services/offlineDocumentEngine.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function createSyntheticTextPdf(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 24 Tf\n72 700 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

async function expectOfflineScannerError(promise, expectedCode) {
  await assert.rejects(
    promise,
    error => {
      assert.equal(error instanceof OfflineScannerError, true);
      assert.equal(error.code, expectedCode);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// A. Validasi MIME dan Routing B4
// ---------------------------------------------------------------------------
test('A1: OFFLINE_SCANNER_MIME_TYPES mencakup PDF, TXT, CSV, dan format gambar', () => {
  assert.equal(OFFLINE_SCANNER_MIME_TYPES.includes('application/pdf'), true);
  assert.equal(OFFLINE_SCANNER_MIME_TYPES.includes('text/plain'), true);
  assert.equal(OFFLINE_SCANNER_MIME_TYPES.includes('text/csv'), true);
  assert.equal(OFFLINE_SCANNER_MIME_TYPES.includes('image/jpeg'), true);
  assert.equal(OFFLINE_SCANNER_MIME_TYPES.includes('image/png'), true);
  assert.equal(isPdfOfflineScannerMimeType('application/pdf'), true);
  assert.equal(isPdfOfflineScannerMimeType('image/png'), false);
  assert.equal(isOfflineScannerMimeType('image/gif'), false);
});

test('A2: File PDF di atas 10 MiB ditolak sebelum sampai ke engine', async () => {
  const bigPdf = {
    name: 'skripsi_besar.pdf',
    type: OFFLINE_SCANNER_PDF_MIME,
    size: 11 * 1024 * 1024,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(bigPdf),
    'unsupported_file',
  );
});

test('A3: PDF dengan nama ekstensi tidak cocok ditolak', async () => {
  const mismatched = {
    name: 'dokumen.txt',
    type: 'application/pdf',
    size: 1000,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(mismatched),
    'unsupported_file',
  );
});

test('A4: Format non-dokumen ditolak dari pemrosesan Offline', async () => {
  const audioFile = {
    name: 'rekaman.mp3',
    type: 'audio/mpeg',
    size: 2048,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(audioFile),
    'unsupported_file',
  );
});

// ---------------------------------------------------------------------------
// B. Validasi Integritas Berkas PDF
// ---------------------------------------------------------------------------
test('B1: PDF dengan header tidak valid ditolak dengan kode pdf_invalid', async () => {
  const invalidHeader = new Uint8Array(100).fill(0x41);
  const file = new File([invalidHeader], 'bukan.pdf', { type: 'application/pdf' });
  await expectOfflineScannerError(
    processOfflineScannerFile(file),
    'pdf_invalid',
  );
});

test('B2: PDF kurang dari 5 bytes ditolak dengan pdf_invalid', async () => {
  const tooShort = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF'
  const file = new File([tooShort], 'kosong.pdf', { type: 'application/pdf' });
  await expectOfflineScannerError(
    processOfflineScannerFile(file),
    'pdf_invalid',
  );
});

test('B3: PDF dengan bytes rusak ditolak dengan kode aman', async () => {
  const corrupted = new Uint8Array(50);
  corrupted[0] = 0x25;
  corrupted[1] = 0x50;
  corrupted[2] = 0x44;
  corrupted[3] = 0x46;
  corrupted[4] = 0x2d;
  const file = new File([corrupted], 'rusak.pdf', { type: 'application/pdf' });
  await assert.rejects(
    processOfflineScannerFile(file, { baseUrl: 'http://localhost/' }),
    error => error instanceof OfflineScannerError
      && ['pdf_invalid', 'pdf_processing_failed', 'pdf_asset_error'].includes(error.code),
  );
});

// ---------------------------------------------------------------------------
// C. Pembatalan (Cancellation) & Signal
// ---------------------------------------------------------------------------
test('C1: AbortController membatalkan PDF sebelum proses dimulai', async () => {
  const controller = new AbortController();
  controller.abort();
  const pdfBytes = createSyntheticTextPdf('UNIMATE CANCEL TEST');
  const file = new File([pdfBytes], 'cancel.pdf', { type: 'application/pdf' });
  await expectOfflineScannerError(
    processOfflineScannerFile(file, { signal: controller.signal }),
    'request_cancelled',
  );
});

test('C2: AbortController yang dibatalkan segera setelah start menghasilkan request_cancelled', async () => {
  const controller = new AbortController();
  const pdfBytes = createSyntheticTextPdf('UNIMATE CANCEL TEST 2');
  const file = new File([pdfBytes], 'cancel2.pdf', { type: 'application/pdf' });
  const promise = processOfflineScannerFile(file, { signal: controller.signal });
  controller.abort();
  await expectOfflineScannerError(promise, 'request_cancelled');
});

// ---------------------------------------------------------------------------
// D. Nol Jaringan (Zero-Network)
// ---------------------------------------------------------------------------
test('D1: Pemrosesan PDF Offline tidak memanggil fetch atau jaringan', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('network_call_forbidden');
  };
  try {
    const pdfBytes = createSyntheticTextPdf('UNIMATE ZERO NETWORK');
    const file = new File([pdfBytes], 'zero_network.pdf', { type: 'application/pdf' });
    await processOfflineScannerFile(file).catch(() => {});
    assert.equal(fetchCalled, false, 'fetch tidak boleh dipanggil pada pemrosesan offline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// E. Kontrak Error Codes & Dependensi Terpin
// ---------------------------------------------------------------------------
test('E1: Kode error B4 aman dan tidak mengandung karakter berbahaya', () => {
  const safeCodes = [
    'request_cancelled',
    'unsupported_file',
    'empty_content',
    'pdf_invalid',
    'pdf_processing_failed',
    'pdf_asset_error',
    'ocr_canvas_unavailable',
    'ocr_processing_failed',
    'ocr_asset_error',
  ];
  for (const code of safeCodes) {
    const error = new OfflineScannerError(code);
    assert.equal(/^[a-z0-9_]+$/u.test(error.code), true);
  }
});

test('E2: Versi PDF.js dan Tesseract.js sesuai kontrak baseline', () => {
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.pdfjs, '6.4.299');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseract, '7.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseractCore, '7.0.0');
});

test('E3: Aset PDF.js dan Tesseract tersedia di public/offline-scanner/', async () => {
  const assetRoot = path.join(repositoryRoot, 'public', 'offline-scanner');
  const requiredFiles = [
    'pdfjs/pdf.min.mjs',
    'pdfjs/pdf.worker.min.mjs',
    'tesseract/tesseract.esm.min.js',
    'tesseract/worker.min.js',
    'tesseract/core/tesseract-core-lstm.wasm.js',
    'tesseract/lang/ind.traineddata.gz',
    'tesseract/lang/eng.traineddata.gz',
  ];
  for (const file of requiredFiles) {
    const fullPath = path.join(assetRoot, file);
    const stats = await fs.stat(fullPath);
    assert.equal(stats.isFile(), true, `${file} missing`);
    assert.equal(stats.size > 0, true, `${file} is empty`);
  }
});
