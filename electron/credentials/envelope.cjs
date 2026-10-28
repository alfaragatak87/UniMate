const {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_PROVIDER_VALUES,
} = require('./constants.cjs');

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class CredentialEnvelopeError extends Error {
  constructor(code) {
    super('Penyimpanan credential tidak valid.');
    this.name = 'CredentialEnvelopeError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, allowedKeys, requiredKeys = allowedKeys) {
  const keys = Object.keys(value);
  return keys.every(key => allowedKeys.includes(key)) && requiredKeys.every(key => Object.hasOwn(value, key));
}

function isIsoDate(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 32) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isValidRecord(value) {
  return isPlainObject(value)
    && hasExactKeys(value, ['ciphertext', 'updatedAt'])
    && typeof value.ciphertext === 'string'
    && value.ciphertext.length > 0
    && value.ciphertext.length <= 16 * 1024
    && value.ciphertext.length % 4 === 0
    && BASE64_PATTERN.test(value.ciphertext)
    && isIsoDate(value.updatedAt);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateCredentialEnvelope(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, ['schemaVersion', 'encryption', 'records'])) return false;
  if (value.schemaVersion !== CREDENTIAL_ENVELOPE_VERSION) return false;
  if (typeof value.encryption !== 'string' || value.encryption.length < 1 || value.encryption.length > 128) return false;
  if (!isPlainObject(value.records)) return false;
  if (!Object.keys(value.records).every(provider => CREDENTIAL_PROVIDER_VALUES.includes(provider))) return false;
  return Object.values(value.records).every(isValidRecord);
}

function createEmptyCredentialEnvelope(encryption) {
  const value = {
    schemaVersion: CREDENTIAL_ENVELOPE_VERSION,
    encryption,
    records: {},
  };
  if (!validateCredentialEnvelope(value)) throw new CredentialEnvelopeError('invalid_encryption_identifier');
  return value;
}

function parseCredentialEnvelope(serialized) {
  try {
    const value = JSON.parse(serialized);
    if (!validateCredentialEnvelope(value)) throw new CredentialEnvelopeError('invalid_envelope');
    return clone(value);
  } catch (error) {
    if (error instanceof CredentialEnvelopeError) throw error;
    throw new CredentialEnvelopeError('invalid_json');
  }
}

function serializeCredentialEnvelope(value) {
  if (!validateCredentialEnvelope(value)) throw new CredentialEnvelopeError('invalid_envelope');
  return `${JSON.stringify(value)}\n`;
}

module.exports = {
  CredentialEnvelopeError,
  createEmptyCredentialEnvelope,
  parseCredentialEnvelope,
  serializeCredentialEnvelope,
  validateCredentialEnvelope,
};
