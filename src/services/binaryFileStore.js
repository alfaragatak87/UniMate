export const BINARY_FILE_REFERENCE_KIND = 'unimate-binary-file';
export const BINARY_FILE_REFERENCE_VERSION = 1;
export const BINARY_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const DOCUMENT_TEXT_REFERENCE_KIND = 'unimate-document-text';
export const DOCUMENT_TEXT_REFERENCE_VERSION = 1;

export const DATABASE_NAME = 'unimate-binary-vault';
export const DATABASE_VERSION = 2;
export const OBJECT_STORE_NAME = 'files';
export const DOCUMENT_TEXT_STORE_NAME = 'document_texts';

const ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/u;

const EXTENSION_MIME_TYPES = Object.freeze({
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  bmp: ['image/bmp'],
  txt: ['text/plain'],
  csv: ['text/csv', 'application/csv', 'text/plain'],
  json: ['application/json', 'text/json', 'text/plain'],
  md: ['text/markdown', 'text/plain'],
  js: ['text/javascript', 'application/javascript', 'text/plain'],
  jsx: ['text/jsx', 'text/plain'],
  css: ['text/css', 'text/plain'],
  html: ['text/html', 'text/plain'],
  py: ['text/x-python', 'text/plain'],
  java: ['text/x-java-source', 'text/plain'],
  cpp: ['text/x-c++src', 'text/plain'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
});

export const BINARY_FILE_ACCEPT = Object.freeze(Object.keys(EXTENSION_MIME_TYPES).map(extension => `.${extension}`));

export class BinaryFileStoreError extends Error {
  constructor(code) {
    super('Berkas lokal tidak dapat diproses.');
    this.name = 'BinaryFileStoreError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getExtension(name) {
  const separator = name.lastIndexOf('.');
  return separator > 0 ? name.slice(separator + 1).toLowerCase() : '';
}

function validateFile(file) {
  if (!file || typeof file !== 'object') throw new BinaryFileStoreError('invalid_file');
  if (typeof file.name !== 'string' || file.name.length < 1 || file.name.length > 255) {
    throw new BinaryFileStoreError('invalid_name');
  }
  if ([...file.name].some(character => character === '/' || character === '\\' || character.codePointAt(0) < 32)) {
    throw new BinaryFileStoreError('invalid_name');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) throw new BinaryFileStoreError('empty_file');
  if (file.size > BINARY_FILE_MAX_BYTES) throw new BinaryFileStoreError('file_too_large');
  if (typeof file.arrayBuffer !== 'function') throw new BinaryFileStoreError('invalid_file');

  const extension = getExtension(file.name);
  const allowedMimes = EXTENSION_MIME_TYPES[extension];
  if (!allowedMimes) throw new BinaryFileStoreError('unsupported_type');
  const suppliedMime = typeof file.type === 'string' ? file.type.toLowerCase().trim() : '';
  const mimeType = suppliedMime && suppliedMime !== 'application/octet-stream'
    ? suppliedMime
    : allowedMimes[0];
  if (!allowedMimes.includes(mimeType)) throw new BinaryFileStoreError('mime_mismatch');

  return Object.freeze({
    name: file.name,
    mimeType,
    size: file.size,
    lastModified: Number.isSafeInteger(file.lastModified) && file.lastModified >= 0 ? file.lastModified : 0,
  });
}

function validateReference(reference) {
  if (!isPlainObject(reference)) return false;
  const expectedKeys = ['kind', 'version', 'id', 'name', 'mimeType', 'size', 'lastModified'];
  const keys = Object.keys(reference);
  if (keys.length !== expectedKeys.length || !keys.every(key => expectedKeys.includes(key))) return false;
  if (reference.kind !== BINARY_FILE_REFERENCE_KIND || reference.version !== BINARY_FILE_REFERENCE_VERSION) return false;
  if (typeof reference.id !== 'string' || !ID_PATTERN.test(reference.id)) return false;
  if (typeof reference.name !== 'string' || reference.name.length < 1 || reference.name.length > 255) return false;
  if (typeof reference.mimeType !== 'string' || reference.mimeType.length < 1 || reference.mimeType.length > 160) return false;
  if (!Number.isSafeInteger(reference.size) || reference.size < 1 || reference.size > BINARY_FILE_MAX_BYTES) return false;
  return Number.isSafeInteger(reference.lastModified) && reference.lastModified >= 0;
}

function validateTextReference(reference) {
  if (!isPlainObject(reference)) return false;
  const expectedKeys = ['kind', 'version', 'id', 'binaryId', 'charCount', 'hasEditedText', 'updatedAt'];
  const keys = Object.keys(reference);
  if (keys.length !== expectedKeys.length || !keys.every(key => expectedKeys.includes(key))) return false;
  if (reference.kind !== DOCUMENT_TEXT_REFERENCE_KIND || reference.version !== DOCUMENT_TEXT_REFERENCE_VERSION) return false;
  if (typeof reference.id !== 'string' || !ID_PATTERN.test(reference.id)) return false;
  if (typeof reference.binaryId !== 'string' || !ID_PATTERN.test(reference.binaryId)) return false;
  if (!Number.isSafeInteger(reference.charCount) || reference.charCount < 0) return false;
  if (typeof reference.hasEditedText !== 'boolean') return false;
  return Number.isSafeInteger(reference.updatedAt) && reference.updatedAt >= 0;
}

function createId(cryptoImpl) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  if (typeof cryptoImpl?.getRandomValues !== 'function') throw new BinaryFileStoreError('random_unavailable');
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(18));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function openDatabase(indexedDBFactory) {
  return new Promise((resolve, reject) => {
    if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') {
      reject(new BinaryFileStoreError('storage_unavailable'));
      return;
    }
    const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        db.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DOCUMENT_TEXT_STORE_NAME)) {
        const textStore = db.createObjectStore(DOCUMENT_TEXT_STORE_NAME, { keyPath: 'id' });
        textStore.createIndex('by_binary_id', 'binaryId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        try { db.close(); } catch {}
      };
      resolve(db);
    };
    request.onerror = () => {
      const error = request.error;
      if (error?.name === 'VersionError') {
        reject(new BinaryFileStoreError('database_version_mismatch'));
        return;
      }
      if (error?.name === 'QuotaExceededError') {
        reject(new BinaryFileStoreError('quota_exceeded'));
        return;
      }
      reject(new BinaryFileStoreError('storage_unavailable'));
    };
    request.onblocked = () => reject(new BinaryFileStoreError('storage_blocked'));
  });
}

