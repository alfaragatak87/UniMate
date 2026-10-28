const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

let stage = 'bootstrap';
let resultWritten = false;
let activeWindow = null;

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContained(parentPath, childPath) {
  const parent = normalize(parentPath);
  const child = normalize(childPath);
  if (child !== parent && !child.startsWith(`${parent}${path.sep}`)) throw new Error('path_outside_isolation');
}

function safeCode(error) {
  const value = typeof error?.message === 'string' ? error.message : '';
  return /^[a-z0-9_]+$/u.test(value) ? value : 'indexeddb_harness_failed';
}

async function writeResult(resultPath, result) {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  fsSync.writeFileSync(resultPath, JSON.stringify(result), 'utf8');
  resultWritten = true;
}

process.once('exit', exitCode => {
  if (resultWritten) return;
  const isolationRoot = readArgument('isolation-root');
  const resultPath = readArgument('result');
  if (!isolationRoot || !resultPath) return;
  try {
    assertContained(isolationRoot, resultPath);
    fsSync.mkdirSync(path.dirname(resultPath), { recursive: true });
    fsSync.writeFileSync(resultPath, JSON.stringify({
      ok: false,
      stage,
      code: exitCode === 0 ? 'premature_process_exit' : 'unreported_process_failure',
    }), 'utf8');
  } catch {}
});

