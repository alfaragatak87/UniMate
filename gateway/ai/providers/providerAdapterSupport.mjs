import {
  AI_CAPABILITIES,
  AI_OUTPUT_TOKEN_LIMITS,
  AI_PROVIDER_ERROR_CODES,
} from '../../../shared/ai/contracts.mjs';
import { AI_RESULT_SCHEMAS } from '../../../shared/ai/schemas.mjs';
import {
  assertValidAIRequest,
  validateCapabilityResult,
} from '../../../shared/ai/validation.mjs';

const PROVIDER_ERROR_VALUES = Object.freeze(Object.values(AI_PROVIDER_ERROR_CODES));
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class ProviderAdapterError extends Error {
  constructor(code) {
    super('Provider AI tidak dapat menyelesaikan permintaan.');
    this.name = 'ProviderAdapterError';
    this.code = PROVIDER_ERROR_VALUES.includes(code) ? code : AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
  }
}

export function normalizeProviderConfig(options = {}) {
  const {
    model,
    transport,
    timeoutMs = 30_000,
    outputTokens = AI_OUTPUT_TOKEN_LIMITS,
  } = options;
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) {
    throw new TypeError('Model provider wajib dikonfigurasi secara eksplisit');
  }
  if (typeof transport?.send !== 'function') throw new TypeError('Transport provider tidak valid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new TypeError('Timeout provider tidak valid');
  }
  if (outputTokens === null || typeof outputTokens !== 'object' || Array.isArray(outputTokens)) {
    throw new TypeError('Batas output provider tidak valid');
  }
  const normalizedTokens = {};
  for (const capability of Object.values(AI_CAPABILITIES)) {
    const value = outputTokens[capability];
    if (!Number.isInteger(value) || value < 1 || value > 8192) {
      throw new TypeError('Batas output provider tidak valid');
    }
    normalizedTokens[capability] = value;
  }
  return Object.freeze({
    model,
    transport,
    timeoutMs,
    outputTokens: Object.freeze(normalizedTokens),
  });
}

export function assertExecutionInput(value) {
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || keys.some(key => !['request', 'credential', 'signal'].includes(key))
    || !keys.includes('request')
    || !keys.includes('credential')
    || typeof value.credential !== 'string'
    || value.credential.length < 8
  ) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  try {
    assertValidAIRequest(value.request);
  } catch {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
}

export function createProviderPrompt(request) {
  const schema = AI_RESULT_SCHEMAS[request.capability];
  const sharedInstructions = [
    'Anda adalah backend AI UniMate.',
    'Utamakan tujuan dan instruksi pengguna selama aman, sah, dan dapat dilakukan.',
    'Bantu kebutuhan akademik maupun kebutuhan umum tanpa membatasi topik secara tidak perlu.',
    'Sesuaikan tingkat detail dan gaya bahasa dengan permintaan pengguna.',
    'Berikan solusi praktis, jelaskan keterbatasan secara jujur, dan jangan mengarang hasil atau kemampuan.',
    'Jangan menyatakan telah membuat file atau melakukan tindakan yang tidak benar-benar tersedia.',
    'Kembalikan tepat satu objek JSON tanpa markdown atau teks tambahan.',
    `Hasil wajib mengikuti JSON Schema berikut: ${JSON.stringify(schema)}`,
  ];

  if (request.capability === AI_CAPABILITIES.CHAT) {
    return Object.freeze({
      instructions: sharedInstructions.join('\n'),
      schema,
      userText: JSON.stringify({ locale: request.input.locale, message: request.input.message }),
      file: null,
    });
  }
  if (request.capability === AI_CAPABILITIES.ANALYTICS) {
    return Object.freeze({
      instructions: [
        ...sharedInstructions,
        'Gunakan hanya data yang diberikan dan pisahkan fakta data dari interpretasi.',
      ].join('\n'),
      schema,
      userText: JSON.stringify(request.input),
      file: null,
    });
  }
  return Object.freeze({
    instructions: [
      ...sharedInstructions,
      'Ekstrak hanya informasi yang terlihat atau dapat didukung dokumen.',
      'Gunakan null atau array kosong bila informasi tidak tersedia; jangan menebak data akademik.',
    ].join('\n'),
    schema,
    userText: JSON.stringify({
      scanType: request.input.scanType,
      userContext: request.input.userContext,
      file: {
        name: request.input.file.name,
        mimeType: request.input.file.mimeType,
        size: request.input.file.size,
      },
    }),
    file: Object.freeze({ ...request.input.file }),
  });
}

export function parseCapabilityResult(request, text) {
  if (typeof text !== 'string' || text.length < 2 || text.length > 1_048_576) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!validateCapabilityResult(request.capability, result).valid) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return JSON.parse(JSON.stringify(result));
}

export function classifyHttpError(status, body) {
  const providerCode = typeof body?.error?.code === 'string' ? body.error.code : '';
  const providerStatus = typeof body?.error?.status === 'string' ? body.error.status : '';
  const quotaDetails = Array.isArray(body?.error?.details)
    ? JSON.stringify(body.error.details).toLowerCase()
    : '';
  if (status === 401 || status === 403) return AI_PROVIDER_ERROR_CODES.AUTH_FAILED;
  if (status === 408 || status === 504) return AI_PROVIDER_ERROR_CODES.TIMEOUT;
  if (status === 429) {
    if (['insufficient_quota', 'billing_hard_limit_reached'].includes(providerCode)) {
      return AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED;
    }
    if (providerStatus === 'RESOURCE_EXHAUSTED') {
      return /perday|requestsperday|daily|rpd/u.test(quotaDetails)
        ? AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED
        : AI_PROVIDER_ERROR_CODES.RATE_LIMITED;
    }
    return AI_PROVIDER_ERROR_CODES.RATE_LIMITED;
  }
  if (status === 400 || status === 404 || status === 422) return AI_PROVIDER_ERROR_CODES.INVALID_REQUEST;
  if (status >= 500) return AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
  return AI_PROVIDER_ERROR_CODES.UNAVAILABLE;
}

export function normalizeAdapterError(error) {
  if (error instanceof ProviderAdapterError) return error;
  if (PROVIDER_ERROR_VALUES.includes(error?.code)) return new ProviderAdapterError(error.code);
  return new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.UNAVAILABLE);
}
