const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class AIQuotaFileStoreError extends Error {
  constructor(code) {
    super('Penyimpanan kuota AI tidak tersedia.');
    this.name = 'AIQuotaFileStoreError';
    this.code = code;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAIQuotaFileStore(options = {}) {
  const { filePath, fsApi = fs, randomId = randomUUID } = options;
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError('Lokasi file kuota AI harus absolut');
  }
  if (typeof randomId !== 'function') throw new TypeError('Generator file sementara kuota tidak valid');

  return Object.freeze({
    async read() {
      let serialized;
      try {
        serialized = await fsApi.readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return Object.freeze({ status: 'missing', state: null });
        throw new AIQuotaFileStoreError('read_failed');
      }
      try {
        const state = JSON.parse(serialized);
        if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid');
        return Object.freeze({ status: 'ready', state: clone(state) });
      } catch {
        return Object.freeze({ status: 'corrupt', state: null });
      }
    },

    async write(state) {
      let serialized;
      try {
        serialized = JSON.stringify(state);
      } catch {
        throw new AIQuotaFileStoreError('write_failed');
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
          try { await handle.close(); } catch {}
        }
        try { await fsApi.unlink(temporaryPath); } catch {}
        throw new AIQuotaFileStoreError('write_failed');
      }
    },
  });
}

module.exports = { AIQuotaFileStoreError, createAIQuotaFileStore };
