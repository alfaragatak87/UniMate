export const CREDENTIAL_CONTRACT_VERSION = 1;

export const CREDENTIAL_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  GEMINI: 'gemini',
});

export const CREDENTIAL_STATES = Object.freeze({
  MISSING: 'missing',
  CONFIGURED: 'configured',
  CORRUPT: 'corrupt',
  UNAVAILABLE: 'unavailable',
});

export const CREDENTIAL_STORAGE_STATES = Object.freeze({
  READY: 'ready',
  MISSING: 'missing',
  CORRUPT: 'corrupt',
  UNAVAILABLE: 'unavailable',
});

export const CREDENTIAL_LIMITS = Object.freeze({
  MIN_CHARACTERS: 16,
  MAX_CHARACTERS: 4096,
});

export const CREDENTIAL_PROVIDER_VALUES = Object.freeze(Object.values(CREDENTIAL_PROVIDERS));
export const CREDENTIAL_STATE_VALUES = Object.freeze(Object.values(CREDENTIAL_STATES));
export const CREDENTIAL_STORAGE_STATE_VALUES = Object.freeze(Object.values(CREDENTIAL_STORAGE_STATES));

export const CREDENTIAL_MUTATION_SCHEMA = Object.freeze({
  $id: 'unimate.credentials.mutation.v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'provider', 'credential'],
  properties: {
    schemaVersion: { const: CREDENTIAL_CONTRACT_VERSION },
    provider: { type: 'string', enum: CREDENTIAL_PROVIDER_VALUES },
    credential: {
      type: 'string',
      minLength: CREDENTIAL_LIMITS.MIN_CHARACTERS,
      maxLength: CREDENTIAL_LIMITS.MAX_CHARACTERS,
    },
  },
});

export const CREDENTIAL_DELETE_SCHEMA = Object.freeze({
  $id: 'unimate.credentials.delete.v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'provider', 'confirm'],
  properties: {
    schemaVersion: { const: CREDENTIAL_CONTRACT_VERSION },
    provider: { type: 'string', enum: CREDENTIAL_PROVIDER_VALUES },
    confirm: { const: true },
  },
});

export const CREDENTIAL_STATUS_SCHEMA = Object.freeze({
  $id: 'unimate.credentials.status.v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'storage', 'providers'],
  properties: {
    schemaVersion: { const: CREDENTIAL_CONTRACT_VERSION },
    storage: { type: 'string', enum: CREDENTIAL_STORAGE_STATE_VALUES },
    providers: {
      type: 'object',
      additionalProperties: false,
      required: CREDENTIAL_PROVIDER_VALUES,
      properties: {
        openai: { type: 'string', enum: CREDENTIAL_STATE_VALUES },
        gemini: { type: 'string', enum: CREDENTIAL_STATE_VALUES },
      },
    },
  },
});
