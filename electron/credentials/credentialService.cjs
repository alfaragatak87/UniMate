const { timingSafeEqual } = require('node:crypto');

const {
  CREDENTIAL_ENVELOPE_VERSION,
  CREDENTIAL_PROVIDER_VALUES,
  CREDENTIAL_ROTATION_RETRY_LIMIT,
} = require('./constants.cjs');
const { createEmptyCredentialEnvelope } = require('./envelope.cjs');

const validationModule = import('../../shared/credentials/validation.mjs');
const contractModule = import('../../shared/credentials/contracts.mjs');

const ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Permintaan credential tidak valid.',
  storage_unavailable: 'Penyimpanan credential tidak tersedia.',
  storage_corrupt: 'Penyimpanan credential rusak dan tidak diubah.',
  encryption_mismatch: 'Format enkripsi credential tidak didukung.',
  encryption_failed: 'Credential tidak dapat dienkripsi.',
  decryption_failed: 'Credential tidak dapat didekripsi.',
  credential_missing: 'Credential belum dikonfigurasi.',
  operation_failed: 'Operasi backend credential gagal.',
  unsafe_result: 'Hasil operasi backend ditolak.',
  write_failed: 'Perubahan credential tidak dapat disimpan.',
  rotation_failed: 'Rotasi enkripsi credential gagal.',
});

class CredentialServiceError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Operasi credential gagal.');
    this.name = 'CredentialServiceError';
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buffersEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeDecryptionResult(value) {
  if (typeof value === 'string') {
    return Object.freeze({ result: value, shouldReEncrypt: false });
  }
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || typeof value.result !== 'string'
    || typeof value.shouldReEncrypt !== 'boolean'
  ) {
    throw new Error('invalid decryption result');
  }
  return Object.freeze({ result: value.result, shouldReEncrypt: value.shouldReEncrypt });
}

function inspectResult(value, secret, seen = new Set()) {
  if (typeof value === 'string') return { valid: true, containsSecret: value.includes(secret) };
  if (Buffer.isBuffer(value)) return { valid: true, containsSecret: value.includes(Buffer.from(secret, 'utf8')) };
  if (value === null || ['undefined', 'boolean', 'number'].includes(typeof value)) return { valid: true, containsSecret: false };
  if (typeof value !== 'object' || seen.has(value)) return { valid: false, containsSecret: false };
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return { valid: false, containsSecret: false };
  seen.add(value);
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const item of items) {
    const inspection = inspectResult(item, secret, seen);
    if (!inspection.valid || inspection.containsSecret) return inspection;
  }
  return { valid: true, containsSecret: false };
}

function assertAdapter(adapter) {
  if (
    adapter === null
    || typeof adapter !== 'object'
    || typeof adapter.id !== 'string'
    || typeof adapter.isAvailable !== 'function'
    || typeof adapter.encrypt !== 'function'
    || typeof adapter.decrypt !== 'function'
  ) {
    throw new TypeError('Adapter enkripsi credential tidak valid');
  }
}

