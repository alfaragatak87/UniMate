import {
  AI_ACCESS_MODES,
  AI_CAPABILITIES,
  AI_DOCUMENT_MIME_TYPES,
  AI_PROVIDERS,
} from './contracts.mjs';

export const AI_MODEL_CATALOG_VERSION = 2;
export const AI_MODEL_PRICING_VERIFIED_AT = '2026-10-21';
export const AI_DEFAULT_MODEL_ID = 'gemini-3.5-flash-lite';

export const AI_MODEL_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  PARTIALLY_VERIFIED: 'partially_verified',
  DISABLED: 'disabled',
});

const ALL_CAPABILITIES = Object.freeze(Object.values(AI_CAPABILITIES));

const GEMINI_35_FLASH_LITE = Object.freeze({
  provider: AI_PROVIDERS.GEMINI,
  modelId: AI_DEFAULT_MODEL_ID,
  label: 'Gemini 3.5 Flash Lite',
  lifecycle: 'stable',
  availability: AI_MODEL_AVAILABILITY.AVAILABLE,
  selectable: true,
  accessMode: AI_ACCESS_MODES.FREE_ONLY,
  capabilities: ALL_CAPABILITIES,
  documentMimeTypes: AI_DOCUMENT_MIME_TYPES,
  contextWindowTokens: 1_048_576,
  longContextThresholdTokens: null,
  quota: Object.freeze({
    requestsPerMinute: 15,
    inputTokensPerMinute: 250_000,
    requestsPerDay: 500,
    verifiedAt: AI_MODEL_PRICING_VERIFIED_AT,
    source: 'user_ai_studio_snapshot',
    realtime: false,
  }),
  pricingMicrousdPerMillionTokens: Object.freeze({
    input: 300_000,
    output: 2_500_000,
    longInput: 300_000,
    longOutput: 2_500_000,
  }),
  documentationSource: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite',
  pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing',
});

const GEMINI_31_FLASH_LITE = Object.freeze({
  provider: AI_PROVIDERS.GEMINI,
  modelId: 'gemini-3.1-flash-lite',
  label: 'Gemini 3.1 Flash Lite',
  lifecycle: 'stable',
  availability: AI_MODEL_AVAILABILITY.PARTIALLY_VERIFIED,
  selectable: false,
  accessMode: AI_ACCESS_MODES.FREE_ONLY,
  capabilities: ALL_CAPABILITIES,
  documentMimeTypes: AI_DOCUMENT_MIME_TYPES,
  contextWindowTokens: 1_048_576,
  longContextThresholdTokens: null,
  quota: Object.freeze({
    requestsPerMinute: 15,
    inputTokensPerMinute: null,
    requestsPerDay: 500,
    verifiedAt: AI_MODEL_PRICING_VERIFIED_AT,
    source: 'user_ai_studio_snapshot',
    realtime: false,
  }),
  pricingMicrousdPerMillionTokens: Object.freeze({
    input: 250_000,
    output: 1_500_000,
    longInput: 250_000,
    longOutput: 1_500_000,
  }),
  documentationSource: 'https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite',
  pricingSource: 'https://ai.google.dev/gemini-api/docs/pricing',
});

const OPENAI_FUTURE_MODEL = Object.freeze({
  provider: AI_PROVIDERS.OPENAI,
  modelId: 'gpt-6-luna',
  label: 'OpenAI (opsi masa depan)',
  lifecycle: 'unverified',
  availability: AI_MODEL_AVAILABILITY.DISABLED,
  selectable: false,
  accessMode: null,
  capabilities: ALL_CAPABILITIES,
  documentMimeTypes: Object.freeze([]),
  contextWindowTokens: 1_050_000,
  longContextThresholdTokens: 272_000,
  quota: null,
  pricingMicrousdPerMillionTokens: Object.freeze({
    input: 100_000,
    output: 500_000,
    longInput: 200_000,
    longOutput: 750_000,
  }),
  documentationSource: null,
  pricingSource: 'https://developers.openai.com/api/docs/pricing',
});

export const AI_MODEL_CATALOG = Object.freeze({
  [GEMINI_35_FLASH_LITE.modelId]: GEMINI_35_FLASH_LITE,
  [GEMINI_31_FLASH_LITE.modelId]: GEMINI_31_FLASH_LITE,
  [OPENAI_FUTURE_MODEL.modelId]: OPENAI_FUTURE_MODEL,
});

export const AI_BACKEND_MODELS = Object.freeze({
  [AI_PROVIDERS.GEMINI]: Object.freeze([
    GEMINI_35_FLASH_LITE.modelId,
    GEMINI_31_FLASH_LITE.modelId,
  ]),
  [AI_PROVIDERS.OPENAI]: Object.freeze([]),
});

export const AI_SELECTABLE_MODEL_IDS = Object.freeze(
  Object.values(AI_MODEL_CATALOG).filter(model => model.selectable).map(model => model.modelId),
);

export function getAIModel(modelId) {
  return typeof modelId === 'string' ? AI_MODEL_CATALOG[modelId] ?? null : null;
}

export function listAIModels(options = {}) {
  const { provider = null, capability = null, includeUnavailable = true } = options;
  return Object.freeze(Object.values(AI_MODEL_CATALOG).filter(model => (
    (provider === null || model.provider === provider)
    && (capability === null || model.capabilities.includes(capability))
    && (includeUnavailable || model.selectable)
  )));
}

export function isAIModelSelectable(modelId, capability, mimeType = null) {
  const model = getAIModel(modelId);
  if (
    model === null
    || model.provider !== AI_PROVIDERS.GEMINI
    || model.selectable !== true
    || model.accessMode !== AI_ACCESS_MODES.FREE_ONLY
    || !model.capabilities.includes(capability)
  ) return false;
  return capability !== AI_CAPABILITIES.DOCUMENT_SCAN
    || (typeof mimeType === 'string' && model.documentMimeTypes.includes(mimeType));
}

export function resolveAllowedAIModels(models = AI_BACKEND_MODELS) {
  const keys = models !== null && typeof models === 'object' && !Array.isArray(models)
    ? Object.keys(models)
    : [];
  if (
    keys.length !== 2
    || !keys.includes(AI_PROVIDERS.OPENAI)
    || !keys.includes(AI_PROVIDERS.GEMINI)
    || !Array.isArray(models.openai)
    || models.openai.length !== 0
    || !Array.isArray(models.gemini)
    || models.gemini.length !== AI_BACKEND_MODELS.gemini.length
    || models.gemini.some((modelId, index) => modelId !== AI_BACKEND_MODELS.gemini[index])
  ) {
    throw new TypeError('Konfigurasi model provider tidak diizinkan');
  }
  return AI_BACKEND_MODELS;
}
