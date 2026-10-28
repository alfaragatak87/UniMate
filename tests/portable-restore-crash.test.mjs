import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  JOURNAL_STATUS,
  RestoreJournalError,
  RESTORE_VAULT_DATABASE_NAME,
  RESTORE_VAULT_DATABASE_VERSION,
  RESTORE_JOURNAL_STORE_NAME,
  RESTORE_LOCK_NAME,
  createMemoryJournalAdapter,
  createRestoreJournalStore,
  takeStorageSnapshot,
  withRestoreLock,
  reconcileInterruptedRestore,
} from '../src/services/portableAcademicRestoreJournal.js';

import {
  executePortableRestore,
  rollbackRestoreJournal,
  PortableAcademicRestoreError,
} from '../src/services/portableAcademicRestoreEngine.js';

import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
} from '../src/services/binaryFileStore.js';

import {
  createPortableAcademicBackup,
} from '../src/services/portableAcademicBackup.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(repositoryRoot, 'tests', 'fixtures', 'electronIndexedDBHarness.cjs');
const nodeModulesPath = path.join(repositoryRoot, 'node_modules');
const electronTestLockPath = path.join(nodeModulesPath, '.unimate-electron-test.lock');

const FIXED_DATE = 1_800_000_000_000;

function createStorage(initialData = {}) {
  const values = new Map();
  for (const [k, v] of Object.entries(initialData)) {
    if (v !== null && v !== undefined) {
      values.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, val) => values.set(key, String(val)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values.entries()),
  };
}

