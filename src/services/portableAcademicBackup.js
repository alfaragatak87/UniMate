import {
  createAcademicBackup,
  createAcademicRestorePreview,
  parseAcademicBackup,
} from './academicBackup.js';
import {
  courseVaultBinaryStore,
  isBinaryFileReference,
  isDocumentTextReference,
} from './binaryFileStore.js';

export const PORTABLE_BACKUP_FORMAT = 'unimate-portable-academic-backup';
export const PORTABLE_BACKUP_VERSIONS = Object.freeze([1, 2]);
export const PORTABLE_BACKUP_VERSION = 2;
export const PORTABLE_BACKUP_MAX_BYTES = 64 * 1024 * 1024;
export const PORTABLE_BACKUP_MAX_BINARY_BYTES = 36 * 1024 * 1024;
export const PORTABLE_BACKUP_MAX_TEXT_BYTES = 25 * 1024 * 1024;
export const PORTABLE_BACKUP_MAX_FILES = 250;

export function computeCanonicalTextPayload(record) {
  if (!record || typeof record !== 'object') return '';
  const binaryId = String(record.binaryId || record.reference?.binaryId || '');
  const rawText = typeof record.rawText === 'string' ? record.rawText : '';
  let editedText = null;
  if (typeof record.editedText === 'string') {
    editedText = record.editedText;
  } else if (record.editedText !== null && record.editedText !== undefined) {
    editedText = String(record.editedText);
  }
  return JSON.stringify({
    binaryId,
    editedText,
    rawText,
  });
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export class PortableAcademicBackupError extends Error {
  constructor(code) {
    super('Backup portabel tidak valid.');
    this.name = 'PortableAcademicBackupError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function cloneAndFreeze(value) {
  const clone = JSON.parse(JSON.stringify(value));
  const freeze = current => {
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) return current;
    Object.values(current).forEach(freeze);
    return Object.freeze(current);
  };
  return freeze(clone);
}

function encodedBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function collectBinaryReferences(value, state, depth = 0) {
  if (depth > 32 || state.nodes > 100_000) throw new PortableAcademicBackupError('data_too_complex');
  state.nodes += 1;
  if (isBinaryFileReference(value)) {
    const existing = state.references.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new PortableAcademicBackupError('reference_conflict');
    }
    state.references.set(value.id, value);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectBinaryReferences(item, state, depth + 1);
    return;
  }
  for (const item of Object.values(value)) collectBinaryReferences(item, state, depth + 1);
}

function listBinaryReferences(academicBackup) {
  const state = { nodes: 0, references: new Map() };
  collectBinaryReferences(academicBackup.data, state);
  const references = [...state.references.values()];
  if (references.length > PORTABLE_BACKUP_MAX_FILES) {
    throw new PortableAcademicBackupError('too_many_files');
  }
  const totalBytes = references.reduce((total, reference) => total + reference.size, 0);
  if (totalBytes > PORTABLE_BACKUP_MAX_BINARY_BYTES) {
    throw new PortableAcademicBackupError('binary_data_too_large');
  }
  return references;
}

function collectTextReferences(value, state, depth = 0) {
  if (depth > 32 || state.nodes > 100_000) throw new PortableAcademicBackupError('data_too_complex');
  state.nodes += 1;
  if (isDocumentTextReference(value)) {
    const existing = state.references.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new PortableAcademicBackupError('reference_conflict');
    }
    state.references.set(value.id, value);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectTextReferences(item, state, depth + 1);
    return;
  }
  for (const item of Object.values(value)) collectTextReferences(item, state, depth + 1);
}

