import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_DELETE_SCHEMA,
  CREDENTIAL_MUTATION_SCHEMA,
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_STATUS_SCHEMA,
  CREDENTIAL_STATES,
  CREDENTIAL_STORAGE_STATES,
} from '../shared/credentials/contracts.mjs';
import {
  CredentialContractValidationError,
  assertValidCredentialDelete,
  assertValidCredentialMutation,
  assertValidCredentialStatus,
  validateCredentialDelete,
  validateCredentialMutation,
  validateCredentialStatus,
  validateCredentialValue,
} from '../shared/credentials/validation.mjs';
import {
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_MUTATION,
  clone,
} from './fixtures/credentialFixtures.mjs';

test('schema credential menggunakan versi kontrak 1 dan menolak field tambahan', () => {
  assert.equal(CREDENTIAL_MUTATION_SCHEMA.properties.schemaVersion.const, CREDENTIAL_CONTRACT_VERSION);
  assert.equal(CREDENTIAL_DELETE_SCHEMA.additionalProperties, false);
  assert.equal(CREDENTIAL_STATUS_SCHEMA.additionalProperties, false);
});

test('menerima mutation credential sintetis', () => {
  assert.deepEqual(validateCredentialMutation(SYNTHETIC_OPENAI_MUTATION), { valid: true, errors: [] });
  assert.equal(assertValidCredentialMutation(SYNTHETIC_OPENAI_MUTATION), SYNTHETIC_OPENAI_MUTATION);
});

test('menolak provider tidak dikenal', () => {
  const request = clone(SYNTHETIC_OPENAI_MUTATION);
  request.provider = 'unknown';
  assert.equal(validateCredentialMutation(request).valid, false);
});

test('menolak credential terlalu pendek, terlalu panjang, atau bukan string', () => {
  assert.equal(validateCredentialValue('pendek').valid, false);
  assert.equal(validateCredentialValue('x'.repeat(4097)).valid, false);
  assert.equal(validateCredentialValue(null).valid, false);
});

test('menolak spasi luar dan karakter kontrol', () => {
  assert.equal(validateCredentialValue(` ${SYNTHETIC_OPENAI_CREDENTIAL}`).valid, false);
  assert.equal(validateCredentialValue(`${SYNTHETIC_OPENAI_CREDENTIAL}\n`).valid, false);
});

test('menolak field tambahan tanpa memantulkan credential dalam error', () => {
  const request = clone(SYNTHETIC_OPENAI_MUTATION);
  request.debug = SYNTHETIC_OPENAI_CREDENTIAL;
  const validation = validateCredentialMutation(request);
  assert.equal(validation.valid, false);
  assert.equal(JSON.stringify(validation.errors).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
});

test('assert mutation menghasilkan error terstruktur dan tersanitasi', () => {
  const request = clone(SYNTHETIC_OPENAI_MUTATION);
  request.credential = '';
  assert.throws(
    () => assertValidCredentialMutation(request),
    error => error instanceof CredentialContractValidationError
      && error.code === 'invalid_credential_contract'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});

test('penghapusan memerlukan konfirmasi eksplisit', () => {
  const valid = {
    schemaVersion: CREDENTIAL_CONTRACT_VERSION,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
    confirm: true,
  };
  assert.deepEqual(validateCredentialDelete(valid), { valid: true, errors: [] });
  assert.equal(assertValidCredentialDelete(valid), valid);
  assert.equal(validateCredentialDelete({ ...valid, confirm: false }).valid, false);
});

test('status publik hanya menerima state yang dikenal', () => {
  const status = {
    schemaVersion: CREDENTIAL_CONTRACT_VERSION,
    storage: CREDENTIAL_STORAGE_STATES.READY,
    providers: {
      openai: CREDENTIAL_STATES.CONFIGURED,
      gemini: CREDENTIAL_STATES.MISSING,
    },
  };
  assert.deepEqual(validateCredentialStatus(status), { valid: true, errors: [] });
  assert.equal(assertValidCredentialStatus(status), status);
  assert.equal(validateCredentialStatus({ ...status, storage: 'unknown' }).valid, false);
});
