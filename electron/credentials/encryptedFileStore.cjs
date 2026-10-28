const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  CredentialEnvelopeError,
  parseCredentialEnvelope,
  serializeCredentialEnvelope,
} = require('./envelope.cjs');

class CredentialFileStoreError extends Error {
  constructor(code) {
    super('Operasi file credential gagal.');
    this.name = 'CredentialFileStoreError';
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEncryptedCredentialFileStore(options = {}) {
  const {
    filePath,
    fsApi = fs,
    randomId = randomUUID,
  } = options;

  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('Lokasi file credential harus absolut');
  if (typeof randomId !== 'function') throw new TypeError('Generator ID file sementara tidak valid');

  return Object.freeze({
    async read() {
      let serialized;
      try {
        serialized = await fsApi.readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return Object.freeze({ status: 'missing', envelope: null });
        throw new CredentialFileStoreError('read_failed');
      }

      try {
        const envelope = parseCredentialEnvelope(serialized);
        return Object.freeze({ status: 'ready', envelope: clone(envelope) });
      } catch (error) {
        if (error instanceof CredentialEnvelopeError) return Object.freeze({ status: 'corrupt', envelope: null });
        throw new CredentialFileStoreError('read_failed');
      }
    },

    async write(envelope) {
      let serialized;
      try {
        serialized = serializeCredentialEnvelope(envelope);
      } catch {
        throw new CredentialFileStoreError('invalid_envelope');
      }

      const directory = path.dirname(filePath);
      const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomId()}.tmp`);
      let handle = null;

      try {
        await fsApi.mkdir(directory, { recursive: true });
        handle = await fsApi.open(temporaryPath, 'wx', 0o600);
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fsApi.rename(temporaryPath, filePath);
      } catch {
        if (handle !== null) {
          try {
            await handle.close();
          } catch {}
        }
        try {
          await fsApi.unlink(temporaryPath);
        } catch {}
        throw new CredentialFileStoreError('write_failed');
      }
    },
  });
}

module.exports = {
  CredentialFileStoreError,
  createEncryptedCredentialFileStore,
};
