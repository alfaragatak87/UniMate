import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_LIMITS,
  CREDENTIAL_PROVIDER_VALUES,
  CREDENTIAL_STATE_VALUES,
  CREDENTIAL_STORAGE_STATE_VALUES,
} from './contracts.mjs';

export const CREDENTIAL_TRANSPORT_VERSION = 1;

export const CREDENTIAL_TRANSPORT_OPERATIONS = Object.freeze({
  STATUS: 'status',
  CONFIGURE: 'configure',
  REMOVE: 'remove',
});

export const CREDENTIAL_CONFIGURATION_MODES = Object.freeze({
  CREATE: 'create',
  REPLACE: 'replace',
});

export const CREDENTIAL_CONFIRMATION_ACTIONS = Object.freeze({
  CONFIGURE: 'configure',
  REPLACE: 'replace',
  REMOVE: 'remove',
});

export const CREDENTIAL_MUTATION_OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const CREDENTIAL_RESPONSE_OPERATIONS = Object.freeze({
  STATUS: 'status',
  CONFIGURE: 'configure',
  REPLACE: 'replace',
  REMOVE: 'remove',
});

export const CREDENTIAL_TRANSPORT_OPERATION_VALUES = Object.freeze(Object.values(CREDENTIAL_TRANSPORT_OPERATIONS));
export const CREDENTIAL_CONFIGURATION_MODE_VALUES = Object.freeze(Object.values(CREDENTIAL_CONFIGURATION_MODES));
export const CREDENTIAL_CONFIRMATION_ACTION_VALUES = Object.freeze(Object.values(CREDENTIAL_CONFIRMATION_ACTIONS));
export const CREDENTIAL_MUTATION_OUTCOME_VALUES = Object.freeze(Object.values(CREDENTIAL_MUTATION_OUTCOMES));
export const CREDENTIAL_RESPONSE_OPERATION_VALUES = Object.freeze(Object.values(CREDENTIAL_RESPONSE_OPERATIONS));

export const CREDENTIAL_TRANSPORT_REQUEST_SCHEMA = Object.freeze({
  $id: 'unimate.credentials.transport.request.v1',
  oneOf: Object.freeze([
    Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['schemaVersion', 'operation']),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ const: CREDENTIAL_TRANSPORT_VERSION }),
        operation: Object.freeze({ const: CREDENTIAL_TRANSPORT_OPERATIONS.STATUS }),
      }),
    }),
    Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['schemaVersion', 'operation', 'provider', 'mode', 'credential']),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ const: CREDENTIAL_TRANSPORT_VERSION }),
        operation: Object.freeze({ const: CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE }),
        provider: Object.freeze({ type: 'string', enum: CREDENTIAL_PROVIDER_VALUES }),
        mode: Object.freeze({ type: 'string', enum: CREDENTIAL_CONFIGURATION_MODE_VALUES }),
        credential: Object.freeze({
          type: 'string',
          minLength: CREDENTIAL_LIMITS.MIN_CHARACTERS,
          maxLength: CREDENTIAL_LIMITS.MAX_CHARACTERS,
        }),
      }),
    }),
    Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['schemaVersion', 'operation', 'provider']),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ const: CREDENTIAL_TRANSPORT_VERSION }),
        operation: Object.freeze({ const: CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE }),
        provider: Object.freeze({ type: 'string', enum: CREDENTIAL_PROVIDER_VALUES }),
      }),
    }),
  ]),
});

export const CREDENTIAL_TRANSPORT_RESPONSE_SCHEMA = Object.freeze({
  $id: 'unimate.credentials.transport.response.v1',
  oneOf: Object.freeze([
    Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['schemaVersion', 'operation', 'status']),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ const: CREDENTIAL_TRANSPORT_VERSION }),
        operation: Object.freeze({ const: CREDENTIAL_RESPONSE_OPERATIONS.STATUS }),
        status: Object.freeze({
          type: 'object',
          additionalProperties: false,
          required: Object.freeze(['schemaVersion', 'storage', 'providers']),
          properties: Object.freeze({
            schemaVersion: Object.freeze({ const: CREDENTIAL_CONTRACT_VERSION }),
            storage: Object.freeze({ type: 'string', enum: CREDENTIAL_STORAGE_STATE_VALUES }),
            providers: Object.freeze({
              type: 'object',
              additionalProperties: false,
              required: CREDENTIAL_PROVIDER_VALUES,
              properties: Object.freeze(Object.fromEntries(CREDENTIAL_PROVIDER_VALUES.map(provider => [
                provider,
                Object.freeze({ type: 'string', enum: CREDENTIAL_STATE_VALUES }),
              ]))),
            }),
          }),
        }),
      }),
    }),
    Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(['schemaVersion', 'operation', 'provider', 'outcome', 'changed']),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ const: CREDENTIAL_TRANSPORT_VERSION }),
        operation: Object.freeze({ type: 'string', enum: Object.freeze([
          CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE,
          CREDENTIAL_RESPONSE_OPERATIONS.REPLACE,
          CREDENTIAL_RESPONSE_OPERATIONS.REMOVE,
        ]) }),
        provider: Object.freeze({ type: 'string', enum: CREDENTIAL_PROVIDER_VALUES }),
        outcome: Object.freeze({ type: 'string', enum: CREDENTIAL_MUTATION_OUTCOME_VALUES }),
        changed: Object.freeze({ type: 'boolean' }),
      }),
    }),
  ]),
});
