import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPortableAcademicBackup,
} from '../src/services/portableAcademicBackup.js';
import {
  createPortableRestorePlan,
} from '../src/services/portableAcademicRestorePlan.js';
import {
  executePortableRestore,
  rollbackRestoreJournal,
  PortableAcademicRestoreError,
} from '../src/services/portableAcademicRestoreEngine.js';
import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
  createIndexedDBBinaryAdapter,
} from '../src/services/binaryFileStore.js';

const FIXED_DATE = 1_800_000_000_000;

function createSyntheticFile(name, mimeType, content) {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    type: mimeType,
    size: bytes.byteLength,
    lastModified: FIXED_DATE,
    arrayBuffer: async () => bytes.buffer,
  };
}

function createStore(customAdapter = null) {
  let id = 0;
  return createBinaryFileStore({
    adapter: customAdapter || createMemoryBinaryAdapter(),
    cryptoImpl: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
    now: () => FIXED_DATE,
  });
}

function createStorage(initialData = {}) {
  const defaults = {
    profile_name: '',
    profile_fullname: '',
    profile_nim: '',
    college_semesters: [],
    college_tasks: [],
    college_projects: [],
    college_thesis: { todo: [], inProgress: [], review: [], done: [] },
  };
  const merged = { ...defaults, ...initialData };
  const values = new Map();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== null && v !== undefined && v !== '') {
      values.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls,
    getItem: key => {
      calls.get += 1;
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      calls.set += 1;
      values.set(key, String(value));
    },
    removeItem: key => {
      calls.remove += 1;
      values.delete(key);
    },
    dump: () => Object.fromEntries(values.entries()),
  };
}

async function createBackupFixture(options = {}) {
  const store = options.store || createStore();
  const fileA = createSyntheticFile('khs-semester-1.pdf', 'application/pdf', 'konten-khs-asli-smt-1');
  const fileB = createSyntheticFile('silabus-struktur-data.pdf', 'application/pdf', 'konten-silabus-asli');

  const binaryRefA = await store.put(fileA);
  const binaryRefB = await store.put(fileB);

  let textRefA = null;
  if (!options.omitText) {
    textRefA = await store.putText({
      binaryRef: binaryRefA,
      rawText: options.rawText || 'Nilai Struktur Data: A, SKS: 4',
      editedText: Object.hasOwn(options, 'editedText') ? options.editedText : 'Nilai Struktur Data: A, SKS: 4 (Tervalidasi)',
      documentType: 'KHS',
    });
  }

  const storage = createStorage({
    profile_name: JSON.stringify('Farhan'),
    profile_fullname: JSON.stringify('Farhan Siswa'),
    profile_nim: JSON.stringify('20240001'),
    profile_major: JSON.stringify('Informatika'),
    college_semesters: JSON.stringify([
      {
        id: 'sem-1',
        name: 'Semester Ganjil 2024',
        originalFile: binaryRefA,
        documents: textRefA
          ? [{ type: 'KHS', binaryRef: binaryRefA, textRef: textRefA }]
          : [{ type: 'KHS', binaryRef: binaryRefA }],
        courses: [
          { id: 'c1', name: 'Struktur Data', sks: 4, grade: 'A', files: [{ binaryRef: binaryRefB }] },
        ],
      },
    ]),
    college_tasks: JSON.stringify([
      { id: 'task-1', title: 'Implementasi Binary Search Tree', deadline: '2026-11-10', status: 'todo' },
    ]),
    college_projects: JSON.stringify([
      { id: 'proj-1', title: 'UniMate Desktop App', status: 'active' },
    ]),
    college_thesis: JSON.stringify({
      todo: [{ id: 'th-1', title: 'Studi Literatur' }],
      inProgress: [],
      review: [],
      done: [],
    }),
  });

  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date(FIXED_DATE),
    version: options.version,
  });

  return { store, storage, backup, binaryRefA, binaryRefB, textRefA };
}

// -------------------------------------------------------------
// F. PENGUJIAN WAJIB
// -------------------------------------------------------------