export function createIndexedDBBinaryAdapter(indexedDBFactory = globalThis.indexedDB) {
  let databasePromise;
  const getDatabase = () => {
    databasePromise ??= openDatabase(indexedDBFactory);
    return databasePromise;
  };
  return Object.freeze({
    async putMany(records) {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(OBJECT_STORE_NAME);
        for (const record of records) store.add(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
        transaction.onabort = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
      });
    },
    async get(id) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(new BinaryFileStoreError('read_failed'));
        transaction.onabort = () => reject(new BinaryFileStoreError('read_failed'));
      });
    },
    async remove(id) {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
        transaction.objectStore(OBJECT_STORE_NAME).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new BinaryFileStoreError('delete_failed'));
        transaction.onabort = () => reject(new BinaryFileStoreError('delete_failed'));
      });
    },
    async putText(record) {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_TEXT_STORE_NAME, 'readwrite');
        transaction.objectStore(DOCUMENT_TEXT_STORE_NAME).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
        transaction.onabort = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
      });
    },
    async getText(id) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_TEXT_STORE_NAME, 'readonly');
        const request = transaction.objectStore(DOCUMENT_TEXT_STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(new BinaryFileStoreError('read_failed'));
        transaction.onabort = () => reject(new BinaryFileStoreError('read_failed'));
      });
    },
    async getTextByBinaryId(binaryId) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_TEXT_STORE_NAME, 'readonly');
        const store = transaction.objectStore(DOCUMENT_TEXT_STORE_NAME);
        if (store.indexNames?.contains('by_binary_id')) {
          const index = store.index('by_binary_id');
          const request = index.getAll(binaryId);
          request.onsuccess = () => resolve(request.result ?? []);
          request.onerror = () => reject(new BinaryFileStoreError('read_failed'));
        } else {
          const request = store.openCursor();
          const results = [];
          request.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
              if (cursor.value.binaryId === binaryId) results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          request.onerror = () => reject(new BinaryFileStoreError('read_failed'));
        }
      });
    },
    async removeText(id) {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(DOCUMENT_TEXT_STORE_NAME, 'readwrite');
        transaction.objectStore(DOCUMENT_TEXT_STORE_NAME).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new BinaryFileStoreError('delete_failed'));
        transaction.onabort = () => reject(new BinaryFileStoreError('delete_failed'));
      });
    },
    async putFileAndText({ fileRecord, textRecord }) {
      const database = await getDatabase();
      await new Promise((resolve, reject) => {
        const storeNames = textRecord
          ? [OBJECT_STORE_NAME, DOCUMENT_TEXT_STORE_NAME]
          : [OBJECT_STORE_NAME];
        const transaction = database.transaction(storeNames, 'readwrite');
        transaction.objectStore(OBJECT_STORE_NAME).add(fileRecord);
        if (textRecord) {
          transaction.objectStore(DOCUMENT_TEXT_STORE_NAME).add(textRecord);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
        transaction.onabort = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
      });
    },
    async restoreEntries({ fileRecords = [], textRecords = [] }) {
      const database = await getDatabase();
      const storeNames = [];
      if (fileRecords.length > 0) storeNames.push(OBJECT_STORE_NAME);
      if (textRecords.length > 0) storeNames.push(DOCUMENT_TEXT_STORE_NAME);
      if (storeNames.length === 0) {
        return { filesWritten: 0, filesSkipped: 0, textsWritten: 0, textsSkipped: 0 };
      }
      return new Promise((resolve, reject) => {
        let transaction;
        try {
          transaction = database.transaction(storeNames, 'readwrite');
        } catch (err) {
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'storage_unavailable'));
          return;
        }

        let filesWritten = 0;
        let filesSkipped = 0;
        let textsWritten = 0;
        let textsSkipped = 0;
        let hasConflict = false;

        transaction.onerror = event => {
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
        transaction.onabort = event => {
          if (hasConflict) {
            reject(new BinaryFileStoreError('conflict_detected'));
            return;
          }
          const err = transaction.error || event?.target?.error;
          reject(new BinaryFileStoreError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed'));
        };
        transaction.oncomplete = () => {
          resolve({ filesWritten, filesSkipped, textsWritten, textsSkipped });
        };

        if (fileRecords.length > 0) {
          const fileStore = transaction.objectStore(OBJECT_STORE_NAME);
          for (const rec of fileRecords) {
            const req = fileStore.get(rec.id);
            req.onsuccess = () => {
              if (hasConflict) return;
              const existing = req.result;
              if (existing) {
                if (existing.size === rec.size && existing.name === rec.name && existing.mimeType === rec.mimeType) {
                  filesSkipped += 1;
                } else {
                  hasConflict = true;
                  transaction.abort();
                }
              } else {
                fileStore.add(rec);
                filesWritten += 1;
              }
            };
            req.onerror = () => {
              transaction.abort();
            };
          }
        }

        if (textRecords.length > 0) {
          const textStore = transaction.objectStore(DOCUMENT_TEXT_STORE_NAME);
          for (const rec of textRecords) {
            const req = textStore.get(rec.id);
            req.onsuccess = () => {
              if (hasConflict) return;
              const existing = req.result;
              if (existing) {
                if (existing.binaryId === rec.binaryId && existing.rawText === rec.rawText && existing.editedText === rec.editedText) {
                  textsSkipped += 1;
                } else {
                  hasConflict = true;
                  transaction.abort();
                }
              } else {
                textStore.add(rec);
                textsWritten += 1;
              }
            };
            req.onerror = () => {
              transaction.abort();
            };
          }
        }
      });
    },
    async close() {
      if (databasePromise) {
        try {
          const db = await databasePromise;
          db.close();
        } catch {}
        databasePromise = null;
      }
    },
  });
}

