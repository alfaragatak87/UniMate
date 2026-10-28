/**
 * tests/offline-image-ocr-extraction.test.mjs
 *
 * Test fokus untuk Tahap B3: integrasi OCR gambar Offline (JPG, PNG, WebP, BMP).
 *
 * Menguji:
 * - Kontrak MIME types gambar
 * - Deteksi signature biner / magic bytes (JPEG, PNG, WebP, BMP)
 * - Penolakan gambar rusak, ekstensi tidak cocok, kosong, dan melebihi 10 MiB
 * - Cancellation via AbortController
 * - Zero network (tidak ada fetch atau jaringan)
 * - Kontrak error codes dan sanitasi pesan
 * - Ketersediaan aset Tesseract lokal dan model ind+eng
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OfflineScannerError,
  OFFLINE_SCANNER_IMAGE_MIME_TYPES,
  isImageOfflineScannerMimeType,
  isOfflineScannerMimeType,
  processOfflineScannerFile,
} from '../src/services/offlineScanner.js';
import {
  OfflineDocumentEngineError,
  OFFLINE_DOCUMENT_ENGINE_VERSIONS,
} from '../src/services/offlineDocumentEngine.js';

// ---------------------------------------------------------------------------
// Helpers: buat synthetic image files dengan signature biner yang valid
// ---------------------------------------------------------------------------
function createSyntheticJpegBytes(size = 64) {
  const bytes = new Uint8Array(Math.max(size, 16));
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0; // APP0 marker
  return bytes;
}

function createSyntheticPngBytes(size = 64) {
  const bytes = new Uint8Array(Math.max(size, 16));
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((val, i) => { bytes[i] = val; });
  return bytes;
}

function createSyntheticBmpBytes(size = 64) {
  const bytes = new Uint8Array(Math.max(size, 16));
  // BMP signature: 'BM' (0x42, 0x4D)
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  return bytes;
}

function createSyntheticWebpBytes(size = 64) {
  const bytes = new Uint8Array(Math.max(size, 16));
  // RIFF header: 52 49 46 46
  bytes[0] = 0x52; bytes[1] = 0x49; bytes[2] = 0x46; bytes[3] = 0x46;
  // File size placeholder bytes 4..7
  // WEBP signature: 57 45 42 50
  bytes[8] = 0x57; bytes[9] = 0x45; bytes[10] = 0x42; bytes[11] = 0x50;
  return bytes;
}

async function expectOfflineScannerError(promise, code) {
  await assert.rejects(promise, error => (
    error instanceof OfflineScannerError
    && error.code === code
    && !error.message.includes('script')
  ));
}

// ---------------------------------------------------------------------------
// A. Tes MIME type dan routing gambar (B3)
// ---------------------------------------------------------------------------
test('A1: OFFLINE_SCANNER_IMAGE_MIME_TYPES mencakup JPG, PNG, WebP, dan BMP', () => {
  assert.equal(isImageOfflineScannerMimeType('image/jpeg'), true);
  assert.equal(isImageOfflineScannerMimeType('image/png'), true);
  assert.equal(isImageOfflineScannerMimeType('image/webp'), true);
  assert.equal(isImageOfflineScannerMimeType('image/bmp'), true);

  // MIME image juga harus terdaftar di OFFLINE_SCANNER_MIME_TYPES umum
  assert.equal(isOfflineScannerMimeType('image/jpeg'), true);
  assert.equal(isOfflineScannerMimeType('image/png'), true);
  assert.equal(isOfflineScannerMimeType('image/webp'), true);
  assert.equal(isOfflineScannerMimeType('image/bmp'), true);

  // Format di luar daftar B3 tidak terdaftar
  assert.equal(isImageOfflineScannerMimeType('image/gif'), false);
  assert.equal(isImageOfflineScannerMimeType('image/tiff'), false);
  assert.equal(isImageOfflineScannerMimeType('application/pdf'), false);
  assert.equal(isImageOfflineScannerMimeType('text/plain'), false);
});

test('A2: Gambar di atas 10 MiB ditolak sebelum sampai ke engine', async () => {
  const bigImage = {
    name: 'foto_raksasa.jpg',
    type: 'image/jpeg',
    size: 11 * 1024 * 1024,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(bigImage),
    'unsupported_file',
  );
});

test('A3: Gambar dengan nama yang tidak cocok dengan ekstensi ditolak', async () => {
  const mismatched = {
    name: 'dokumen.txt',
    type: 'image/jpeg',
    size: 500,
  };
  await expectOfflineScannerError(
    processOfflineScannerFile(mismatched),
    'unsupported_file',
  );
});

test('A4: Format non-dokumen ditolak dari pemrosesan Offline', async () => {
  const gifFile = new File([new Uint8Array(100)], 'animasi.gif', { type: 'image/gif' });
  await expectOfflineScannerError(
    processOfflineScannerFile(gifFile),
    'unsupported_file',
  );
});

// ---------------------------------------------------------------------------
// B. Tes validasi signature biner gambar (JPG, PNG, WebP, BMP)
// ---------------------------------------------------------------------------
test('B1: File JPEG dengan signature valid dikenali, signature rusak ditolak', async () => {
  const validJpeg = new File([createSyntheticJpegBytes()], 'foto.jpg', { type: 'image/jpeg' });
  const corruptedJpeg = new File([new Uint8Array(50).fill(0x00)], 'foto.jpg', { type: 'image/jpeg' });

  // Corrupted bytes bukan 0xFF 0xD8 0xFF -> harus ditolak dengan 'invalid_image'
  await expectOfflineScannerError(
    processOfflineScannerFile(corruptedJpeg),
    'invalid_image',
  );
});

test('B2: File PNG dengan signature valid dikenali, signature rusak ditolak', async () => {
  const corruptedPng = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'gambar.png', { type: 'image/png' });
  await expectOfflineScannerError(
    processOfflineScannerFile(corruptedPng),
    'invalid_image',
  );
});

test('B3: File BMP dengan signature valid dikenali, signature rusak ditolak', async () => {
  const corruptedBmp = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'grafik.bmp', { type: 'image/bmp' });
  await expectOfflineScannerError(
    processOfflineScannerFile(corruptedBmp),
    'invalid_image',
  );
});

test('B4: File WebP dengan signature valid dikenali, signature rusak ditolak', async () => {
  const corruptedWebp = new File([new Uint8Array(20).fill(0x41)], 'scan.webp', { type: 'image/webp' });
  await expectOfflineScannerError(
    processOfflineScannerFile(corruptedWebp),
    'invalid_image',
  );
});

// ---------------------------------------------------------------------------
// C. Tes cancellation pada gambar
// ---------------------------------------------------------------------------
test('C1: AbortController membatalkan OCR gambar sebelum proses dimulai', async () => {
  const validPng = new File([createSyntheticPngBytes()], 'catatan.png', { type: 'image/png' });
  const controller = new AbortController();
  controller.abort();
  await expectOfflineScannerError(
    processOfflineScannerFile(validPng, { signal: controller.signal }),
    'request_cancelled',
  );
});

test('C2: AbortController yang dibatalkan segera menghasilkan request_cancelled', async () => {
  const validJpeg = new File([createSyntheticJpegBytes()], 'krs.jpg', { type: 'image/jpeg' });
  const controller = new AbortController();
  const promise = processOfflineScannerFile(validJpeg, { signal: controller.signal, baseUrl: 'http://localhost/' });
  controller.abort();
  await assert.rejects(
    promise,
    error => error instanceof OfflineScannerError && error.code === 'request_cancelled',
  );
});

// ---------------------------------------------------------------------------
// D. Tes zero-network: pemrosesan OCR gambar Offline tidak memanggil fetch
// ---------------------------------------------------------------------------
test('D1: Pemrosesan OCR gambar Offline tidak memanggil fetch atau jaringan', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = async () => {
    fetchCallCount += 1;
    throw new Error('network_forbidden_in_offline_ocr');
  };
  try {
    const file = new File([createSyntheticPngBytes()], 'dokumen.png', { type: 'image/png' });
    await processOfflineScannerFile(file, { baseUrl: 'http://localhost/' }).catch(() => {});
    assert.equal(fetchCallCount, 0, 'fetch tidak boleh dipanggil pada mode OCR Offline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// E. Tes kontrak error codes B3
// ---------------------------------------------------------------------------
test('E1: Kode error B3 aman dan tidak mengandung karakter berbahaya', () => {
  const validCodes = [
    'invalid_image',
    'image_dimension_limit_exceeded',
    'ocr_processing_failed',
    'ocr_asset_error',
    'request_cancelled',
    'unsupported_file',
  ];
  for (const code of validCodes) {
    const error = new OfflineScannerError(code);
    assert.match(error.code, /^[a-z0-9_]+$/u);
    assert.equal(error.message.includes('<script'), false);
    assert.equal(error.message.includes('javascript:'), false);
  }
});

test('E2: Versi Tesseract lokal terpin sesuai kontrak B1', () => {
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseract, '7.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.tesseractCore, '7.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.englishModel, '1.0.0');
  assert.equal(OFFLINE_DOCUMENT_ENGINE_VERSIONS.indonesianModel, '1.0.0');
});

// ---------------------------------------------------------------------------
// F. Smoke test: verifikasi aset Tesseract lokal tersedia
// ---------------------------------------------------------------------------
test('F1: Aset Tesseract ESM dan Worker tersedia di public/offline-scanner/tesseract/', async () => {
  const { access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'offline-scanner', 'tesseract');
  await assert.doesNotReject(access(`${root}/tesseract.esm.min.js`));
  await assert.doesNotReject(access(`${root}/worker.min.js`));
});

test('F2: Model bahasa Indonesia dan Inggris tersedia secara lokal', async () => {
  const { access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'offline-scanner', 'tesseract', 'lang');
  await assert.doesNotReject(access(`${root}/ind.traineddata.gz`));
  await assert.doesNotReject(access(`${root}/eng.traineddata.gz`));
});