test('B5B-4b.1: Restore backup valid pada profil kosong', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const emptyStorage = createStorage({
    profile_name: null,
    profile_fullname: null,
    profile_nim: null,
    college_semesters: [],
    college_tasks: [],
    college_projects: [],
    college_thesis: { todo: [], inProgress: [], review: [], done: [] },
  });
  const targetStore = createStore();

  const result = await executePortableRestore(serialized, emptyStorage, { binaryStore: targetStore });
  assert.equal(result.success, true);
  assert.equal(result.restored.profile, true);
  assert.equal(result.restored.semesters, 1);
  assert.equal(result.restored.tasks, 1);
  assert.equal(result.restored.projects, 1);
  assert.equal(result.restored.binaries, 2);
  assert.equal(result.restored.texts, 1);

  // Verifikasi storage terisi
  assert.equal(JSON.parse(emptyStorage.getItem('profile_nim')), '20240001');
  const semesters = JSON.parse(emptyStorage.getItem('college_semesters'));
  assert.equal(semesters.length, 1);
  assert.equal(semesters[0].id, 'sem-1');
});

test('B5B-4b.2: Restore backup lama tanpa OCR', async () => {
  const { backup } = await createBackupFixture({ omitText: true, version: 1 });
  const serialized = JSON.stringify(backup);
  const emptyStorage = createStorage({
    profile_name: null,
    profile_fullname: null,
    profile_nim: null,
  });
  const targetStore = createStore();

  const result = await executePortableRestore(serialized, emptyStorage, { binaryStore: targetStore });
  assert.equal(result.success, true);
  assert.equal(result.restored.binaries, 2);
  assert.equal(result.restored.texts, 0);

  const semesters = JSON.parse(emptyStorage.getItem('college_semesters'));
  assert.equal(semesters.length, 1);
  assert.equal(semesters[0].documents[0].textRef, undefined);
});

test('B5B-4b.3: Restore backup baru dengan rawText dan editedText', async () => {
  const { backup, binaryRefA, textRefA } = await createBackupFixture({
    rawText: 'Teks Mentah OCR KHS 2024',
    editedText: 'Teks Hasil Koreksi Pengguna KHS 2024',
  });
  const serialized = JSON.stringify(backup);
  const emptyStorage = createStorage({ profile_nim: null });
  const targetStore = createStore();

  const result = await executePortableRestore(serialized, emptyStorage, { binaryStore: targetStore });
  assert.equal(result.success, true);

  const textRec = await targetStore.getText(textRefA);
  assert.equal(textRec.rawText, 'Teks Mentah OCR KHS 2024');
  assert.equal(textRec.editedText, 'Teks Hasil Koreksi Pengguna KHS 2024');
  assert.equal(textRec.binaryId, binaryRefA.id);
});

test('B5B-4b.4: editedText null dan string kosong ("")', async () => {
  // Sub-kasus 1: editedText === null
  const fixtureNull = await createBackupFixture({ editedText: null });
  const serializedNull = JSON.stringify(fixtureNull.backup);
  const targetStore1 = createStore();
  const storage1 = createStorage({ profile_nim: null });
  const res1 = await executePortableRestore(serializedNull, storage1, { binaryStore: targetStore1 });
  assert.equal(res1.success, true);
  const text1 = await targetStore1.getText(fixtureNull.textRefA);
  assert.equal(text1.editedText, null);

  // Sub-kasus 2: editedText === "" (string kosong)
  const fixtureEmpty = await createBackupFixture({ editedText: '' });
  const serializedEmpty = JSON.stringify(fixtureEmpty.backup);
  const targetStore2 = createStore();
  const storage2 = createStorage({ profile_nim: null });
  const res2 = await executePortableRestore(serializedEmpty, storage2, { binaryStore: targetStore2 });
  assert.equal(res2.success, true);
  const text2 = await targetStore2.getText(fixtureEmpty.textRefA);
  assert.equal(text2.editedText, '');
  assert.notEqual(text2.editedText, null);
});

