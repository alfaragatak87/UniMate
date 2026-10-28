import {
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_CONTRACT_VERSION,
  AI_SELECTION_MODES,
  AI_SENSITIVITIES,
} from '../../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID, getAIModel } from '../../shared/ai/modelCatalog.mjs';
import { recommendAIModel } from '../../shared/ai/modelRecommendation.mjs';
import {
  assertValidAIRequest,
  validateAIResponse,
} from '../../shared/ai/validation.mjs';

const SAFE_ERROR_MESSAGES = Object.freeze({
  backend_unavailable: 'Layanan AI lokal belum tersedia.',
  capability_disabled: 'Fitur AI ini belum diaktifkan.',
  invalid_request: 'Permintaan AI tidak valid.',
  invalid_response: 'Respons AI tidak valid.',
  request_rejected: 'Permintaan AI ditolak.',
  request_cancelled: 'Permintaan AI dibatalkan.',
  quota_exceeded: 'Batas penggunaan Gemini Free Tier tercapai.',
  quota_unavailable: 'Status kuota Gemini Free Tier tidak tersedia.',
  rate_limited: 'Gemini sedang membatasi permintaan.',
  provider_timeout: 'Gemini tidak merespons dalam batas waktu.',
  provider_unavailable: 'Gemini tidak tersedia.',
});

const COMPLEXITY_LABELS = Object.freeze({
  light: 'Ringan',
  medium: 'Sedang',
  heavy: 'Berat',
});

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function cloneAndFreeze(value) {
  const cloned = JSON.parse(JSON.stringify(value));
  const freeze = current => {
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) return current;
    Object.values(current).forEach(freeze);
    return Object.freeze(current);
  };
  return freeze(cloned);
}

function defaultRequestId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new FrontendAIError('backend_unavailable');
  }
  return globalThis.crypto.randomUUID();
}

async function defaultTransport(request) {
  const bridge = globalThis.window?.electronAPI;
  if (typeof bridge?.requestAI !== 'function') throw new FrontendAIError('backend_unavailable');
  return bridge.requestAI(request);
}

async function defaultCancelTransport(requestId) {
  const bridge = globalThis.window?.electronAPI;
  if (typeof bridge?.cancelAI !== 'function') throw new FrontendAIError('backend_unavailable');
  return bridge.cancelAI(requestId);
}

export class FrontendAIError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(SAFE_ERROR_MESSAGES, code) ? code : 'request_rejected';
    super(SAFE_ERROR_MESSAGES[safeCode]);
    this.name = 'FrontendAIError';
    this.code = safeCode;
  }
}

export function createDefaultAISelection(overrides = {}) {
  const value = {
    mode: AI_SELECTION_MODES.AUTOMATIC,
    complexity: AI_COMPLEXITY_LEVELS.MEDIUM,
    modelId: AI_DEFAULT_MODEL_ID,
    freeTierDataConsent: false,
    ...overrides,
  };
  if (!hasExactKeys(value, ['mode', 'complexity', 'modelId', 'freeTierDataConsent'])) {
    throw new FrontendAIError('invalid_request');
  }
  return Object.freeze(value);
}

export function formatAIProviderStatus(meta) {
  const model = getAIModel(meta?.modelId);
  if (
    meta?.provider !== 'gemini'
    || model?.provider !== 'gemini'
    || meta?.fallbackUsed !== false
    || meta?.attemptCount !== 1
  ) return 'Provider AI tidak diketahui';
  const mode = meta.selectionMode === AI_SELECTION_MODES.MANUAL ? 'Manual' : 'Rekomendasi UniMate';
  const complexity = COMPLEXITY_LABELS[meta.complexity] ?? 'Tidak diketahui';
  return `Gemini · ${model.label} · ${mode} · ${complexity}`;
}

function assertOptions(value, keys) {
  if (!hasExactKeys(value, keys)) throw new FrontendAIError('invalid_request');
}

function resolveRequestSelection(capability, input, selection) {
  if (!hasExactKeys(selection, ['mode', 'complexity', 'modelId', 'freeTierDataConsent'])) {
    throw new FrontendAIError('invalid_request');
  }
  let recommendation;
  try {
    recommendation = recommendAIModel({
      capability,
      input,
      mode: selection.mode,
      complexity: selection.mode === AI_SELECTION_MODES.MANUAL ? selection.complexity : null,
      requestedModelId: selection.mode === AI_SELECTION_MODES.MANUAL ? selection.modelId : null,
    });
  } catch {
    throw new FrontendAIError('invalid_request');
  }
  return Object.freeze({
    mode: recommendation.mode,
    complexity: recommendation.complexity,
    provider: recommendation.provider,
    modelId: recommendation.modelId,
    accessMode: recommendation.accessMode,
    allowModelFallback: false,
    freeTierDataConsent: selection.freeTierDataConsent,
    consentVersion: 1,
  });
}

