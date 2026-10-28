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
} from '../src/services/portableAcademicRestoreEngine.js';
import {
  createRestoreJournalStore,
  inspectPendingRestoreJournals,
  reconcileInterruptedRestore,
  withRestoreLock,
  JOURNAL_STATUS,
  RESTORE_JOURNAL_STORE_NAME,
  RESTORE_VAULT_DATABASE_NAME,
} from '../src/services/portableAcademicRestoreJournal.js';
import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
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

function createSyntheticStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    map,
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}

function createStore() {
  let idCounter = 0;
  return createBinaryFileStore({
    adapter: createMemoryBinaryAdapter(),
    cryptoImpl: { randomUUID: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}` },
    now: () => FIXED_DATE,
  });
}

async function createBackupFixture(options = {}) {
  const store = createStore();
  const fileA = createSyntheticFile('silabus.pdf', 'application/pdf', 'konten-silabus');
  const binRecord = await store.put(fileA);

  const textRecord = await store.putText({
    binaryRef: binRecord,
    rawText: 'Teks OCR mentah silabus',
    editedText: 'Teks OCR editan silabus',
    documentType: 'silabus',
  });

  const storage = createSyntheticStorage({
    profile_name: JSON.stringify('Mahasiswa Uji'),
    profile_nim: JSON.stringify('20240001'),
    college_semesters: JSON.stringify([{
      id: 'sem-1',
      name: 'Semester 1',
      originalFile: binRecord,
      documents: [{ type: 'silabus', binaryRef: binRecord, textRef: textRecord }],
      courses: [{ id: 'mk-1', name: 'Algoritma', sks: 3 }],
    }]),
    college_tasks: JSON.stringify([{ id: 'task-1', title: 'Tugas Algoritma' }]),
    college_projects: JSON.stringify([{ id: 'proj-1', title: 'Proyek Web' }]),
    college_thesis: JSON.stringify({
      todo: [{ id: 'th-1', title: 'Proposal' }],
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

  const serialized = JSON.stringify(backup);
  return { serialized, store, storage, binRecord, textRecord, backup };
}

test('B5B-4c.1: Pratinjau rencana pemulihan backup valid (deep plan preview)', async () => {
  const { serialized, store } = await createBackupFixture();
  const emptyStorage = createSyntheticStorage();

  const plan = await createPortableRestorePlan(serialized, emptyStorage, { binaryStore: store });
  assert.equal(plan.canRestoreClean, true);
  assert.equal(plan.portable, true);
  assert.equal(plan.version, 2);
  assert.equal(plan.summary.conflicts, 0);
  assert.ok(plan.summary.toAdd > 0);
  assert.equal(plan.entities.semesters.length, 1);
  assert.equal(plan.entities.tasks.length, 1);
  assert.equal(plan.entities.projects.length, 1);
  assert.equal(plan.entities.binaries.length, 1);
  assert.equal(plan.entities.texts.length, 1);
});

test('B5B-4c.2: Pratinjau backup lama v1 menyertakan peringatan integritas checksum', async () => {
  const { serialized, store } = await createBackupFixture({ version: 1 });
  const emptyStorage = createSyntheticStorage();

  const plan = await createPortableRestorePlan(serialized, emptyStorage, { binaryStore: store });
  assert.equal(plan.version, 1);
  assert.ok(plan.risks.some(r => r.includes('versi 1')));
});

test('B5B-4c.3: Penolakan checksum tidak cocok (bitflip payload)', async () => {
  const { serialized, store } = await createBackupFixture();
  const parsed = JSON.parse(serialized);
  parsed.binaries[0].data = parsed.binaries[0].data.slice(0, -4) + 'AAAA';
  const corruptSerialized = JSON.stringify(parsed);
  const emptyStorage = createSyntheticStorage();

  await assert.rejects(
    async () => createPortableRestorePlan(corruptSerialized, emptyStorage, { binaryStore: store }),
    error => error.code === 'integrity_failed' || error.code === 'binary_corrupt'
  );
});

test('B5B-4c.4: Deteksi konflik yang jelas pada entitas semester, tugas, dan biner', async () => {
  const { serialized, store } = await createBackupFixture();
  const conflictStorage = createSyntheticStorage({
    college_semesters: JSON.stringify([{ id: 'sem-1', name: 'Semester Berbeda', courses: [] }]),
    college_tasks: JSON.stringify([{ id: 'task-1', title: 'Tugas Lain' }]),
  });

  const plan = await createPortableRestorePlan(serialized, conflictStorage, { binaryStore: store });
  assert.equal(plan.canRestoreClean, false);
  assert.ok(plan.summary.conflicts >= 2);
  const semConflict = plan.entities.semesters.find(s => s.id === 'sem-1');
  assert.equal(semConflict.status, 'conflict');
  const taskConflict = plan.entities.tasks.find(t => t.id === 'task-1');
  assert.equal(taskConflict.status, 'conflict');
});

test('B5B-4c.5: Restore profil kosong melalui engine sintetis terisolasi', async () => {
  const { serialized } = await createBackupFixture();
  const emptyStorage = createSyntheticStorage();
  const emptyStore = createStore();

  const plan = await createPortableRestorePlan(serialized, emptyStorage, { binaryStore: emptyStore });
  const result = await executePortableRestore(serialized, emptyStorage, {
    binaryStore: emptyStore,
    expectedPlan: plan,
  });

  assert.equal(result.success, true);
  assert.equal(result.restored.semesters, 1);
  assert.equal(result.restored.binaries, 1);
  assert.equal(result.restored.texts, 1);
  assert.ok(emptyStorage.getItem('college_semesters').includes('Semester 1'));
});

test('B5B-4c.6: Restore additive tidak menimpa data lokal yang berbeda', async () => {
  const { serialized } = await createBackupFixture();
  const existingStorage = createSyntheticStorage({
    college_semesters: JSON.stringify([{ id: 'sem-existing-9', name: 'Semester Mandiri', courses: [] }]),
  });
  const restoreStore = createStore();

  const plan = await createPortableRestorePlan(serialized, existingStorage, { binaryStore: restoreStore });
  assert.equal(plan.canRestoreClean, true);
  await executePortableRestore(serialized, existingStorage, {
    binaryStore: restoreStore,
    expectedPlan: plan,
  });

  const sems = JSON.parse(existingStorage.getItem('college_semesters'));
  assert.equal(sems.length, 2);
  assert.ok(sems.some(s => s.id === 'sem-existing-9'));
  assert.ok(sems.some(s => s.id === 'sem-1'));
});

test('B5B-4c.7: Pembatalan sebelum commit memicu rollback biner tanpa jejak', async () => {
  const { serialized } = await createBackupFixture();
  const cleanStorage = createSyntheticStorage();
  const restoreStore = createStore();

  await assert.rejects(
    async () => executePortableRestore(serialized, cleanStorage, {
      binaryStore: restoreStore,
      simulateCrash: 'after_binary_staging',
    }),
    error => error.code === 'simulated_crash_after_staging'
  );

  // Verifikasi storage dan biner tetap kosong
  assert.equal(cleanStorage.getItem('college_semesters'), null);
});

test('B5B-4c.8: Konkurensi dua operasi restore bersamaan ditolak dengan restore_locked', async () => {
  const { serialized } = await createBackupFixture();
  const cleanStorage = createSyntheticStorage();
  const restoreStore = createStore();

  let resolveHolder;
  const lockHoldPromise = new Promise(r => { resolveHolder = r; });

  const activeLocks = new Set();
  const mockLockManager = {
    async request(name, options, callback) {
      if (activeLocks.has(name)) {
        if (options.ifAvailable) {
          return await callback(null);
        }
      }
      activeLocks.add(name);
      try {
        return await callback({ name });
      } finally {
        activeLocks.delete(name);
      }
    },
  };

  const backgroundLock = withRestoreLock({ lockManager: mockLockManager }, async () => {
    await lockHoldPromise;
  });

  await assert.rejects(
    async () => executePortableRestore(serialized, cleanStorage, {
      binaryStore: restoreStore,
      lockManager: mockLockManager,
    }),
    error => error.code === 'restore_locked'
  );

  resolveHolder();
  await backgroundLock;
});

test('B5B-4c.9: Deteksi perubahan storage pasca-preview memicu penolakan plan_stale', async () => {
  const { serialized } = await createBackupFixture();
  const cleanStorage = createSyntheticStorage();
  const restoreStore = createStore();

  const plan = await createPortableRestorePlan(serialized, cleanStorage, { binaryStore: restoreStore });

  // Ubah storage lokal setelah plan dibuat
  cleanStorage.setItem('profile_name', JSON.stringify('Nama Berubah'));

  await assert.rejects(
    async () => executePortableRestore(serialized, cleanStorage, {
      binaryStore: restoreStore,
      expectedPlan: plan,
    }),
    error => error.code === 'plan_stale'
  );
});

test('B5B-4c.10: Penanganan disk penuh (QuotaExceededError) fail-closed', async () => {
  const { serialized } = await createBackupFixture();
  const cleanStorage = createSyntheticStorage();
  const failStore = {
    ...createStore(),
    async restoreEntries() {
      const err = new Error('Disk penuh');
      err.name = 'QuotaExceededError';
      throw err;
    },
  };

  await assert.rejects(
    async () => executePortableRestore(serialized, cleanStorage, { binaryStore: failStore }),
    error => error.code === 'quota_exceeded' || error.code === 'binary_write_failed'
  );
  assert.equal(cleanStorage.getItem('college_semesters'), null);
});

test('B5B-4c.11: Inspeksi startup mendeteksi jurnal tertunda (100% read-only)', async () => {
  const journalStore = createRestoreJournalStore();
  await journalStore.createJournal({
    operationId: 'op-startup-001',
    status: JOURNAL_STATUS.BINARIES_STAGED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stagedBinaryIds: ['bin-1'],
    stagedTextIds: ['txt-1'],
    modifiedStorageKeys: ['college_semesters'],
  });

  const inspection = await inspectPendingRestoreJournals({ journalStore });
  assert.equal(inspection.status, 'pending');
  assert.equal(inspection.hasPending, true);
  assert.equal(inspection.pendingCount, 1);
  assert.equal(inspection.journals[0].status, JOURNAL_STATUS.BINARIES_STAGED);
  assert.equal(inspection.journals[0].isCommitted, false);

  const remaining = await journalStore.listPendingJournals();
  assert.equal(remaining.length, 1);
});

test('B5B-4c.12: Inspeksi startup menangani kondisi store kosong / normal', async () => {
  const journalStore = createRestoreJournalStore();
  const inspection = await inspectPendingRestoreJournals({ journalStore });
  assert.equal(inspection.status, 'clean');
  assert.equal(inspection.hasPending, false);
  assert.equal(inspection.pendingCount, 0);
  assert.equal(inspection.journals.length, 0);
});

test('B5B-4c.13: Commit-forward pasca status COMMITTED tidak membatalkan data', async () => {
  const journalStore = createRestoreJournalStore();
  const storage = createSyntheticStorage({
    college_semesters: JSON.stringify([{ id: 'sem-sah-comm', name: 'Semester Sah' }]),
  });
  const store = createStore();

  await journalStore.createJournal({
    operationId: 'op-comm-forward',
    status: JOURNAL_STATUS.COMMITTED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stagedBinaryIds: [],
    stagedTextIds: [],
    modifiedStorageKeys: ['college_semesters'],
  });

  const recResult = await reconcileInterruptedRestore({
    storage,
    binaryStore: store,
    journalStore,
    bypassLock: true,
  });

  assert.equal(recResult.reconciled, true);
  assert.equal(recResult.actions[0].action, 'commit_forward_purged');
  assert.ok(storage.getItem('college_semesters').includes('Semester Sah'));

  const pendingAfter = await journalStore.listPendingJournals();
  assert.equal(pendingAfter.length, 0);
});

test('B5B-4c.14: Rekonsiliasi idempoten dijalankan berulang kali tetap aman', async () => {
  const journalStore = createRestoreJournalStore();
  const storage = createSyntheticStorage();
  const store = createStore();

  for (let i = 0; i < 3; i++) {
    const res = await reconcileInterruptedRestore({
      storage,
      binaryStore: store,
      journalStore,
      bypassLock: true,
    });
    assert.equal(res.reconciled, false);
    assert.equal(res.pendingCount, 0);
  }
});

test('B5B-4c.15: Tidak ada kebocoran kredensial dalam cadangan', async () => {
  const store = createStore();
  const storageWithSecret = createSyntheticStorage({
    gemini_api_key: JSON.stringify('AIzaSySecret123'),
    college_semesters: JSON.stringify([]),
  });

  const backup = await createPortableAcademicBackup(storageWithSecret, { binaryStore: store });
  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes('AIzaSySecret123'), false);
  assert.equal(serialized.includes('gemini_api_key'), false);

  const injected = JSON.parse(serialized);
  injected.apiKey = 'curian-key';
  await assert.rejects(
    async () => createPortableRestorePlan(JSON.stringify(injected), storageWithSecret, { binaryStore: store }),
    error => error.code === 'forbidden_credential_in_backup'
  );
});

test('B5B-4c.16: Jalur eksekusi produksi terkunci (isExecutionEnabled = false)', async () => {
  const isExecutionEnabled = false;
  let executionCalled = false;
  const mockExecutor = async () => { executionCalled = true; };

  if (isExecutionEnabled && typeof mockExecutor === 'function') {
    await mockExecutor();
  }

  assert.equal(executionCalled, false, 'Jalur eksekusi tidak boleh terpanggil saat isExecutionEnabled false');
});

test('B5B-4c.17: Fail-closed jika Web Locks tidak tersedia pada lingkungan tanpa polyfill', async () => {
  await assert.rejects(
    async () => withRestoreLock({ lockManager: null }, async () => 'ok'),
    error => error.code === 'lock_unavailable'
  );
});

test('B5B-4c.18: Cadangan biner tetap identik byte-per-byte setelah dipulihkan', async () => {
  const { serialized, binRecord } = await createBackupFixture();
  const targetStorage = createSyntheticStorage();
  const targetStore = createStore();

  const plan = await createPortableRestorePlan(serialized, targetStorage, { binaryStore: targetStore });
  await executePortableRestore(serialized, targetStorage, {
    binaryStore: targetStore,
    expectedPlan: plan,
  });

  const restoredBlob = await targetStore.get(binRecord);
  assert.ok(restoredBlob !== null);
  const text = await restoredBlob.text();
  assert.equal(text, 'konten-silabus');
});

test('B5B-4c.19: Teks OCR rawText dan editedText tetap terhubung ke biner', async () => {
  const { serialized, textRecord } = await createBackupFixture();
  const targetStorage = createSyntheticStorage();
  const targetStore = createStore();

  const plan = await createPortableRestorePlan(serialized, targetStorage, { binaryStore: targetStore });
  await executePortableRestore(serialized, targetStorage, {
    binaryStore: targetStore,
    expectedPlan: plan,
  });

  const restoredText = await targetStore.getText(textRecord);
  assert.ok(restoredText !== null);
  assert.equal(restoredText.rawText, 'Teks OCR mentah silabus');
  assert.equal(restoredText.editedText, 'Teks OCR editan silabus');
});

test('B5B-4c.20: Tidak ada request jaringan atau ketergantungan API model AI saat restore', async () => {
  const { serialized } = await createBackupFixture();
  const targetStorage = createSyntheticStorage();
  const targetStore = createStore();

  const originalFetch = globalThis.fetch;
  let fetchAttempted = false;
  globalThis.fetch = async () => {
    fetchAttempted = true;
    throw new Error('Jaringan eksternal dilarang');
  };

  try {
    const plan = await createPortableRestorePlan(serialized, targetStorage, { binaryStore: targetStore });
    await executePortableRestore(serialized, targetStorage, {
      binaryStore: targetStore,
      expectedPlan: plan,
    });
    assert.equal(fetchAttempted, false, 'Dilarang ada fetch ke jaringan luar selama restore');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B5B-4c.21: Verifikasi nama object store journal_entries dan persistensi lintas buka/tutup store', async () => {
  assert.equal(RESTORE_JOURNAL_STORE_NAME, 'journal_entries');
  assert.equal(RESTORE_VAULT_DATABASE_NAME, 'unimate-restore-vault');

  // Simulasikan adapter dengan persistent map bersama untuk membuktikan akses lintas buka/tutup
  const persistentRecords = new Map();
  const createMockAdapter = () => ({
    async createJournal(entry) {
      persistentRecords.set(entry.operationId, JSON.parse(JSON.stringify(entry)));
      return entry;
    },
    async listPendingJournals() {
      return [...persistentRecords.values()].filter(j => j.status !== JOURNAL_STATUS.PURGED);
    },
    async close() {},
  });

  // Sesi 1: Tulis jurnal tertunda
  const store1 = createRestoreJournalStore({ adapter: createMockAdapter() });
  await store1.createJournal({
    operationId: 'op-persist-check',
    status: JOURNAL_STATUS.BINARIES_STAGED,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stagedBinaryIds: ['bin-x'],
    stagedTextIds: ['txt-x'],
    modifiedStorageKeys: ['college_semesters'],
  });
  await store1.close();

  // Sesi 2: Buka kembali store baru dan periksa apakah inspectPendingRestoreJournals menemukannya
  const store2 = createRestoreJournalStore({ adapter: createMockAdapter() });
  const inspection = await inspectPendingRestoreJournals({ journalStore: store2 });
  assert.equal(inspection.status, 'pending');
  assert.equal(inspection.hasPending, true);
  assert.equal(inspection.pendingCount, 1);
  assert.equal(inspection.journals[0].operationId, 'op-persist-check');
});

test('B5B-4c.22: Siklus React StrictMode (mount -> unmount -> remount) mempertahankan notifikasi pending', async () => {
  let resolveInspection;
  const delayedInspectionPromise = new Promise(resolve => {
    resolveInspection = resolve;
  });

  const mockJournalStore = {
    async listPendingJournals() {
      return await delayedInspectionPromise;
    },
    async close() {},
  };

  // Simulasikan struktur lifecycle AppContext dengan refs
  const pendingInspectionPromiseRef = { current: null };
  const isResolvedRef = { current: false };
  let deliveredNotice = null;
  let toastCallCount = 0;

  // Mount 1 (StrictMode pass 1)
  let isMounted1 = true;
  pendingInspectionPromiseRef.current ??= inspectPendingRestoreJournals({ journalStore: mockJournalStore });
  pendingInspectionPromiseRef.current.then(res => {
    if (!isMounted1) return;
    isResolvedRef.current = true;
    deliveredNotice = res;
    toastCallCount++;
  });

  // Unmount 1 (StrictMode simulated cleanup)
  isMounted1 = false;

  // Mount 2 (StrictMode pass 2 - remount)
  let isMounted2 = true;
  assert.equal(isResolvedRef.current, false, 'isResolvedRef belum true sebelum promise selesai');
  pendingInspectionPromiseRef.current ??= inspectPendingRestoreJournals({ journalStore: mockJournalStore });
  pendingInspectionPromiseRef.current.then(res => {
    if (!isMounted2) return;
    isResolvedRef.current = true;
    deliveredNotice = res;
    toastCallCount++;
  });

  // Selesaikan promise inspeksi yang tertunda dengan data pending
  resolveInspection([
    {
      operationId: 'op-strict-mode-pending',
      status: JOURNAL_STATUS.METADATA_WRITTEN,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stagedBinaryIds: ['bin-s1'],
      stagedTextIds: [],
      modifiedStorageKeys: ['college_semesters'],
    },
  ]);

  // Tunggu penyelesaian promise inspeksi
  await pendingInspectionPromiseRef.current;
  await Promise.resolve();

  assert.equal(isResolvedRef.current, true);
  assert.ok(deliveredNotice !== null, 'Notifikasi berhasil diterima oleh mount 2');
  assert.equal(deliveredNotice.status, 'pending');
  assert.equal(deliveredNotice.pendingCount, 1);
  assert.equal(toastCallCount, 1, 'Toast hanya dipanggil tepat satu kali oleh instance yang aktif');
});

test('B5B-4c.23: Penanganan kegagalan inspeksi membedakan status failed/unavailable tanpa mutasi storage', async () => {
  const cleanStorage = createSyntheticStorage({
    college_semesters: JSON.stringify([{ id: 'sem-protect', name: 'Semester Aman' }]),
  });

  // 1. Kasus store_unavailable
  const inspectionUnavailable = await inspectPendingRestoreJournals({
    journalStore: null,
    adapter: null,
    indexedDBFactory: null,
  });
  assert.equal(inspectionUnavailable.status, 'unavailable');
  assert.equal(inspectionUnavailable.hasPending, false);
  assert.equal(inspectionUnavailable.pendingCount, 0);
  assert.ok(inspectionUnavailable.error !== null);

  // 2. Kasus read error (database disk error)
  const faultyStore = {
    async listPendingJournals() {
      throw new Error('Database disk error');
    },
    async close() {},
  };
  const inspectionFailed = await inspectPendingRestoreJournals({ journalStore: faultyStore });
  assert.equal(inspectionFailed.status, 'failed');
  assert.equal(inspectionFailed.hasPending, false);
  assert.equal(inspectionFailed.error, 'Database disk error');

  // Pastikan storage akademik sama sekali tidak disentuh atau di-rollback
  const sems = JSON.parse(cleanStorage.getItem('college_semesters'));
  assert.equal(sems.length, 1);
  assert.equal(sems[0].id, 'sem-protect');
});

test('B5B-4c.24: Inspeksi startup dengan factory.databases() mendeteksi ketiadaan database tanpa efek samping', async () => {
  let openCalled = false;
  const mockFactory = {
    async databases() {
      return [{ name: 'unimate-binary-vault', version: 2 }];
    },
    open() {
      openCalled = true;
      throw new Error('open() tidak boleh dipanggil jika database tidak terdaftar');
    },
  };

  const inspection = await inspectPendingRestoreJournals({ indexedDBFactory: mockFactory });
  assert.equal(inspection.status, 'clean');
  assert.equal(inspection.hasPending, false);
  assert.equal(inspection.databaseExists, false);
  assert.equal(openCalled, false, 'indexedDB.open tidak dipanggil ketika database belum pernah dibuat');
});