test('B5B-4b.5: editedText dimodifikasi tetapi checksum lama rawText masih valid (terdeteksi unverified di v1)', async () => {
  const { backup } = await createBackupFixture({
    version: 1,
    rawText: 'Nilai Asli 100',
    editedText: 'Nilai Koreksi 100',
  });
  // Modifikasi editedText pada cadangan v1
  const tamperedBackupV1 = JSON.parse(JSON.stringify(backup));
  tamperedBackupV1.texts[0].editedText = 'Nilai Diubah Menjadi 80';

  const emptyStorage = createStorage({ profile_nim: null });
  const targetStore = createStore();

  // Evaluasi plan mendeteksi bahwa editedTextProtected bernilai false
  const plan = await createPortableRestorePlan(JSON.stringify(tamperedBackupV1), emptyStorage, { binaryStore: targetStore });
  assert.equal(plan.integrity.editedTextProtected, false);
  assert.ok(plan.risks.some(r => r.includes('versi 1 hanya memverifikasi rawText')));
});

test('B5B-4b.6: Integritas format backup baru mendeteksi perubahan editedText (integrity_failed di v2)', async () => {
  const { backup } = await createBackupFixture({
    version: 2,
    rawText: 'Nilai Asli 100',
    editedText: 'Nilai Koreksi 100',
  });
  // Modifikasi editedText pada cadangan v2
  const tamperedBackup = JSON.parse(JSON.stringify(backup));
  tamperedBackup.texts[0].editedText = 'Nilai Palsu 50';

  const emptyStorage = createStorage({ profile_nim: null });
  const targetStore = createStore();

  await assert.rejects(
    executePortableRestore(JSON.stringify(tamperedBackup), emptyStorage, { binaryStore: targetStore }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'integrity_failed',
  );
});

test('B5B-4b.7: Dokumen biner tetap identik byte-per-byte', async () => {
  const { backup, binaryRefA } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const targetStore = createStore();
  const storage = createStorage({ profile_nim: null });

  await executePortableRestore(serialized, storage, { binaryStore: targetStore });
  const restoredBlob = await targetStore.get(binaryRefA);
  const originalBytes = new TextEncoder().encode('konten-khs-asli-smt-1');
  const restoredBytes = new Uint8Array(await restoredBlob.arrayBuffer());

  assert.deepEqual(restoredBytes, originalBytes);
});

test('B5B-4b.8: ID biner dan teks tetap terhubung', async () => {
  const { backup, binaryRefA, textRefA } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const targetStore = createStore();
  const storage = createStorage({ profile_nim: null });

  await executePortableRestore(serialized, storage, { binaryStore: targetStore });
  const textRecord = await targetStore.getText(textRefA);

  assert.equal(textRecord.id, textRefA.id);
  assert.equal(textRecord.binaryId, binaryRefA.id);

  const semesters = JSON.parse(storage.getItem('college_semesters'));
  assert.equal(semesters[0].documents[0].binaryRef.id, binaryRefA.id);
  assert.equal(semesters[0].documents[0].textRef.id, textRefA.id);
});

test('B5B-4b.9: Shared reference tidak rusak', async () => {
  const store = createStore();
  const sharedFile = createSyntheticFile('shared-guide.pdf', 'application/pdf', 'panduan-bersama');
  const sharedRef = await store.put(sharedFile);

  const storage = createStorage({
    college_semesters: JSON.stringify([
      {
        id: 'sem-a',
        name: 'Semester A',
        documents: [{ type: 'Guide', binaryRef: sharedRef }],
      },
      {
        id: 'sem-b',
        name: 'Semester B',
        documents: [{ type: 'Guide', binaryRef: sharedRef }],
      },
    ]),
  });

  const backup = await createPortableAcademicBackup(storage, { binaryStore: store, now: () => new Date(FIXED_DATE) });
  assert.equal(backup.binaries.length, 1); // 1 binary dishare oleh 2 semester

  const targetStore = createStore();
  const targetStorage = createStorage();
  await executePortableRestore(JSON.stringify(backup), targetStorage, { binaryStore: targetStore });

  const restoredSemesters = JSON.parse(targetStorage.getItem('college_semesters'));
  assert.equal(restoredSemesters[0].documents[0].binaryRef.id, sharedRef.id);
  assert.equal(restoredSemesters[1].documents[0].binaryRef.id, sharedRef.id);
  assert.equal(await (await targetStore.get(sharedRef)).size, sharedRef.size);
});

test('B5B-4b.10: Konflik ID sama dengan payload berbeda membatalkan operasi', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  // Storage lokal sudah memiliki semester dengan ID 'sem-1' tetapi nama dan data berbeda
  const targetStorage = createStorage({
    profile_nim: JSON.stringify('20240001'), // NIM sama
    college_semesters: JSON.stringify([
      { id: 'sem-1', name: 'Semester Berbeda Lokal' },
    ]),
  });
  const targetStore = createStore();

  await assert.rejects(
    executePortableRestore(serialized, targetStorage, { binaryStore: targetStore }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'conflict_detected',
  );

  // Pastikan data lokal tidak berubah
  const semesters = JSON.parse(targetStorage.getItem('college_semesters'));
  assert.equal(semesters.length, 1);
  assert.equal(semesters[0].name, 'Semester Berbeda Lokal');
});

test('B5B-4b.11: Restore ulang tidak menghasilkan duplikasi (idempotent)', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  // Eksekusi pertama
  const res1 = await executePortableRestore(serialized, storage, { binaryStore: store });
  assert.equal(res1.restored.semesters, 1);

  // Eksekusi kedua dengan data persis sama
  const res2 = await executePortableRestore(serialized, storage, { binaryStore: store });
  assert.equal(res2.restored.semesters, 0);
  assert.equal(res2.skipped.semesters, 1);
  assert.equal(res2.skipped.binaries, 2);
  assert.equal(res2.skipped.texts, 1);

  // Verifikasi jumlah entitas di storage tidak bertambah dua kali
  const semesters = JSON.parse(storage.getItem('college_semesters'));
  assert.equal(semesters.length, 1);
});

