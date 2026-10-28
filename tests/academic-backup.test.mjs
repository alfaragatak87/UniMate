import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  ACADEMIC_BACKUP_FORMAT,
  ACADEMIC_BACKUP_MAX_BYTES,
  ACADEMIC_BACKUP_VERSION,
  ACADEMIC_STORAGE_KEYS,
  AcademicBackupError,
  createAcademicBackup,
  createAcademicRestorePreview,
  parseAcademicBackup,
} from '../src/services/academicBackup.js';

const FIXED_DATE = new Date('2026-10-21T08:00:00.000Z');

const SYNTHETIC_DATA = Object.freeze({
  profile_name: 'Mahasiswa Sintetis',
  profile_picture: 'data:image/png;base64,c3ludGhldGlj',
  profile_fullname: 'Nama Contoh',
  profile_nim: 'SYNTH-001',
  profile_instansi: 'Universitas Contoh',
  profile_instansi_nickname: 'UNIC',
  profile_jurusan: 'Teknik Pengujian',
  profile_semester: 5,
  profile_academic_phase: 'kuliah',
  profile_next_date: '2026-11-01',
  profile_academic_calendar: { krs: '2026-08-01', uts: '2026-10-01', uas: '2026-12-01', libur: '2027-01-01' },
  college_semesters: [{
    id: 1,
    name: 'Semester Sintetis',
    courses: [
      { id: 11, name: 'Keamanan Data', sks: 3, grade: 'A' },
      { id: 12, name: 'Pengujian Perangkat Lunak', sks: 3, grade: 'A-' },
    ],
  }],
  college_tasks: [
    { id: 21, title: 'Tugas Sintetis Satu', completed: false },
    { id: 22, title: 'Tugas Sintetis Dua', completed: true },
  ],
  college_thesis: {
    todo: [{ id: 31, title: 'Rencana Sintetis' }],
    inProgress: [{ id: 32, title: 'Proses Sintetis' }],
    review: [],
    done: [{ id: 33, title: 'Selesai Sintetis' }],
  },
  sidebar_collapsed: false,
  dark_mode: true,
  prompted_docs_phase: 'kuliah',
  profile_academic_phase_auto: true,
  profile_jenjang: 'S1',
  github_username: 'synthetic-user',
  holiday_mode: false,
  college_projects: [{ id: 41, name: 'Proyek Sintetis' }],
});

const FORBIDDEN_STORAGE = Object.freeze({
  gemini_api_key: 'forbidden-gemini-synthetic-value',
  openai_api_key: 'forbidden-openai-synthetic-value',
  unimate_firebase_config: { apiKey: 'forbidden-firebase-synthetic-value' },
  credential_ciphertext: 'forbidden-ciphertext-synthetic-value',
  gateway_token: 'forbidden-token-synthetic-value',
});

function createStorage(extra = {}) {
  const entries = new Map(Object.entries({ ...SYNTHETIC_DATA, ...FORBIDDEN_STORAGE, ...extra })
    .map(([key, value]) => [key, JSON.stringify(value)]));
  const calls = { get: [], set: 0, remove: 0 };
  return {
    calls,
    entries,
    getItem(key) {
      calls.get.push(key);
      return entries.get(key) ?? null;
    },
    setItem() {
      calls.set += 1;
    },
    removeItem() {
      calls.remove += 1;
    },
  };
}

function serializeBackup(overrides = {}) {
  return JSON.stringify({
    format: ACADEMIC_BACKUP_FORMAT,
    version: ACADEMIC_BACKUP_VERSION,
    exportedAt: FIXED_DATE.toISOString(),
    data: { college_semesters: [], college_tasks: [], college_projects: [], college_thesis: {} },
    ...overrides,
  });
}

function assertBackupError(action, expectedCode) {
  assert.throws(action, error => {
    assert.equal(error instanceof AcademicBackupError, true);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, 'Backup akademik tidak valid.');
    return true;
  });
}

