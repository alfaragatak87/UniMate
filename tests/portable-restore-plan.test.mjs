import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
} from '../src/services/binaryFileStore.js';
import {
  PORTABLE_BACKUP_FORMAT,
  PortableAcademicBackupError,
  createPortableAcademicBackup,
  createPortableRestorePlan,
} from '../src/services/portableAcademicBackup.js';
import {
  createAcademicBackup,
} from '../src/services/academicBackup.js';

const FIXED_DATE = new Date('2026-10-25T12:00:00.000Z');

function createSyntheticFile(name, type, contents) {
  const file = new Blob([contents], { type });
  Object.defineProperties(file, {
    name: { value: name },
    lastModified: { value: 1_700_000_000_000 },
  });
  return file;
}

function createStore(customAdapter) {
  let id = 0;
  return createBinaryFileStore({
    adapter: customAdapter || createMemoryBinaryAdapter(),
    cryptoImpl: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
    now: () => 1_800_000_000_000,
  });
}

function createStorage(initialData = {}) {
  const values = new Map([
    ['profile_name', JSON.stringify('Mahasiswa')],
    ['profile_fullname', JSON.stringify('Mahasiswa Lokal')],
    ['profile_nim', JSON.stringify('12345678')],
    ['college_semesters', JSON.stringify([])],
    ['college_tasks', JSON.stringify([])],
    ['college_projects', JSON.stringify([])],
    ['college_thesis', JSON.stringify({ todo: [], inProgress: [], review: [], done: [] })],
    ...Object.entries(initialData).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  ]);

  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls,
    getItem: key => {
      calls.get += 1;
      return values.get(key) ?? null;
    },
    setItem: () => {
      calls.set += 1;
    },
    removeItem: () => {
      calls.remove += 1;
    },
  };
}

async function createSyntheticBackupFixture(options = {}) {
  const store = createStore();
  const fileA = createSyntheticFile('khs-smt1.pdf', 'application/pdf', 'pdf-konten-smt-1');
  const fileB = createSyntheticFile('silabus-algoritma.pdf', 'application/pdf', 'silabus-konten-algoritma');

  const binaryRefA = await store.put(fileA);
  const binaryRefB = await store.put(fileB);

  const textRefA = await store.putText({
    binaryRef: binaryRefA,
    rawText: 'Nilai Algoritma: A, SKS: 3',
    editedText: 'Nilai Algoritma Pemrograman: A, SKS: 3',
    documentType: 'KHS',
  });

  const storage = createStorage({
    profile_name: JSON.stringify('Budi'),
    profile_fullname: JSON.stringify('Budi Utomo'),
    profile_nim: JSON.stringify('12345678'),
    college_semesters: JSON.stringify([
      {
        id: 1,
        name: 'Semester 1',
        originalFile: binaryRefA,
        documents: [{ type: 'KHS', binaryRef: binaryRefA, textRef: textRefA }],
        courses: [
          { id: 101, name: 'Algoritma', sks: 3, grade: 'A', files: [{ binaryRef: binaryRefB }] },
        ],
      },
    ]),
    college_tasks: JSON.stringify([
      { id: 't1', title: 'Tugas 1 Algoritma', deadline: '2026-11-01', status: 'todo' },
    ]),
    college_projects: JSON.stringify([
      { id: 'p1', title: 'Aplikasi Web UniMate' },
    ]),
    college_thesis: JSON.stringify({
      todo: [{ id: 'th1', title: 'Pengajuan Judul' }],
      inProgress: [],
      review: [],
      done: [],
    }),
  });

  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => FIXED_DATE,
    version: options.version,
  });

  return { store, storage, backup };
}

test('B5B-4a.1: Backup metadata lama (unimate-academic-backup) dan portabel lama tanpa texts dapat dianalisis rencananya', async () => {
  const storage = createStorage();
  const metadataBackup = createAcademicBackup(storage, { now: () => FIXED_DATE });
  const serializedMeta = JSON.stringify(metadataBackup);

  const planMeta = await createPortableRestorePlan(serializedMeta, storage);
  assert.equal(planMeta.format, 'unimate-academic-backup');
  assert.equal(planMeta.portable, false);
  assert.equal(planMeta.restoreEnabled, false);
  assert.equal(typeof planMeta.summary, 'object');

  // Test portabel lama tanpa texts (pra B5B-2)
  const { backup } = await createSyntheticBackupFixture();
  const legacyPortable = structuredClone(backup);
  delete legacyPortable.texts;
  delete legacyPortable.academic.data.college_semesters[0].documents[0].textRef;
  const serializedLegacy = JSON.stringify(legacyPortable);

  const planLegacy = await createPortableRestorePlan(serializedLegacy, storage);
  assert.equal(planLegacy.format, PORTABLE_BACKUP_FORMAT);
  assert.equal(planLegacy.portable, true);
  assert.equal(planLegacy.restoreEnabled, false);
});

