import {
  CREDENTIAL_CONFIGURATION_MODE_VALUES,
  CREDENTIAL_MUTATION_OUTCOMES,
  CREDENTIAL_MUTATION_OUTCOME_VALUES,
  CREDENTIAL_RESPONSE_OPERATIONS,
  CREDENTIAL_RESPONSE_OPERATION_VALUES,
  CREDENTIAL_TRANSPORT_OPERATIONS,
  CREDENTIAL_TRANSPORT_OPERATION_VALUES,
  CREDENTIAL_TRANSPORT_VERSION,
} from './transportContracts.mjs';
import {
  validateCredentialProvider,
  validateCredentialStatus,
  validateCredentialValue,
} from './validation.mjs';

export class CredentialTransportValidationError extends Error {
  constructor(errors) {
    super('Kontrak transport credential tidak valid.');
    this.name = 'CredentialTransportValidationError';
    this.code = 'invalid_credential_transport';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function rejectUnknownKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addError(errors, `${path}.${key}`, 'field tidak dikenali');
  }
}

function requireKeys(value, required, path, errors) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) addError(errors, `${path}.${key}`, 'field wajib');
  }
}

function validateVersion(value, errors) {
  if (value.schemaVersion !== CREDENTIAL_TRANSPORT_VERSION) {
    addError(errors, '$.schemaVersion', `harus bernilai ${CREDENTIAL_TRANSPORT_VERSION}`);
  }
}

function validateStatusRequest(value, errors) {
  const keys = ['schemaVersion', 'operation'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
}

function validateConfigureRequest(value, errors) {
  const keys = ['schemaVersion', 'operation', 'provider', 'mode', 'credential'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  errors.push(...validateCredentialProvider(value.provider).errors);
  if (!CREDENTIAL_CONFIGURATION_MODE_VALUES.includes(value.mode)) {
    addError(errors, '$.mode', 'mode konfigurasi tidak didukung');
  }
  errors.push(...validateCredentialValue(value.credential).errors);
}

function validateRemoveRequest(value, errors) {
  const keys = ['schemaVersion', 'operation', 'provider'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  errors.push(...validateCredentialProvider(value.provider).errors);
}

export function validateCredentialTransportRequest(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [{ path: '$', message: 'harus berupa object' }] };
  validateVersion(value, errors);
  if (!CREDENTIAL_TRANSPORT_OPERATION_VALUES.includes(value.operation)) {
    addError(errors, '$.operation', 'operasi tidak didukung');
    return { valid: false, errors };
  }
  if (value.operation === CREDENTIAL_TRANSPORT_OPERATIONS.STATUS) validateStatusRequest(value, errors);
  if (value.operation === CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE) validateConfigureRequest(value, errors);
  if (value.operation === CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE) validateRemoveRequest(value, errors);
  return { valid: errors.length === 0, errors };
}

function validateStatusResponse(value, errors) {
  const keys = ['schemaVersion', 'operation', 'status'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  const statusValidation = validateCredentialStatus(value.status);
  for (const error of statusValidation.errors) {
    addError(errors, `$.status${error.path.slice(1)}`, error.message);
  }
}

function validateMutationResponse(value, errors) {
  const keys = ['schemaVersion', 'operation', 'provider', 'outcome', 'changed'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  errors.push(...validateCredentialProvider(value.provider).errors);
  if (!CREDENTIAL_MUTATION_OUTCOME_VALUES.includes(value.outcome)) {
    addError(errors, '$.outcome', 'hasil mutasi tidak didukung');
  }
  if (typeof value.changed !== 'boolean') addError(errors, '$.changed', 'harus berupa boolean');
  if (value.outcome === CREDENTIAL_MUTATION_OUTCOMES.CANCELLED && value.changed !== false) {
    addError(errors, '$.changed', 'pembatalan tidak boleh mengubah credential');
  }
  if (
    value.outcome === CREDENTIAL_MUTATION_OUTCOMES.COMPLETED
    && [CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE, CREDENTIAL_RESPONSE_OPERATIONS.REPLACE].includes(value.operation)
    && value.changed !== true
  ) {
    addError(errors, '$.changed', 'konfigurasi berhasil harus menandai perubahan');
  }
}

export function validateCredentialTransportResponse(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [{ path: '$', message: 'harus berupa object' }] };
  validateVersion(value, errors);
  if (!CREDENTIAL_RESPONSE_OPERATION_VALUES.includes(value.operation)) {
    addError(errors, '$.operation', 'operasi respons tidak didukung');
    return { valid: false, errors };
  }
  if (value.operation === CREDENTIAL_RESPONSE_OPERATIONS.STATUS) validateStatusResponse(value, errors);
  else validateMutationResponse(value, errors);
  return { valid: errors.length === 0, errors };
}

export function assertValidCredentialTransportRequest(value) {
  const validation = validateCredentialTransportRequest(value);
  if (!validation.valid) throw new CredentialTransportValidationError(validation.errors);
  return value;
}

export function assertValidCredentialTransportResponse(value) {
  const validation = validateCredentialTransportResponse(value);
  if (!validation.valid) throw new CredentialTransportValidationError(validation.errors);
  return value;
}