function rendererOperation(operation) {
  return `(() => {
    const operation = ${JSON.stringify(operation)};
    const databaseName = 'unimate-binary-vault';
    const storeName = 'files';
    const textStoreName = 'document_texts';
    const primaryId = '00000000-0000-4000-8000-000000000081';
    const textPrimaryId = '00000000-0000-4000-8000-000000000083';
    const cancelledId = '00000000-0000-4000-8000-000000000082';
    const openDatabase = () => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('indexeddb_open_failed'));
      request.onblocked = () => reject(new Error('indexeddb_blocked'));
    });
    const openDatabaseV2 = () => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: 'id' });
        }
        if (!request.result.objectStoreNames.contains(textStoreName)) {
          const s = request.result.createObjectStore(textStoreName, { keyPath: 'id' });
          s.createIndex('by_binary_id', 'binaryId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('indexeddb_open_failed'));
      request.onblocked = () => reject(new Error('indexeddb_blocked'));
    });
    const readRecord = (database, id) => new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('indexeddb_read_failed'));
      transaction.onabort = () => reject(new Error('indexeddb_read_failed'));
    });
    const addRecord = (database, record) => new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).add(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('indexeddb_write_failed'));
      transaction.onabort = () => reject(new Error('indexeddb_write_failed'));
    });
    const abortWrite = (database, record) => new Promise(resolve => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.onabort = () => resolve(true);
      transaction.oncomplete = () => resolve(false);
      transaction.objectStore(storeName).put(record);
      transaction.abort();
    });
    return (async () => {
      if (operation === 'cancel') return { cancelled: true, wrote: false };
      if (operation === 'upgrade_and_write_ocr_text') {
        const dbV2 = await openDatabaseV2();
        try {
          const hasFiles = dbV2.objectStoreNames.contains(storeName);
          const hasTexts = dbV2.objectStoreNames.contains(textStoreName);
          const rawText = 'BAB I PENDAHULUAN\\n' + 'Karakter teks skripsi panjang sintetis. '.repeat(1300);
          const textTx = dbV2.transaction(textStoreName, 'readwrite');
          textTx.objectStore(textStoreName).add({
            id: textPrimaryId,
            binaryId: primaryId,
            documentType: 'PDF Dokumen',
            rawText,
            editedText: null,
            charCount: rawText.length,
            pageCount: 35,
            confidence: 96.5,
            createdAt: 1800000000000,
            updatedAt: 1800000000000,
          });
          await new Promise((res, rej) => {
            textTx.oncomplete = res;
            textTx.onerror = rej;
          });
          return {
            upgraded: hasFiles && hasTexts,
            charCount: rawText.length,
            written: true,
          };
        } finally {
          dbV2.close();
        }
      }
      if (operation === 'read_ocr_text') {
        const dbV2 = await openDatabaseV2();
        try {
          const textTx = dbV2.transaction(textStoreName, 'readonly');
          const textReq = textTx.objectStore(textStoreName).get(textPrimaryId);
          const textRecord = await new Promise((res, rej) => {
            textReq.onsuccess = () => res(textReq.result || null);
            textReq.onerror = rej;
          });
          const binaryRecord = await readRecord(dbV2, primaryId);
          return {
            textFound: textRecord !== null,
            charCount: textRecord ? textRecord.charCount : 0,
            textMatches: textRecord !== null && textRecord.rawText.startsWith('BAB I PENDAHULUAN'),
            binaryPreserved: binaryRecord !== null && await binaryRecord.blob.text() === 'synthetic-indexeddb-document',
          };
        } finally {
          dbV2.close();
        }
      }
      if (operation === 'write_and_edit_ocr_text') {
        const dbV2 = await openDatabaseV2();
        try {
          const rawText = 'BAB I PENDAHULUAN LENGKAP DOKUMEN SKRIPSI UNIVERSITAS '.repeat(966).slice(0, 52140);
          const editedText = 'KOREKSI PENGGUNA B5B-3: Teks hasil koreksi manual mahasiswa pada halaman pertama dan bab utama.';
          const textTx = dbV2.transaction(textStoreName, 'readwrite');
          textTx.objectStore(textStoreName).put({
            id: textPrimaryId,
            binaryId: primaryId,
            documentType: 'PDF Dokumen',
            rawText,
            editedText,
            charCount: rawText.length,
            pageCount: 35,
            confidence: 96.5,
            createdAt: 1800000000000,
            updatedAt: 1800000050000,
          });
          await new Promise((res, rej) => {
            textTx.oncomplete = res;
            textTx.onerror = rej;
          });
          return {
            editedWritten: true,
            rawLength: rawText.length,
            editedLength: editedText.length,
          };
        } finally {
          dbV2.close();
        }
      }
      if (operation === 'read_edited_ocr_text') {
        const dbV2 = await openDatabaseV2();
        try {
          const textTx = dbV2.transaction(textStoreName, 'readonly');
          const textReq = textTx.objectStore(textStoreName).get(textPrimaryId);
          const textRecord = await new Promise((res, rej) => {
            textReq.onsuccess = () => res(textReq.result || null);
            textReq.onerror = rej;
          });
          const binaryRecord = await readRecord(dbV2, primaryId);
          return {
            textFound: textRecord !== null,
            rawTextMatches: textRecord !== null && textRecord.rawText.startsWith('BAB I PENDAHULUAN') && textRecord.rawText.length === 52140,
            editedTextMatches: textRecord !== null && textRecord.editedText === 'KOREKSI PENGGUNA B5B-3: Teks hasil koreksi manual mahasiswa pada halaman pertama dan bab utama.',
            rawNotMutated: textRecord !== null && textRecord.rawText !== textRecord.editedText,
            binaryPreserved: binaryRecord !== null && await binaryRecord.blob.text() === 'synthetic-indexeddb-document',
          };
        } finally {
          dbV2.close();
        }
      }
      if (operation === 'test_web_locks_native') {
        if (!navigator.locks || typeof navigator.locks.request !== 'function') {
          return { supported: false };
        }
        const lockName = 'unimate_academic_restore_lock';
        let contentionBlocked = false;
        let releasePassed = false;
        await navigator.locks.request(lockName, { mode: 'exclusive' }, async (lock1) => {
          if (!lock1) throw new Error('lock1_failed');
          // Permintaan kedua saat lock1 dipegang harus gagal / menghasilkan null
          await navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock2) => {
            contentionBlocked = (lock2 === null);
          });
        });
        // Setelah lock1 dilepas, permintaan ketiga harus berhasil
        await navigator.locks.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock3) => {
          releasePassed = (lock3 !== null);
        });
        return {
          supported: true,
          contentionBlocked,
          releasePassed,
        };
      }
      if (operation === 'setup_crash_staging') {
        const dbV2 = await openDatabaseV2();
        const restoreDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open('unimate-restore-vault', 1);
          req.onupgradeneeded = () => {
            const s = req.result.createObjectStore('journal_entries', { keyPath: 'operationId' });
            s.createIndex('by_status', 'status', { unique: false });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          // 1. Tulis berkas historis yang sudah ada sebelum restore
          const histBlob = new Blob(['konten-dokumen-historis-lama'], { type: 'application/pdf' });
          await new Promise((resolve, reject) => {
            const tx = dbV2.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put({
              id: primaryId,
              name: 'dokumen-historis.pdf',
              mimeType: 'application/pdf',
              size: histBlob.size,
              lastModified: 1700000000000,
              createdAt: 1800000000000,
              blob: histBlob,
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          // 2. Tulis teks OCR historis
          await new Promise((resolve, reject) => {
            const tx = dbV2.transaction(textStoreName, 'readwrite');
            tx.objectStore(textStoreName).put({
              id: textPrimaryId,
              binaryId: primaryId,
              documentType: 'KHS',
              rawText: 'Teks OCR Historis',
              editedText: null,
              charCount: 17,
              pageCount: 1,
              createdAt: 1800000000000,
              updatedAt: 1800000000000,
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          // 3. Tulis biner baru yang distaging
          const stagedBlob = new Blob(['konten-biner-baru-staged'], { type: 'application/pdf' });
          await new Promise((resolve, reject) => {
            const tx = dbV2.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put({
              id: '00000000-0000-4000-8000-000000000099',
              name: 'dokumen-staged-baru.pdf',
              mimeType: 'application/pdf',
              size: stagedBlob.size,
              lastModified: 1700000000000,
              createdAt: 1800000000000,
              blob: stagedBlob,
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          // 4. Tulis entri jurnal ke unimate-restore-vault dengan status BINARIES_STAGED
          await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readwrite');
            tx.objectStore('journal_entries').put({
              operationId: 'op-crash-001',
              status: 'BINARIES_STAGED',
              createdAt: 1800000000000,
              updatedAt: 1800000000000,
              existingBinaryIds: [primaryId],
              existingTextIds: [textPrimaryId],
              stagedBinaryIds: ['00000000-0000-4000-8000-000000000099'],
              stagedTextIds: [],
              previousStorageSnapshot: {
                college_semesters: {
                  exists: true,
                  rawValue: JSON.stringify([{ id: 'sem-old', name: 'Semester 1' }]),
                  isValidJson: true,
                  parsedValue: [{ id: 'sem-old', name: 'Semester 1' }],
                },
              },
              modifiedStorageKeys: ['college_semesters'],
              writtenStorageKeys: {
                college_semesters: JSON.stringify([{ id: 'sem-old', name: 'Semester 1' }, { id: 'sem-restored', name: 'Semester 2' }]),
              },
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          // 5. Ubah localStorage
          localStorage.setItem('college_semesters', JSON.stringify([{ id: 'sem-old', name: 'Semester 1' }, { id: 'sem-restored', name: 'Semester 2' }]));
          return { staged: true };
        } finally {
          dbV2.close();
          restoreDb.close();
        }
      }
      if (operation === 'reconcile_and_verify_crash') {
        const dbV2 = await openDatabaseV2();
        const restoreDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open('unimate-restore-vault', 1);
          req.onupgradeneeded = () => {
            const s = req.result.createObjectStore('journal_entries', { keyPath: 'operationId' });
            s.createIndex('by_status', 'status', { unique: false });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          // Baca jurnal tertunda
          const pending = await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readonly');
            const req = tx.objectStore('journal_entries').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = reject;
          });
          let foundPending = pending.length > 0;
          let historicFoundBefore = (await readRecord(dbV2, primaryId)) !== null;
          let stagedFoundBefore = (await readRecord(dbV2, '00000000-0000-4000-8000-000000000099')) !== null;

          // Jalankan logika rekonsiliasi
          for (const j of pending) {
            if (j.status === 'BINARIES_STAGED') {
              // Revert storage
              const snap = j.previousStorageSnapshot || {};
              for (const [k, v] of Object.entries(snap)) {
                if (v && v.rawValue !== null) localStorage.setItem(k, v.rawValue);
              }
              // Hapus biner staged (dan jangan hapus file historis)
              for (const binId of j.stagedBinaryIds) {
                if (!j.existingBinaryIds.includes(binId)) {
                  await new Promise(r => {
                    const tx = dbV2.transaction(storeName, 'readwrite');
                    tx.objectStore(storeName).delete(binId);
                    tx.oncomplete = r;
                  });
                }
              }
              // Purge jurnal
              await new Promise(r => {
                const tx = restoreDb.transaction('journal_entries', 'readwrite');
                tx.objectStore('journal_entries').delete(j.operationId);
                tx.oncomplete = r;
              });
            }
          }

          // Verifikasi pasca rekonsiliasi
          const historicAfter = await readRecord(dbV2, primaryId);
          const stagedAfter = await readRecord(dbV2, '00000000-0000-4000-8000-000000000099');
          const pendingAfter = await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readonly');
            const req = tx.objectStore('journal_entries').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = reject;
          });
          const storageAfter = localStorage.getItem('college_semesters');

          return {
            foundPending,
            historicFoundBefore,
            stagedFoundBefore,
            historicPreserved: historicAfter !== null && await historicAfter.blob.text() === 'konten-dokumen-historis-lama',
            stagedCleaned: stagedAfter === null,
            journalPurged: pendingAfter.length === 0,
            storageReverted: storageAfter === JSON.stringify([{ id: 'sem-old', name: 'Semester 1' }]),
          };
        } finally {
          dbV2.close();
          restoreDb.close();
        }
      }
      if (operation === 'setup_crash_committed') {
        const dbV2 = await openDatabaseV2();
        const restoreDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open('unimate-restore-vault', 1);
          req.onupgradeneeded = () => {
            const s = req.result.createObjectStore('journal_entries', { keyPath: 'operationId' });
            s.createIndex('by_status', 'status', { unique: false });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          const commBlob = new Blob(['konten-biner-sah-committed'], { type: 'application/pdf' });
          await new Promise((resolve, reject) => {
            const tx = dbV2.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put({
              id: '00000000-0000-4000-8000-000000000077',
              name: 'dokumen-sah.pdf',
              mimeType: 'application/pdf',
              size: commBlob.size,
              lastModified: 1700000000000,
              createdAt: 1800000000000,
              blob: commBlob,
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readwrite');
            tx.objectStore('journal_entries').put({
              operationId: 'op-crash-comm-002',
              status: 'COMMITTED',
              createdAt: 1800000000000,
              updatedAt: 1800000000000,
              existingBinaryIds: [],
              existingTextIds: [],
              stagedBinaryIds: ['00000000-0000-4000-8000-000000000077'],
              stagedTextIds: [],
              modifiedStorageKeys: ['college_semesters'],
              writtenStorageKeys: {
                college_semesters: JSON.stringify([{ id: 'sem-sah-committed' }]),
              },
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          });
          localStorage.setItem('college_semesters', JSON.stringify([{ id: 'sem-sah-committed' }]));
          return { committedStaged: true };
        } finally {
          dbV2.close();
          restoreDb.close();
        }
      }
      if (operation === 'reconcile_committed') {
        const dbV2 = await openDatabaseV2();
        const restoreDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open('unimate-restore-vault', 1);
          req.onupgradeneeded = () => {
            const s = req.result.createObjectStore('journal_entries', { keyPath: 'operationId' });
            s.createIndex('by_status', 'status', { unique: false });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          const pending = await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readonly');
            const req = tx.objectStore('journal_entries').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = reject;
          });
          // Status COMMITTED: commit-forward! DILARANG ROLLBACK!
          for (const j of pending) {
            if (j.status === 'COMMITTED') {
              await new Promise(r => {
                const tx = restoreDb.transaction('journal_entries', 'readwrite');
                tx.objectStore('journal_entries').delete(j.operationId);
                tx.oncomplete = r;
              });
            }
          }
          const committedFile = await readRecord(dbV2, '00000000-0000-4000-8000-000000000077');
          const storageAfter = localStorage.getItem('college_semesters');
          const pendingAfter = await new Promise((resolve, reject) => {
            const tx = restoreDb.transaction('journal_entries', 'readonly');
            const req = tx.objectStore('journal_entries').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = reject;
          });
          return {
            filePreserved: committedFile !== null,
            storagePreserved: storageAfter === JSON.stringify([{ id: 'sem-sah-committed' }]),
            journalPurged: pendingAfter.length === 0,
          };
        } finally {
          dbV2.close();
          restoreDb.close();
        }
      }
      const database = await openDatabase();
      try {
        if (operation === 'write') {
          const blob = new Blob(['synthetic-indexeddb-document'], { type: 'application/pdf' });
          await addRecord(database, {
            id: primaryId,
            name: 'indexeddb-sintetis.pdf',
            mimeType: 'application/pdf',
            size: blob.size,
            lastModified: 1700000000000,
            createdAt: 1800000000000,
            blob,
          });
          return { written: true, size: blob.size };
        }
        if (operation === 'read') {
          const record = await readRecord(database, primaryId);
          return {
            found: record !== null,
            valid: record !== null
              && record.name === 'indexeddb-sintetis.pdf'
              && record.mimeType === 'application/pdf'
              && record.size === record.blob.size
              && await record.blob.text() === 'synthetic-indexeddb-document',
          };
        }
        if (operation === 'verify_suite') {
          const record = await readRecord(database, primaryId);
          const missing = await readRecord(database, '00000000-0000-4000-8000-999999999999');
          const rejected = await abortWrite(database, {
            ...record,
            blob: new Blob(['replacement'], { type: 'application/pdf' }),
          });
          const after = await readRecord(database, primaryId);
          const cancelled = await readRecord(database, cancelledId);
          return {
            found: record !== null,
            valid: record !== null
              && record.name === 'indexeddb-sintetis.pdf'
              && record.mimeType === 'application/pdf'
              && record.size === record.blob.size
              && await record.blob.text() === 'synthetic-indexeddb-document',
            missing: missing === null,
            rejected,
            originalPreserved: await after.blob.text() === 'synthetic-indexeddb-document',
            cancelledWriteAbsent: cancelled === null,
          };
        }
        if (operation === 'missing') return { found: (await readRecord(database, '00000000-0000-4000-8000-999999999999')) !== null };
        if (operation === 'cancelled_read') return { found: (await readRecord(database, cancelledId)) !== null };
        if (operation === 'duplicate') {
          const before = await readRecord(database, primaryId);
          const rejected = await abortWrite(database, {
            ...before,
            blob: new Blob(['replacement'], { type: 'application/pdf' }),
          });
          const after = await readRecord(database, primaryId);
          return {
            rejected,
            originalPreserved: await after.blob.text() === 'synthetic-indexeddb-document',
          };
        }
        throw new Error('invalid_operation');
      } finally {
        try { database.close(); } catch {}
      }
    })();
  })()`;
}

