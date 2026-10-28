import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_PROVIDERS,
  AI_SELECTION_MODES,
} from '../shared/ai/contracts.mjs';
import {
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_AVAILABILITY,
  getAIModel,
} from '../shared/ai/modelCatalog.mjs';
import {
  inferAIComplexity,
  listCompatibleAIModels,
  recommendAIModel,
} from '../shared/ai/modelRecommendation.mjs';
import { validateAIRequest } from '../shared/ai/validation.mjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';

test('Gemini 3.5 Flash Lite menjadi default Free Tier dan OpenAI tetap nonaktif', () => {
  const model = getAIModel(AI_DEFAULT_MODEL_ID);
  assert.equal(model.provider, AI_PROVIDERS.GEMINI);
  assert.equal(model.selectable, true);
  assert.equal(model.accessMode, 'free_only');
  assert.equal(getAIModel('gpt-6-luna').selectable, false);
});

test('rekomendasi Chat membedakan kebutuhan Ringan, Sedang, dan Berat secara deterministik', () => {
  assert.equal(inferAIComplexity(AI_CAPABILITIES.CHAT, { message: 'Jelaskan array.' }), AI_COMPLEXITY_LEVELS.LIGHT);
  assert.equal(
    inferAIComplexity(AI_CAPABILITIES.CHAT, { message: 'Jelaskan; bandingkan; lalu berikan langkah praktis.' }),
    AI_COMPLEXITY_LEVELS.MEDIUM,
  );
  assert.equal(
    inferAIComplexity(AI_CAPABILITIES.CHAT, { message: 'x'.repeat(2_501) }),
    AI_COMPLEXITY_LEVELS.HEAVY,
  );
});

test('rekomendasi Analytics dan Scanner memakai karakteristik input', () => {
  assert.equal(inferAIComplexity(AI_CAPABILITIES.ANALYTICS, {
    rows: Array.from({ length: 12 }, (_, index) => ({ index })),
    yAxes: ['a', 'b', 'c'],
  }), AI_COMPLEXITY_LEVELS.MEDIUM);
  assert.equal(inferAIComplexity(AI_CAPABILITIES.ANALYTICS, {
    rows: Array.from({ length: 40 }, (_, index) => ({ index })),
    yAxes: ['a'],
  }), AI_COMPLEXITY_LEVELS.HEAVY);
  assert.equal(inferAIComplexity(AI_CAPABILITIES.DOCUMENT_SCAN, {
    scanType: 'khs',
    file: { size: 2_000_000 },
  }), AI_COMPLEXITY_LEVELS.MEDIUM);
});

test('mode Otomatis dan Manual menghasilkan alasan serta model yang kompatibel', () => {
  const automatic = recommendAIModel({
    capability: AI_CAPABILITIES.CHAT,
    input: { message: 'Pertanyaan singkat' },
  });
  const manual = recommendAIModel({
    capability: AI_CAPABILITIES.CHAT,
    input: { message: 'Pertanyaan singkat' },
    mode: AI_SELECTION_MODES.MANUAL,
    complexity: AI_COMPLEXITY_LEVELS.HEAVY,
    requestedModelId: AI_DEFAULT_MODEL_ID,
  });
  assert.equal(automatic.modelId, AI_DEFAULT_MODEL_ID);
  assert.equal(automatic.complexity, AI_COMPLEXITY_LEVELS.LIGHT);
  assert.equal(manual.modelId, AI_DEFAULT_MODEL_ID);
  assert.equal(manual.complexity, AI_COMPLEXITY_LEVELS.HEAVY);
  assert.match(automatic.reason, /Free Tier/u);
});

test('model parsial tetap terlihat tetapi tidak dapat dipilih', () => {
  const models = listCompatibleAIModels(AI_CAPABILITIES.CHAT);
  const partial = models.find(model => model.modelId === 'gemini-3.1-flash-lite');
  const futureOpenAI = models.find(model => model.provider === AI_PROVIDERS.OPENAI);
  assert.equal(partial.availability, AI_MODEL_AVAILABILITY.PARTIALLY_VERIFIED);
  assert.equal(partial.selectable, false);
  assert.equal(futureOpenAI.selectable, false);
  assert.throws(() => recommendAIModel({
    capability: AI_CAPABILITIES.CHAT,
    input: { message: 'Tes' },
    mode: AI_SELECTION_MODES.MANUAL,
    complexity: AI_COMPLEXITY_LEVELS.LIGHT,
    requestedModelId: partial.modelId,
  }), /tidak tersedia/u);
});

test('otoritas backend menolak rekomendasi otomatis yang dimanipulasi', () => {
  const wrongComplexity = structuredClone(SYNTHETIC_CHAT_REQUEST);
  wrongComplexity.selection.complexity = AI_COMPLEXITY_LEVELS.HEAVY;
  assert.equal(validateAIRequest(wrongComplexity).valid, false);

  const paidProvider = structuredClone(SYNTHETIC_CHAT_REQUEST);
  paidProvider.selection.provider = AI_PROVIDERS.OPENAI;
  paidProvider.selection.modelId = 'gpt-6-luna';
  assert.equal(validateAIRequest(paidProvider).valid, false);
});

test('katalog Scanner memvalidasi MIME sebelum model ditawarkan', () => {
  const supported = listCompatibleAIModels(AI_CAPABILITIES.DOCUMENT_SCAN, SYNTHETIC_DOCUMENT_REQUEST.input);
  const unsupported = listCompatibleAIModels(AI_CAPABILITIES.DOCUMENT_SCAN, {
    file: { mimeType: 'application/x-msdownload' },
  });
  assert.equal(supported.find(model => model.modelId === AI_DEFAULT_MODEL_ID).selectable, true);
  assert.equal(unsupported.find(model => model.modelId === AI_DEFAULT_MODEL_ID).selectable, false);
});
