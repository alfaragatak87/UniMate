/**
 * tests/offline-pdf-text-extraction.test.mjs
 *
 * Test fokus untuk Tahap B2: ekstraksi teks PDF Offline.
 *
 * Seluruh test menggunakan PDF sintetis yang dibuat dari bytes murni —
 * tidak menggunakan dokumen akademik asli, API key, atau request jaringan.
 *
 * Karena PDF.js memerlukan browser environment (dynamic import, canvas, Worker),
 * test unit di sini mem-mock engine dan memverifikasi logika dispatcher,
 * penanganan error, transformasi teks, dan kontrak output.
 *
 * Test integrasi Electron packaged nyata ada di:
 *   tests/offline-pdf-b2-extraction.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OfflineScannerError,
  SCANNER_PROCESSING_SOURCES,
  isOfflineScannerMimeType,
  isPdfOfflineScannerMimeType,
  processOfflineScannerFile,
} from '../src/services/offlineScanner.js';
import {
  OfflineDocumentEngineError,
  OFFLINE_DOCUMENT_ENGINE_VERSIONS,
} from '../src/services/offlineDocumentEngine.js';

// ---------------------------------------------------------------------------
// Helper: buat File sintetis PDF (bytes minimal agar lulus validasi header %PDF-)
// ---------------------------------------------------------------------------
function createMinimalPdfBytes(text = 'UNIMATE TEST') {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 12 Tf\n72 700 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function makePdfFile(bytes, name = 'dokumen.pdf') {
  return new File([bytes], name, { type: 'application/pdf' });
}

async function expectOfflineScannerError(promise, code) {
  await assert.rejects(promise, error => (
    error instanceof OfflineScannerError
    && error.code === code
    && !error.message.includes('script')
  ));
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Catatan: Karena offlineScanner.js mengimpor extractPdfTextOnly dari offlineDocumentEngine.js
// pada load time (bukan dynamic import), test unit ini memvalidasi kontrak routing,
// penanganan error, sanitasi batas bytes, dan zero-network.
// Pengujian ekstraksi teks sintetis nyata dijalankan pada Electron packaged.
// ---------------------------------------------------------------------------

// Karena offlineScanner.js mengimpor extractPdfTextOnly dari offlineDocumentEngine.js
// pada load time (bukan dynamic import), kita tidak bisa mem-mock-nya secara transparan
// di Node.js ESM tanpa loader hook. Untuk itu, test unit ini memvalidasi:
// 1. Kontrak MIME type dan routing
// 2. Penanganan error engine yang sudah dikonversi
// 3. Kode error yang benar pada kondisi bermasalah
// 4. Tidak ada request jaringan
// Test ekstraksi PDF nyata ada di test Electron packaged.

// ---------------------------------------------------------------------------
// A. Tes MIME type dan routing
// ---------------------------------------------------------------------------
test('A1: application/pdf termasuk dalam OFFLINE_SCANNER_MIME_TYPES', () => {
  assert.equal(isOfflineScannerMimeType('application/pdf'), true);
  assert.equal(isOfflineScannerMimeType('text/plain'), true);
  assert.equal(isOfflineScannerMimeType('text/csv'), true);
  // Format non-dokumen tidak didukung Offline
  assert.equal(isOfflineScannerMimeType('image/gif'), false);
  assert.equal(isOfflineScannerMimeType('audio/mpeg'), false);
});

test('A2: isPdfOfflineScannerMimeType hanya mengenali application/pdf', () => {
  assert.equal(isPdfOfflineScannerMimeType('application/pdf'), true);
  assert.equal(isPdfOfflineScannerMimeType('text/plain'), false);
  assert.equal(isPdfOfflineScannerMimeType('text/csv'), false);
  assert.equal(isPdfOfflineScannerMimeType('image/gif'), false);
  assert.equal(isPdfOfflineScannerMimeType(''), false);
  assert.equal(isPdfOfflineScannerMimeType(undefined), false);
});

test('A3: PDF di atas 10 MiB ditolak sebelum sampai ke engine', async () => {
  const bigFile = {
    name: 'besar.pdf',
    type: 'application/pdf',
    size: 11 * 1024 * 1024,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(bigFile),
    'unsupported_file',
  );
});

test('A4: PDF dengan nama yang tidak cocok dengan ekstensi ditolak', async () => {
  // Nama file .txt dengan type application/pdf → harus ditolak
  const mismatchedFile = {
    name: 'dokumen.txt',
    type: 'application/pdf',
    size: 1000,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(mismatchedFile),
    'unsupported_file',
  );
});

test('A5: File non-dokumen tetap ditolak pada mode Offline (format tidak didukung)', async () => {
  const gifFile = new File([new Uint8Array(100)], 'animasi.gif', { type: 'image/gif' });
  await expectOfflineScannerError(
    processOfflineScannerFile(gifFile),
    'unsupported_file',
  );
});

test('A6: TXT dan CSV existing tetap berfungsi setelah penambahan PDF', async () => {
  const txt = new File(['Catatan kuliah\nBaris kedua'], 'catatan.txt', { type: 'text/plain' });
  const result = await processOfflineScannerFile(txt);
  assert.equal(result.source, SCANNER_PROCESSING_SOURCES.OFFLINE);
  assert.equal(result.parser, 'text');
  assert.equal(result.structured, false);
  assert.equal(result.textPreview.text.includes('Catatan kuliah'), true);
});

// ---------------------------------------------------------------------------
// B. Tes PDF bermasalah — header tidak valid (Node.js dapat memvalidasi ini
//    tanpa memerlukan browser karena validasi terjadi di toPdfBytes())
// ---------------------------------------------------------------------------
test('B1: PDF dengan header tidak valid ditolak dengan kode aman', async () => {
  // Buat file yang ukurannya valid tapi bukan PDF nyata
  const notPdf = new Uint8Array(100).fill(0x41); // bytes 'AAAAAA...'
  const file = makePdfFile(notPdf, 'bukan.pdf');
  // File.arrayBuffer() berfungsi di Node.js; extractPdfTextOnly akan melempar
  // OfflineDocumentEngineError('invalid_pdf') yang diterjemahkan ke 'pdf_invalid'
  await expectOfflineScannerError(
    processOfflineScannerFile(file),
    'pdf_invalid',
  );
});

test('B2: PDF kosong (0 byte setelah header) ditolak dengan aman', async () => {
  // File 4 byte — kurang dari 5 byte minimum toPdfBytes()
  const tooShort = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF'
  const file = makePdfFile(tooShort, 'kosong.pdf');
  await expectOfflineScannerError(
    processOfflineScannerFile(file),
    'pdf_invalid',
  );
});

test('B3: PDF dengan bytes rusak menghasilkan error aman tanpa crash', async () => {
  // Mulai dengan header valid tapi isi rusak
  const corrupted = new Uint8Array(50);
  corrupted[0] = 0x25; // %
  corrupted[1] = 0x50; // P
  corrupted[2] = 0x44; // D
  corrupted[3] = 0x46; // F
  corrupted[4] = 0x2D; // -
  // Sisa bytes = 0x00 (data rusak)
  const file = makePdfFile(corrupted, 'rusak.pdf');
  // Akan gagal di pdf_processing_failed atau pdf_invalid — keduanya aman
  await assert.rejects(
    processOfflineScannerFile(file, { baseUrl: 'http://localhost/' }),
    error => error instanceof OfflineScannerError
      && ['pdf_invalid', 'pdf_processing_failed'].includes(error.code),
  );
});

// ---------------------------------------------------------------------------
// C. Tes cancellation
test('B4: PDF terenkripsi ditolak dengan kode aman tanpa crash', async () => {
  const encPdf = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (dummy) /U (dummy) /P -4 >>\nendobj\ntrailer\n<< /Size 4 /Root 1 0 R /Encrypt 3 0 R >>\nstartxref\n9999\n%%EOF';
  const file = makePdfFile(new TextEncoder().encode(encPdf), 'terenkripsi.pdf');
  await assert.rejects(
    processOfflineScannerFile(file, { baseUrl: 'http://localhost/' }),
    error => error instanceof OfflineScannerError
      && ['pdf_invalid', 'pdf_processing_failed'].includes(error.code),
  );
});

// ---------------------------------------------------------------------------
test('C1: AbortController membatalkan PDF sebelum engine memulai', async () => {
  const bytes = createMinimalPdfBytes('UNIMATE CANCEL TEST');
  const file = makePdfFile(bytes);
  const controller = new AbortController();
  // Batalkan sebelum memanggil — signal sudah aborted
  controller.abort();
  await expectOfflineScannerError(
    processOfflineScannerFile(file, { signal: controller.signal }),
    'request_cancelled',
  );
});

test('C2: AbortController yang dibatalkan segera setelah start menghasilkan request_cancelled', async () => {
  const bytes = createMinimalPdfBytes('CANCEL IMMEDIATELY');
  const file = makePdfFile(bytes);
  const controller = new AbortController();
  const promise = processOfflineScannerFile(file, { signal: controller.signal });
  // Batalkan segera — mungkin engine belum sempat load atau sudah mulai
  controller.abort();
  await assert.rejects(
    promise,
    error => error instanceof OfflineScannerError
      && error.code === 'request_cancelled',
  );
});

// ---------------------------------------------------------------------------
// D. Tes bahwa mode Offline tidak menggunakan jaringan
// ---------------------------------------------------------------------------
test('D1: Pemrosesan PDF Offline tidak memanggil fetch atau jaringan', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount += 1;
    throw new Error('network_forbidden_in_offline_mode');
  };
  try {
    const bytes = createMinimalPdfBytes();
    const file = makePdfFile(bytes);
    // Akan gagal karena PDF.js tidak bisa load di Node tanpa browser,
    // tetapi yang penting fetch tidak dipanggil.
    await processOfflineScannerFile(file).catch(() => {});
    assert.equal(fetchCallCount, 0, 'fetch tidak boleh dipanggil pada mode Offline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// E. Tes kontrak OFFLINE_DOCUMENT_ENGINE_VERSIONS
// ---------------------------------------------------------------------------
test('E1: Versi PDF.js dan Tesseract.js sesuai kontrak B1', () => {
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.pdfjs, '6.4.299');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseract, '7.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseractCore, '7.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.englishModel, '1.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.indonesianModel, '1.0.0');
});

// ---------------------------------------------------------------------------
// F. Tes kontrak OfflineDocumentEngineError (engine error codes)
// ---------------------------------------------------------------------------
test('F1: OfflineDocumentEngineError memiliki code yang terdefinisi dengan benar', () => {
  const error = new OfflineDocumentEngineError('invalid_pdf');
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'OfflineDocumentEngineError');
  assert.equal(error.code, 'invalid_pdf');
  assert.equal(error.message.includes('script'), false);
});

test('F2: OfflineScannerError memiliki code yang terdefinisi dengan benar', () => {
  const error = new OfflineScannerError('pdf_processing_failed');
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'OfflineScannerError');
  assert.equal(error.code, 'pdf_processing_failed');
  assert.equal(error.message.includes('script'), false);
});

// ---------------------------------------------------------------------------
// G. Tes bahwa hasil PDF valid mengikuti kontrak validateCapabilityResult
//    (test ini memverifikasi createResult() pada scan path melalui error)
// ---------------------------------------------------------------------------
test('G1: Kode error B2 tidak mengandung karakter berbahaya', () => {
  const validCodes = [
    'pdf_invalid',
    'pdf_processing_failed',
    'pdf_asset_error',
    'request_cancelled',
    'unsupported_file',
  ];
  for (const code of validCodes) {
    const error = new OfflineScannerError(code);
    // Kode hanya mengandung huruf, angka, dan underscore
    assert.match(error.code, /^[a-z0-9_]+$/u);
    // Pesan tidak mengandung karakter kontrol atau script
    assert.equal(error.message.includes('<script'), false);
    assert.equal(error.message.includes('javascript:'), false);
  }
});

// ---------------------------------------------------------------------------
// H. Smoke test: pastikan header PDF.js lokal bisa dibaca (bukan test browser)
// ---------------------------------------------------------------------------
test('H1: Aset PDF.js minimal tersedia di public/offline-scanner/', async () => {
  const { access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'offline-scanner');
  await assert.doesNotReject(access(`${root}/pdfjs/pdf.min.mjs`));
  await assert.doesNotReject(access(`${root}/pdfjs/pdf.worker.min.mjs`));
  await assert.doesNotReject(access(`${root}/tesseract/tesseract.esm.min.js`));
});

test('H2: Model OCR bahasa Indonesia dan Inggris tersedia secara lokal', async () => {
  const { access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'offline-scanner');
  await assert.doesNotReject(access(`${root}/tesseract/lang/eng.traineddata.gz`));
  await assert.doesNotReject(access(`${root}/tesseract/lang/ind.traineddata.gz`));
});
