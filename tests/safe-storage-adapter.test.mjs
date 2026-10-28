import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import runtimeModule from '../electron/credentials/credentialRuntime.cjs';
import pathModule from '../electron/credentials/credentialPaths.cjs';
import adapterModule from '../electron/credentials/safeStorageAdapter.cjs';
import { SYNTHETIC_OPENAI_CREDENTIAL } from './fixtures/credentialFixtures.mjs';

const { createElectronCredentialRuntime } = runtimeModule;
const { resolveCredentialPaths } = pathModule;
const { SafeStorageAdapterError, createSafeStorageAdapter } = adapterModule;

function createFakeSafeStorage(options = {}) {
  const decryptResults = [...(options.decryptResults ?? [])];
  const calls = { availability: 0, encrypt: 0, decrypt: 0 };
  return {
    calls,
    api: {
      async isAsyncEncryptionAvailable() {
        calls.availability += 1;
        if (options.availabilityError) throw options.availabilityError;
        return options.available !== false;
      },
      async encryptStringAsync(value) {
        calls.encrypt += 1;
        if (options.encryptionError) throw options.encryptionError;
        return Buffer.from(`encrypted:${value}`, 'utf8');
      },
      async decryptStringAsync() {
        calls.decrypt += 1;
        if (options.decryptionError) throw options.decryptionError;
        return decryptResults.shift() ?? { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: false };
      },
    },
  };
}

test('safeStorage tidak tersedia sebelum Electron siap', async () => {
  const fake = createFakeSafeStorage();
  const adapter = createSafeStorageAdapter({ safeStorage: fake.api, isAppReady: () => false });
  assert.equal(await adapter.isAvailable(), false);
  assert.equal(fake.calls.availability, 0);
  await assert.rejects(adapter.encrypt(SYNTHETIC_OPENAI_CREDENTIAL), error => error.code === 'unavailable');
});

test('safeStorage menangani ketersediaan false dan error tanpa membocorkan pesan asli', async () => {
  const fake = createFakeSafeStorage({ availabilityError: new Error(SYNTHETIC_OPENAI_CREDENTIAL) });
  const adapter = createSafeStorageAdapter({ safeStorage: fake.api, isAppReady: () => true });
  assert.equal(await adapter.isAvailable(), false);
  await assert.rejects(
    adapter.decrypt(Buffer.from('ciphertext')),
    error => error instanceof SafeStorageAdapterError
      && error.code === 'unavailable'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});

test('safeStorage mengenkripsi dan mendekripsi hasil async yang valid', async () => {
  const fake = createFakeSafeStorage();
  const adapter = createSafeStorageAdapter({ safeStorage: fake.api, isAppReady: () => true });
  const encrypted = await adapter.encrypt(SYNTHETIC_OPENAI_CREDENTIAL);
  const decrypted = await adapter.decrypt(encrypted);
  assert.equal(Buffer.isBuffer(encrypted), true);
  assert.deepEqual(decrypted, { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: false });
});

test('safeStorage melakukan tepat satu dekripsi ulang saat rotasi diminta', async () => {
  const fake = createFakeSafeStorage({
    decryptResults: [
      { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: true },
      { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: false },
    ],
  });
  const adapter = createSafeStorageAdapter({ safeStorage: fake.api, isAppReady: () => true });
  const result = await adapter.decrypt(Buffer.from('synthetic-ciphertext'));
  assert.deepEqual(result, { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: true });
  assert.equal(fake.calls.decrypt, 2);
});

test('safeStorage menolak hasil dekripsi tidak konsisten dan menyamarkan error', async () => {
  const fake = createFakeSafeStorage({
    decryptResults: [
      { result: SYNTHETIC_OPENAI_CREDENTIAL, shouldReEncrypt: true },
      { result: 'synthetic-different-credential-000001', shouldReEncrypt: false },
    ],
  });
  const adapter = createSafeStorageAdapter({ safeStorage: fake.api, isAppReady: () => true });
  await assert.rejects(
    adapter.decrypt(Buffer.from('synthetic-ciphertext')),
    error => error.code === 'decryption_failed'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});

test('resolver credential hanya menerima lokasi userData absolut', () => {
  assert.throws(() => resolveCredentialPaths({ userDataPath: 'relative-path' }));
  const userDataPath = path.resolve('synthetic-user-data');
  const paths = resolveCredentialPaths({ userDataPath });
  assert.equal(paths.userDataPath, userDataPath);
  assert.equal(paths.filePath.startsWith(userDataPath), true);
});

test('runtime menolak inisialisasi sebelum Electron siap tanpa mengubah userData', () => {
  const fake = createFakeSafeStorage();
  let getPathCalls = 0;
  const app = {
    isReady: () => false,
    getPath: () => {
      getPathCalls += 1;
      return path.resolve('unused-user-data');
    },
  };
  assert.throws(() => createElectronCredentialRuntime({ app, safeStorage: fake.api }));
  assert.equal(getPathCalls, 0);
});
