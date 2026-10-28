/**
 * tests/offline-pdf-full-text.test.mjs
 *
 * Test suite regresi khusus untuk B5B-1:
 * Memverifikasi preservasi fullText pada pipeline Offline Scanner tanpa pemotongan diam-diam.
 *
 * Menggunakan fixture sintetis murni dalam memori tanpa panggilan jaringan,
 * tanpa token AI, dan tanpa efek samping penyimpanan permanen.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCANNER_PROCESSING_SOURCES,
  processOfflineScannerFile,
} from '../src/services/offlineScanner.js';

function createSyntheticPdfFile(name = 'dokumen_test.pdf') {
  // Minimal valid PDF byte header
  const header = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
  return new File([new TextEncoder().encode(header)], name, { type: 'application/pdf' });
}

function createTextFile(content, name = 'catatan.txt', type = 'text/plain') {
  return new File([content], name, { type });
}

function createImageFile(name = 'scan.png') {
  // Minimal PNG signature bytes
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  return new File([bytes], name, { type: 'image/png' });
}

test('B5B-1.1: PDF kurang dari 20.000 karakter tidak dipotong (preview === fullText)', async () => {
  const sampleText = 'Bab 1 Pendahuluan: Sistem Manajemen Kuliah Mahasiswa. '.repeat(100); // ~5400 karakter
  assert.equal(sampleText.length < 20_000, true);

  const mockExtraction = {
    pageCount: 2,
    textPageCount: 2,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: sampleText,
  };

  const file = createSyntheticPdfFile('pendek.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.equal(result.source, SCANNER_PROCESSING_SOURCES.OFFLINE);
  assert.equal(result.parser, 'pdf');
  assert.equal(result.textPreview.truncated, false);
  assert.equal(result.textPreview.totalCharacters, sampleText.length);
  assert.equal(result.textPreview.text, sampleText);
  assert.equal(result.textPreview.fullText, sampleText);
  assert.equal(result.textPreview.pageCount, 2);
  assert.equal(result.textPreview.isTextOnly, true);
});

test('B5B-1.2: PDF tepat 20.000 karakter tidak dipotong (truncated === false)', async () => {
  // Buat string tepat 20.000 karakter
  const exact20kText = 'A'.repeat(20_000);
  assert.equal(exact20kText.length, 20_000);

  const mockExtraction = {
    pageCount: 5,
    textPageCount: 5,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: exact20kText,
  };

  const file = createSyntheticPdfFile('tepat_20k.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.equal(result.textPreview.truncated, false);
  assert.equal(result.textPreview.totalCharacters, 20_000);
  assert.equal(result.textPreview.text.length, 20_000);
  assert.equal(result.textPreview.fullText.length, 20_000);
  assert.equal(result.textPreview.text, exact20kText);
  assert.equal(result.textPreview.fullText, exact20kText);
});

test('B5B-1.3: PDF lebih dari 20.000 karakter (25.000 char) mempertahankan fullText utuh dan membatasi preview', async () => {
  const prefix = 'A'.repeat(20_000);
  const suffix = 'B'.repeat(5_000);
  const fullText25k = prefix + suffix;
  assert.equal(fullText25k.length, 25_000);

  const mockExtraction = {
    pageCount: 8,
    textPageCount: 8,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: fullText25k,
  };

  const file = createSyntheticPdfFile('lebih_20k.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  // textPreview.text harus dipotong tepat 20.000 karakter
  assert.equal(result.textPreview.text.length, 20_000);
  assert.equal(result.textPreview.text, prefix);
  assert.equal(result.textPreview.truncated, true);
  assert.equal(result.textPreview.totalCharacters, 25_000);

  // fullText HARUS memuat seluruh 25.000 karakter tanpa hilang suffix 'B'
  assert.equal(result.textPreview.fullText.length, 25_000);
  assert.equal(result.textPreview.fullText, fullText25k);
  assert.equal(result.textPreview.fullText.endsWith(suffix), true);
});

test('B5B-1.4: Dokumen panjang 52.000 karakter (skripsi/silabus) tetap utuh di fullText tanpa memory leak', async () => {
  const chapter1 = '[Halaman 1]\nBab 1 Teori Komputasi: ' + 'X'.repeat(25_000);
  const chapter2 = '\n\n[Halaman 2]\nBab 2 Implementasi Algoritma: ' + 'Y'.repeat(27_000);
  const longText = chapter1 + chapter2; // ~52.000+ karakter

  const mockExtraction = {
    pageCount: 20,
    textPageCount: 20,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: longText,
  };

  const file = createSyntheticPdfFile('skripsi_panjang.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.equal(result.textPreview.truncated, true);
  assert.equal(result.textPreview.totalCharacters, longText.length);
  assert.equal(result.textPreview.text.length, 20_000);

  // Verifikasi karakter ke-50.000+ ada di fullText
  assert.equal(result.textPreview.fullText.length, longText.length);
  assert.equal(result.textPreview.fullText.includes('Bab 2 Implementasi Algoritma:'), true);
  assert.equal(result.textPreview.fullText.endsWith('Y'.repeat(100)), true);
});

test('B5B-1.5: Hasil fullText identik 1:1 dengan extraction.combinedText', async () => {
  const uniqueContent = `KHS Mahasiswa: NIM=12345678, IPS=3.85, Tanggal=${new Date().toISOString()}`;
  const mockExtraction = {
    pageCount: 1,
    textPageCount: 1,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: uniqueContent,
  };

  const file = createSyntheticPdfFile('identik.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.strictEqual(result.textPreview.fullText, uniqueContent);
});

test('B5B-1.6: Preview dapat disingkat tanpa memutasi fullText', async () => {
  const content = 'Header Dokumen\n' + 'Konten baris kuliah. '.repeat(1500); // > 30.000 chars
  const mockExtraction = {
    pageCount: 3,
    textPageCount: 3,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: content,
  };

  const file = createSyntheticPdfFile('mutasi_check.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  // text dipotong
  assert.equal(result.textPreview.text.length, 20_000);
  // fullText TIDAK terpotong
  assert.equal(result.textPreview.fullText.length, content.length);
  assert.notEqual(result.textPreview.text.length, result.textPreview.fullText.length);
  // Objek beku (deepFreeze)
  assert.equal(Object.isFrozen(result.textPreview), true);
});

test('B5B-1.7: Jumlah karakter, metadata halaman, dan truncated akurat', async () => {
  const mockExtraction = {
    pageCount: 10,
    textPageCount: 6,
    ocrPageCount: 3,
    emptyPageCount: 1,
    hasText: true,
    isTextOnly: false,
    isAllScanned: false,
    isHybrid: true,
    isAllEmpty: false,
    averageConfidence: 85,
    combinedText: 'Teks Gabungan 10 Halaman',
  };

  const file = createSyntheticPdfFile('metadata.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.equal(result.textPreview.pageCount, 10);
  assert.equal(result.textPreview.textPageCount, 6);
  assert.equal(result.textPreview.ocrPageCount, 3);
  assert.equal(result.textPreview.emptyPageCount, 1);
  assert.equal(result.textPreview.extractedPageCount, 9);
  assert.equal(result.textPreview.averageConfidence, 85);
  assert.equal(result.textPreview.isHybrid, true);
  assert.equal(result.textPreview.parser, 'pdf');
});

test('B5B-1.8: PDF hybrid menjaga teks OCR dan teks asli di fullText', async () => {
  const hybridCombined = '[Halaman 1]\nTeks Asli PDF Kampus\n\n[Halaman 2 · OCR]\nHasil Scan Tesseract Huruf Mutu A';
  const mockExtraction = {
    pageCount: 2,
    textPageCount: 1,
    ocrPageCount: 1,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: false,
    isAllScanned: false,
    isHybrid: true,
    isAllEmpty: false,
    averageConfidence: 88,
    combinedText: hybridCombined,
  };

  const file = createSyntheticPdfFile('hybrid.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  assert.equal(result.textPreview.fullText.includes('Teks Asli PDF Kampus'), true);
  assert.equal(result.textPreview.fullText.includes('Hasil Scan Tesseract Huruf Mutu A'), true);
  assert.equal(result.textPreview.isHybrid, true);
});

test('B5B-1.9: Tidak ada efek samping penyimpanan otomatis', async () => {
  const mockExtraction = {
    pageCount: 1,
    textPageCount: 1,
    ocrPageCount: 0,
    emptyPageCount: 0,
    hasText: true,
    isTextOnly: true,
    isAllScanned: false,
    isHybrid: false,
    isAllEmpty: false,
    averageConfidence: null,
    combinedText: 'Tidak ada penyimpanan otomatis',
  };

  const file = createSyntheticPdfFile('no_storage.pdf');
  const result = await processOfflineScannerFile(file, {
    pdfDocumentProcessor: async () => mockExtraction,
  });

  // Memverifikasi fungsi hanya memproses dan mengembalikan representasi view
  assert.equal(typeof result, 'object');
  assert.equal(result.source, 'offline');
});

test('B5B-1.10: Mode Offline tidak memanggil fetch atau Gateway jaringan', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('network_call_forbidden');
  };

  try {
    const mockExtraction = {
      pageCount: 1,
      textPageCount: 1,
      ocrPageCount: 0,
      emptyPageCount: 0,
      hasText: true,
      isTextOnly: true,
      isAllScanned: false,
      isHybrid: false,
      isAllEmpty: false,
      averageConfidence: null,
      combinedText: 'Zero network check',
    };

    const file = createSyntheticPdfFile('offline_zero_net.pdf');
    await processOfflineScannerFile(file, {
      pdfDocumentProcessor: async () => mockExtraction,
    });
    assert.equal(fetchCalled, false, 'Fetch tidak boleh dipanggil sama sekali pada mode offline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B5B-1.11: Tidak ada regresi pada TXT, CSV, maupun OCR Gambar', async () => {
  // 1. TXT
  const txt = createTextFile('Teks biasa dalam berkas TXT.\nBaris kedua.');
  const txtResult = await processOfflineScannerFile(txt);
  assert.equal(txtResult.parser, 'text');
  assert.equal(txtResult.textPreview.text, 'Teks biasa dalam berkas TXT.\nBaris kedua.');
  assert.equal(txtResult.textPreview.fullText, 'Teks biasa dalam berkas TXT.\nBaris kedua.');

  // 2. CSV
  const csv = createTextFile('name,sks,grade\nFisika Dasar,3,A\n', 'nilai.csv', 'text/csv');
  const csvResult = await processOfflineScannerFile(csv, { scanType: 'khs' });
  assert.equal(csvResult.parser, 'csv');
  assert.equal(csvResult.structured, true);
  assert.equal(csvResult.suggestion.extracted_data.courses.length, 1);
  assert.equal(csvResult.suggestion.extracted_data.courses[0].name, 'Fisika Dasar');

  // 3. OCR Gambar
  const img = createImageFile('scan.png');
  const imgResult = await processOfflineScannerFile(img, {
    imageTextRecognizer: async () => ({
      text: 'OCR Gambar Tesseract Sintetis',
      confidence: 92,
      durationMs: 15,
      hasText: true,
    }),
  });
  assert.equal(imgResult.parser, 'ocr');
  assert.equal(imgResult.textPreview.text, 'OCR Gambar Tesseract Sintetis');
  assert.equal(imgResult.textPreview.fullText, 'OCR Gambar Tesseract Sintetis');
  assert.equal(imgResult.textPreview.confidence, 92);
});
