import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('UI memisahkan sumber Offline dan Gemini dari tiga mode dokumen existing', async () => {
  const source = await read('../src/pages/AIScanner.jsx');

  assert.match(source, /useState\(SCANNER_PROCESSING_SOURCES\.OFFLINE\)/u);
  assert.match(source, />Offline \(Lokal\)</u);
  assert.match(source, />Gemini Online</u);
  assert.match(source, />Otomatis</u);
  assert.match(source, />KRS\/Jadwal</u);
  assert.match(source, />Agenda Event</u);
  assert.equal(source.includes('navigator.onLine'), false);
});

test('jalur Offline memproses lokal sebelum jalur Gateway dan tidak memiliki fallback otomatis', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  const handleStart = source.indexOf('const handleScan = async');
  const onlineStart = source.indexOf('const aiFile = await fileToAIInput', handleStart);
  const offlineBranch = source.slice(handleStart, onlineStart);

  assert.notEqual(handleStart, -1);
  assert.equal(onlineStart > handleStart, true);
  assert.match(offlineBranch, /processOfflineScannerFile/u);
  assert.match(offlineBranch, /isOfflineScannerMimeType/u);
  assert.equal(offlineBranch.includes('frontendAIClient'), false);
  assert.equal(offlineBranch.includes('startDocumentScan'), false);
  assert.equal(offlineBranch.includes('setProcessingSource(SCANNER_PROCESSING_SOURCES.GEMINI)'), false);
});

test('Gemini memerlukan pilihan manual dan consent per dokumen tanpa probe koneksi', async () => {
  const source = await read('../src/pages/AIScanner.jsx');

  assert.match(source, /onClick=\{\(\) => handleProcessingSourceChange\(SCANNER_PROCESSING_SOURCES\.GEMINI\)\}/u);
  assert.match(source, /selection\.freeTierDataConsent \|\| !onlineDocumentConsent/u);
  assert.match(source, /checked=\{onlineDocumentConsent\}/u);
  assert.match(source, /frontendAIClient\.startDocumentScan/u);
  assert.match(source, /Status tidak diuji otomatis/u);
});

test('autoScan tidak pernah mengirim dokumen ke Gemini', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  const effectStart = source.indexOf('location.state?.autoScan');
  const effectEnd = source.indexOf('const previewData', effectStart);
  const autoScanEffect = source.slice(effectStart, effectEnd);

  assert.notEqual(effectStart, -1);
  assert.match(autoScanEffect, /processingSource === SCANNER_PROCESSING_SOURCES\.OFFLINE/u);
  assert.match(autoScanEffect, /isOfflineScannerMimeType\(fileToUpload\.type\)/u);
  assert.equal(autoScanEffect.includes('SCANNER_PROCESSING_SOURCES.GEMINI'), false);
});

test('review teks Offline dirender sebagai teks aman dan penyimpanan tetap melalui konfirmasi existing', async () => {
  const source = await read('../src/pages/AIScanner.jsx');

  assert.match(source, /\{offlineTextPreview\.text\}/u);
  assert.equal(source.includes('dangerouslySetInnerHTML'), false);
  assert.match(source, /onClick=\{saveManual\}/u);
  assert.match(source, /persistScannerDocumentWithMetadata/u);
  assert.match(source, /Pilih semester tujuan/u);
});

test('service Offline tidak memiliki akses jaringan, Gateway, API key, atau bridge Electron', async () => {
  const source = await read('../src/services/offlineScanner.js');

  assert.match(source, /from 'papaparse'/u);
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('XMLHttpRequest'), false);
  assert.equal(source.includes('frontendAIClient'), false);
  assert.equal(source.includes('electronAPI'), false);
  assert.equal(source.includes('apiKey'), false);
});

test('preview, drag-drop, clipboard, cancellation tersedia dan progress bar PDF ditampilkan', async () => {
  const source = await read('../src/pages/AIScanner.jsx');

  assert.match(source, /onDrop=\{handleDrop\}/u);
  assert.match(source, /navigator\.clipboard\.read\(\)/u);
  assert.match(source, /handleCancelScan/u);
  assert.match(source, /offlineAbortControllerRef\.current\?\.abort\(\)/u);
  // Progress bar PDF harus tersedia (B2)
  assert.match(source, /pdfProgress/u);
  assert.match(source, /Memproses halaman/u);
  // Preview iframe/img tetap tersedia
  assert.match(source, /<iframe src=\{imagePreview\}/u);
  assert.match(source, /<img src=\{imagePreview\}/u);
});

test('B4: OCR gambar, PDF scan, dan PDF campuran didukung Offline tanpa jaringan', async () => {
  const scannerSource = await read('../src/pages/AIScanner.jsx');
  const offlineScannerSource = await read('../src/services/offlineScanner.js');

  // PDF dan Gambar masuk cabang Offline (B4)
  assert.match(offlineScannerSource, /application\/pdf/u);
  assert.match(offlineScannerSource, /processPdfDocumentOffline/u);
  assert.match(offlineScannerSource, /isImageOfflineScannerMimeType/u);
  assert.match(offlineScannerSource, /recognizeImageText/u);
  assert.match(scannerSource, /isPdfOfflineScannerMimeType/u);
  assert.match(scannerSource, /isImageOfflineScannerMimeType/u);

  // Informasi bahwa PDF (teks asli, scan, & campuran) serta OCR gambar diproses secara lokal
  assert.match(scannerSource, /PDF \(teks asli, scan, & campuran\), serta OCR gambar/u);

  // Status PDF scan dan hybrid ditangani
  assert.match(offlineScannerSource, /isAllScanned/u);
  assert.match(offlineScannerSource, /isHybrid/u);

  // Tidak ada request jaringan, API key, atau Gateway
  assert.equal(offlineScannerSource.includes('fetch('), false);
  assert.equal(offlineScannerSource.includes('apiKey'), false);
  assert.equal(offlineScannerSource.includes('frontendAIClient'), false);
});
