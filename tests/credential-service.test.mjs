import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { CREDENTIAL_CONTRACT_VERSION, CREDENTIAL_PROVIDERS } from '../shared/credentials/contracts.mjs';
import fileStoreModule from '../electron/credentials/encryptedFileStore.cjs';
import credentialServiceModule from '../electron/credentials/credentialService.cjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_GEMINI_MUTATION,
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_MUTATION,
  SYNTHETIC_OPENAI_REPLACEMENT,
  clone,
  createCredentialHarness,
  createMockEncryptionAdapter,
  createServiceForPath,
} from './fixtures/credentialFixtures.mjs';

const { createEncryptedCredentialFileStore } = fileStoreModule;
const { CredentialServiceError, createCredentialService } = credentialServiceModule;

async function useCredentialAsBoolean(service, provider, expected) {
  return service.withCredential(provider, credential => ({ matches: credential === expected }));
}

test('status awal tidak mengandung credential atau ciphertext', async (t) => {
  const harness = await createCredentialHarness(t);
  const status = await harness.service.getStatus();
  assert.deepEqual(status, {
    schemaVersion: CREDENTIAL_CONTRACT_VERSION,
    storage: 'missing',
    providers: { openai: 'missing', gemini: 'missing' },
  });
  assert.equal(JSON.stringify(status).includes('credential'), false);
});

test('configure menulis ciphertext dan hanya mengembalikan metadata aman', async (t) => {
  const harness = await createCredentialHarness(t);
  const result = await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const serialized = await fs.readFile(harness.filePath, 'utf8');

  assert.deepEqual(result, { provider: CREDENTIAL_PROVIDERS.OPENAI, configured: true, replaced: false });
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  assert.equal(serialized.includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  assert.equal(serialized.includes('ciphertext'), true);
  assert.equal((await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.OPENAI, SYNTHETIC_OPENAI_CREDENTIAL)).matches, true);
});

test('credential bertahan setelah service dibuat ulang dengan adapter yang sama', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const restarted = createServiceForPath(harness.filePath);
  const result = await useCredentialAsBoolean(restarted.service, CREDENTIAL_PROVIDERS.OPENAI, SYNTHETIC_OPENAI_CREDENTIAL);
  assert.equal(result.matches, true);
});

test('konfigurasi bersamaan tidak menghilangkan provider lain', async (t) => {
  const harness = await createCredentialHarness(t);
  await Promise.all([
    harness.service.configure(SYNTHETIC_OPENAI_MUTATION),
    harness.service.configure(SYNTHETIC_GEMINI_MUTATION),
  ]);
  const status = await harness.service.getStatus();
  assert.deepEqual(status.providers, { openai: 'configured', gemini: 'configured' });
  assert.equal((await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.GEMINI, SYNTHETIC_GEMINI_CREDENTIAL)).matches, true);
});

test('replace berhasil secara atomik dan menandai metadata replaced', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const replacement = clone(SYNTHETIC_OPENAI_MUTATION);
  replacement.credential = SYNTHETIC_OPENAI_REPLACEMENT;
  const result = await harness.service.configure(replacement);

  assert.equal(result.replaced, true);
  assert.equal((await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.OPENAI, SYNTHETIC_OPENAI_REPLACEMENT)).matches, true);
});

test('kegagalan commit mempertahankan credential lama dan membersihkan file sementara', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'rename') return async () => { throw new Error('synthetic rename failure'); };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const failing = createServiceForPath(harness.filePath, {
    fsApi: failingFs,
    randomId: () => 'synthetic-failure',
  });
  const replacement = clone(SYNTHETIC_OPENAI_MUTATION);
  replacement.credential = SYNTHETIC_OPENAI_REPLACEMENT;

  await assert.rejects(
    failing.service.configure(replacement),
    error => error instanceof CredentialServiceError && error.code === 'write_failed',
  );
  assert.equal((await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.OPENAI, SYNTHETIC_OPENAI_CREDENTIAL)).matches, true);
  assert.equal((await fs.readdir(harness.directory)).some(name => name.endsWith('.tmp')), false);
});