function createStore() {
  let id = 0;
  return createBinaryFileStore({
    adapter: createMemoryBinaryAdapter(),
    cryptoImpl: { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` },
    now: () => FIXED_DATE,
  });
}

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

async function createBackupFixture() {
  const store = createStore();
  const fileA = createSyntheticFile('file-a.pdf', 'application/pdf', 'konten-file-a');
  const binaryRefA = await store.put(fileA);
  const textRefA = await store.putText({
    binaryRef: binaryRefA,
    rawText: 'Teks Dokumen A',
    editedText: null,
    documentType: 'KHS',
  });

  const storage = createStorage({
    profile_name: JSON.stringify('Mahasiswa Uji'),
    profile_nim: JSON.stringify('20240099'),
    college_semesters: JSON.stringify([
      {
        id: 'sem-1',
        name: 'Semester 1',
        documents: [{ type: 'KHS', binaryRef: binaryRefA, textRef: textRefA }],
      },
    ]),
    college_tasks: JSON.stringify([
      { id: 'task-1', title: 'Tugas Uji', status: 'todo' },
    ]),
  });

  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date(FIXED_DATE),
  });

  return { store, storage, backup, binaryRefA, textRefA };
}

async function acquireElectronTestLock() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(electronTestLockPath);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(electronTestLockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('electron_test_lock_timeout');
}

// ============================================================================
// 1. UNIT & CONTRACT TESTS: RECOVERY JOURNAL & WEB LOCKS
// ============================================================================

test('B5B-4b.3-U1: Kontrak konstanta database recovery unimate-restore-vault', () => {
  assert.equal(RESTORE_VAULT_DATABASE_NAME, 'unimate-restore-vault');
  assert.equal(RESTORE_VAULT_DATABASE_VERSION, 1);
  assert.equal(RESTORE_JOURNAL_STORE_NAME, 'journal_entries');
  assert.equal(RESTORE_LOCK_NAME, 'unimate_academic_restore_lock');
});

test('B5B-4b.3-U2: Snapshot storage mendalam membedakan null, empty string, valid JSON, dan string biasa', () => {
  const storage = createStorage({
    profile_name: 'Mahasiswa',
    college_semesters: [{ id: 's1' }],
    empty_key: '',
  });

  const snapshot = takeStorageSnapshot(storage, ['profile_name', 'college_semesters', 'empty_key', 'missing_key']);
  assert.equal(snapshot.profile_name.exists, true);
  assert.equal(snapshot.profile_name.isValidJson, false); // string tanpa kutip JSON
  assert.equal(snapshot.college_semesters.exists, true);
  assert.equal(snapshot.college_semesters.isValidJson, true);
  assert.equal(Array.isArray(snapshot.college_semesters.parsedValue), true);
  assert.equal(snapshot.empty_key.exists, true);
  assert.equal(snapshot.empty_key.isEmptyString, true);
  assert.equal(snapshot.missing_key.exists, false);
  assert.equal(snapshot.missing_key.rawValue, null);
});

test('B5B-4b.3-U3: CRUD store jurnal memory adapter', async () => {
  const store = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });
  const entry = {
    operationId: 'op-001',
    status: JOURNAL_STATUS.INITIALIZED,
    createdAt: Date.now(),
  };

  await store.createJournal(entry);
  const fetched = await store.getJournal('op-001');
  assert.equal(fetched.operationId, 'op-001');
  assert.equal(fetched.status, JOURNAL_STATUS.INITIALIZED);

  await store.updateJournal('op-001', { status: JOURNAL_STATUS.BINARIES_STAGED });
  const updated = await store.getJournal('op-001');
  assert.equal(updated.status, JOURNAL_STATUS.BINARIES_STAGED);

  const pendingList = await store.listPendingJournals();
  assert.equal(pendingList.length, 1);

  await store.purgeJournal('op-001');
  const purgedList = await store.listPendingJournals();
  assert.equal(purgedList.length, 0);
});

test('B5B-4b.3-U4: Web Locks API fail-closed jika lockManager tidak tersedia', async () => {
  await assert.rejects(
    async () => {
      await withRestoreLock({ lockManager: null }, async () => {
        return 'success';
      });
    },
    error => error instanceof RestoreJournalError && error.code === 'lock_unavailable'
  );
});

test('B5B-4b.3-U5: Web Locks API menolak operasi konkuren dengan restore_locked', async () => {
  let isInnerLockHeld = false;
  let contentionBlocked = false;

  await withRestoreLock({}, async () => {
    isInnerLockHeld = true;
    try {
      // Panggilan kedua saat lock dipegang
      await withRestoreLock({}, async () => {});
    } catch (err) {
      if (err instanceof RestoreJournalError && err.code === 'restore_locked') {
        contentionBlocked = true;
      }
    }
  });

  assert.equal(isInnerLockHeld, true);
  assert.equal(contentionBlocked, true);
});

// ============================================================================
// 2. CRASH STATE MACHINE & RECONCILIATION SCENARIOS
// ============================================================================

test('B5B-4b.3-S1: Rekonsiliasi jurnal INITIALIZED / TARGETS_REGISTERED membersihkan residu tanpa merusak data', async () => {
  const storage = createStorage({ profile_nim: JSON.stringify('20240001') });
  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  await journalStore.createJournal({
    operationId: 'op-s1',
    status: JOURNAL_STATUS.INITIALIZED,
    createdAt: Date.now(),
    existingBinaryIds: [],
    stagedBinaryIds: [],
  });

  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.actions[0].action, 'clean_aborted_restore');
  const pending = await journalStore.listPendingJournals();
  assert.equal(pending.length, 0);
  assert.equal(JSON.parse(storage.getItem('profile_nim')), '20240001');
});

test('B5B-4b.3-S2: Rekonsiliasi crash setelah staging biner (BINARIES_STAGED) menghapus file baru dan melindungi file historis', async () => {
  const storage = createStorage();
  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  // 1. Buat berkas historis yang sudah ada sebelum restore
  const histFile = createSyntheticFile('dokumen-historis.pdf', 'application/pdf', 'konten-historis');
  const histBinaryRef = await binaryStore.put(histFile);
  const histTextRef = await binaryStore.putText({
    binaryRef: histBinaryRef,
    rawText: 'Teks OCR Historis',
    editedText: null,
    documentType: 'KHS',
  });

  // 2. Tulis biner dan teks baru yang distaging
  const stagedFile = createSyntheticFile('dokumen-staged.pdf', 'application/pdf', 'konten-staged');
  const stagedBinaryRef = await binaryStore.put(stagedFile);
  const stagedTextRef = await binaryStore.putText({
    binaryRef: stagedBinaryRef,
    rawText: 'Teks OCR Staged',
    editedText: null,
    documentType: 'KHS',
  });

  // 3. Catat jurnal seolah-olah proses crash di status BINARIES_STAGED
  await journalStore.createJournal({
    operationId: 'op-s2',
    status: JOURNAL_STATUS.BINARIES_STAGED,
    createdAt: Date.now(),
    existingBinaryIds: [histBinaryRef.id],
    existingTextIds: [histTextRef.id],
    stagedBinaryIds: [stagedBinaryRef.id],
    stagedTextIds: [stagedTextRef.id],
    stagedBinaryRefs: [stagedBinaryRef],
    stagedTextRefs: [stagedTextRef],
    previousStorageSnapshot: {},
    modifiedStorageKeys: [],
  });

  // Pastikan kedua file ada sebelum rekonsiliasi
  assert.notEqual(await binaryStore.get(histBinaryRef), null);
  assert.notEqual(await binaryStore.get(stagedBinaryRef), null);

  // 4. Jalankan rekonsiliasi
  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.actions[0].action, 'compensated_and_purged');

  // File historis WAJIB tetap ada!
  const histAfter = await binaryStore.get(histBinaryRef);
  assert.notEqual(histAfter, null);
  const histTextAfter = await binaryStore.getText(histTextRef);
  assert.notEqual(histTextAfter, null);

  // File staged WAJIB telah dihapus (get & getText melempar file_not_found)!
  await assert.rejects(
    async () => await binaryStore.get(stagedBinaryRef),
    err => err.code === 'file_not_found'
  );
  await assert.rejects(
    async () => await binaryStore.getText(stagedTextRef),
    err => err.code === 'file_not_found'
  );

  // Jurnal sudah dibersihkan
  assert.equal((await journalStore.listPendingJournals()).length, 0);
});

test('B5B-4b.3-S3: Rekonsiliasi crash saat metadata ditulis (METADATA_WRITTEN) mengembalikan storage ke snapshot awal', async () => {
  const initialStorageData = {
    profile_name: JSON.stringify('Nama Lama'),
    college_semesters: JSON.stringify([{ id: 'sem-old', name: 'Semester Lama' }]),
  };
  const storage = createStorage(initialStorageData);
  const snapshot = takeStorageSnapshot(storage);

  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  // Ubah storage seolah-olah restore sempat menulis sebagian
  storage.setItem('profile_name', JSON.stringify('Nama Dari Restore'));
  storage.setItem('college_semesters', JSON.stringify([{ id: 'sem-old' }, { id: 'sem-new' }]));

  await journalStore.createJournal({
    operationId: 'op-s3',
    status: JOURNAL_STATUS.METADATA_WRITTEN,
    createdAt: Date.now(),
    existingBinaryIds: [],
    existingTextIds: [],
    stagedBinaryIds: [],
    stagedTextIds: [],
    previousStorageSnapshot: snapshot,
    modifiedStorageKeys: ['profile_name', 'college_semesters'],
    writtenStorageKeys: {
      profile_name: JSON.stringify('Nama Dari Restore'),
      college_semesters: JSON.stringify([{ id: 'sem-old' }, { id: 'sem-new' }]),
    },
  });

  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  assert.equal(JSON.parse(storage.getItem('profile_name')), 'Nama Lama');
  const semestersAfter = JSON.parse(storage.getItem('college_semesters'));
  assert.equal(semestersAfter.length, 1);
  assert.equal(semestersAfter[0].id, 'sem-old');
});

test('B5B-4b.3-S4: Crash setelah status COMMITTED tidak membatalkan data sah (Commit-Forward)', async () => {
  const storage = createStorage({
    college_semesters: JSON.stringify([{ id: 'sem-sah-committed' }]),
  });
  const binaryStore = createStore();
  const commFile = createSyntheticFile('sah.pdf', 'application/pdf', 'konten-sah');
  const commRef = await binaryStore.put(commFile);

  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });
  await journalStore.createJournal({
    operationId: 'op-s4',
    status: JOURNAL_STATUS.COMMITTED,
    createdAt: Date.now(),
    stagedBinaryIds: [commRef.id],
    previousStorageSnapshot: {
      college_semesters: { exists: false, rawValue: null },
    },
  });

  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.actions[0].action, 'commit_forward_purged');
  assert.equal(result.actions[0].preserved, true);

  // Data sah TIDAK BOLEH di-rollback!
  const fileStillThere = await binaryStore.get(commRef);
  assert.notEqual(fileStillThere, null);
  assert.equal(JSON.parse(storage.getItem('college_semesters'))[0].id, 'sem-sah-committed');
  assert.equal((await journalStore.listPendingJournals()).length, 0);
});

test('B5B-4b.3-S5: Rekonsiliasi mendeteksi modifikasi independen di tab lain dan tidak menghapus perubahan pengguna', async () => {
  const initialData = {
    college_tasks: JSON.stringify([{ id: 't1', title: 'Tugas 1' }]),
  };
  const storage = createStorage(initialData);
  const snapshot = takeStorageSnapshot(storage);

  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  // Restore menambahkan t2:
  const writtenTasks = JSON.stringify([{ id: 't1', title: 'Tugas 1' }, { id: 't2', title: 'Tugas 2' }]);

  // Tetapi sebelum rekonsiliasi, pengguna di tab lain menambahkan t3 secara sah!
  const userCurrentTasks = JSON.stringify([
    { id: 't1', title: 'Tugas 1' },
    { id: 't2', title: 'Tugas 2' },
    { id: 't3', title: 'Tugas 3 Pengguna Independen' },
  ]);
  storage.setItem('college_tasks', userCurrentTasks);

  await journalStore.createJournal({
    operationId: 'op-s5',
    status: JOURNAL_STATUS.METADATA_WRITTEN,
    createdAt: Date.now(),
    existingBinaryIds: [],
    existingTextIds: [],
    stagedBinaryIds: [],
    stagedTextIds: [],
    previousStorageSnapshot: snapshot,
    modifiedStorageKeys: ['college_tasks'],
    writtenStorageKeys: {
      college_tasks: writtenTasks,
    },
    plannedEntityIds: {
      college_tasks: ['t2'], // Hanya t2 yang berasal dari restore!
    },
  });

  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  const tasksAfter = JSON.parse(storage.getItem('college_tasks'));

  // t2 harus dihapus, tetapi t1 dan t3 (milik pengguna independen) HARUS TETAP ADA!
  const ids = tasksAfter.map(t => t.id);
  assert.equal(ids.includes('t1'), true);
  assert.equal(ids.includes('t3'), true);
  assert.equal(ids.includes('t2'), false);
});

test('B5B-4b.3-S6: Rekonsiliasi idempoten: dijalankan 5x berturut-turut menghasilkan state bersih tanpa error', async () => {
  const storage = createStorage({ profile_nim: JSON.stringify('20240001') });
  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  await journalStore.createJournal({
    operationId: 'op-s6',
    status: JOURNAL_STATUS.INITIALIZED,
    createdAt: Date.now(),
  });

  for (let i = 0; i < 5; i++) {
    const result = await reconcileInterruptedRestore({
      storage,
      binaryStore,
      journalStore,
    });
    if (i === 0) {
      assert.equal(result.reconciled, true);
      assert.equal(result.pendingCount, 1);
    } else {
      assert.equal(result.reconciled, false);
      assert.equal(result.pendingCount, 0);
    }
  }
});

test('B5B-4b.3-S7: Jurnal berstatus tidak dikenal dikarantina dan data tidak dihapus spekulatif', async () => {
  const storage = createStorage({ data_penting: JSON.stringify('aman') });
  const binaryStore = createStore();
  const journalStore = createRestoreJournalStore({ adapter: createMemoryJournalAdapter() });

  await journalStore.createJournal({
    operationId: 'op-corrupt',
    status: 'UNKNOWN_CORRUPT_STATUS',
    createdAt: Date.now(),
  });

  const result = await reconcileInterruptedRestore({
    storage,
    binaryStore,
    journalStore,
  });

  assert.equal(result.reconciled, true);
  assert.equal(result.actions[0].action, 'quarantined');

  const journalAfter = await journalStore.getJournal('op-corrupt');
  assert.equal(journalAfter.status, JOURNAL_STATUS.QUARANTINED);
  assert.equal(journalAfter.diagnostic.reason, 'unrecognized_or_corrupted_journal_status');
  assert.equal(storage.getItem('data_penting'), JSON.stringify('aman'));
});

// ============================================================================
// 3. REAL SUBPROCESS CRASH TEST IN ISOLATED ELECTRON PROFILE
// ============================================================================

test('B5B-4b.3-R1: Crash subproses nyata Electron dan pemulihan rekonsiliasi lintas restart', { timeout: 180_000 }, async () => {
  await fs.access(electronExecutable);
  const releaseLock = await acquireElectronTestLock();

  let rootPath;
  let isolatedElectronExecutable;

  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-crash-'));
    isolatedElectronExecutable = path.join(
      path.dirname(electronExecutable),
      `.unimate-crash-${process.pid}-${path.basename(rootPath)}.exe`
    );
    await fs.link(electronExecutable, isolatedElectronExecutable);

    const paths = {
      profile: path.join(rootPath, 'profile'),
      results: path.join(rootPath, 'results'),
      staging: path.join(rootPath, 'staging'),
    };
    await Promise.all(Object.values(paths).map(directory => fs.mkdir(directory, { recursive: true })));
    await fs.copyFile(harnessPath, path.join(paths.staging, 'main.cjs'));
    await fs.writeFile(path.join(paths.staging, 'package.json'), JSON.stringify({
      name: 'unimate-crash-test',
      version: '1.0.0',
      private: true,
      main: 'main.cjs',
    }), 'utf8');

    const environment = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[name];
    }

    // A. Uji Web Locks API native di dalam Chromium/Electron
    const webLocksResultPath = path.join(paths.results, 'web_locks.json');
    const childLocks = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${webLocksResultPath}`,
      `--operation=test_web_locks_native`,
    ], { cwd: paths.staging, env: environment, stdio: 'ignore', windowsHide: true });

    await new Promise(res => childLocks.once('close', res));
    const webLocksContent = JSON.parse(await fs.readFile(webLocksResultPath, 'utf8'));
    assert.equal(webLocksContent.ok, true);
    assert.equal(webLocksContent.result.supported, true);
    assert.equal(webLocksContent.result.contentionBlocked, true);
    assert.equal(webLocksContent.result.releasePassed, true);

    // B. Subproses 1: Tulis data staging + jurnal persisten lalu diterminasi paksa oleh OS (taskkill)
    const crashResultPath = path.join(paths.results, 'crash_staging.json');
    const childCrash = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${crashResultPath}`,
      `--operation=setup_crash_staging`,
    ], { cwd: paths.staging, env: environment, stdio: 'ignore', windowsHide: true });

    // Tunggu sampai child proses menulis sentinel staged.ready (data tuntas tertulis di disk)
    const stagedReadyPath = path.join(rootPath, 'staged.ready');
    const startWait = Date.now();
    while (Date.now() - startWait < 15000) {
      try {
        await fs.access(stagedReadyPath);
        break;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    await fs.access(stagedReadyPath);

    // Terminasi paksa proses nyata level OS (taskkill di Windows, SIGKILL di POSIX)
    if (process.platform === 'win32' && Number.isInteger(childCrash.pid)) {
      const killer = spawn('taskkill.exe', ['/pid', String(childCrash.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise(res => killer.once('close', res));
    } else {
      childCrash.kill('SIGKILL');
    }
    await new Promise(res => childCrash.once('close', res));

    // C. Subproses 2: Buka KEMBALI profil yang sama persis dan jalankan rekonsiliasi
    const reconcileResultPath = path.join(paths.results, 'reconcile.json');
    const childReconcile = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${reconcileResultPath}`,
      `--operation=reconcile_and_verify_crash`,
    ], { cwd: paths.staging, env: environment, stdio: 'ignore', windowsHide: true });

    const reconcileExitCode = await new Promise(res => childReconcile.once('close', res));
    assert.equal(reconcileExitCode, 0, 'Subproses rekonsiliasi harus selesai dengan sukses (exit code 0)');

    const reconcileOutput = JSON.parse(await fs.readFile(reconcileResultPath, 'utf8'));
    assert.equal(reconcileOutput.ok, true);
    const recResult = reconcileOutput.result;
    assert.equal(recResult.foundPending, true, 'Jurnal pending harus terbaca dari unimate-restore-vault pasca-crash');
    assert.equal(recResult.historicPreserved, true, 'Berkas biner historis TIDAK BOLEH terhapus saat recovery');
    assert.equal(recResult.stagedCleaned, true, 'Berkas biner baru yang distaging harus bersih dibersihkan');
    assert.equal(recResult.journalPurged, true, 'Jurnal pemulihan harus bersih dihapus setelah rekonsiliasi');
    assert.equal(recResult.storageReverted, true, 'localStorage harus kembali ke kondisi sebelum crash');

    // D. Uji Kasus Crash Pasca-COMMITTED: Data sah tidak boleh dibatalkan
    const crashCommResultPath = path.join(paths.results, 'crash_comm.json');
    const childComm = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${crashCommResultPath}`,
      `--operation=setup_crash_committed`,
    ], { cwd: paths.staging, env: environment, stdio: 'ignore', windowsHide: true });

    const committedReadyPath = path.join(rootPath, 'committed.ready');
    const startWaitComm = Date.now();
    while (Date.now() - startWaitComm < 15000) {
      try {
        await fs.access(committedReadyPath);
        break;
      } catch {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    await fs.access(committedReadyPath);

    // Terminasi paksa proses nyata level OS
    if (process.platform === 'win32' && Number.isInteger(childComm.pid)) {
      const killer = spawn('taskkill.exe', ['/pid', String(childComm.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise(res => killer.once('close', res));
    } else {
      childComm.kill('SIGKILL');
    }
    await new Promise(res => childComm.once('close', res));

    // Buka kembali dan verifikasi commit-forward
    const recCommResultPath = path.join(paths.results, 'rec_comm.json');
    const childRecComm = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${recCommResultPath}`,
      `--operation=reconcile_committed`,
    ], { cwd: paths.staging, env: environment, stdio: 'ignore', windowsHide: true });

    await new Promise(res => childRecComm.once('close', res));
    const recCommOutput = JSON.parse(await fs.readFile(recCommResultPath, 'utf8'));
    assert.equal(recCommOutput.ok, true);
    assert.equal(recCommOutput.result.filePreserved, true, 'Berkas sah committed tidak boleh di-rollback');
    assert.equal(recCommOutput.result.storagePreserved, true, 'Metadata sah committed tidak boleh di-rollback');
    assert.equal(recCommOutput.result.journalPurged, true, 'Jurnal committed berhasil dibersihkan');
  } finally {
    if (isolatedElectronExecutable) {
      try { await fs.unlink(isolatedElectronExecutable); } catch {}
    }
    if (rootPath) {
      try { await fs.rm(rootPath, { recursive: true, force: true }); } catch {}
    }
    await releaseLock();
  }
});
