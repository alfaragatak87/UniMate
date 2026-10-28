import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import credentialServiceModule from '../electron/credentials/credentialService.cjs';
import {
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_MUTATION,
  SYNTHETIC_OPENAI_REPLACEMENT,
  clone,
  createCredentialHarness,
  createMockEncryptionAdapter,
  createServiceForPath,
} from './fixtures/credentialFixtures.mjs';

const { CredentialServiceError } = credentialServiceModule;

function createRotatingAdapter() {
  const base = createMockEncryptionAdapter();
  let rotationCredential = null;
  let decryptions = 0;
  return {
    adapter: Object.freeze({
      id: base.id,
      isAvailable: () => base.isAvailable(),
      encrypt: value => base.encrypt(value),
      async decrypt(value) {
        decryptions += 1;
        const result = await base.decrypt(value);
        const shouldReEncrypt = rotationCredential === result;
        if (shouldReEncrypt) rotationCredential = null;
        return Object.freeze({ result, shouldReEncrypt });
      },
    }),
    arm(credential) {
      rotationCredential = credential;
    },
    getDecryptions() {
      return decryptions;
    },
  };
}

function createConflictAdapter() {
  const base = createMockEncryptionAdapter();
  let armed = false;
  let releaseBlocked;
  let signalBlocked;
  const blocked = new Promise(resolve => {
    signalBlocked = resolve;
  });
  const released = new Promise(resolve => {
    releaseBlocked = resolve;
  });

  return {
    adapter: Object.freeze({
      id: base.id,
      isAvailable: () => base.isAvailable(),
      encrypt: value => base.encrypt(value),
      async decrypt(value) {
        const result = await base.decrypt(value);
        if (armed && result === SYNTHETIC_OPENAI_CREDENTIAL) {
          armed = false;
          signalBlocked();
          await released;
          return Object.freeze({ result, shouldReEncrypt: true });
        }
        return Object.freeze({ result, shouldReEncrypt: false });
      },
    }),
    arm() {
      armed = true;
    },
    waitUntilBlocked() {
      return blocked;
    },
    release() {
      releaseBlocked();
    },
  };
}

test('rotasi mengganti ciphertext secara atomik dan mempertahankan waktu konfigurasi', async t => {
  const rotating = createRotatingAdapter();
  const harness = await createCredentialHarness(t, { adapter: rotating.adapter });
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const before = JSON.parse(await fs.readFile(harness.filePath, 'utf8'));
  const decryptionsBefore = rotating.getDecryptions();

  rotating.arm(SYNTHETIC_OPENAI_CREDENTIAL);
  const result = await harness.service.withCredential('openai', credential => ({
    matches: credential === SYNTHETIC_OPENAI_CREDENTIAL,
  }));
  const after = JSON.parse(await fs.readFile(harness.filePath, 'utf8'));

  assert.equal(result.matches, true);
  assert.notEqual(after.records.openai.ciphertext, before.records.openai.ciphertext);
  assert.equal(after.records.openai.updatedAt, before.records.openai.updatedAt);
  assert.equal(rotating.getDecryptions() > decryptionsBefore, true);
});

test('pergantian credential menang atas rotasi yang sedang menunggu', async t => {
  const conflict = createConflictAdapter();
  const harness = await createCredentialHarness(t, { adapter: conflict.adapter });
  await harness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  conflict.arm();

  const usePromise = harness.service.withCredential('openai', credential => ({
    usesReplacement: credential === SYNTHETIC_OPENAI_REPLACEMENT,
  }));
  await conflict.waitUntilBlocked();

  const replacement = clone(SYNTHETIC_OPENAI_MUTATION);
  replacement.credential = SYNTHETIC_OPENAI_REPLACEMENT;
  await harness.service.configure(replacement);
  conflict.release();

  const used = await usePromise;
  const verified = await harness.service.withCredential('openai', credential => ({
    matches: credential === SYNTHETIC_OPENAI_REPLACEMENT,
  }));
  assert.equal(used.usesReplacement, true);
  assert.equal(verified.matches, true);
});

test('kegagalan penyimpanan rotasi mempertahankan ciphertext lama dan membatalkan callback', async t => {
  const rotating = createRotatingAdapter();
  const initial = await createCredentialHarness(t, { adapter: rotating.adapter });
  await initial.service.configure(SYNTHETIC_OPENAI_MUTATION);
  const before = await fs.readFile(initial.filePath, 'utf8');
  let failWrite = true;
  let operationCalled = false;
  const failingStore = {
    read: () => initial.fileStore.read(),
    async write(envelope) {
      if (failWrite) throw new Error('synthetic write failure');
      return initial.fileStore.write(envelope);
    },
  };
  const service = createServiceForPath(initial.filePath, {
    adapter: rotating.adapter,
    fileStore: failingStore,
  }).service;

  rotating.arm(SYNTHETIC_OPENAI_CREDENTIAL);
  await assert.rejects(
    service.withCredential('openai', () => {
      operationCalled = true;
      return { ok: true };
    }),
    error => error instanceof CredentialServiceError
      && error.code === 'rotation_failed'
      && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
  const after = await fs.readFile(initial.filePath, 'utf8');
  assert.equal(after, before);
  assert.equal(operationCalled, false);
  failWrite = false;
});