test('B5B-4a.2: Backup portabel dengan OCR dan editedText dianalisis dengan verifikasi integritas hash', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const serialized = JSON.stringify(backup);
  const targetStorage = createStorage(); // storage kosong

  const plan = await createPortableRestorePlan(serialized, targetStorage);
  assert.equal(plan.format, PORTABLE_BACKUP_FORMAT);
  assert.equal(plan.portable, true);
  assert.equal(plan.integrity.binariesVerified, true);
  assert.equal(plan.integrity.textsVerified, true);
  assert.equal(plan.integrity.editedTextProtected, true); // Di v2 terproteksi penuh
  assert.equal(plan.entities.binaries.length, 2);
  assert.equal(plan.entities.texts.length, 1);
  assert.equal(plan.entities.texts[0].hasEditedText, true);

  // Verifikasi v1 legacy tetap teranalisis dengan editedTextProtected: false
  const { backup: legacyV1 } = await createSyntheticBackupFixture({ version: 1 });
  const planV1 = await createPortableRestorePlan(JSON.stringify(legacyV1), targetStorage);
  assert.equal(planV1.integrity.editedTextProtected, false);
});

test('B5B-4a.3: Backup rusak (malformed JSON atau non-string) ditolak dengan aman', async () => {
  const storage = createStorage();
  await assert.rejects(
    createPortableRestorePlan('{ malformed json }', storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'invalid_file',
  );

  await assert.rejects(
    createPortableRestorePlan(null, storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'invalid_file',
  );
});

test('B5B-4a.4: Checksum tidak cocok (bitflip pada payload Base64 biner atau teks) digagalkan dengan integrity_failed', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  // 1. Bitflip pada data biner
  const corruptBinary = structuredClone(backup);
  corruptBinary.binaries[0].data = corruptBinary.binaries[0].data.replace(/[a-zA-Z]/, 'Z');
  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(corruptBinary), storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'integrity_failed',
  );

  // 2. Manipulasi rawText
  const corruptText = structuredClone(backup);
  corruptText.texts[0].rawText = 'Teks yang telah dimutasi tanpa ubah hash';
  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(corruptText), storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'integrity_failed',
  );
});

test('B5B-4a.5: Referensi berkas biner hilang (binaryRef ada di semester tetapi tidak ada di binaries) ditolak', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  const missingBinary = structuredClone(backup);
  missingBinary.binaries.pop(); // Hapus 1 file biner yang direferensikan

  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(missingBinary), storage),
    error => error instanceof PortableAcademicBackupError && (error.code === 'missing_binary_reference' || error.code === 'inconsistent_backup'),
  );
});

test('B5B-4a.6: Referensi teks OCR hilang (textRef ada di semester tetapi tidak ada di texts) ditolak', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  const missingText = structuredClone(backup);
  missingText.texts = []; // Kosongkan texts padahal semester memuat textRef

  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(missingText), storage),
    error => error instanceof PortableAcademicBackupError && (error.code === 'missing_text_reference' || error.code === 'inconsistent_backup'),
  );
});

test('B5B-4a.7: Duplikasi ID biner dengan isi berbeda dideteksi sebagai duplicate_id_conflict', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  const dupBackup = structuredClone(backup);
  // Tambah entri biner dengan ID yang sama tetapi sha256 / size berbeda
  dupBackup.binaries.push({
    reference: { ...dupBackup.binaries[0].reference },
    encoding: 'base64',
    sha256: 'f'.repeat(64),
    data: 'c2FtcGxl',
  });

  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(dupBackup), storage),
    error => error instanceof PortableAcademicBackupError,
  );
});

test('B5B-4a.8: Deteksi konflik semester bertabrakan (nama sama tetapi ID berbeda, atau ID sama tetapi isi berbeda)', async () => {
  const { backup } = await createSyntheticBackupFixture();

  // Skenario A: ID sama tetapi jumlah matkul berbeda
  const conflictStorageA = createStorage({
    college_semesters: JSON.stringify([
      {
        id: 1,
        name: 'Semester 1',
        courses: [{ id: 999, name: 'Mata Kuliah Berbeda Lokal', sks: 4, grade: 'B' }],
      },
    ]),
  });

  const planA = await createPortableRestorePlan(JSON.stringify(backup), conflictStorageA);
  assert.equal(planA.entities.semesters[0].status, 'conflict');
  assert.equal(planA.summary.conflicts > 0, true);
  assert.equal(planA.canRestoreClean, false);

  // Skenario B: Nama sama "Semester 1" tetapi ID berbeda (ID 99 vs ID 1)
  const conflictStorageB = createStorage({
    college_semesters: JSON.stringify([
      {
        id: 99,
        name: 'Semester 1',
        courses: [],
      },
    ]),
  });

  const planB = await createPortableRestorePlan(JSON.stringify(backup), conflictStorageB);
  assert.equal(planB.entities.semesters[0].status, 'conflict');
  assert.match(planB.entities.semesters[0].reason, /memiliki ID berbeda/u);
});

