import {
  AI_CONTRACT_VERSION,
  AI_ERROR_CODES,
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDERS,
} from '../../shared/ai/contracts.mjs';
import { getAIModel } from '../../shared/ai/modelCatalog.mjs';
import {
  assertValidAIRequest,
  assertValidAIResponse,
  validateCapabilityResult,
} from '../../shared/ai/validation.mjs';

const RESPONSE_ERROR_BY_PROVIDER_ERROR = Object.freeze({
  [AI_PROVIDER_ERROR_CODES.INVALID_REQUEST]: AI_ERROR_CODES.INVALID_REQUEST,
  [AI_PROVIDER_ERROR_CODES.NOT_CONFIGURED]: AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
  [AI_PROVIDER_ERROR_CODES.AUTH_FAILED]: AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
  [AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED]: AI_ERROR_CODES.QUOTA_EXCEEDED,
  [AI_PROVIDER_ERROR_CODES.TIMEOUT]: AI_ERROR_CODES.PROVIDER_TIMEOUT,
  [AI_PROVIDER_ERROR_CODES.RATE_LIMITED]: AI_ERROR_CODES.RATE_LIMITED,
  [AI_PROVIDER_ERROR_CODES.NETWORK_ERROR]: AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
  [AI_PROVIDER_ERROR_CODES.CANCELLED]: AI_ERROR_CODES.REQUEST_CANCELLED,
  [AI_PROVIDER_ERROR_CODES.UNAVAILABLE]: AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
  [AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE]: AI_ERROR_CODES.INVALID_RESPONSE,
});

const ERROR_MESSAGES = Object.freeze({
  [AI_ERROR_CODES.INVALID_REQUEST]: 'Permintaan AI tidak dapat diproses.',
  [AI_ERROR_CODES.INVALID_RESPONSE]: 'Respons provider AI tidak valid.',
  [AI_ERROR_CODES.QUOTA_EXCEEDED]: 'Kuota Gemini Free Tier tidak tersedia untuk permintaan ini.',
  [AI_ERROR_CODES.RATE_LIMITED]: 'Gemini sedang membatasi permintaan. Coba kembali setelah jeda.',
  [AI_ERROR_CODES.PROVIDER_TIMEOUT]: 'Gemini tidak merespons dalam batas waktu.',
  [AI_ERROR_CODES.PROVIDER_UNAVAILABLE]: 'Gemini tidak tersedia.',
  [AI_ERROR_CODES.REQUEST_CANCELLED]: 'Permintaan AI dibatalkan.',
});

class ProviderResultError extends Error {
  constructor() {
    super('Respons provider tidak valid');
    this.name = 'ProviderResultError';
    this.code = AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE;
  }
}

function createErrorResponse(request, providerReason) {
  const code = RESPONSE_ERROR_BY_PROVIDER_ERROR[providerReason] ?? AI_ERROR_CODES.INTERNAL_ERROR;
  return assertValidAIResponse({
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: request.requestId,
    capability: request.capability,
    success: false,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? 'Permintaan AI tidak dapat diselesaikan.',
      primaryReason: providerReason,
      fallbackReason: null,
    },
  });
}

function normalizeProviderResult(request, value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.provider !== request.selection.provider
    || value.modelId !== request.selection.modelId
    || !Object.hasOwn(value, 'result')
  ) {
    throw new ProviderResultError();
  }
  const validation = validateCapabilityResult(request.capability, value.result);
  if (!validation.valid) throw new ProviderResultError();
  return value.result;
}

function createSuccessResponse(request, result) {
  return assertValidAIResponse({
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: request.requestId,
    capability: request.capability,
    success: true,
    meta: {
      provider: request.selection.provider,
      modelId: request.selection.modelId,
      selectionMode: request.selection.mode,
      complexity: request.selection.complexity,
      accessMode: request.selection.accessMode,
      fallbackUsed: false,
      fallbackReason: null,
      attemptCount: 1,
    },
    result,
  });
}

function validateProviders(providers) {
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new TypeError('Provider router AI tidak valid');
  }
  const entries = Object.entries(providers);
  if (entries.length < 1) throw new TypeError('Provider router AI tidak valid');
  for (const [modelId, provider] of entries) {
    const model = getAIModel(modelId);
    if (
      model?.selectable !== true
      || model.provider !== AI_PROVIDERS.GEMINI
      || provider?.name !== model.provider
      || provider?.modelId !== modelId
      || typeof provider.generate !== 'function'
    ) {
      throw new TypeError('Provider router AI tidak valid');
    }
  }
}

export function createAIRouter({ providers }) {
  validateProviders(providers);
  const providerMap = Object.freeze({ ...providers });

  return Object.freeze({
    async route(request, options = {}) {
      assertValidAIRequest(request);
      if (options.signal?.aborted) {
        return createErrorResponse(request, AI_PROVIDER_ERROR_CODES.CANCELLED);
      }
      const provider = providerMap[request.selection.modelId];
      if (provider === undefined) {
        return createErrorResponse(request, AI_PROVIDER_ERROR_CODES.UNAVAILABLE);
      }
      try {
        const providerValue = await provider.generate(request, { signal: options.signal });
        return createSuccessResponse(request, normalizeProviderResult(request, providerValue));
      } catch (error) {
        const providerCode = typeof error?.code === 'string'
          ? error.code
          : AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
        return createErrorResponse(request, providerCode);
      }
    },
  });
}
