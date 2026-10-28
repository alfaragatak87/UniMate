import {
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_COMPLEXITY_LEVEL_VALUES,
  AI_SELECTION_MODES,
  AI_SELECTION_MODE_VALUES,
} from './contracts.mjs';
import {
  AI_DEFAULT_MODEL_ID,
  getAIModel,
  isAIModelSelectable,
  listAIModels,
} from './modelCatalog.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inferChatComplexity(input) {
  const message = typeof input?.message === 'string' ? input.message.trim() : '';
  const instructionSignals = (message.match(/[.;:\n]|bandingkan|analisis|jelaskan|langkah|kode|rencana/giu) ?? []).length;
  if (message.length > 2_500 || instructionSignals >= 8) return AI_COMPLEXITY_LEVELS.HEAVY;
  if (message.length > 500 || instructionSignals >= 3) return AI_COMPLEXITY_LEVELS.MEDIUM;
  return AI_COMPLEXITY_LEVELS.LIGHT;
}

function inferAnalyticsComplexity(input) {
  const rowCount = Array.isArray(input?.rows) ? input.rows.length : 0;
  const axisCount = Array.isArray(input?.yAxes) ? input.yAxes.length : 0;
  const score = rowCount * Math.max(axisCount, 1);
  if (score > 150 || rowCount > 35 || axisCount > 6) return AI_COMPLEXITY_LEVELS.HEAVY;
  if (score > 25 || rowCount > 10 || axisCount > 2) return AI_COMPLEXITY_LEVELS.MEDIUM;
  return AI_COMPLEXITY_LEVELS.LIGHT;
}

function inferDocumentComplexity(input) {
  const size = Number.isSafeInteger(input?.file?.size) ? input.file.size : 0;
  if (size > 5 * 1024 * 1024) return AI_COMPLEXITY_LEVELS.HEAVY;
  if (size > 1024 * 1024 || input?.scanType !== 'auto') return AI_COMPLEXITY_LEVELS.MEDIUM;
  return AI_COMPLEXITY_LEVELS.LIGHT;
}

export function inferAIComplexity(capability, input) {
  if (capability === AI_CAPABILITIES.CHAT) return inferChatComplexity(input);
  if (capability === AI_CAPABILITIES.ANALYTICS) return inferAnalyticsComplexity(input);
  if (capability === AI_CAPABILITIES.DOCUMENT_SCAN) return inferDocumentComplexity(input);
  throw new TypeError('Capability rekomendasi AI tidak didukung');
}

function recommendationReason(capability, complexity) {
  const task = {
    [AI_CAPABILITIES.CHAT]: 'percakapan dan penulisan',
    [AI_CAPABILITIES.ANALYTICS]: 'analisis data terstruktur',
    [AI_CAPABILITIES.DOCUMENT_SCAN]: 'pemrosesan dokumen multimodal',
  }[capability];
  return `Model stabil Free Tier yang kompatibel untuk ${task} dengan kebutuhan ${complexity}.`;
}

export function listCompatibleAIModels(capability, input = null) {
  const mimeType = capability === AI_CAPABILITIES.DOCUMENT_SCAN ? input?.file?.mimeType : null;
  return Object.freeze(listAIModels({ capability }).map(model => Object.freeze({
    provider: model.provider,
    modelId: model.modelId,
    label: model.label,
    lifecycle: model.lifecycle,
    availability: model.availability,
    selectable: isAIModelSelectable(model.modelId, capability, mimeType),
    freeTier: model.accessMode === 'free_only',
    quotaVerifiedAt: model.quota?.verifiedAt ?? null,
    quotaRealtime: model.quota?.realtime === true,
  })));
}

export function recommendAIModel(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('Input rekomendasi AI tidak valid');
  const allowedKeys = ['capability', 'input', 'mode', 'complexity', 'requestedModelId'];
  if (Object.keys(options).some(key => !allowedKeys.includes(key))) {
    throw new TypeError('Input rekomendasi AI tidak valid');
  }
  const {
    capability,
    input,
    mode = AI_SELECTION_MODES.AUTOMATIC,
    complexity = null,
    requestedModelId = null,
  } = options;
  if (!Object.values(AI_CAPABILITIES).includes(capability) || !AI_SELECTION_MODE_VALUES.includes(mode)) {
    throw new TypeError('Input rekomendasi AI tidak valid');
  }
  const resolvedComplexity = complexity === null
    ? inferAIComplexity(capability, input)
    : complexity;
  if (!AI_COMPLEXITY_LEVEL_VALUES.includes(resolvedComplexity)) {
    throw new TypeError('Kompleksitas AI tidak valid');
  }
  const modelId = mode === AI_SELECTION_MODES.MANUAL ? requestedModelId : AI_DEFAULT_MODEL_ID;
  const mimeType = capability === AI_CAPABILITIES.DOCUMENT_SCAN ? input?.file?.mimeType : null;
  if (!isAIModelSelectable(modelId, capability, mimeType)) {
    throw new TypeError('Model AI tidak tersedia untuk permintaan ini');
  }
  const model = getAIModel(modelId);
  return Object.freeze({
    mode,
    complexity: resolvedComplexity,
    provider: model.provider,
    modelId: model.modelId,
    accessMode: model.accessMode,
    reason: recommendationReason(capability, resolvedComplexity),
  });
}