export function createMemoryBinaryAdapter() {
  const records = new Map();
  const textRecords = new Map();
  return Object.freeze({
    async putMany(nextRecords) {
      const pending = new Map(records);
      for (const record of nextRecords) {
        if (pending.has(record.id)) throw new BinaryFileStoreError('write_failed');
        pending.set(record.id, record);
      }
      records.clear();
      for (const [id, record] of pending) records.set(id, record);
    },
    async get(id) {
      return records.get(id) ?? null;
    },
    async remove(id) {
      records.delete(id);
    },
    async putText(record) {
      textRecords.set(record.id, record);
    },
    async getText(id) {
      return textRecords.get(id) ?? null;
    },
    async getTextByBinaryId(binaryId) {
      return [...textRecords.values()].filter(record => record.binaryId === binaryId);
    },
    async removeText(id) {
      textRecords.delete(id);
    },
    async putFileAndText({ fileRecord, textRecord }) {
      if (records.has(fileRecord.id)) throw new BinaryFileStoreError('write_failed');
      if (textRecord && textRecords.has(textRecord.id)) throw new BinaryFileStoreError('write_failed');
      records.set(fileRecord.id, fileRecord);
      if (textRecord) textRecords.set(textRecord.id, textRecord);
    },
    async restoreEntries({ fileRecords: incomingFiles = [], textRecords: incomingTexts = [] }) {
      for (const rec of incomingFiles) {
        if (records.has(rec.id)) {
          const existing = records.get(rec.id);
          if (existing.size !== rec.size || existing.name !== rec.name || existing.mimeType !== rec.mimeType) {
            throw new BinaryFileStoreError('conflict_detected');
          }
        }
      }
      for (const rec of incomingTexts) {
        if (textRecords.has(rec.id)) {
          const existing = textRecords.get(rec.id);
          if (existing.binaryId !== rec.binaryId || existing.rawText !== rec.rawText || existing.editedText !== rec.editedText) {
            throw new BinaryFileStoreError('conflict_detected');
          }
        }
      }

      let filesWritten = 0;
      let filesSkipped = 0;
      let textsWritten = 0;
      let textsSkipped = 0;

      for (const rec of incomingFiles) {
        if (records.has(rec.id)) {
          filesSkipped += 1;
        } else {
          records.set(rec.id, rec);
          filesWritten += 1;
        }
      }

      for (const rec of incomingTexts) {
        if (textRecords.has(rec.id)) {
          textsSkipped += 1;
        } else {
          textRecords.set(rec.id, rec);
          textsWritten += 1;
        }
      }

      return { filesWritten, filesSkipped, textsWritten, textsSkipped };
    },
    async close() {},
  });
}

