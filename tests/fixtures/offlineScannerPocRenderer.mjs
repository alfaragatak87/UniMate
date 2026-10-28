import {
  createOfflineOcrEngine,
  extractPdfTextAndRender,
} from './offline-document-engine.mjs';

const diagnostic = {
  stage: 'renderer_loaded',
  code: null,
  pdfStage: 'not_started',
  ocrStage: 'not_started',
  ocrProgressBucket: 0,
  pdfWorkerLoaded: false,
  tesseractWorkerLoaded: false,
  tesseractWasmLoaded: false,
  englishModelLoaded: false,
  indonesianModelLoaded: false,
  workerBlobURL: false,
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

globalThis.getOfflineScannerPocDiagnostic = () => ({ ...diagnostic });

function createSyntheticPdf(text) {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 26 Tf\n72 700 Td\n(${escaped}) Tj\nET`;
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

function createTextCanvas(lines, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = options.width ?? 1400;
  canvas.height = options.height ?? 360;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = `700 ${options.fontSize ?? 68}px Arial, sans-serif`;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 50, 45 + (index * 100)));
  return canvas;
}

function includesWords(text, words) {
  const normalized = text.toLocaleUpperCase('en-US').replace(/[^A-Z0-9]+/gu, ' ');
  return words.every(word => normalized.includes(word));
}

async function recognizeFixture(languages, lines, expectedWords) {
  const progressStages = new Set();
  const engine = createOfflineOcrEngine({
    baseUrl: document.baseURI,
    languages,
    onProgress: update => {
      progressStages.add(update.status);
      diagnostic.ocrStage = update.status
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 64);
      diagnostic.ocrProgressBucket = Math.max(0, Math.min(10, Math.floor(update.progress * 10)));
      if (update.status === 'loading tesseract core' && update.progress === 1) {
        diagnostic.tesseractWasmLoaded = true;
      }
    },
  });
  const startedAt = performance.now();
  try {
    await engine.initialize();
    diagnostic.tesseractWorkerLoaded = true;
    if (languages.includes('eng')) diagnostic.englishModelLoaded = true;
    if (languages.includes('ind')) diagnostic.indonesianModelLoaded = true;
    const result = await engine.recognize(createTextCanvas(lines));
    return {
      matched: includesWords(result.text, expectedWords),
      confidenceAvailable: Number.isFinite(result.confidence),
      durationMs: Math.round(performance.now() - startedAt),
      progressReported: progressStages.size > 0,
    };
  } finally {
    await engine.dispose();
  }
}

async function verifyCancellation() {
  const engine = createOfflineOcrEngine({
    baseUrl: document.baseURI,
    languages: ['eng', 'ind'],
    onProgress: update => {
      diagnostic.ocrStage = update.status
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 64);
      diagnostic.ocrProgressBucket = Math.max(0, Math.min(10, Math.floor(update.progress * 10)));
    },
  });
  await engine.initialize();
  const controller = new AbortController();
  const canvas = createTextCanvas(
    Array.from({ length: 8 }, (_, index) => `UNIMATE OFFLINE CANCEL ${index + 1}`),
    { width: 2400, height: 1600, fontSize: 72 },
  );
  const operation = engine.recognize(canvas, { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  let code = null;
  try {
    await operation;
  } catch (error) {
    code = error?.code ?? null;
  } finally {
    await engine.dispose();
  }
  return {
    cancelled: code === 'request_cancelled',
    disposed: engine.getStatus().disposed,
  };
}

globalThis.runOfflineScannerPoc = async () => {
  try {
    const startedAt = performance.now();
    setStage('pdf_processing');
    const pdf = await extractPdfTextAndRender(createSyntheticPdf('UNIMATE PDF TEXT 2026'), {
      baseUrl: document.baseURI,
      maxPagePixels: 4_000_000,
      onDiagnostic: stage => { diagnostic.pdfStage = stage; },
    });
    diagnostic.pdfWorkerLoaded = true;
    setStage('ocr_english');
    const english = await recognizeFixture(
      ['eng'],
      ['HELLO WORLD 2026', 'OFFLINE SCANNER'],
      ['HELLO', 'WORLD', 'OFFLINE', 'SCANNER'],
    );
    setStage('ocr_indonesian');
    const indonesian = await recognizeFixture(
      ['ind'],
      ['TUGAS KULIAH INDONESIA', 'JADWAL SEMESTER'],
      ['TUGAS', 'KULIAH', 'INDONESIA', 'JADWAL', 'SEMESTER'],
    );
    setStage('ocr_mixed');
    const mixed = await recognizeFixture(
      ['eng', 'ind'],
      ['UNIMATE OFFLINE CAMPUS', 'TUGAS MAHASISWA 2026'],
      ['UNIMATE', 'OFFLINE', 'CAMPUS', 'TUGAS', 'MAHASISWA'],
    );
    setStage('ocr_cancellation');
    const cancellation = await verifyCancellation();
    setStage('completed');
    return {
      pdf: {
        extracted: pdf.text.includes('UNIMATE PDF TEXT 2026'),
        rendered: pdf.inkSamples > 0,
        pageCount: pdf.pageCount,
        pixels: pdf.pixels,
      },
      english,
      indonesian,
      mixed,
      cancellation,
      workerBlobURL: diagnostic.workerBlobURL,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    diagnostic.code = safeCode(error);
    const failure = new Error(diagnostic.code);
    failure.code = diagnostic.code;
    throw failure;
  }
};
