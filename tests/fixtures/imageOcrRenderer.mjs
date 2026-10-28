import { recognizeImageText } from './offline-document-engine.mjs';

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

globalThis.getImageOcrDiagnostic = () => ({ ...diagnostic });

function createTextCanvas(lines, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = options.width ?? 1400;
  canvas.height = options.height ?? 360;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = `700 ${options.fontSize ?? 64}px Arial, sans-serif`;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 50, 45 + (index * 95)));
  return canvas;
}

function includesWords(text, words) {
  const normalized = (text || '').toLocaleUpperCase('en-US').replace(/[^A-Z0-9]+/gu, ' ');
  return words.every(word => normalized.includes(word));
}

async function recognizeFixture(lines, expectedWords) {
  const canvas = createTextCanvas(lines);
  const stages = [];
  const startedAt = performance.now();
  const result = await recognizeImageText(canvas, {
    baseUrl: document.baseURI,
    languages: ['ind', 'eng'],
    onProgress: update => {
      stages.push(update.stage);
      diagnostic.ocrStage = update.stage;
      diagnostic.progressCount += 1;
    },
  });
  return {
    matched: includesWords(result.text, expectedWords),
    text: result.text,
    confidenceAvailable: Number.isFinite(result.confidence) && result.confidence >= 0,
    confidence: result.confidence,
    hasText: result.hasText,
    stagesReported: stages,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function verifyCancellation() {
  const canvas = createTextCanvas(
    Array.from({ length: 10 }, (_, index) => `UNIMATE B3 CANCEL TEXT LINE ${index + 1}`),
    { width: 2400, height: 1600, fontSize: 72 },
  );
  const controller = new AbortController();
  const operation = recognizeImageText(canvas, {
    baseUrl: document.baseURI,
    languages: ['ind', 'eng'],
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

async function verifyEmptyImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const result = await recognizeImageText(canvas, {
    baseUrl: document.baseURI,
    languages: ['ind', 'eng'],
  });
  return {
    hasText: result.hasText,
    textLength: (result.text || '').trim().length,
  };
}

globalThis.runImageOcrProof = async () => {
  try {
    const startedAt = performance.now();

    setStage('ocr_indonesian');
    const indonesian = await recognizeFixture(
      ['SISTEM INFORMASI AKADEMIK', 'UNIVERSITAS UNIMATE 2026'],
      ['SISTEM', 'INFORMASI', 'AKADEMIK', 'UNIVERSITAS'],
    );

    setStage('ocr_english');
    const english = await recognizeFixture(
      ['COMPUTER SCIENCE RESEARCH', 'ARTIFICIAL INTELLIGENCE'],
      ['COMPUTER', 'SCIENCE', 'RESEARCH', 'ARTIFICIAL'],
    );

    setStage('ocr_mixed');
    const mixed = await recognizeFixture(
      ['TUGAS ALGORITMA PEMROGRAMAN', 'DATA STRUCTURES AND ALGORITHMS'],
      ['TUGAS', 'ALGORITMA', 'DATA', 'STRUCTURES'],
    );

    setStage('ocr_empty');
    const empty = await verifyEmptyImage();

    setStage('ocr_cancellation');
    const cancellation = await verifyCancellation();

    setStage('completed');
    return {
      indonesian,
      english,
      mixed,
      empty,
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
