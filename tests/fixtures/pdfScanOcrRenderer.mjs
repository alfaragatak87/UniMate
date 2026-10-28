import { processPdfDocumentOffline } from './offline-document-engine.mjs';

const diagnostic = {
  stage: 'renderer_loaded',
  code: null,
  ocrStage: 'not_started',
  progressCount: 0,
};

function setStage(stage) {
  diagnostic.stage = stage;
}

function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/^[a-z0-9_]+$/u.test(code)) return code;
  const names = new Map([
    ['TypeError', 'renderer_type_error'],
    ['ReferenceError', 'renderer_reference_error'],
    ['SecurityError', 'renderer_security_error'],
    ['NetworkError', 'renderer_network_error'],
    ['InvalidStateError', 'renderer_invalid_state'],
  ]);
  return names.get(error?.name) ?? 'renderer_proof_failed';
}

globalThis.getPdfScanOcrDiagnostic = () => ({ ...diagnostic });

function includesWords(text, words) {
  const normalized = (text || '').toLocaleUpperCase('en-US').replace(/[^A-Z0-9]+/gu, ' ');
  return words.every(word => normalized.includes(word));
}

// Helper: menggambar teks ke Canvas dan mengekstrak bytes RGB mentah
function renderTextToRgb(lines, options = {}) {
  const width = options.width ?? 1200;
  const height = options.height ?? 320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  context.font = `700 ${options.fontSize ?? 54}px Arial, sans-serif`;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 40, 35 + (index * 85)));

  const imageData = context.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    rgb[j] = imageData.data[i];
    rgb[j + 1] = imageData.data[i + 1];
    rgb[j + 2] = imageData.data[i + 2];
  }
  return { width, height, rgb };
}

// Helper: membuat dokumen PDF 1 halaman berisi gambar raster murni (tanpa text font)
function createSinglePageRasterPdf(lines, options = {}) {
  const { width, height, rgb } = renderTextToRgb(lines, options);
  const encoder = new TextEncoder();

  const contentStream = 'q\n500 0 0 133 56 600 cm\n/Im1 Do\nQ';

  const header = '%PDF-1.7\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n';
  const obj4 = `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  const obj5Header = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`;
  const obj5Trailer = '\nendstream\nendobj\n';

  const part1 = encoder.encode(header + obj1 + obj2 + obj3 + obj4 + obj5Header);
  const part2 = rgb;
  const part3 = encoder.encode(obj5Trailer);

  // Hitung offsets
  const off1 = header.length;
  const off2 = off1 + obj1.length;
  const off3 = off2 + obj2.length;
  const off4 = off3 + obj3.length;
  const off5 = off4 + obj4.length;
  const xrefOffset = part1.length + part2.length + part3.length;

  const xref = `xref\n0 6\n0000000000 65535 f \n`
    + `${String(off1).padStart(10, '0')} 00000 n \n`
    + `${String(off2).padStart(10, '0')} 00000 n \n`
    + `${String(off3).padStart(10, '0')} 00000 n \n`
    + `${String(off4).padStart(10, '0')} 00000 n \n`
    + `${String(off5).padStart(10, '0')} 00000 n \n`
    + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const part4 = encoder.encode(xref);

  const totalLength = part1.length + part2.length + part3.length + part4.length;
  const result = new Uint8Array(totalLength);
  result.set(part1, 0);
  result.set(part2, part1.length);
  result.set(part3, part1.length + part2.length);
  result.set(part4, part1.length + part2.length + part3.length);
  return result;
}

