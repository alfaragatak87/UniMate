import { extractPdfTextOnly } from './offline-document-engine.mjs';

const diagnostic = {
  stage: 'renderer_loaded',
  code: null,
  pdfTextStage: 'not_started',
  pdfWorkerLoaded: false,
  progressReported: false,
  cancellationWorked: false,
};

function setStage(stage) {
  diagnostic.stage = stage;
  diagnostic.pdfTextStage = stage;
}

function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/^[a-z0-9_]+$/u.test(code)) return code;
  const names = new Map([
    ['TypeError', 'renderer_type_error'],
    ['ReferenceError', 'renderer_reference_error'],
    ['SecurityError', 'renderer_security_error'],
    ['NetworkError', 'renderer_network_error'],
  ]);
  return names.get(error?.name) ?? 'renderer_proof_failed';
}

globalThis.getPdfTextExtractionDiagnostic = () => ({ ...diagnostic });

/**
 * Buat PDF sintetis satu halaman dengan teks yang diketahui.
 * Menggunakan format PDF 1.7 minimal yang valid.
 */
function createSyntheticTextPdf(text) {
  const stream = text && text.trim().length > 0
    ? `BT\n/F1 18 Tf\n72 700 Td\n(${text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj\nET`
    : 'q 10 10 100 100 re f Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

/**
 * Buat PDF sintetis multi-halaman (dua halaman) dengan teks berbeda per halaman.
 */
function createSyntheticMultiPagePdf(page1Text, page2Text) {
  function makeStream(text) {
    if (!text || text.trim().length === 0) return 'q 10 10 100 100 re f Q';
    const escaped = text
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
    return `BT\n/F1 14 Tf\n72 700 Td\n(${escaped}) Tj\nET`;
  }
  const stream1 = makeStream(page1Text);
  const stream2 = makeStream(page2Text);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`,
    `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
  ];
  let body = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

globalThis.runPdfTextExtractionProof = async () => {
  try {
    // --- Tes 1: PDF satu halaman, teks bahasa Indonesia ---
    setStage('single_page_id');
    const TEKS_ID = 'JADWAL KULIAH SEMESTER GANJIL UNIMATE';
    const singlePageBytes = createSyntheticTextPdf(TEKS_ID);
    const progressUpdates = [];
    const singlePageResult = await extractPdfTextOnly(singlePageBytes, {
      baseUrl: document.baseURI,
      onProgress: update => {
        progressUpdates.push({ ...update });
        diagnostic.progressReported = true;
      },
    });
    diagnostic.pdfWorkerLoaded = true;

    // Verifikasi struktur hasil
    if (singlePageResult.pageCount !== 1) throw new Error('single_page_count_mismatch');
    if (singlePageResult.extractedPageCount !== 1) throw new Error('single_extracted_count_mismatch');
    if (singlePageResult.scannedPageCount !== 0) throw new Error('single_scanned_count_nonzero');
    if (singlePageResult.isAllScanned) throw new Error('single_should_not_be_all_scanned');
    if (!singlePageResult.pages || singlePageResult.pages.length !== 1) throw new Error('single_pages_array_invalid');
    if (!singlePageResult.pages[0].hasText) throw new Error('single_page_should_have_text');
    // Verifikasi teks yang diekstrak mengandung kata kunci yang diketahui
    const singleText = singlePageResult.combinedText.toUpperCase();
    const singleWordsFound = ['JADWAL', 'KULIAH', 'UNIMATE'].filter(word => singleText.includes(word));
    if (singleWordsFound.length < 2) throw new Error(`single_text_words_not_found_${singleWordsFound.length}`);
    // Verifikasi progress dilaporkan
    if (progressUpdates.length < 1) throw new Error('single_no_progress_reported');

    // --- Tes 2: PDF multi-halaman, teks campuran Indonesia-Inggris ---
    setStage('multi_page');
    const PAGE1_TEXT = 'MATA KULIAH ALGORITMA PEMROGRAMAN';
    const PAGE2_TEXT = 'ALGORITHM DATA STRUCTURE SEMESTER TWO';
    const multiPageBytes = createSyntheticMultiPagePdf(PAGE1_TEXT, PAGE2_TEXT);
    const multiPageResult = await extractPdfTextOnly(multiPageBytes, {
      baseUrl: document.baseURI,
    });

    if (multiPageResult.pageCount !== 2) throw new Error('multi_page_count_mismatch');
    if (multiPageResult.extractedPageCount !== 2) throw new Error('multi_extracted_count_mismatch');
    if (multiPageResult.scannedPageCount !== 0) throw new Error('multi_scanned_count_nonzero');
    if (multiPageResult.pages.length !== 2) throw new Error('multi_pages_array_invalid');
    // Kedua halaman harus punya teks
    if (!multiPageResult.pages[0].hasText) throw new Error('multi_page1_no_text');
    if (!multiPageResult.pages[1].hasText) throw new Error('multi_page2_no_text');
    // Teks gabungan harus mengandung kata dari kedua halaman
    const multiText = multiPageResult.combinedText.toUpperCase();
    const page1Found = ['MATA', 'KULIAH', 'ALGORITMA'].some(w => multiText.includes(w));
    const page2Found = ['ALGORITHM', 'DATA', 'SEMESTER'].some(w => multiText.includes(w));
    if (!page1Found || !page2Found) throw new Error('multi_text_pages_not_both_found');
    // Untuk PDF multi-halaman, combinedText harus mengandung label halaman
    if (!multiPageResult.combinedText.includes('[Halaman 1]')) throw new Error('multi_page_label_missing');

    // --- Tes 3: PDF tanpa teks (scan murni, tidak ada teks asli) ---
    setStage('all_scanned');
    const scannedBytes = createSyntheticTextPdf('');
    const allScannedResult = await extractPdfTextOnly(scannedBytes, {
      baseUrl: document.baseURI,
    });
    if (allScannedResult.pageCount !== 1) throw new Error('scanned_page_count_mismatch');
    if (allScannedResult.extractedPageCount !== 0) throw new Error('scanned_extracted_count_nonzero');
    if (allScannedResult.scannedPageCount !== 1) throw new Error('scanned_scanned_count_mismatch');
    if (!allScannedResult.isAllScanned) throw new Error('scanned_is_all_scanned_false');
    if (allScannedResult.isPartial) throw new Error('scanned_is_partial_true');

    // --- Tes 4: PDF campuran (halaman 1 teks, halaman 2 scan tanpa teks) ---
    setStage('mixed_pages');
    const MIXED_PAGE1_TEXT = 'HALAMAN PERTAMA DENGAN TEKS VALID';
    const mixedBytes = createSyntheticMultiPagePdf(MIXED_PAGE1_TEXT, '');
    const mixedResult = await extractPdfTextOnly(mixedBytes, {
      baseUrl: document.baseURI,
    });
    if (mixedResult.pageCount !== 2) throw new Error('mixed_page_count_mismatch');
    if (mixedResult.extractedPageCount !== 1) throw new Error('mixed_extracted_count_mismatch');
    if (mixedResult.scannedPageCount !== 1) throw new Error('mixed_scanned_count_mismatch');
    if (!mixedResult.isPartial) throw new Error('mixed_is_partial_false');
    if (mixedResult.isAllScanned) throw new Error('mixed_is_all_scanned_true');
    if (!mixedResult.pages[0].hasText) throw new Error('mixed_page1_should_have_text');
    if (mixedResult.pages[1].hasText) throw new Error('mixed_page2_should_not_have_text');
    if (!mixedResult.combinedText.includes('HALAMAN PERTAMA')) throw new Error('mixed_page1_text_missing');

    // --- Tes 5: Cancellation ---
    setStage('cancellation');
    const cancelBytes = createSyntheticTextPdf('CANCEL TEST UNIMATE B2');
    const cancelController = new AbortController();
    // Batalkan segera — sebelum engine sempat berjalan
    cancelController.abort();
    let cancellationErrorCode = null;
    try {
      await extractPdfTextOnly(cancelBytes, {
        baseUrl: document.baseURI,
        signal: cancelController.signal,
      });
    } catch (error) {
      cancellationErrorCode = error?.code ?? null;
    }
    if (cancellationErrorCode !== 'request_cancelled') {
      throw new Error(`cancellation_wrong_code_${cancellationErrorCode}`);
    }
    diagnostic.cancellationWorked = true;

    setStage('completed');
    return {
      singlePage: {
        pageCount: singlePageResult.pageCount,
        extractedPageCount: singlePageResult.extractedPageCount,
        textFound: singleWordsFound.length >= 2,
        wordsFound: singleWordsFound,
        progressReported: progressUpdates.length > 0,
        progressStages: progressUpdates.map(u => u.stage),
      },
      multiPage: {
        pageCount: multiPageResult.pageCount,
        extractedPageCount: multiPageResult.extractedPageCount,
        page1TextFound: page1Found,
        page2TextFound: page2Found,
        hasPageLabels: multiPageResult.combinedText.includes('[Halaman 1]'),
      },
      allScanned: {
        pageCount: allScannedResult.pageCount,
        extractedPageCount: allScannedResult.extractedPageCount,
        scannedPageCount: allScannedResult.scannedPageCount,
        isAllScanned: allScannedResult.isAllScanned,
        isPartial: allScannedResult.isPartial,
      },
      mixed: {
        pageCount: mixedResult.pageCount,
        extractedPageCount: mixedResult.extractedPageCount,
        scannedPageCount: mixedResult.scannedPageCount,
        isPartial: mixedResult.isPartial,
        isAllScanned: mixedResult.isAllScanned,
        page1HasText: mixedResult.pages[0].hasText,
        page2HasText: mixedResult.pages[1].hasText,
      },
      cancellation: {
        cancelled: cancellationErrorCode === 'request_cancelled',
        code: cancellationErrorCode,
      },
      workerLoaded: diagnostic.pdfWorkerLoaded,
      progressReported: diagnostic.progressReported,
    };
  } catch (error) {
    diagnostic.code = safeCode(error);
    const failure = new Error(diagnostic.code);
    failure.code = diagnostic.code;
    throw failure;
  }
};
