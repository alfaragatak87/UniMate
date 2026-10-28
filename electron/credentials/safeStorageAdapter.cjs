const {
  CREDENTIAL_ENCRYPTION_IDS,
  SAFE_STORAGE_REDECRYPT_LIMIT,
} = require('./constants.cjs');

const ERROR_MESSAGES = Object.freeze({
  invalid_adapter: 'Adapter safeStorage tidak valid.',
  invalid_input: 'Input enkripsi credential tidak valid.',
  unavailable: 'Enkripsi credential tidak tersedia.',
  encryption_failed: 'Credential tidak dapat dienkripsi.',
  decryption_failed: 'Credential tidak dapat didekripsi.',
});

class SafeStorageAdapterError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Operasi safeStorage gagal.');
    this.name = 'SafeStorageAdapterError';
    this.code = code;
  }
}

function validateSafeStorage(safeStorage) {
  return safeStorage !== null
    && typeof safeStorage === 'object'
    && typeof safeStorage.isAsyncEncryptionAvailable === 'function'
    && typeof safeStorage.encryptStringAsync === 'function'
    && typeof safeStorage.decryptStringAsync === 'function';
}

function normalizeDecryptResult(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || typeof value.result !== 'string'
    || typeof value.shouldReEncrypt !== 'boolean'
  ) {
    throw new SafeStorageAdapterError('decryption_failed');
  }
  return Object.freeze({ result: value.result, shouldReEncrypt: value.shouldReEncrypt });
}

function createSafeStorageAdapter(options = {}) {
  const {
    safeStorage,
    isAppReady,
  } = options;

  if (!validateSafeStorage(safeStorage) || typeof isAppReady !== 'function') {
    throw new SafeStorageAdapterError('invalid_adapter');
  }

  async function isAvailable() {
    if (isAppReady() !== true) return false;
    try {
      return await safeStorage.isAsyncEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  async function assertAvailable() {
    if (await isAvailable() !== true) throw new SafeStorageAdapterError('unavailable');
  }

  return Object.freeze({
    id: CREDENTIAL_ENCRYPTION_IDS.SAFE_STORAGE,

    isAvailable,

    async encrypt(plainText) {
      if (typeof plainText !== 'string') throw new SafeStorageAdapterError('invalid_input');
      await assertAvailable();
      try {
        const encrypted = await safeStorage.encryptStringAsync(plainText);
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('invalid ciphertext');
        return Buffer.from(encrypted);
      } catch (error) {
        if (error instanceof SafeStorageAdapterError) throw error;
        throw new SafeStorageAdapterError('encryption_failed');
      }
    },

    async decrypt(encrypted) {
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) {
        throw new SafeStorageAdapterError('invalid_input');
      }
      await assertAvailable();

      try {
        const initial = normalizeDecryptResult(await safeStorage.decryptStringAsync(Buffer.from(encrypted)));
        if (!initial.shouldReEncrypt) return initial;

        let current = initial;
        for (let attempt = 0; attempt < SAFE_STORAGE_REDECRYPT_LIMIT; attempt += 1) {
          current = normalizeDecryptResult(await safeStorage.decryptStringAsync(Buffer.from(encrypted)));
        }
        if (current.result !== initial.result) throw new Error('inconsistent plaintext');
        return Object.freeze({ result: current.result, shouldReEncrypt: true });
      } catch (error) {
        if (error instanceof SafeStorageAdapterError) throw error;
        throw new SafeStorageAdapterError('decryption_failed');
      }
    },
  });
}

module.exports = {
  SafeStorageAdapterError,
  createSafeStorageAdapter,
};
