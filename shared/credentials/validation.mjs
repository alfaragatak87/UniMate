import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_LIMITS,
  CREDENTIAL_PROVIDER_VALUES,
  CREDENTIAL_STATE_VALUES,
  CREDENTIAL_STORAGE_STATE_VALUES,
} from './contracts.mjs';

export class CredentialContractValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'CredentialContractValidationError';
    this.code = 'invalid_credential_contract';
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

export function validateCredentialProvider(provider) {
  const errors = [];
  if (!CREDENTIAL_PROVIDER_VALUES.includes(provider)) addError(errors, '$.provider', 'provider tidak didukung');
  return { valid: errors.length === 0, errors };
}

export function validateCredentialValue(credential) {
  const errors = [];
  if (typeof credential !== 'string') {
    addError(errors, '$.credential', 'credential harus berupa string');
  } else {
    if (credential.length < CREDENTIAL_LIMITS.MIN_CHARACTERS || credential.length > CREDENTIAL_LIMITS.MAX_CHARACTERS) {
      addError(errors, '$.credential', 'panjang credential tidak valid');
    }
    if (credential.trim() !== credential) addError(errors, '$.credential', 'credential tidak boleh memiliki spasi luar');
    if (/\p{Cc}/u.test(credential)) addError(errors, '$.credential', 'credential mengandung karakter kontrol');
  }
  return { valid: errors.length === 0, errors };
}

export function validateCredentialMutation(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [{ path: '$', message: 'harus berupa object' }] };
  const keys = ['schemaVersion', 'provider', 'credential'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  if (value.schemaVersion !== CREDENTIAL_CONTRACT_VERSION) addError(errors, '$.schemaVersion', `harus bernilai ${CREDENTIAL_CONTRACT_VERSION}`);
  errors.push(...validateCredentialProvider(value.provider).errors);
  errors.push(...validateCredentialValue(value.credential).errors);
  return { valid: errors.length === 0, errors };
}

export function validateCredentialDelete(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [{ path: '$', message: 'harus berupa object' }] };
  const keys = ['schemaVersion', 'provider', 'confirm'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  if (value.schemaVersion !== CREDENTIAL_CONTRACT_VERSION) addError(errors, '$.schemaVersion', `harus bernilai ${CREDENTIAL_CONTRACT_VERSION}`);
  errors.push(...validateCredentialProvider(value.provider).errors);
  if (value.confirm !== true) addError(errors, '$.confirm', 'konfirmasi wajib bernilai true');
  return { valid: errors.length === 0, errors };
}

export function validateCredentialStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [{ path: '$', message: 'harus berupa object' }] };
  const keys = ['schemaVersion', 'storage', 'providers'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);
  if (value.schemaVersion !== CREDENTIAL_CONTRACT_VERSION) addError(errors, '$.schemaVersion', `harus bernilai ${CREDENTIAL_CONTRACT_VERSION}`);
  if (!CREDENTIAL_STORAGE_STATE_VALUES.includes(value.storage)) addError(errors, '$.storage', 'status storage tidak didukung');
  if (!isPlainObject(value.providers)) {
    addError(errors, '$.providers', 'harus berupa object');
  } else {
    rejectUnknownKeys(value.providers, CREDENTIAL_PROVIDER_VALUES, '$.providers', errors);
    requireKeys(value.providers, CREDENTIAL_PROVIDER_VALUES, '$.providers', errors);
    for (const provider of CREDENTIAL_PROVIDER_VALUES) {
      if (!CREDENTIAL_STATE_VALUES.includes(value.providers[provider])) {
        addError(errors, `$.providers.${provider}`, 'status provider tidak didukung');
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidCredentialMutation(value) {
  const validation = validateCredentialMutation(value);
  if (!validation.valid) throw new CredentialContractValidationError('Request credential tidak valid', validation.errors);
  return value;
}

export function assertValidCredentialDelete(value) {
  const validation = validateCredentialDelete(value);
  if (!validation.valid) throw new CredentialContractValidationError('Request penghapusan credential tidak valid', validation.errors);
  return value;
}

export function assertValidCredentialStatus(value) {
  const validation = validateCredentialStatus(value);
  if (!validation.valid) throw new CredentialContractValidationError('Status credential tidak valid', validation.errors);
  return value;
}