export function createBinaryFileStore({
  adapter = createIndexedDBBinaryAdapter(),
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  if (typeof adapter?.putMany !== 'function' || typeof adapter?.get !== 'function') {
    throw new TypeError('Adapter penyimpanan biner tidak valid');
  }
  return Object.freeze({
    async put(file) {
      const [reference] = await this.putMany([file]);
      return reference;
    },
    async putMany(files) {
      if (!Array.isArray(files) || files.length < 1 || files.length > 250) {
        throw new BinaryFileStoreError('invalid_batch');
      }
      const createdAt = now();
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new BinaryFileStoreError('invalid_time');
      const records = files.map(file => {
        const metadata = validateFile(file);
        return {
          id: createId(cryptoImpl),
          ...metadata,
          createdAt,
          blob: file,
        };
      });
      await adapter.putMany(records);
      return Object.freeze(records.map(record => Object.freeze({
        kind: BINARY_FILE_REFERENCE_KIND,
        version: BINARY_FILE_REFERENCE_VERSION,
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
        lastModified: record.lastModified,
      })));
    },
    async get(reference) {
      if (!validateReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      const record = await adapter.get(reference.id);
      if (!record) throw new BinaryFileStoreError('file_not_found');
      if (
        record.name !== reference.name
        || record.mimeType !== reference.mimeType
        || record.size !== reference.size
        || record.lastModified !== reference.lastModified
        || typeof record.blob?.arrayBuffer !== 'function'
      ) throw new BinaryFileStoreError('corrupt_record');
      return record.blob;
    },
    async remove(reference) {
      if (!validateReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.remove !== 'function') throw new BinaryFileStoreError('delete_unavailable');
      try {
        await adapter.remove(reference.id);
      } catch (error) {
        if (error instanceof BinaryFileStoreError) throw error;
        throw new BinaryFileStoreError('delete_failed');
      }
    },
    async putText(payload) {
      if (!payload || typeof payload !== 'object') throw new BinaryFileStoreError('invalid_text_payload');
      if (!validateReference(payload.binaryRef)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof payload.rawText !== 'string' || payload.rawText.length > 10_000_000) {
        throw new BinaryFileStoreError('invalid_text_payload');
      }
      const createdAt = now();
      const textId = createId(cryptoImpl);
      const record = {
        id: textId,
        binaryId: payload.binaryRef.id,
        documentType: typeof payload.documentType === 'string' && payload.documentType.trim() ? payload.documentType.trim().slice(0, 160) : 'Dokumen',
        rawText: payload.rawText,
        editedText: typeof payload.editedText === 'string' ? payload.editedText : null,
        charCount: payload.rawText.length,
        pageCount: Number.isSafeInteger(payload.pageCount) && payload.pageCount >= 1 ? payload.pageCount : null,
        confidence: typeof payload.confidence === 'number' && Number.isFinite(payload.confidence) ? payload.confidence : null,
        createdAt,
        updatedAt: createdAt,
      };
      if (typeof adapter.putText !== 'function') throw new BinaryFileStoreError('storage_unavailable');
      await adapter.putText(record);
      return Object.freeze({
        kind: DOCUMENT_TEXT_REFERENCE_KIND,
        version: DOCUMENT_TEXT_REFERENCE_VERSION,
        id: textId,
        binaryId: payload.binaryRef.id,
        charCount: record.charCount,
        hasEditedText: record.editedText !== null,
        updatedAt: record.updatedAt,
      });
    },
    async putFileWithText(file, textPayload) {
      const fileMetadata = validateFile(file);
      const createdAt = now();
      const fileId = createId(cryptoImpl);
      const fileRecord = {
        id: fileId,
        ...fileMetadata,
        createdAt,
        blob: file,
      };
      const binaryRef = Object.freeze({
        kind: BINARY_FILE_REFERENCE_KIND,
        version: BINARY_FILE_REFERENCE_VERSION,
        id: fileId,
        name: fileRecord.name,
        mimeType: fileRecord.mimeType,
        size: fileRecord.size,
        lastModified: fileRecord.lastModified,
      });

      let textRecord = null;
      let textRef = null;
      if (textPayload && typeof textPayload.rawText === 'string') {
        const textId = createId(cryptoImpl);
        textRecord = {
          id: textId,
          binaryId: fileId,
          documentType: typeof textPayload.documentType === 'string' && textPayload.documentType.trim() ? textPayload.documentType.trim().slice(0, 160) : 'Dokumen',
          rawText: textPayload.rawText,
          editedText: typeof textPayload.editedText === 'string' ? textPayload.editedText : null,
          charCount: textPayload.rawText.length,
          pageCount: Number.isSafeInteger(textPayload.pageCount) && textPayload.pageCount >= 1 ? textPayload.pageCount : null,
          confidence: typeof textPayload.confidence === 'number' && Number.isFinite(textPayload.confidence) ? textPayload.confidence : null,
          createdAt,
          updatedAt: createdAt,
        };
        textRef = Object.freeze({
          kind: DOCUMENT_TEXT_REFERENCE_KIND,
          version: DOCUMENT_TEXT_REFERENCE_VERSION,
          id: textId,
          binaryId: fileId,
          charCount: textRecord.charCount,
          hasEditedText: textRecord.editedText !== null,
          updatedAt: textRecord.updatedAt,
        });
      }

      if (typeof adapter.putFileAndText === 'function') {
        await adapter.putFileAndText({ fileRecord, textRecord });
      } else {
        await adapter.putMany([fileRecord]);
        if (textRecord && typeof adapter.putText === 'function') {
          try {
            await adapter.putText(textRecord);
          } catch (err) {
            try { await adapter.remove(fileId); } catch {}
            throw err;
          }
        }
      }

      return Object.freeze({
        binaryRef,
        textRef,
      });
    },
    async getText(reference) {
      if (!validateTextReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.getText !== 'function') throw new BinaryFileStoreError('storage_unavailable');
      const record = await adapter.getText(reference.id);
      if (!record) throw new BinaryFileStoreError('file_not_found');
      if (
        record.binaryId !== reference.binaryId
        || record.charCount !== reference.charCount
        || typeof record.rawText !== 'string'
      ) throw new BinaryFileStoreError('corrupt_record');
      return Object.freeze({ ...record });
    },
    async getTextByBinaryId(binaryId) {
      if (typeof binaryId !== 'string' || !ID_PATTERN.test(binaryId)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.getTextByBinaryId !== 'function') return [];
      const records = await adapter.getTextByBinaryId(binaryId);
      return records.map(record => Object.freeze({ ...record }));
    },
    async removeText(reference) {
      if (!validateTextReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.removeText !== 'function') throw new BinaryFileStoreError('delete_unavailable');
      try {
        await adapter.removeText(reference.id);
      } catch (error) {
        if (error instanceof BinaryFileStoreError) throw error;
        throw new BinaryFileStoreError('delete_failed');
      }
    },
    async updateEditedText(reference, editedText) {
      if (!validateTextReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.getText !== 'function' || typeof adapter.putText !== 'function') {
        throw new BinaryFileStoreError('storage_unavailable');
      }
      const existing = await adapter.getText(reference.id);
      if (!existing) throw new BinaryFileStoreError('file_not_found');
      if (existing.binaryId !== reference.binaryId) throw new BinaryFileStoreError('corrupt_record');
      if (editedText !== null && typeof editedText !== 'string') {
        throw new BinaryFileStoreError('invalid_text_payload');
      }

      const updatedRecord = {
        ...existing,
        editedText: editedText === null ? null : String(editedText),
        updatedAt: now(),
      };

      try {
        await adapter.putText(updatedRecord);
      } catch (error) {
        if (error instanceof BinaryFileStoreError) throw error;
        if (error?.name === 'QuotaExceededError') throw new BinaryFileStoreError('quota_exceeded');
        throw new BinaryFileStoreError('write_failed');
      }

      return Object.freeze({
        kind: DOCUMENT_TEXT_REFERENCE_KIND,
        version: DOCUMENT_TEXT_REFERENCE_VERSION,
        id: updatedRecord.id,
        binaryId: updatedRecord.binaryId,
        charCount: updatedRecord.charCount,
        hasEditedText: updatedRecord.editedText !== null,
        updatedAt: updatedRecord.updatedAt,
      });
    },
    async forkEditedText(reference, editedText) {
      if (!validateTextReference(reference)) throw new BinaryFileStoreError('invalid_reference');
      if (typeof adapter.getText !== 'function' || typeof adapter.putText !== 'function') {
        throw new BinaryFileStoreError('storage_unavailable');
      }
      const existing = await adapter.getText(reference.id);
      if (!existing) throw new BinaryFileStoreError('file_not_found');
      if (existing.binaryId !== reference.binaryId) throw new BinaryFileStoreError('corrupt_record');
      if (editedText !== null && typeof editedText !== 'string') {
        throw new BinaryFileStoreError('invalid_text_payload');
      }

      const newId = createId(cryptoImpl);
      const timestamp = now();
      const forkedRecord = {
        ...existing,
        id: newId,
        editedText: editedText === null ? null : String(editedText),
        updatedAt: timestamp,
      };

      try {
        await adapter.putText(forkedRecord);
      } catch (error) {
        if (error instanceof BinaryFileStoreError) throw error;
        if (error?.name === 'QuotaExceededError') throw new BinaryFileStoreError('quota_exceeded');
        throw new BinaryFileStoreError('write_failed');
      }

      return Object.freeze({
        kind: DOCUMENT_TEXT_REFERENCE_KIND,
        version: DOCUMENT_TEXT_REFERENCE_VERSION,
        id: forkedRecord.id,
        binaryId: forkedRecord.binaryId,
        charCount: forkedRecord.charCount,
        hasEditedText: forkedRecord.editedText !== null,
        updatedAt: forkedRecord.updatedAt,
      });
    },
    async restoreEntries({ fileRecords = [], textRecords = [] }) {
      if (typeof adapter.restoreEntries !== 'function') {
        throw new BinaryFileStoreError('storage_unavailable');
      }
      return adapter.restoreEntries({ fileRecords, textRecords });
    },
    async close() {
      if (typeof adapter.close === 'function') await adapter.close();
    },
  });
}

export function isBinaryFileReference(value) {
  return validateReference(value);
}

export function isDocumentTextReference(value) {
  return validateTextReference(value);
}

export function hasLegacyTransientBinary(fileEntry) {
  if (!fileEntry || typeof fileEntry !== 'object') return false;
  return typeof fileEntry.url === 'string' && fileEntry.url.startsWith('blob:');
}

export const courseVaultBinaryStore = createBinaryFileStore();

