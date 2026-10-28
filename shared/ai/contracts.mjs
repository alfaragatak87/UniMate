export const AI_CONTRACT_VERSION = 2;

export const AI_CAPABILITIES = Object.freeze({
  CHAT: 'chat',
  ANALYTICS: 'analytics',
  DOCUMENT_SCAN: 'document_scan',
});

export const AI_SENSITIVITIES = Object.freeze({
  NORMAL: 'normal',
  PERSONAL_DATA: 'personal_data',
  ACADEMIC_DOCUMENT: 'academic_document',
});

export const AI_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  GEMINI: 'gemini',
});

export const AI_SELECTION_MODES = Object.freeze({
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
});

export const AI_COMPLEXITY_LEVELS = Object.freeze({
  LIGHT: 'light',
  MEDIUM: 'medium',
  HEAVY: 'heavy',
});

export const AI_ACCESS_MODES = Object.freeze({
  FREE_ONLY: 'free_only',
});

export const AI_SCAN_TYPES = Object.freeze({
  AUTO: 'auto',
  KHS: 'khs',
  EVENT: 'event',
});

export const AI_DIRECTIONS = Object.freeze({
  KHS: 'khs',
  TASK: 'task',
  EVENT: 'event',
  FILE: 'file',
  UNKNOWN: 'unknown',
});

export const AI_FALLBACK_REASONS = Object.freeze({
  PRIMARY_NOT_CONFIGURED: 'primary_not_configured',
  PRIMARY_AUTH_FAILED: 'primary_auth_failed',
  PRIMARY_QUOTA_EXCEEDED: 'primary_quota_exceeded',
  PRIMARY_RATE_LIMITED: 'primary_rate_limited',
  PRIMARY_TIMEOUT: 'primary_timeout',
  PRIMARY_NETWORK_ERROR: 'primary_network_error',
  PRIMARY_UNAVAILABLE: 'primary_unavailable',
  PRIMARY_INVALID_RESPONSE: 'primary_invalid_response',
});

export const AI_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'invalid_request',
  INVALID_RESPONSE: 'invalid_response',
  CONSENT_REQUIRED: 'consent_required',
  MODEL_NOT_AVAILABLE: 'model_not_available',
  QUOTA_EXCEEDED: 'quota_exceeded',
  QUOTA_UNAVAILABLE: 'quota_unavailable',
  BUDGET_NOT_CONFIGURED: 'budget_not_configured',
  BUDGET_EXCEEDED: 'budget_exceeded',
  BUDGET_UNAVAILABLE: 'budget_unavailable',
  RATE_LIMITED: 'rate_limited',
  PROVIDER_TIMEOUT: 'provider_timeout',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  ALL_PROVIDERS_FAILED: 'all_providers_failed',
  REQUEST_CANCELLED: 'request_cancelled',
  INTERNAL_ERROR: 'internal_error',
});

export const AI_PROVIDER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'invalid_request',
  NOT_CONFIGURED: 'provider_not_configured',
  AUTH_FAILED: 'provider_auth_failed',
  QUOTA_EXCEEDED: 'provider_quota_exceeded',
  TIMEOUT: 'provider_timeout',
  RATE_LIMITED: 'provider_rate_limited',
  NETWORK_ERROR: 'provider_network_error',
  CANCELLED: 'provider_cancelled',
  UNAVAILABLE: 'provider_unavailable',
  INVALID_RESPONSE: 'provider_invalid_response',
});

export const AI_LIMITS = Object.freeze({
  CHAT_MESSAGE_CHARACTERS: 8000,
  ANALYTICS_ROWS: 50,
  ANALYTICS_AXES: 20,
  DOCUMENT_BYTES: 10 * 1024 * 1024,
  DOCUMENT_CONTEXT_CHARACTERS: 2000,
});

export const AI_DOCUMENT_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/bmp',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

export const AI_OUTPUT_TOKEN_LIMITS = Object.freeze({
  [AI_CAPABILITIES.CHAT]: 2048,
  [AI_CAPABILITIES.ANALYTICS]: 3072,
  [AI_CAPABILITIES.DOCUMENT_SCAN]: 4096,
});

export const AI_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AI_CAPABILITY_VALUES = Object.freeze(Object.values(AI_CAPABILITIES));
export const AI_SENSITIVITY_VALUES = Object.freeze(Object.values(AI_SENSITIVITIES));
export const AI_PROVIDER_VALUES = Object.freeze(Object.values(AI_PROVIDERS));
export const AI_SELECTION_MODE_VALUES = Object.freeze(Object.values(AI_SELECTION_MODES));
export const AI_COMPLEXITY_LEVEL_VALUES = Object.freeze(Object.values(AI_COMPLEXITY_LEVELS));
export const AI_ACCESS_MODE_VALUES = Object.freeze(Object.values(AI_ACCESS_MODES));
export const AI_SCAN_TYPE_VALUES = Object.freeze(Object.values(AI_SCAN_TYPES));
export const AI_DIRECTION_VALUES = Object.freeze(Object.values(AI_DIRECTIONS));
export const AI_FALLBACK_REASON_VALUES = Object.freeze(Object.values(AI_FALLBACK_REASONS));
export const AI_ERROR_CODE_VALUES = Object.freeze(Object.values(AI_ERROR_CODES));

export const AI_ALLOWED_SENSITIVITIES = Object.freeze({
  [AI_CAPABILITIES.CHAT]: Object.freeze([
    AI_SENSITIVITIES.NORMAL,
    AI_SENSITIVITIES.PERSONAL_DATA,
  ]),
  [AI_CAPABILITIES.ANALYTICS]: Object.freeze([
    AI_SENSITIVITIES.PERSONAL_DATA,
  ]),
  [AI_CAPABILITIES.DOCUMENT_SCAN]: Object.freeze([
    AI_SENSITIVITIES.ACADEMIC_DOCUMENT,
  ]),
});