function listTextReferences(academicBackup) {
  const state = { nodes: 0, references: new Map() };
  collectTextReferences(academicBackup.data, state);
  const references = [...state.references.values()];
  if (references.length > PORTABLE_BACKUP_MAX_FILES) {
    throw new PortableAcademicBackupError('too_many_files');
  }
  return references;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length < 1 || !BASE64_PATTERN.test(value)) {
    throw new PortableAcademicBackupError('invalid_binary_encoding');
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new PortableAcademicBackupError('invalid_binary_encoding');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(bytes, cryptoImpl) {
  if (typeof cryptoImpl?.subtle?.digest !== 'function') {
    throw new PortableAcademicBackupError('integrity_unavailable');
  }
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createBinaryEntry(reference, store, cryptoImpl) {
  let blob;
  try {
    blob = await store.get(reference);
  } catch {
    throw new PortableAcademicBackupError('binary_unavailable');
  }
  if (
    blob?.size !== reference.size
    || (blob.type && blob.type !== 'application/octet-stream' && blob.type !== reference.mimeType)
    || typeof blob.arrayBuffer !== 'function'
  ) throw new PortableAcademicBackupError('binary_corrupt');
  let bytes;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch {
    throw new PortableAcademicBackupError('binary_unavailable');
  }
  if (bytes.byteLength !== reference.size) throw new PortableAcademicBackupError('binary_corrupt');
  return Object.freeze({
    reference,
    encoding: 'base64',
    sha256: await sha256(bytes, cryptoImpl),
    data: bytesToBase64(bytes),
  });
}

async function createTextEntry(reference, store, cryptoImpl, version = PORTABLE_BACKUP_VERSION) {
  let record;
  try {
    record = await store.getText(reference);
  } catch {
    throw new PortableAcademicBackupError('text_unavailable');
  }
  if (
    !record
    || record.binaryId !== reference.binaryId
    || record.charCount !== reference.charCount
    || typeof record.rawText !== 'string'
  ) throw new PortableAcademicBackupError('text_corrupt');
  const payloadToHash = version >= 2
    ? computeCanonicalTextPayload(record)
    : record.rawText;
  const bytes = new TextEncoder().encode(payloadToHash);
  return Object.freeze({
    reference,
    sha256: await sha256(bytes, cryptoImpl),
    rawText: record.rawText,
    editedText: typeof record.editedText === 'string' ? record.editedText : null,
    documentType: record.documentType || 'Dokumen',
    pageCount: record.pageCount ?? null,
    confidence: record.confidence ?? null,
  });
}

export async function createPortableAcademicBackup(storage, options = {}) {
  const store = options.binaryStore ?? courseVaultBinaryStore;
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const version = options.version ?? PORTABLE_BACKUP_VERSION;
  if (!PORTABLE_BACKUP_VERSIONS.includes(version)) {
    throw new PortableAcademicBackupError('unsupported_version');
  }
  if (typeof store?.get !== 'function') throw new TypeError('Penyimpanan biner backup tidak valid');
  const academic = createAcademicBackup(storage, { now: options.now });
  const references = listBinaryReferences(academic);
  const textReferences = listTextReferences(academic);
  const binaries = [];
  for (const reference of references) binaries.push(await createBinaryEntry(reference, store, cryptoImpl));
  const texts = [];
  for (const textRef of textReferences) texts.push(await createTextEntry(textRef, store, cryptoImpl, version));
  const backup = {
    format: PORTABLE_BACKUP_FORMAT,
    version,
    exportedAt: academic.exportedAt,
    academic,
    binaries,
    texts,
  };
  if (encodedBytes(JSON.stringify(backup)) > PORTABLE_BACKUP_MAX_BYTES) {
    throw new PortableAcademicBackupError('backup_too_large');
  }
  return cloneAndFreeze(backup);
}

async function validatePortableEnvelope(value, cryptoImpl) {
  const hasTexts = Object.hasOwn(value, 'texts');
  const allowedKeys = hasTexts
    ? ['format', 'version', 'exportedAt', 'academic', 'binaries', 'texts']
    : ['format', 'version', 'exportedAt', 'academic', 'binaries'];
  if (!hasExactKeys(value, allowedKeys)) {
    throw new PortableAcademicBackupError('invalid_envelope');
  }
  if (value.format !== PORTABLE_BACKUP_FORMAT || !PORTABLE_BACKUP_VERSIONS.includes(value.version)) {
    throw new PortableAcademicBackupError('unsupported_version');
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new PortableAcademicBackupError('invalid_export_time');
  }
  let academic;
  try {
    academic = parseAcademicBackup(JSON.stringify(value.academic));
  } catch {
    throw new PortableAcademicBackupError('invalid_academic_backup');
  }
  if (academic.exportedAt !== value.exportedAt || !Array.isArray(value.binaries)) {
    throw new PortableAcademicBackupError('inconsistent_backup');
  }
  const expectedReferences = listBinaryReferences(academic);
  if (value.binaries.length !== expectedReferences.length) {
    throw new PortableAcademicBackupError('inconsistent_backup');
  }
  const expectedById = new Map(expectedReferences.map(reference => [reference.id, reference]));
  const seen = new Set();
  let totalBytes = 0;
  for (const entry of value.binaries) {
    if (!hasExactKeys(entry, ['reference', 'encoding', 'sha256', 'data'])) {
      throw new PortableAcademicBackupError('invalid_binary_entry');
    }
    if (
      entry.encoding !== 'base64'
      || !isBinaryFileReference(entry.reference)
      || !SHA256_PATTERN.test(entry.sha256)
      || seen.has(entry.reference.id)
      || JSON.stringify(expectedById.get(entry.reference.id)) !== JSON.stringify(entry.reference)
    ) throw new PortableAcademicBackupError('inconsistent_backup');
    const bytes = base64ToBytes(entry.data);
    if (bytes.byteLength !== entry.reference.size) throw new PortableAcademicBackupError('binary_corrupt');
    if (await sha256(bytes, cryptoImpl) !== entry.sha256) {
      throw new PortableAcademicBackupError('integrity_failed');
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > PORTABLE_BACKUP_MAX_BINARY_BYTES) {
      throw new PortableAcademicBackupError('binary_data_too_large');
    }
    seen.add(entry.reference.id);
  }

  const expectedTextReferences = listTextReferences(academic);
  if (expectedTextReferences.length > 0 && !hasTexts) {
    throw new PortableAcademicBackupError('inconsistent_backup');
  }

  if (hasTexts) {
    if (!Array.isArray(value.texts)) throw new PortableAcademicBackupError('inconsistent_backup');
    if (value.texts.length !== expectedTextReferences.length) {
      throw new PortableAcademicBackupError('inconsistent_backup');
    }
    const expectedTextById = new Map(expectedTextReferences.map(ref => [ref.id, ref]));
    const seenTexts = new Set();
    let totalTextBytes = 0;
    for (const entry of value.texts) {
      if (!hasExactKeys(entry, ['reference', 'sha256', 'rawText', 'editedText', 'documentType', 'pageCount', 'confidence'])) {
        throw new PortableAcademicBackupError('invalid_text_entry');
      }
      if (
        !isDocumentTextReference(entry.reference)
        || !SHA256_PATTERN.test(entry.sha256)
        || typeof entry.rawText !== 'string'
        || seenTexts.has(entry.reference.id)
        || JSON.stringify(expectedTextById.get(entry.reference.id)) !== JSON.stringify(entry.reference)
      ) throw new PortableAcademicBackupError('inconsistent_backup');
      const payloadToVerify = value.version >= 2
        ? computeCanonicalTextPayload(entry)
        : entry.rawText;
      const textBytes = new TextEncoder().encode(payloadToVerify);
      if (await sha256(textBytes, cryptoImpl) !== entry.sha256) {
        throw new PortableAcademicBackupError('integrity_failed');
      }
      totalTextBytes += textBytes.byteLength;
      if (totalTextBytes > PORTABLE_BACKUP_MAX_TEXT_BYTES) {
        throw new PortableAcademicBackupError('text_data_too_large');
      }
      seenTexts.add(entry.reference.id);
    }
  }

  return {
    academic,
    fileCount: seen.size,
    totalBytes,
    version: value.version,
    editedTextProtected: value.version >= 2,
  };
}

export async function parsePortableAcademicBackup(serialized, options = {}) {
  if (typeof serialized !== 'string') throw new PortableAcademicBackupError('invalid_file');
  if (encodedBytes(serialized) > PORTABLE_BACKUP_MAX_BYTES) {
    throw new PortableAcademicBackupError('backup_too_large');
  }
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new PortableAcademicBackupError('invalid_file');
  }
  await validatePortableEnvelope(value, options.cryptoImpl ?? globalThis.crypto);
  return cloneAndFreeze(value);
}

export async function createPortableRestorePreview(serialized, storage, options = {}) {
  const backup = await parsePortableAcademicBackup(serialized, options);
  const academicPreview = createAcademicRestorePreview(JSON.stringify(backup.academic), storage);
  return Object.freeze({
    ...academicPreview,
    portable: true,
    binaries: Object.freeze({
      files: backup.binaries.length,
      bytes: backup.binaries.reduce((total, entry) => total + entry.reference.size, 0),
    }),
    texts: Object.freeze({
      count: backup.texts?.length ?? 0,
      characters: (backup.texts ?? []).reduce((total, entry) => total + entry.rawText.length, 0),
    }),
    restoreEnabled: false,
  });
}

export { createPortableRestorePlan } from './portableAcademicRestorePlan.js';
export {
  executePortableRestore,
  rollbackRestoreJournal,
  PortableAcademicRestoreError,
} from './portableAcademicRestoreEngine.js';