function createCredentialService(options = {}) {
  const {
    fileStore,
    encryptionAdapter,
    now = () => new Date(),
  } = options;

  if (typeof fileStore?.read !== 'function' || typeof fileStore?.write !== 'function') {
    throw new TypeError('File store credential tidak valid');
  }
  assertAdapter(encryptionAdapter);
  if (typeof now !== 'function') throw new TypeError('Sumber waktu credential tidak valid');

  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function validateProvider(provider) {
    const { validateCredentialProvider } = await validationModule;
    if (!validateCredentialProvider(provider).valid) throw new CredentialServiceError('invalid_request');
  }

  async function assertAvailable() {
    if (await encryptionAdapter.isAvailable() !== true) throw new CredentialServiceError('storage_unavailable');
  }

  async function readEnvelope({ allowMissing = true } = {}) {
    let result;
    try {
      result = await fileStore.read();
    } catch {
      throw new CredentialServiceError('operation_failed');
    }
    if (result.status === 'corrupt') throw new CredentialServiceError('storage_corrupt');
    if (result.status === 'missing') {
      if (!allowMissing) throw new CredentialServiceError('credential_missing');
      return createEmptyCredentialEnvelope(encryptionAdapter.id);
    }
    if (result.status !== 'ready' || result.envelope.encryption !== encryptionAdapter.id) {
      throw new CredentialServiceError('encryption_mismatch');
    }
    return clone(result.envelope);
  }

  async function writeEnvelope(envelope) {
    try {
      await fileStore.write(envelope);
    } catch {
      throw new CredentialServiceError('write_failed');
    }
  }

  async function decryptCredential(ciphertext) {
    const decrypted = normalizeDecryptionResult(
      await encryptionAdapter.decrypt(Buffer.from(ciphertext, 'base64')),
    );
    const { validateCredentialValue } = await validationModule;
    if (!validateCredentialValue(decrypted.result).valid) throw new Error('invalid credential');
    return decrypted;
  }

  function rotateCredentialIfCurrent(provider, expectedCiphertext, credential) {
    return serializeMutation(async () => {
      await assertAvailable();
      const envelope = await readEnvelope({ allowMissing: false });
      const currentRecord = envelope.records[provider];
      if (currentRecord === undefined || currentRecord.ciphertext !== expectedCiphertext) {
        return Object.freeze({ rotated: false, stale: true });
      }

      let encrypted;
      try {
        encrypted = await encryptionAdapter.encrypt(credential);
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('invalid encrypted value');
        const verified = normalizeDecryptionResult(await encryptionAdapter.decrypt(encrypted));
        if (!buffersEqual(verified.result, credential)) throw new Error('verification failed');
      } catch {
        throw new CredentialServiceError('rotation_failed');
      }

      envelope.records[provider] = {
        ciphertext: encrypted.toString('base64'),
        updatedAt: currentRecord.updatedAt,
      };
      try {
        await writeEnvelope(envelope);
      } catch {
        throw new CredentialServiceError('rotation_failed');
      }
      return Object.freeze({ rotated: true, stale: false });
    });
  }

  return Object.freeze({
    async getStatus() {
      const { CREDENTIAL_CONTRACT_VERSION, CREDENTIAL_STATES, CREDENTIAL_STORAGE_STATES } = await contractModule;
      if (await encryptionAdapter.isAvailable() !== true) {
        return Object.freeze({
          schemaVersion: CREDENTIAL_CONTRACT_VERSION,
          storage: CREDENTIAL_STORAGE_STATES.UNAVAILABLE,
          providers: Object.freeze({ openai: CREDENTIAL_STATES.UNAVAILABLE, gemini: CREDENTIAL_STATES.UNAVAILABLE }),
        });
      }

      let stored;
      try {
        stored = await fileStore.read();
      } catch {
        stored = { status: 'corrupt', envelope: null };
      }
      if (stored.status === 'missing') {
        return Object.freeze({
          schemaVersion: CREDENTIAL_CONTRACT_VERSION,
          storage: CREDENTIAL_STORAGE_STATES.MISSING,
          providers: Object.freeze({ openai: CREDENTIAL_STATES.MISSING, gemini: CREDENTIAL_STATES.MISSING }),
        });
      }
      if (stored.status !== 'ready' || stored.envelope.encryption !== encryptionAdapter.id) {
        return Object.freeze({
          schemaVersion: CREDENTIAL_CONTRACT_VERSION,
          storage: CREDENTIAL_STORAGE_STATES.CORRUPT,
          providers: Object.freeze({ openai: CREDENTIAL_STATES.CORRUPT, gemini: CREDENTIAL_STATES.CORRUPT }),
        });
      }
      return Object.freeze({
        schemaVersion: CREDENTIAL_CONTRACT_VERSION,
        storage: CREDENTIAL_STORAGE_STATES.READY,
        providers: Object.freeze(Object.fromEntries(CREDENTIAL_PROVIDER_VALUES.map(provider => [
          provider,
          Object.hasOwn(stored.envelope.records, provider) ? CREDENTIAL_STATES.CONFIGURED : CREDENTIAL_STATES.MISSING,
        ]))),
      });
    },

    configure(request) {
      return serializeMutation(async () => {
        const { assertValidCredentialMutation } = await validationModule;
        try {
          assertValidCredentialMutation(request);
        } catch {
          throw new CredentialServiceError('invalid_request');
        }
        await assertAvailable();
        const envelope = await readEnvelope();
        const replaced = Object.hasOwn(envelope.records, request.provider);

        let encrypted;
        try {
          encrypted = await encryptionAdapter.encrypt(request.credential);
          if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('invalid encrypted value');
          const verified = normalizeDecryptionResult(await encryptionAdapter.decrypt(encrypted));
          if (!buffersEqual(verified.result, request.credential)) throw new Error('verification failed');
        } catch {
          throw new CredentialServiceError('encryption_failed');
        }

        envelope.records[request.provider] = {
          ciphertext: encrypted.toString('base64'),
          updatedAt: now().toISOString(),
        };
        await writeEnvelope(envelope);
        return Object.freeze({ provider: request.provider, configured: true, replaced });
      });
    },

    remove(request) {
      return serializeMutation(async () => {
        const { assertValidCredentialDelete } = await validationModule;
        try {
          assertValidCredentialDelete(request);
        } catch {
          throw new CredentialServiceError('invalid_request');
        }
        await assertAvailable();
        const envelope = await readEnvelope();
        const removed = Object.hasOwn(envelope.records, request.provider);
        if (removed) {
          delete envelope.records[request.provider];
          await writeEnvelope(envelope);
        }
        return Object.freeze({ provider: request.provider, configured: false, removed });
      });
    },

    async withCredential(provider, operation) {
      await validateProvider(provider);
      if (typeof operation !== 'function') throw new CredentialServiceError('invalid_request');
      await assertAvailable();
      let credential;
      let loaded = false;

      for (let attempt = 0; attempt <= CREDENTIAL_ROTATION_RETRY_LIMIT; attempt += 1) {
        const envelope = await readEnvelope({ allowMissing: false });
        const record = envelope.records[provider];
        if (record === undefined) throw new CredentialServiceError('credential_missing');

        let decrypted;
        try {
          decrypted = await decryptCredential(record.ciphertext);
        } catch {
          throw new CredentialServiceError('decryption_failed');
        }

        if (decrypted.shouldReEncrypt) {
          const rotation = await rotateCredentialIfCurrent(provider, record.ciphertext, decrypted.result);
          if (rotation.stale) continue;
        }
        credential = decrypted.result;
        loaded = true;
        break;
      }
      if (!loaded) throw new CredentialServiceError('operation_failed');

      let result;
      try {
        result = await operation(credential);
      } catch {
        throw new CredentialServiceError('operation_failed');
      }
      const inspection = inspectResult(result, credential);
      if (!inspection.valid || inspection.containsSecret) throw new CredentialServiceError('unsafe_result');
      return result;
    },

    getContractVersion() {
      return CREDENTIAL_ENVELOPE_VERSION;
    },
  });
}

module.exports = {
  CredentialServiceError,
  createCredentialService,
};