test('ekspor backup mencakup seluruh key AppContext dan tidak mengubah sumber', async () => {
  const storage = createStorage();
  const before = structuredClone([...storage.entries.entries()]);
  const backup = createAcademicBackup(storage, { now: () => new Date(FIXED_DATE) });
  const contextSource = await fs.readFile(new URL('../src/context/AppContext.jsx', import.meta.url), 'utf8');
  const contextKeys = [...contextSource.matchAll(/useLocalStorage\('([^']+)'/gu)].map(match => match[1]).sort();

  assert.equal(backup.format, ACADEMIC_BACKUP_FORMAT);
  assert.equal(backup.version, ACADEMIC_BACKUP_VERSION);
  assert.equal(backup.exportedAt, FIXED_DATE.toISOString());
  assert.deepEqual(Object.keys(backup.data).sort(), [...ACADEMIC_STORAGE_KEYS].sort());
  assert.deepEqual([...ACADEMIC_STORAGE_KEYS].sort(), contextKeys);
  assert.deepEqual([...storage.entries.entries()], before);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
  assert.deepEqual(storage.calls.get.sort(), [...ACADEMIC_STORAGE_KEYS].sort());
  assert.equal(Object.isFrozen(backup), true);
  assert.equal(Object.isFrozen(backup.data), true);
});

test('backup akademik mengecualikan credential, token, ciphertext, dan konfigurasi privat', () => {
  const backup = createAcademicBackup(createStorage(), { now: () => new Date(FIXED_DATE) });
  const serialized = JSON.stringify(backup);

  for (const [key, value] of Object.entries(FORBIDDEN_STORAGE)) {
    assert.equal(Object.hasOwn(backup.data, key), false);
    assert.equal(serialized.includes(key), false);
    assert.equal(serialized.includes(typeof value === 'string' ? value : value.apiKey), false);
  }
});

test('pratinjau restore hanya menampilkan metadata dan jumlah data sintetis', () => {
  const backup = createAcademicBackup(createStorage(), { now: () => new Date(FIXED_DATE) });
  const preview = createAcademicRestorePreview(JSON.stringify(backup));
  const serializedPreview = JSON.stringify(preview);

  assert.deepEqual(preview.counts, {
    semesters: 1,
    courses: 2,
    tasks: 2,
    projects: 1,
    thesisItems: 3,
  });
  assert.deepEqual(preview.includedKeys, [...ACADEMIC_STORAGE_KEYS].sort());
  assert.equal(Object.hasOwn(preview, 'data'), false);
  assert.equal(serializedPreview.includes('Nama Contoh'), false);
  assert.equal(serializedPreview.includes('Keamanan Data'), false);
  assert.equal(Object.isFrozen(preview), true);
});

test('pratinjau restore membedakan data baru, berbeda, sama, dan konflik tanpa menulis', () => {
  const backupStorage = createStorage();
  const backup = createAcademicBackup(backupStorage, { now: () => new Date(FIXED_DATE) });
  const targetStorage = createStorage({
    profile_name: 'Nama Berbeda',
  });
  targetStorage.entries.set('college_tasks', '{broken-json');
  targetStorage.entries.delete('college_projects');
  const before = structuredClone([...targetStorage.entries.entries()]);

  const preview = createAcademicRestorePreview(JSON.stringify(backup), targetStorage);

  assert.equal(preview.changes.add, 1);
  assert.equal(preview.changes.replace >= 1, true);
  assert.equal(preview.changes.unchanged >= 1, true);
  assert.equal(preview.changes.blocked, 1);
  assert.deepEqual([...targetStorage.entries.entries()], before);
  assert.equal(targetStorage.calls.set, 0);
  assert.equal(targetStorage.calls.remove, 0);
});

test('parser menerima envelope v1 yang valid dan menghasilkan salinan beku', () => {
  const serialized = serializeBackup();
  const parsed = parseAcademicBackup(serialized);

  assert.equal(parsed.version, ACADEMIC_BACKUP_VERSION);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.data), true);
  assert.notEqual(parsed.data, JSON.parse(serialized).data);
});

test('parser menolak JSON rusak, format lama, field tambahan, dan key storage asing', () => {
  assertBackupError(() => parseAcademicBackup('{'), 'invalid_file');
  assertBackupError(() => parseAcademicBackup(JSON.stringify({ semesters: [], tasks: [], thesis: {} })), 'invalid_envelope');
  assertBackupError(() => parseAcademicBackup(serializeBackup({ extra: true })), 'invalid_envelope');
  assertBackupError(() => parseAcademicBackup(serializeBackup({ version: 2 })), 'unsupported_version');
  assertBackupError(() => parseAcademicBackup(serializeBackup({
    data: { college_semesters: [], unknown_data: [] },
  })), 'unknown_storage_key');
});

test('parser menolak tipe data salah dan key prototype berbahaya', () => {
  assertBackupError(() => parseAcademicBackup(serializeBackup({
    data: { profile_semester: 'lima' },
  })), 'invalid_data_type');
  assertBackupError(() => parseAcademicBackup(
    `{"format":"${ACADEMIC_BACKUP_FORMAT}","version":${ACADEMIC_BACKUP_VERSION},"exportedAt":"${FIXED_DATE.toISOString()}","data":{"college_thesis":{"__proto__":[]}}}`,
  ), 'unsafe_key');
});

test('parser membatasi ukuran file backup sebelum memproses isinya', () => {
  const oversized = ' '.repeat(ACADEMIC_BACKUP_MAX_BYTES + 1);
  assertBackupError(() => parseAcademicBackup(oversized), 'backup_too_large');
});

test('kegagalan validasi dan pembatalan pratinjau tidak memiliki jalur tulis storage', async () => {
  const storage = createStorage();
  const before = structuredClone([...storage.entries.entries()]);
  const componentSource = await fs.readFile(new URL('../src/components/DataBackup.jsx', import.meta.url), 'utf8');

  assertBackupError(() => createAcademicRestorePreview('{invalid'), 'invalid_file');
  assert.equal(componentSource.includes('localStorage.setItem'), false);
  assert.equal(componentSource.includes('localStorage.removeItem'), false);
  assert.equal(componentSource.includes('location.reload'), false);
  assert.match(componentSource, /setRestorePreview\(null\)/u);
  assert.match(componentSource, /Restore tetap dinonaktifkan/u);
  assert.deepEqual([...storage.entries.entries()], before);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});
