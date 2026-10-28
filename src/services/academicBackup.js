export const ACADEMIC_BACKUP_FORMAT = 'unimate-academic-backup';
export const ACADEMIC_BACKUP_VERSION = 1;
export const ACADEMIC_BACKUP_MAX_BYTES = 16 * 1024 * 1024;

const STORAGE_SCHEMA = Object.freeze({
  profile_name: 'string',
  profile_picture: 'string',
  profile_fullname: 'string',
  profile_nim: 'string',
  profile_instansi: 'string',
  profile_instansi_nickname: 'string',
  profile_jurusan: 'string',
  profile_semester: 'number',
  profile_academic_phase: 'string',
  profile_next_date: 'string',
  profile_academic_calendar: 'object',
  college_semesters: 'array',
  college_tasks: 'array',
  college_thesis: 'object',
  sidebar_collapsed: 'boolean',
  dark_mode: 'boolean',
  prompted_docs_phase: 'string',
  profile_academic_phase_auto: 'boolean',
  profile_jenjang: 'string',
  github_username: 'string',
  holiday_mode: 'boolean',
  college_projects: 'array',
});

export const ACADEMIC_STORAGE_KEYS = Object.freeze(Object.keys(STORAGE_SCHEMA));

const UNSAFE_KEYS = Object.freeze(new Set(['__proto__', 'constructor', 'prototype']));

export class AcademicBackupError extends Error {
  constructor(code) {
    super('Backup akademik tidak valid.');
    this.name = 'AcademicBackupError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every(key => expectedKeys.includes(key));
}

function assertJsonValue(value, state, depth = 0) {
  if (depth > 24 || state.nodes > 100_000) throw new AcademicBackupError('data_too_complex');
  state.nodes += 1;
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AcademicBackupError('invalid_data');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > ACADEMIC_BACKUP_MAX_BYTES) throw new AcademicBackupError('data_too_large');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, state, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw new AcademicBackupError('invalid_data');
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) throw new AcademicBackupError('unsafe_key');
    assertJsonValue(item, state, depth + 1);
  }
}

function assertStorageValue(key, value) {
  const expectedType = STORAGE_SCHEMA[key];
  const valid = expectedType === 'array'
    ? Array.isArray(value)
    : expectedType === 'object'
      ? isPlainObject(value)
      : typeof value === expectedType;
  if (!valid) throw new AcademicBackupError('invalid_data_type');
  assertJsonValue(value, { nodes: 0 });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertEnvelope(value) {
  if (!hasExactKeys(value, ['format', 'version', 'exportedAt', 'data'])) {
    throw new AcademicBackupError('invalid_envelope');
  }
  if (value.format !== ACADEMIC_BACKUP_FORMAT || value.version !== ACADEMIC_BACKUP_VERSION) {
    throw new AcademicBackupError('unsupported_version');
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new AcademicBackupError('invalid_export_time');
  }
  if (!isPlainObject(value.data)) throw new AcademicBackupError('invalid_data');
  for (const [key, item] of Object.entries(value.data)) {
    if (!Object.hasOwn(STORAGE_SCHEMA, key)) throw new AcademicBackupError('unknown_storage_key');
    assertStorageValue(key, item);
  }
}

export function createAcademicBackup(storage, options = {}) {
  if (typeof storage?.getItem !== 'function') throw new TypeError('Storage backup tidak valid');
  const now = options.now ?? (() => new Date());
  if (typeof now !== 'function') throw new TypeError('Sumber waktu backup tidak valid');
  const data = {};
  for (const key of ACADEMIC_STORAGE_KEYS) {
    const serialized = storage.getItem(key);
    if (serialized === null) continue;
    if (typeof serialized !== 'string' || serialized.length > ACADEMIC_BACKUP_MAX_BYTES) {
      throw new AcademicBackupError('data_too_large');
    }
    let value;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new AcademicBackupError('invalid_stored_json');
    }
    assertStorageValue(key, value);
    data[key] = value;
  }
  const exportedAt = now();
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) {
    throw new TypeError('Sumber waktu backup tidak valid');
  }
  const backup = {
    format: ACADEMIC_BACKUP_FORMAT,
    version: ACADEMIC_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    data,
  };
  const serialized = JSON.stringify(backup);
  if (new TextEncoder().encode(serialized).byteLength > ACADEMIC_BACKUP_MAX_BYTES) {
    throw new AcademicBackupError('backup_too_large');
  }
  return deepFreeze(clone(backup));
}

export function parseAcademicBackup(serialized) {
  if (typeof serialized !== 'string') throw new AcademicBackupError('invalid_file');
  if (new TextEncoder().encode(serialized).byteLength > ACADEMIC_BACKUP_MAX_BYTES) {
    throw new AcademicBackupError('backup_too_large');
  }
  let backup;
  try {
    backup = JSON.parse(serialized);
  } catch {
    throw new AcademicBackupError('invalid_file');
  }
  assertEnvelope(backup);
  return deepFreeze(clone(backup));
}

function classifyRestoreChanges(backup, storage) {
  const changes = { add: 0, replace: 0, unchanged: 0, blocked: 0 };
  if (!storage || typeof storage.getItem !== 'function') return Object.freeze(changes);
  for (const [key, nextValue] of Object.entries(backup.data)) {
    let currentRaw;
    try {
      currentRaw = storage.getItem(key);
    } catch {
      changes.blocked += 1;
      continue;
    }
    if (currentRaw === null) {
      changes.add += 1;
      continue;
    }
    try {
      const currentValue = JSON.parse(currentRaw);
      if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) changes.unchanged += 1;
      else changes.replace += 1;
    } catch {
      changes.blocked += 1;
    }
  }
  return Object.freeze(changes);
}

export function createAcademicRestorePreview(serialized, storage) {
  const backup = parseAcademicBackup(serialized);
  const semesters = backup.data.college_semesters ?? [];
  const thesis = backup.data.college_thesis ?? {};
  return Object.freeze({
    format: backup.format,
    version: backup.version,
    exportedAt: backup.exportedAt,
    includedKeys: Object.freeze(Object.keys(backup.data).sort()),
    counts: Object.freeze({
      semesters: semesters.length,
      courses: semesters.reduce((total, semester) => total + (Array.isArray(semester?.courses) ? semester.courses.length : 0), 0),
      tasks: backup.data.college_tasks?.length ?? 0,
      projects: backup.data.college_projects?.length ?? 0,
      thesisItems: Object.values(thesis).reduce((total, column) => total + (Array.isArray(column) ? column.length : 0), 0),
    }),
    changes: classifyRestoreChanges(backup, storage),
  });
}