test('B5B-4a.9: Deteksi berkas bernama sama tetapi berbeda ID/ukuran/konten sebagai konflik biner', async () => {
  const { backup } = await createSyntheticBackupFixture();

  // Simulasikan adapter yang sudah memiliki binary dengan ID yang sama tetapi ukuran berbeda
  const mockStore = {
    get: async ref => {
      if (ref.id === backup.binaries[0].reference.id) {
        return { size: 999_999 }; // Ukuran berbeda dari reference
      }
      return null;
    },
    getText: async () => null,
  };

  const storage = createStorage();
  const plan = await createPortableRestorePlan(JSON.stringify(backup), storage, { binaryStore: mockStore });

  const conflictBinary = plan.entities.binaries.find(b => b.id === backup.binaries[0].reference.id);
  assert.equal(conflictBinary.status, 'conflict');
  assert.match(conflictBinary.reason, /ukuran berbeda/u);
});

test('B5B-4a.10: Backup dengan struktur yang tidak sesuai skema (tipe data salah) ditolak', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  const invalidTypeBackup = structuredClone(backup);
  invalidTypeBackup.academic.data.profile_semester = 'bukan-angka'; // Harusnya number

  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(invalidTypeBackup), storage),
    error => error instanceof PortableAcademicBackupError || error.name === 'AcademicBackupError',
  );
});

test('B5B-4a.11: Payload yang menyisipkan kunci kredensial/token (gemini_api_key, apiKey) ditolak seketika', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  const maliciousBackup = structuredClone(backup);
  maliciousBackup.academic.data.gemini_api_key = 'ai-secret-key-injected';

  await assert.rejects(
    createPortableRestorePlan(JSON.stringify(maliciousBackup), storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'forbidden_credential_in_backup',
  );
});

test('B5B-4a.12: Ukuran backup melebihi batas (PORTABLE_BACKUP_MAX_BYTES) ditolak sebelum parsing', async () => {
  const storage = createStorage();
  // Simulasikan string raksasa
  const oversizedHeader = ' '.repeat(65 * 1024 * 1024);

  await assert.rejects(
    createPortableRestorePlan(oversizedHeader, storage),
    error => error instanceof PortableAcademicBackupError && error.code === 'backup_too_large',
  );
});

test('B5B-4a.13: Restore plan berulang bersifat deterministik dan idempotent (hasil konsisten)', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();
  const serialized = JSON.stringify(backup);

  const plan1 = await createPortableRestorePlan(serialized, storage);
  const plan2 = await createPortableRestorePlan(serialized, storage);

  assert.deepEqual(plan1, plan2);
});

test('B5B-4a.14: Verifikasi 100% read-only: tidak ada pemanggilan storage.setItem, removeItem, maupun store.put/remove', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();
  const serialized = JSON.stringify(backup);

  const mockStore = {
    get: async () => null,
    getText: async () => null,
    put: () => { throw new Error('write_forbidden_during_planning'); },
    putMany: () => { throw new Error('write_forbidden_during_planning'); },
    putText: () => { throw new Error('write_forbidden_during_planning'); },
    remove: () => { throw new Error('write_forbidden_during_planning'); },
  };

  const plan = await createPortableRestorePlan(serialized, storage, { binaryStore: mockStore });
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
  assert.equal(storage.calls.get > 0, true);
  assert.equal(plan.restoreEnabled, false);
});

test('B5B-4a.15: Kompatibilitas lintas platform (Web, PWA, Electron) tanpa dependensi window.electronAPI', async () => {
  const { backup } = await createSyntheticBackupFixture();
  const storage = createStorage();

  // Pastikan berjalan pada lingkungan murni tanpa window.electronAPI
  const originalElectron = globalThis.window?.electronAPI;
  try {
    if (globalThis.window) delete globalThis.window.electronAPI;
    const plan = await createPortableRestorePlan(JSON.stringify(backup), storage);
    assert.equal(plan.portable, true);
    assert.equal(plan.summary.totalEntities > 0, true);
  } finally {
    if (globalThis.window && originalElectron) globalThis.window.electronAPI = originalElectron;
  }
});
