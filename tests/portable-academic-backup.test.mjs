import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
} from '../src/services/binaryFileStore.js';
import {
  PORTABLE_BACKUP_FORMAT,
  PortableAcademicBackupError,
  createPortableAcademicBackup,
  createPortableRestorePreview,
  parsePortableAcademicBackup,
} from '../src/services/portableAcademicBackup.js';

const FIXED_DATE = new Date('2026-10-22T08:00:00.000Z');

function createSyntheticFile(name, type, contents) {
  const file = new Blob([contents], { type });
  Object.defineProperties(file, {
    name: { value: name },
    lastModified: { value: 1_700_000_000_000 },
  });
  return file;
}

function createStore() {
  let id = 0;
  return createBinaryFileStore({
    adapter: createMemoryBinaryAdapter(),
    cryptoImpl: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
    now: () => 1_800_000_000_000,
  });
}

function createStorage(semesters, tasks = []) {
  const values = new Map([
    ['college_semesters', JSON.stringify(semesters)],
    ['college_tasks', JSON.stringify(tasks)],
    ['college_thesis', JSON.stringify({ todo: [], inProgress: [], review: [], done: [] })],
    ['gemini_api_key', JSON.stringify('synthetic-forbidden-key')],
    ['gateway_token', JSON.stringify('synthetic-forbidden-token')],
  ]);
  const calls = { set: 0, remove: 0 };
  return {
    calls,
    getItem: key => values.get(key) ?? null,
    setItem: () => { calls.set += 1; },
    removeItem: () => { calls.remove += 1; },
  };
}

async function createFixture() {
  const store = createStore();
  const [khs, material] = await store.putMany([
    createSyntheticFile('khs.pdf', 'application/pdf', 'synthetic-khs'),
    createSyntheticFile('materi.txt', 'text/plain', 'synthetic-material'),
  ]);
  const storage = createStorage([{
    id: 1,
    name: 'Semester Sintetis',
    originalFile: khs,
    documents: [{ type: 'KHS', binaryRef: khs }],
    courses: [{ id: 11, name: 'Keamanan Data', sks: 3, grade: 'A', files: [{ binaryRef: material }] }],
  }]);
  return { store, storage };
}

test('backup portabel mengikat metadata dan referensi biner tanpa credential', async () => {
  const { store, storage } = await createFixture();
  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date(FIXED_DATE),
  });
  const serialized = JSON.stringify(backup);

  assert.equal(backup.format, PORTABLE_BACKUP_FORMAT);
  assert.equal(backup.binaries.length, 2);
  assert.equal(backup.binaries.every(entry => /^[a-f0-9]{64}$/u.test(entry.sha256)), true);
  assert.equal(serialized.includes('synthetic-forbidden-key'), false);
  assert.equal(serialized.includes('synthetic-forbidden-token'), false);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});

test('validasi read-only menerima backup utuh dan tidak menulis storage', async () => {
  const { store, storage } = await createFixture();
  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date(FIXED_DATE),
  });
  const preview = await createPortableRestorePreview(JSON.stringify(backup), storage);

  assert.equal(preview.portable, true);
  assert.deepEqual(preview.binaries, { files: 2, bytes: 31 });
  assert.equal(preview.restoreEnabled, false);
  assert.equal(Object.hasOwn(preview, 'data'), false);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
});

test('file hilang menggagalkan seluruh ekspor tanpa backup parsial', async () => {
  const store = createStore();
  const missingReference = {
    kind: 'unimate-binary-file',
    version: 1,
    id: '00000000-0000-4000-8000-000000000099',
    name: 'hilang.pdf',
    mimeType: 'application/pdf',
    size: 10,
    lastModified: 0,
  };
  const storage = createStorage([{ id: 1, documents: [{ type: 'KHS', binaryRef: missingReference }], courses: [] }]);
  await assert.rejects(
    createPortableAcademicBackup(storage, { binaryStore: store, now: () => new Date(FIXED_DATE) }),
    error => error instanceof PortableAcademicBackupError && error.code === 'binary_unavailable',
  );
});

test('checksum, ukuran, referensi ekstra, dan payload rusak ditolak', async () => {
  const { store, storage } = await createFixture();
  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date(FIXED_DATE),
  });
  const cases = [];
  const checksum = structuredClone(backup);
  checksum.binaries[0].sha256 = '0'.repeat(64);
  cases.push(checksum);
  const size = structuredClone(backup);
  size.binaries[0].data = 'YQ==';
  cases.push(size);
  const extra = structuredClone(backup);
  extra.binaries.push(structuredClone(extra.binaries[0]));
  cases.push(extra);
  const field = structuredClone(backup);
  field.binaries[0].credential = 'forbidden';
  cases.push(field);

  for (const value of cases) {
    await assert.rejects(parsePortableAcademicBackup(JSON.stringify(value)), PortableAcademicBackupError);
  }
});

test('UI membedakan ekspor metadata dan lengkap serta tidak mengaktifkan restore', async () => {
  const source = await fs.readFile(new URL('../src/components/DataBackup.jsx', import.meta.url), 'utf8');
  assert.match(source, /createPortableAcademicBackup\(localStorage\)/u);
  assert.match(source, /createPortableRestorePreview/u);
  assert.match(source, /Ekspor Metadata/u);
  assert.match(source, /Ekspor Lengkap \+ Berkas/u);
  assert.match(source, /Restore tetap dinonaktifkan/u);
  assert.equal(source.includes('localStorage.setItem'), false);
  assert.equal(source.includes('localStorage.removeItem'), false);
});