// Helper: membuat dokumen PDF 2 halaman hybrid:
// Halaman 1: teks asli font Helvetica
// Halaman 2: gambar raster murni
function createHybridPdf(nativeText, rasterLines, options = {}) {
  const { width, height, rgb } = renderTextToRgb(rasterLines, options);
  const encoder = new TextEncoder();

  const escapedText = nativeText.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const page1Content = `BT\n/F1 24 Tf\n72 700 Td\n(${escapedText}) Tj\nET`;
  const page2Content = 'q\n500 0 0 133 56 600 cm\n/Im1 Do\nQ';

  const header = '%PDF-1.7\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>\nendobj\n';
  const obj4 = `4 0 obj\n<< /Length ${page1Content.length} >>\nstream\n${page1Content}\nendstream\nendobj\n`;
  const obj5 = '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>\nendobj\n';
  const obj6 = `6 0 obj\n<< /Length ${page2Content.length} >>\nstream\n${page2Content}\nendstream\nendobj\n`;
  const obj7 = '7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const obj8Header = `8 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`;
  const obj8Trailer = '\nendstream\nendobj\n';

  const part1 = encoder.encode(header + obj1 + obj2 + obj3 + obj4 + obj5 + obj6 + obj7 + obj8Header);
  const part2 = rgb;
  const part3 = encoder.encode(obj8Trailer);

  const off1 = header.length;
  const off2 = off1 + obj1.length;
  const off3 = off2 + obj2.length;
  const off4 = off3 + obj3.length;
  const off5 = off4 + obj4.length;
  const off6 = off5 + obj5.length;
  const off7 = off6 + obj6.length;
  const off8 = off7 + obj7.length;
  const xrefOffset = part1.length + part2.length + part3.length;

  const xref = `xref\n0 9\n0000000000 65535 f \n`
    + `${String(off1).padStart(10, '0')} 00000 n \n`
    + `${String(off2).padStart(10, '0')} 00000 n \n`
    + `${String(off3).padStart(10, '0')} 00000 n \n`
    + `${String(off4).padStart(10, '0')} 00000 n \n`
    + `${String(off5).padStart(10, '0')} 00000 n \n`
    + `${String(off6).padStart(10, '0')} 00000 n \n`
    + `${String(off7).padStart(10, '0')} 00000 n \n`
    + `${String(off8).padStart(10, '0')} 00000 n \n`
    + `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const part4 = encoder.encode(xref);

  const totalLength = part1.length + part2.length + part3.length + part4.length;
  const result = new Uint8Array(totalLength);
  result.set(part1, 0);
  result.set(part2, part1.length);
  result.set(part3, part1.length + part2.length);
  result.set(part4, part1.length + part2.length + part3.length);
  return result;
}

// Helper: membuat dokumen PDF 2 halaman teks asli (tanpa gambar)
function createNativePdf(text1, text2) {
  const enc1 = text1.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const enc2 = text2.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream1 = `BT\n/F1 24 Tf\n72 700 Td\n(${enc1}) Tj\nET`;
  const stream2 = `BT\n/F1 24 Tf\n72 700 Td\n(${enc2}) Tj\nET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

async function verifyCancellation(rasterPdfBytes) {
  const controller = new AbortController();
  const operation = processPdfDocumentOffline(rasterPdfBytes, {
    baseUrl: document.baseURI,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  let code = null;
  try {
    await operation;
  } catch (error) {
    code = error?.code ?? null;
  }
  return {
    cancelled: code === 'request_cancelled',
    code,
  };
}

globalThis.runPdfScanOcrProof = async () => {
  try {
    const startedAt = performance.now();

    // 1. PDF Scan Bahasa Indonesia (raster image murni)
    setStage('scan_indonesian');
    const indonesianPdf = createSinglePageRasterPdf([
      'SISTEM INFORMASI AKADEMIK',
      'UNIVERSITAS UNIMATE 2026',
    ]);
    const indonesianResult = await processPdfDocumentOffline(indonesianPdf, {
      baseUrl: document.baseURI,
      languages: ['ind', 'eng'],
    });

    // 2. PDF Scan Bahasa Inggris (raster image murni)
    setStage('scan_english');
    const englishPdf = createSinglePageRasterPdf([
      'COMPUTER SCIENCE AND RESEARCH',
      'ARTIFICIAL INTELLIGENCE LAB',
    ]);
    const englishResult = await processPdfDocumentOffline(englishPdf, {
      baseUrl: document.baseURI,
      languages: ['ind', 'eng'],
    });

    // 3. PDF Hybrid: Halaman 1 teks asli, Halaman 2 scan raster
    setStage('scan_hybrid');
    const hybridPdf = createHybridPdf(
      'MATA KULIAH PEMROGRAMAN WEB UNIMATE',
      ['DATA STRUCTURES AND ALGORITHMS', 'SEMESTER GANJIL 2026'],
    );
    const hybridResult = await processPdfDocumentOffline(hybridPdf, {
      baseUrl: document.baseURI,
      languages: ['ind', 'eng'],
    });

    // 4. PDF Teks Asli Saja (tanpa gambar, membuktikan OCR tidak dipanggil)
    setStage('scan_native_only');
    const nativePdf = createNativePdf(
      'DOKUMEN TEKS ASLI HALAMAN SATU',
      'DOKUMEN TEKS ASLI HALAMAN DUA',
    );
    const nativeResult = await processPdfDocumentOffline(nativePdf, {
      baseUrl: document.baseURI,
      languages: ['ind', 'eng'],
    });

    // 5. Pembatalan (Cancellation)
    setStage('scan_cancellation');
    const cancellation = await verifyCancellation(indonesianPdf);

    setStage('completed');
    return {
      indonesian: {
        pageCount: indonesianResult.pageCount,
        textPageCount: indonesianResult.textPageCount,
        ocrPageCount: indonesianResult.ocrPageCount,
        isAllScanned: indonesianResult.isAllScanned,
        hasText: indonesianResult.hasText,
        confidenceAvailable: Number.isFinite(indonesianResult.averageConfidence),
        confidence: indonesianResult.averageConfidence,
        matched: includesWords(indonesianResult.combinedText, ['SISTEM', 'INFORMASI', 'AKADEMIK', 'UNIVERSITAS']),
        text: indonesianResult.combinedText,
      },
      english: {
        pageCount: englishResult.pageCount,
        ocrPageCount: englishResult.ocrPageCount,
        isAllScanned: englishResult.isAllScanned,
        matched: includesWords(englishResult.combinedText, ['COMPUTER', 'SCIENCE', 'RESEARCH', 'ARTIFICIAL']),
        text: englishResult.combinedText,
      },
      hybrid: {
        pageCount: hybridResult.pageCount,
        textPageCount: hybridResult.textPageCount,
        ocrPageCount: hybridResult.ocrPageCount,
        isHybrid: hybridResult.isHybrid,
        page1Source: hybridResult.pages[0]?.source,
        page2Source: hybridResult.pages[1]?.source,
        page1Matched: includesWords(hybridResult.pages[0]?.text, ['MATA', 'KULIAH', 'PEMROGRAMAN']),
        page2Matched: includesWords(hybridResult.pages[1]?.text, ['DATA', 'STRUCTURES', 'ALGORITHMS']),
      },
      nativeOnly: {
        pageCount: nativeResult.pageCount,
        textPageCount: nativeResult.textPageCount,
        ocrPageCount: nativeResult.ocrPageCount,
        isTextOnly: nativeResult.isTextOnly,
      },
      cancellation,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    diagnostic.code = safeCode(error);
    const failure = new Error(diagnostic.code);
    failure.code = diagnostic.code;
    throw failure;
  }
};
