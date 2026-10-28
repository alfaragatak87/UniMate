import {
  courseVaultBinaryStore,
  isBinaryFileReference,
  isDocumentTextReference,
} from './binaryFileStore.js';

const LEGACY_DATA_URL_PATTERN = /^data:(image\/(?:bmp|gif|jpeg|png|webp)|application\/pdf|text\/(?:csv|plain));base64,/iu;

export class PersistentDocumentError extends Error {
  constructor(code) {
    super('Dokumen lokal tidak dapat diproses.');
    this.name = 'PersistentDocumentError';
    this.code = code;
  }
}

function extractReference(value) {
  if (isBinaryFileReference(value)) return value;
  if (isBinaryFileReference(value?.binaryRef)) return value.binaryRef;
  if (isBinaryFileReference(value?.file)) return value.file;
  return null;
}

function extractTextReference(value) {
  if (isDocumentTextReference(value)) return value;
  if (isDocumentTextReference(value?.textRef)) return value.textRef;
  return null;
}

function extractLegacyUrl(value) {
  const candidate = typeof value === 'string'
    ? value
    : typeof value?.file === 'string'
      ? value.file
      : null;
  return candidate !== null && LEGACY_DATA_URL_PATTERN.test(candidate) ? candidate : null;
}

function mimeTypeFromDataUrl(value) {
  return value.slice(5, value.indexOf(';')).toLowerCase();
}

export function createPersistentDocumentRecord(type, binaryRef, textRef = null) {
  if (typeof type !== 'string' || type.trim().length < 1 || type.trim().length > 160) {
    throw new PersistentDocumentError('invalid_document_type');
  }
  if (!isBinaryFileReference(binaryRef)) throw new PersistentDocumentError('invalid_reference');
  const record = { type: type.trim(), binaryRef };
  if (textRef !== null && textRef !== undefined) {
    if (!isDocumentTextReference(textRef)) throw new PersistentDocumentError('invalid_reference');
    record.textRef = textRef;
  }
  return Object.freeze(record);
}

export async function persistScannerDocument(
  file,
  type,
  store = courseVaultBinaryStore,
  options = {},
) {
  if (typeof store?.put !== 'function') throw new TypeError('Penyimpanan dokumen tidak valid');
  const ocrPayload = options.ocrPayload ?? options.textPayload ?? null;
  if (ocrPayload && typeof ocrPayload.rawText === 'string' && typeof store.putFileWithText === 'function') {
    const stored = await store.putFileWithText(file, ocrPayload);
    return createPersistentDocumentRecord(type, stored.binaryRef, stored.textRef);
  }
  const binaryRef = await store.put(file);
  let textRef = null;
  if (ocrPayload && typeof ocrPayload.rawText === 'string' && typeof store.putText === 'function') {
    try {
      textRef = await store.putText({
        binaryRef,
        ...ocrPayload,
        documentType: type,
      });
    } catch (error) {
      try { await store.remove(binaryRef); } catch {}
      throw error;
    }
  }
  return createPersistentDocumentRecord(type, binaryRef, textRef);
}

export async function persistScannerDocumentWithMetadata(
  file,
  type,
  commitMetadata,
  storeOrOptions = courseVaultBinaryStore,
  extraOptions = {},
) {
  if (typeof commitMetadata !== 'function') throw new TypeError('Commit metadata tidak valid');
  const options = (storeOrOptions && typeof storeOrOptions.put !== 'function')
    ? storeOrOptions
    : { store: storeOrOptions, ...extraOptions };
  const store = options.store ?? courseVaultBinaryStore;
  const ocrPayload = options.ocrPayload ?? options.textPayload ?? null;

  const document = await persistScannerDocument(file, type, store, { ocrPayload });
  let result;
  try {
    result = await commitMetadata(document);
  } catch {
    throw new PersistentDocumentError('metadata_commit_unknown');
  }
  if (result?.ok === true) return document;
  if (result?.ok !== false) throw new PersistentDocumentError('metadata_commit_unknown');

  let cleanupSucceeded = true;
  try {
    if (typeof store?.remove !== 'function') throw new Error('cleanup_unavailable');
    await store.remove(document.binaryRef);
  } catch {
    cleanupSucceeded = false;
  }

  if (document.textRef) {
    try {
      if (typeof store?.removeText === 'function') {
        await store.removeText(document.textRef);
      }
    } catch {
      cleanupSucceeded = false;
    }
  }

  if (!cleanupSucceeded) {
    throw new PersistentDocumentError('cleanup_failed');
  }
  throw new PersistentDocumentError('metadata_write_failed');
}