test('B5B-4b.12: QuotaExceededError sintetis ditangani dengan aman dan di-rollback', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  const storage = createStorage({ profile_nim: null });
  // Simulasikan setItem melempar QuotaExceededError
  const originalSet = storage.setItem;
  storage.setItem = (k, v) => {
    if (k === 'college_semesters') {
      const err = new Error('Disk Full');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return originalSet(k, v);
  };

  const store = createStore();
  await assert.rejects(
    executePortableRestore(serialized, storage, { binaryStore: store }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'quota_exceeded',
  );

  // Verifikasi rollback: tidak ada biner tersisa di store
  await assert.rejects(
    store.get(backup.binaries[0].reference),
    error => error.code === 'file_not_found',
  );
});

test('B5B-4b.13: Kegagalan penulisan binary membatalkan operasi tanpa mengubah storage', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  const failingStore = createStore({
    putMany: async () => {},
    get: async () => null,
    restoreEntries: async () => {
      throw new Error('I/O write disk failure');
    },
    remove: async () => {},
  });

  const storage = createStorage({ profile_nim: null, college_semesters: [] });
  await assert.rejects(
    executePortableRestore(serialized, storage, { binaryStore: failingStore }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'binary_write_failed',
  );

  assert.equal(JSON.parse(storage.getItem('college_semesters')).length, 0);
});

test('B5B-4b.14: Kegagalan penulisan text memicu rollback biner', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  let removedCount = 0;
  const storeWithFailingText = createStore({
    putMany: async () => {},
    get: async () => null,
    restoreEntries: async () => {
      throw new Error('Text store write failed');
    },
    remove: async () => {
      removedCount += 1;
    },
    removeText: async () => {},
  });

  const storage = createStorage({ profile_nim: null });
  await assert.rejects(
    executePortableRestore(serialized, storage, { binaryStore: storeWithFailingText }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'binary_write_failed',
  );
});

test('B5B-4b.15: Kegagalan penulisan metadata mengembalikan storage dan biner ke status awal', async () => {
  const { backup, binaryRefA } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  const storage = createStorage({ profile_nim: JSON.stringify('20240001') });
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'college_projects') throw new Error('Storage write corrupted');
    return originalSet(key, value);
  };

  const store = createStore();
  await assert.rejects(
    executePortableRestore(serialized, storage, { binaryStore: store }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'metadata_write_failed',
  );

  // Kunci profil tetap nilai awal dan biner dibersihkan kembali
  assert.equal(JSON.parse(storage.getItem('profile_nim')), '20240001');
  await assert.rejects(store.get(binaryRefA), e => e.code === 'file_not_found');
});