test('file rusak ditolak tanpa ditimpa otomatis', async (t) => {
  const harness = await createCredentialHarness(t);
  const corruptValue = '{synthetic-corrupt-envelope';
  await fs.writeFile(harness.filePath, corruptValue, 'utf8');

  await assert.rejects(
    harness.service.configure(SYNTHETIC_OPENAI_MUTATION),
    error => error instanceof CredentialServiceError && error.code === 'storage_corrupt',
  );
  assert.equal(await fs.readFile(harness.filePath, 'utf8'), corruptValue);
  assert.equal((await harness.service.getStatus()).storage, 'corrupt');
});

test('adapter tidak tersedia menghasilkan fail-closed', async (t) => {
  const adapter = createMockEncryptionAdapter({ available: false });
  const harness = await createCredentialHarness(t, { adapter });
  const status = await harness.service.getStatus();
  assert.equal(status.storage, 'unavailable');
  await assert.rejects(
    harness.service.configure(SYNTHETIC_OPENAI_MUTATION),
    error => error instanceof CredentialServiceError && error.code === 'storage_unavailable',
  );
});

test('penghapusan satu provider tidak menghapus provider lain', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const result = await harness.service.remove({
    schemaVersion: CREDENTIAL_CONTRACT_VERSION,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
    confirm: true,
  });
  const status = await harness.service.getStatus();

  assert.deepEqual(result, { provider: CREDENTIAL_PROVIDERS.OPENAI, configured: false, removed: true });
  assert.deepEqual(status.providers, { openai: 'missing', gemini: 'configured' });
  assert.equal((await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.GEMINI, SYNTHETIC_GEMINI_CREDENTIAL)).matches, true);
});

test('callback tidak dapat mengembalikan credential langsung atau tersarang', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);

  await assert.rejects(
    harness.service.withCredential(CREDENTIAL_PROVIDERS.OPENAI, credential => credential),
    error => error instanceof CredentialServiceError && error.code === 'unsafe_result',
  );
  await assert.rejects(
    harness.service.withCredential(CREDENTIAL_PROVIDERS.OPENAI, credential => ({ nested: [credential] })),
    error => error instanceof CredentialServiceError && error.code === 'unsafe_result',
  );
  await assert.rejects(
    harness.service.withCredential(CREDENTIAL_PROVIDERS.OPENAI, credential => () => credential),
    error => error instanceof CredentialServiceError && error.code === 'unsafe_result',
  );
});

test('error callback disanitasi dan tidak memantulkan credential', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  await assert.rejects(
    harness.service.withCredential(CREDENTIAL_PROVIDERS.OPENAI, credential => {
      throw new Error(`synthetic failure ${credential}`);
    }),
    error => error instanceof CredentialServiceError
      && error.code === 'operation_failed'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});

test('ciphertext rusak gagal didekripsi tanpa dikembalikan ke pemanggil', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const envelope = JSON.parse(await fs.readFile(harness.filePath, 'utf8'));
  envelope.records.openai.ciphertext = Buffer.from('synthetic-corrupt-ciphertext').toString('base64');
  await fs.writeFile(harness.filePath, JSON.stringify(envelope), 'utf8');

  await assert.rejects(
    harness.service.withCredential(CREDENTIAL_PROVIDERS.OPENAI, () => ({ ok: true })),
    error => error instanceof CredentialServiceError && error.code === 'decryption_failed',
  );
});

test('service tidak menulis credential ke console', async (t) => {
  const harness = await createCredentialHarness(t);
  const calls = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => calls.push(args);
  console.warn = (...args) => calls.push(args);
  console.error = (...args) => calls.push(args);
  try {
    await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
    await harness.service.getStatus();
    await useCredentialAsBoolean(harness.service, CREDENTIAL_PROVIDERS.OPENAI, SYNTHETIC_OPENAI_CREDENTIAL);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.equal(calls.length, 0);
});

test('file store menolak envelope plaintext yang tidak valid', async (t) => {
  const harness = await createCredentialHarness(t);
  const store = createEncryptedCredentialFileStore({ filePath: harness.filePath });
  await assert.rejects(store.write({ credential: SYNTHETIC_OPENAI_CREDENTIAL }));
  await assert.rejects(fs.access(harness.filePath));
});

test('service menolak request invalid tanpa memasukkan credential ke error', async (t) => {
  const harness = await createCredentialHarness(t);
  const invalid = clone(SYNTHETIC_OPENAI_MUTATION);
  invalid.extra = SYNTHETIC_OPENAI_CREDENTIAL;
  await assert.rejects(
    harness.service.configure(invalid),
    error => error instanceof CredentialServiceError
      && error.code === 'invalid_request'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});