async function main() {
  stage = 'validate_arguments';
  const isolationRoot = readArgument('isolation-root');
  const profilePath = readArgument('profile');
  const resultPath = readArgument('result');
  const operation = readArgument('operation');
  if (
    !isolationRoot
    || !profilePath
    || !resultPath
    || !operation
    || !path.isAbsolute(isolationRoot)
    || !path.isAbsolute(profilePath)
    || !path.isAbsolute(resultPath)
  ) {
    throw new Error('invalid_arguments');
  }
  assertContained(isolationRoot, profilePath);
  assertContained(isolationRoot, resultPath);

  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-sync');
  app.disableHardwareAcceleration();
  app.setPath('userData', profilePath);
  stage = 'electron_ready';
  await app.whenReady();
  const userData = app.getPath('userData');
  assertContained(isolationRoot, userData);

  stage = 'create_window';
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  activeWindow = window;
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const pagePath = path.join(isolationRoot, 'origin', 'indexeddb-harness.html');
  assertContained(isolationRoot, pagePath);
  await fs.mkdir(path.dirname(pagePath), { recursive: true });
  try {
    await fs.access(pagePath);
  } catch {
    await fs.writeFile(pagePath, '<!doctype html><meta charset="utf-8"><title>IndexedDB Test</title>', 'utf8');
  }
  stage = 'load_page';
  await window.loadFile(pagePath);
  stage = 'run_operation';
  const operationResult = await window.webContents.executeJavaScript(rendererOperation(operation), true);

  if (operation === 'setup_crash_staging') {
    await window.webContents.session.flushStorageData();
    fsSync.writeFileSync(path.join(isolationRoot, 'staged.ready'), 'ready', 'utf8');
    // Tunggu terminasi paksa (taskkill / SIGKILL) dari proses penguji luar
    await new Promise(resolve => setTimeout(resolve, 60_000));
    return;
  }

  if (operation === 'setup_crash_committed') {
    await window.webContents.session.flushStorageData();
    fsSync.writeFileSync(path.join(isolationRoot, 'committed.ready'), 'ready', 'utf8');
    // Tunggu terminasi paksa (taskkill / SIGKILL) dari proses penguji luar
    await new Promise(resolve => setTimeout(resolve, 60_000));
    return;
  }
  stage = 'write_result';
  const relativeUserData = path.relative(isolationRoot, userData);
  if (!relativeUserData || path.isAbsolute(relativeUserData) || relativeUserData.startsWith('..')) {
    throw new Error('invalid_user_data');
  }
  await writeResult(resultPath, {
    ok: true,
    operation,
    userDataRelative: relativeUserData.split(path.sep).join('/'),
    result: operationResult,
  });
  stage = 'close_window';
  window.destroy();
  activeWindow = null;
  stage = 'completed';
}

main()
  .then(() => app.exit(0))
  .catch(async error => {
    const root = readArgument('isolation-root');
    const result = readArgument('result');
    if (root && result) {
      try {
        assertContained(root, result);
        await writeResult(result, { ok: false, stage, code: safeCode(error) });
      } catch {}
    }
    if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy();
    activeWindow = null;
    app.exit(1);
  });