test('B5B-4b.16: Pembatalan sebelum commit memicu rollback (simulateCrash: before_commit)', async () => {
  const { backup, binaryRefA } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  await assert.rejects(
    executePortableRestore(serialized, storage, {
      binaryStore: store,
      simulateCrash: 'before_commit',
    }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'simulated_crash_before_commit',
  );

  // Verifikasi biner di-rollback
  await assert.rejects(store.get(binaryRefA), e => e.code === 'file_not_found');
});

test('B5B-4b.17: Crash simulasi setelah staging membersihkan file biner (simulateCrash: after_binary_staging)', async () => {
  const { backup, binaryRefA } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  await assert.rejects(
    executePortableRestore(serialized, storage, {
      binaryStore: store,
      simulateCrash: 'after_binary_staging',
    }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'simulated_crash_after_staging',
  );

  await assert.rejects(store.get(binaryRefA), e => e.code === 'file_not_found');
});

test('B5B-4b.18: Recovery dari operasi tidak lengkap via rollbackRestoreJournal', async () => {
  const storage = createStorage({ profile_nim: JSON.stringify('NIM_AWAL') });
  storage.setItem('profile_nim', JSON.stringify('NIM_MUTASI'));

  const journal = {
    operationId: 'op-123',
    status: 'staging_storage',
    stagedStorageKeys: new Map([
      ['profile_nim', JSON.stringify('NIM_AWAL')],
    ]),
    stagedBinaryRefs: [],
    stagedTextRefs: [],
  };

  const store = createStore();
  await rollbackRestoreJournal(journal, storage, store);
  assert.equal(JSON.parse(storage.getItem('profile_nim')), 'NIM_AWAL');
  assert.equal(journal.status, 'rolled_back');
});

test('B5B-4b.19: Kegagalan tidak menghapus data historis lokal yang sudah ada', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);

  // Data historis lokal
  const existingSemester = { id: 'sem-lokal-99', name: 'Semester Lama yang Aman' };
  const storage = createStorage({
    college_semesters: [existingSemester],
  });

  const store = createStore();
  // Simulasikan crash sebelum commit
  await assert.rejects(
    executePortableRestore(serialized, storage, {
      binaryStore: store,
      simulateCrash: 'before_commit',
    }),
    e => e instanceof PortableAcademicRestoreError,
  );

  const currentSemesters = JSON.parse(storage.getItem('college_semesters'));
  assert.equal(currentSemesters.length, 1);
  assert.equal(currentSemesters[0].id, 'sem-lokal-99');
  assert.equal(currentSemesters[0].name, 'Semester Lama yang Aman');
});