export async function resolvePersistentDocument(value, options = {}) {
  const store = options.store ?? courseVaultBinaryStore;
  const urlApi = options.urlApi ?? globalThis.URL;
  const reference = extractReference(value);
  if (reference !== null) {
    if (typeof store?.get !== 'function' || typeof urlApi?.createObjectURL !== 'function' || typeof urlApi?.revokeObjectURL !== 'function') {
      throw new PersistentDocumentError('storage_unavailable');
    }
    let blob;
    try {
      blob = await store.get(reference);
    } catch {
      throw new PersistentDocumentError('file_unavailable');
    }
    const url = urlApi.createObjectURL(blob);
    let released = false;
    return Object.freeze({
      url,
      mimeType: reference.mimeType,
      name: reference.name,
      persistent: true,
      release() {
        if (released) return;
        released = true;
        urlApi.revokeObjectURL(url);
      },
    });
  }

  const legacyUrl = extractLegacyUrl(value);
  if (legacyUrl === null) throw new PersistentDocumentError('invalid_document');
  return Object.freeze({
    url: legacyUrl,
    mimeType: mimeTypeFromDataUrl(legacyUrl),
    name: null,
    persistent: false,
    release() {},
  });
}

export async function resolvePersistentDocumentText(value, options = {}) {
  const store = options.store ?? courseVaultBinaryStore;
  const reference = extractTextReference(value);
  if (reference === null) return null;
  if (typeof store?.getText !== 'function') {
    throw new PersistentDocumentError('storage_unavailable');
  }
  let record;
  try {
    record = await store.getText(reference);
  } catch {
    throw new PersistentDocumentError('file_unavailable');
  }
  if (!record) return null;
  return Object.freeze({
    id: record.id,
    binaryId: record.binaryId,
    rawText: record.rawText,
    editedText: record.editedText,
    text: (record.editedText !== null && record.editedText !== undefined) ? record.editedText : record.rawText,
    charCount: record.charCount,
    pageCount: record.pageCount,
    confidence: record.confidence,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function hasPersistentDocument(value) {
  return extractReference(value) !== null || extractLegacyUrl(value) !== null;
}

export function hasPersistentDocumentText(value) {
  return extractTextReference(value) !== null;
}

export async function updatePersistentDocumentEditedText(
  documentOrTextRef,
  editedText,
  options = {},
) {
  const store = options.store ?? courseVaultBinaryStore;
  const textRef = extractTextReference(documentOrTextRef);
  if (!textRef) throw new PersistentDocumentError('invalid_reference');
  if (typeof store.updateEditedText !== 'function') {
    throw new PersistentDocumentError('storage_unavailable');
  }

  let updatedRef;
  try {
    updatedRef = options.fork === true && typeof store.forkEditedText === 'function'
      ? await store.forkEditedText(textRef, editedText)
      : await store.updateEditedText(textRef, editedText);
  } catch (error) {
    if (error?.code === 'quota_exceeded') {
      throw new PersistentDocumentError('quota_exceeded');
    }
    throw new PersistentDocumentError('save_failed');
  }

  if (documentOrTextRef && typeof documentOrTextRef === 'object' && documentOrTextRef.textRef) {
    return Object.freeze({
      ...documentOrTextRef,
      textRef: updatedRef,
    });
  }
  return updatedRef;
}

