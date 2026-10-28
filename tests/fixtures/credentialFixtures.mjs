import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import constants from '../../electron/credentials/constants.cjs';
import fileStoreModule from '../../electron/credentials/encryptedFileStore.cjs';
import credentialServiceModule from '../../electron/credentials/credentialService.cjs';
import { CREDENTIAL_CONTRACT_VERSION, CREDENTIAL_PROVIDERS } from '../../shared/credentials/contracts.mjs';

const { CREDENTIAL_ENCRYPTION_IDS, CREDENTIAL_FILE_NAME } = constants;
const { createEncryptedCredentialFileStore } = fileStoreModule;
const { createCredentialService } = credentialServiceModule;

export const SYNTHETIC_OPENAI_CREDENTIAL = 'synthetic-openai-m3a-credential-00000001';
export const SYNTHETIC_OPENAI_REPLACEMENT = 'synthetic-openai-m3a-credential-00000002';
export const SYNTHETIC_GEMINI_CREDENTIAL = 'synthetic-gemini-m3a-credential-00000001';

export const SYNTHETIC_OPENAI_MUTATION = Object.freeze({
  schemaVersion: CREDENTIAL_CONTRACT_VERSION,
  provider: CREDENTIAL_PROVIDERS.OPENAI,
  credential: SYNTHETIC_OPENAI_CREDENTIAL,
});

export const SYNTHETIC_GEMINI_MUTATION = Object.freeze({
  schemaVersion: CREDENTIAL_CONTRACT_VERSION,
  provider: CREDENTIAL_PROVIDERS.GEMINI,
  credential: SYNTHETIC_GEMINI_CREDENTIAL,
});

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMockEncryptionAdapter(options = {}) {
  const key = createHash('sha256').update(options.seed ?? 'unimate-m3a-synthetic-encryption-seed').digest();
  let available = options.available !== false;

  return Object.freeze({
    id: CREDENTIAL_ENCRYPTION_IDS.MOCK,

    async isAvailable() {
      return available;
    },

    async encrypt(plainText) {
      if (!available) throw new Error('mock unavailable');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
    },

    async decrypt(encrypted) {
      if (!available) throw new Error('mock unavailable');
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 30 || encrypted[0] !== 1) throw new Error('mock ciphertext invalid');
      const iv = encrypted.subarray(1, 13);
      const tag = encrypted.subarray(13, 29);
      const payload = encrypted.subarray(29);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    },

    setAvailable(value) {
      available = value === true;
    },
  });
}

export async function createCredentialHarness(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-m3a-'));
  const filePath = path.join(directory, CREDENTIAL_FILE_NAME);
  const adapter = options.adapter ?? createMockEncryptionAdapter(options.adapterOptions);
  const fileStore = options.fileStore ?? createEncryptedCredentialFileStore({ filePath });
  const service = createCredentialService({
    fileStore,
    encryptionAdapter: adapter,
    now: options.now ?? (() => new Date('2026-10-18T10:00:00.000Z')),
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return Object.freeze({ directory, filePath, adapter, fileStore, service });
}

export function createServiceForPath(filePath, options = {}) {
  const adapter = options.adapter ?? createMockEncryptionAdapter(options.adapterOptions);
  const fileStore = options.fileStore ?? createEncryptedCredentialFileStore({
    filePath,
    fsApi: options.fsApi,
    randomId: options.randomId,
  });
  const service = createCredentialService({
    fileStore,
    encryptionAdapter: adapter,
    now: options.now ?? (() => new Date('2026-10-18T10:00:00.000Z')),
  });
  return Object.freeze({ adapter, fileStore, service });
}