function createRequest({ capability, sensitivity, selection, input }, createRequestId) {
  const request = {
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: createRequestId(),
    capability,
    sensitivity,
    selection: resolveRequestSelection(capability, input, selection),
    input,
  };
  try {
    assertValidAIRequest(request);
  } catch {
    throw new FrontendAIError('invalid_request');
  }
  return request;
}

function validateTransportEnvelope(envelope, request) {
  if (hasExactKeys(envelope, ['ok', 'response']) && envelope.ok === true) {
    if (
      !validateAIResponse(envelope.response).valid
      || envelope.response.requestId !== request.requestId
      || envelope.response.capability !== request.capability
    ) {
      throw new FrontendAIError('invalid_response');
    }
    return cloneAndFreeze(envelope.response);
  }
  if (hasExactKeys(envelope, ['ok', 'error']) && envelope.ok === false) {
    const code = typeof envelope.error?.code === 'string' && Object.hasOwn(SAFE_ERROR_MESSAGES, envelope.error.code)
      ? envelope.error.code
      : 'request_rejected';
    throw new FrontendAIError(code);
  }
  throw new FrontendAIError('invalid_response');
}

export function createFrontendAIClient(options = {}) {
  const transport = options.transport ?? defaultTransport;
  const cancelTransport = options.cancelTransport ?? defaultCancelTransport;
  const createRequestId = options.createRequestId ?? defaultRequestId;
  if (typeof transport !== 'function' || typeof cancelTransport !== 'function' || typeof createRequestId !== 'function') {
    throw new TypeError('Konfigurasi client AI frontend tidak valid');
  }

  async function dispatch(request) {
    let envelope;
    try {
      envelope = await transport(cloneAndFreeze(request));
    } catch (error) {
      if (error instanceof FrontendAIError) throw error;
      throw new FrontendAIError('backend_unavailable');
    }
    return validateTransportEnvelope(envelope, request);
  }

  function execute(requestOptions) {
    return dispatch(createRequest(requestOptions, createRequestId));
  }

  function startDocumentScan(optionsValue) {
    assertOptions(optionsValue, ['scanType', 'file', 'userContext', 'selection']);
    const request = createRequest({
      capability: AI_CAPABILITIES.DOCUMENT_SCAN,
      sensitivity: AI_SENSITIVITIES.ACADEMIC_DOCUMENT,
      selection: optionsValue.selection,
      input: {
        scanType: optionsValue.scanType,
        file: optionsValue.file,
        userContext: optionsValue.userContext,
      },
    }, createRequestId);
    return Object.freeze({ requestId: request.requestId, result: dispatch(request) });
  }

  return Object.freeze({
    async cancel(requestId) {
      if (typeof requestId !== 'string') throw new FrontendAIError('invalid_request');
      let envelope;
      try {
        envelope = await cancelTransport(requestId);
      } catch {
        throw new FrontendAIError('backend_unavailable');
      }
      if (
        !hasExactKeys(envelope, ['ok', 'response'])
        || envelope.ok !== true
        || !hasExactKeys(envelope.response, ['requestId', 'cancelled'])
        || envelope.response.requestId !== requestId
        || typeof envelope.response.cancelled !== 'boolean'
      ) {
        throw new FrontendAIError('invalid_response');
      }
      return envelope.response.cancelled;
    },

    async chat(optionsValue) {
      assertOptions(optionsValue, ['message', 'selection']);
      return execute({
        capability: AI_CAPABILITIES.CHAT,
        sensitivity: AI_SENSITIVITIES.NORMAL,
        selection: optionsValue.selection,
        input: { message: optionsValue.message, locale: 'id-ID' },
      });
    },

    async analyze(optionsValue) {
      assertOptions(optionsValue, ['rows', 'xAxis', 'yAxes', 'selection']);
      return execute({
        capability: AI_CAPABILITIES.ANALYTICS,
        sensitivity: AI_SENSITIVITIES.PERSONAL_DATA,
        selection: optionsValue.selection,
        input: { rows: optionsValue.rows, xAxis: optionsValue.xAxis, yAxes: optionsValue.yAxes },
      });
    },

    startDocumentScan,

    async scanDocument(optionsValue) {
      return startDocumentScan(optionsValue).result;
    },
  });
}

export const frontendAIClient = createFrontendAIClient();