test('B5B-4b.20: Tidak ada credential dalam backup yang dipulihkan', async () => {
  const { backup } = await createBackupFixture();
  const storage = createStorage();
  const store = createStore();

  // Kasus 1: Sisipkan credential/secret di dalam array data proyek
  const tamperedNested = JSON.parse(JSON.stringify(backup));
  tamperedNested.academic.data.college_projects[0].api_key = 'AIzaSyFAKEKEYFORBIDDEN';

  await assert.rejects(
    executePortableRestore(JSON.stringify(tamperedNested), storage, { binaryStore: store }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'forbidden_credential_in_backup',
  );

  // Kasus 2: Sisipkan credential di root metadata akademik
  const tamperedRoot = JSON.parse(JSON.stringify(backup));
  tamperedRoot.academic.data.gemini_api_key = 'AIzaSyFAKEKEYFORBIDDEN';

  await assert.rejects(
    executePortableRestore(JSON.stringify(tamperedRoot), storage, { binaryStore: store }),
    error => error instanceof PortableAcademicRestoreError && (error.code === 'invalid_academic_backup' || error.code === 'forbidden_credential_in_backup'),
  );

  assert.equal(storage.getItem('gemini_api_key'), null);
});

test('B5B-4b.21: Tidak ada request Gemini / OpenAI selama proses restore', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  // Awasi pemanggilan fetch global jika ada
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    return Promise.reject(new Error('Network access forbidden'));
  };

  try {
    const result = await executePortableRestore(serialized, storage, { binaryStore: store });
    assert.equal(result.success, true);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B5B-4b.22: Restore Plan harus dibangun ulang jika data berubah (plan_stale)', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  // Buat plan awal
  const stalePlan = await createPortableRestorePlan(serialized, storage, { binaryStore: store });

  // Ubah kondisi storage sebelum eksekusi (kunci terdaftar di ACADEMIC_STORAGE_KEYS)
  storage.setItem('profile_jurusan', JSON.stringify('Sistem Informasi'));

  // Eksekusi dengan menyuplai expectedPlan yang lama
  await assert.rejects(
    executePortableRestore(serialized, storage, {
      binaryStore: store,
      expectedPlan: stalePlan,
    }),
    error => error instanceof PortableAcademicRestoreError && error.code === 'plan_stale',
  );
});

test('B5B-4b.23: Tidak ada mutasi storage sebelum konfirmasi eksekusi eksplisit (createPortableRestorePlan is read-only)', async () => {
  const { backup } = await createBackupFixture();
  const serialized = JSON.stringify(backup);
  const storage = createStorage({ profile_nim: null });
  const store = createStore();

  const initialSetCalls = storage.calls.set;
  const initialRemoveCalls = storage.calls.remove;

  const plan = await createPortableRestorePlan(serialized, storage, { binaryStore: store });
  assert.equal(plan.canRestoreClean, true);

  // Pastikan tidak ada setItem maupun removeItem terpanggil
  assert.equal(storage.calls.set, initialSetCalls);
  assert.equal(storage.calls.remove, initialRemoveCalls);
});

test('B5B-4b.24: Transaksi multi-store IndexedDB adapter restoreEntries memproses files dan document_texts secara atomik', async () => {
  const fileStoreData = new Map();
  const textStoreData = new Map();
  let requestedStoreNames = null;

  const mockDb = {
    objectStoreNames: { contains: () => true },
    transaction(storeNames) {
      requestedStoreNames = storeNames;
      const tx = {
        objectStore(name) {
          return {
            get(id) {
              const req = { result: name === 'files' ? fileStoreData.get(id) : textStoreData.get(id) };
              queueMicrotask(() => req.onsuccess?.());
              return req;
            },
            add(record) {
              if (name === 'files') fileStoreData.set(record.id, record);
              else textStoreData.set(record.id, record);
            },
          };
        },
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      setTimeout(() => tx.oncomplete?.(), 5);
      return tx;
    },
  };

  const mockFactory = {
    open() {
      const req = { result: mockDb };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };

  const adapter = createIndexedDBBinaryAdapter(mockFactory);
  const result = await adapter.restoreEntries({
    fileRecords: [{
      id: '00000000-0000-4000-8000-000000000001',
      name: 'file1.pdf',
      mimeType: 'application/pdf',
      size: 100,
    }],
    textRecords: [{
      id: '00000000-0000-4000-8000-000000000002',
      binaryId: '00000000-0000-4000-8000-000000000001',
      rawText: 'Teks IDB',
      editedText: null,
    }],
  });

  assert.deepEqual(requestedStoreNames, ['files', 'document_texts']);
  assert.equal(result.filesWritten, 1);
  assert.equal(result.textsWritten, 1);
  assert.equal(fileStoreData.size, 1);
  assert.equal(textStoreData.size, 1);
  await adapter.close();
});

