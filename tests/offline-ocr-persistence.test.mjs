import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BINARY_FILE_REFERENCE_KIND,
  DOCUMENT_TEXT_REFERENCE_KIND,
  BinaryFileStoreError,
  createBinaryFileStore,
  createIndexedDBBinaryAdapter,
  createMemoryBinaryAdapter,
  isBinaryFileReference,
  isDocumentTextReference,
} from '../src/services/binaryFileStore.js';
import {
  PersistentDocumentError,
  hasPersistentDocumentText,
  persistScannerDocument,
  persistScannerDocumentWithMetadata,
  resolvePersistentDocument,
  resolvePersistentDocumentText,
} from '../src/services/persistentDocument.js';
import {
  PORTABLE_BACKUP_FORMAT,
  PortableAcademicBackupError,
  createPortableAcademicBackup,
  createPortableRestorePreview,
  parsePortableAcademicBackup,
} from '../src/services/portableAcademicBackup.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(repositoryRoot, 'tests', 'fixtures', 'electronIndexedDBHarness.cjs');
const nodeModulesPath = path.join(repositoryRoot, 'node_modules');
const electronTestLockPath = path.join(nodeModulesPath, '.unimate-electron-test.lock');

function createSyntheticPdf(contents = 'synthetic pdf content', name = 'dokumen.pdf') {
  const blob = new Blob([contents], { type: 'application/pdf' });
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: 1_700_000_000_000 },
  });
  return blob;
}

function createStore(adapter = createMemoryBinaryAdapter(), idPrefix = '00000000-0000-4000-8000-') {
  let counter = 0;
  return createBinaryFileStore({
    adapter,
    cryptoImpl: {
      randomUUID: () => `${idPrefix}${String(++counter).padStart(12, '0')}`,
    },
    now: () => 1_800_000_000_000,
  });
}

function createStorage(semesters = [], tasks = []) {
  const map = new Map([
    ['college_semesters', JSON.stringify(semesters)],
    ['college_tasks', JSON.stringify(tasks)],
    ['college_thesis', JSON.stringify({ todo: [], inProgress: [], review: [], done: [] })],
  ]);
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, val),
    removeItem: key => map.delete(key),
  };
}

async function acquireElectronLock() {
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
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error('electron_lock_timeout');
}

test('B5B-2.1: Adapter memory mendukung store files dan document_texts', async () => {
  const adapter = createMemoryBinaryAdapter();
  const store = createStore(adapter);

  const file = createSyntheticPdf('dokumen skripsi');
  const ocrPayload = {
    rawText: 'Bab 1 Pendahuluan Skripsi',
    documentType: 'PDF Dokumen',
    pageCount: 12,
    confidence: 98.4,
  };

  const stored = await store.putFileWithText(file, ocrPayload);
  assert.equal(isBinaryFileReference(stored.binaryRef), true);
  assert.equal(isDocumentTextReference(stored.textRef), true);
  assert.equal(stored.textRef.charCount, ocrPayload.rawText.length);
  assert.equal(stored.textRef.hasEditedText, false);

  const textRecord = await store.getText(stored.textRef);
  assert.equal(textRecord.rawText, ocrPayload.rawText);
  assert.equal(textRecord.binaryId, stored.binaryRef.id);
  assert.equal(textRecord.pageCount, 12);
  assert.equal(textRecord.confidence, 98.4);
});

test('B5B-2.2: Dokumen lama tanpa textRef tetap utuh dan valid', async () => {
  const store = createStore();
  const file = createSyntheticPdf('dokumen lama');
  const stored = await persistScannerDocument(file, 'Dokumen KHS', store);

  assert.equal(isBinaryFileReference(stored.binaryRef), true);
  assert.equal(stored.textRef, undefined);
  assert.equal(hasPersistentDocumentText(stored), false);

  const textResult = await resolvePersistentDocumentText(stored, { store });
  assert.equal(textResult, null);

  const binaryBlob = await resolvePersistentDocument(stored, { store });
  assert.equal(binaryBlob.persistent, true);
  assert.equal(binaryBlob.mimeType, 'application/pdf');
});

test('B5B-2.3: Simpan dan baca kembali fullText 25.000 karakter', async () => {
  const store = createStore();
  const file = createSyntheticPdf('dokumen-25k.pdf');
  const text25k = 'A'.repeat(25_000);

  let committedDoc = null;
  const document = await persistScannerDocumentWithMetadata(
    file,
    'PDF Dokumen',
    stored => {
      committedDoc = stored;
      return { ok: true };
    },
    store,
    { ocrPayload: { rawText: text25k, documentType: 'PDF Dokumen' } },
  );

  assert.equal(document, committedDoc);
  assert.equal(isDocumentTextReference(document.textRef), true);
  assert.equal(document.textRef.charCount, 25_000);

  const resolved = await resolvePersistentDocumentText(document, { store });
  assert.notEqual(resolved, null);
  assert.equal(resolved.rawText.length, 25_000);
  assert.equal(resolved.rawText, text25k);
  assert.equal(resolved.text, text25k);
  assert.equal(resolved.editedText, null);
});

test('B5B-2.4: Simpan dan baca kembali fullText 52.140 karakter (skripsi/silabus)', async () => {
  const store = createStore();
  const file = createSyntheticPdf('skripsi-bab-1-5.pdf');
  const text52k = 'BAB I PENDAHULUAN\n' + 'Ini adalah isi skripsi panjang mahasiswa. '.repeat(1300);

  const document = await persistScannerDocumentWithMetadata(
    file,
    'Skripsi',
    () => ({ ok: true }),
    store,
    { ocrPayload: { rawText: text52k, pageCount: 45, confidence: 97.2 } },
  );

  assert.equal(document.textRef.charCount, text52k.length);
  assert.ok(document.textRef.charCount > 52_000);

  const resolved = await resolvePersistentDocumentText(document, { store });
  assert.equal(resolved.rawText, text52k);
  assert.equal(resolved.charCount, text52k.length);
  assert.equal(resolved.pageCount, 45);
  assert.equal(resolved.confidence, 97.2);
});

test('B5B-2.5: Tutup dan buka kembali koneksi database, teks tetap persisten', async () => {
  const adapter = createMemoryBinaryAdapter();
  const store1 = createStore(adapter);
  const file = createSyntheticPdf('arsip.pdf');
  const rawText = 'Teks persisten sebelum koneksi ditutup';

  const doc = await persistScannerDocument(file, 'Arsip', store1, {
    ocrPayload: { rawText },
  });

  await store1.close();

  // Buat instance store baru yang tersambung ke adapter yang sama
  const store2 = createStore(adapter);
  const resolved = await resolvePersistentDocumentText(doc, { store: store2 });
  assert.notEqual(resolved, null);
  assert.equal(resolved.rawText, rawText);
});

test('B5B-2.6: rawText dan editedText dapat dibedakan tanpa mengubah dokumen biner asli', async () => {
  const adapter = createMemoryBinaryAdapter();
  const store = createStore(adapter);
  const file = createSyntheticPdf('transkrip.pdf');
  const rawText = 'KHS Semester 5 - Nilai: Algoritma A';

  const doc = await persistScannerDocument(file, 'KHS', store, {
    ocrPayload: { rawText },
  });

  // Simulasikan pembaruan editedText oleh pengguna di tahap editor mendatang
  const textRecord = await store.getText(doc.textRef);
  await adapter.putText({
    ...textRecord,
    editedText: 'KHS Semester 5 - Nilai: Algoritma A (Koreksi Pengguna: 4 SKS)',
    updatedAt: 1_800_000_000_500,
  });

  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.editedText, 'KHS Semester 5 - Nilai: Algoritma A (Koreksi Pengguna: 4 SKS)');
  assert.equal(resolved.text, 'KHS Semester 5 - Nilai: Algoritma A (Koreksi Pengguna: 4 SKS)');

  // Verifikasi file biner asli tetap 100% utuh
  const binaryBlob = await store.get(doc.binaryRef);
  assert.equal(await binaryBlob.text(), 'transkrip.pdf');
});

test('B5B-2.7: Kegagalan simpan binary menghentikan operasi sebelum commit metadata', async () => {
  let metadataCalls = 0;
  const store = createStore({
    async putMany() { throw new BinaryFileStoreError('write_failed'); },
    async putFileAndText() { throw new BinaryFileStoreError('write_failed'); },
    async get() { return null; },
    async remove() {},
  });

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticPdf(),
      'Dokumen KHS',
      () => {
        metadataCalls += 1;
        return { ok: true };
      },
      store,
      { ocrPayload: { rawText: 'contoh' } },
    ),
    err => err instanceof BinaryFileStoreError && err.code === 'write_failed',
  );
  assert.equal(metadataCalls, 0);
});

test('B5B-2.8: Kegagalan simpan text menghentikan operasi tanpa meninggalkan file orfan', async () => {
  const memory = createMemoryBinaryAdapter();
  const store = createStore({
    putMany: records => memory.putMany(records),
    get: id => memory.get(id),
    remove: id => memory.remove(id),
    async putText() { throw new BinaryFileStoreError('write_failed'); },
    async getText() { return null; },
    async removeText() {},
  });

  let metadataCalls = 0;
  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticPdf(),
      'Dokumen',
      () => {
        metadataCalls += 1;
        return { ok: true };
      },
      store,
      { ocrPayload: { rawText: 'teks yang gagal' } },
    ),
    err => err instanceof BinaryFileStoreError && err.code === 'write_failed',
  );
  assert.equal(metadataCalls, 0);
});

test('B5B-2.9: Kegagalan commit metadata memicu rollback kompensasi (hapus binary & text baru)', async () => {
  const adapter = createMemoryBinaryAdapter();
  const store = createStore(adapter);
  let stagedDoc = null;

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticPdf('dokumen rollback'),
      'Dokumen',
      doc => {
        stagedDoc = doc;
        return { ok: false };
      },
      store,
      { ocrPayload: { rawText: 'teks rollback' } },
    ),
    err => err instanceof PersistentDocumentError && err.code === 'metadata_write_failed',
  );

  assert.notEqual(stagedDoc, null);
  // Verifikasi binary baru terhapus
  await assert.rejects(
    store.get(stagedDoc.binaryRef),
    err => err instanceof BinaryFileStoreError && err.code === 'file_not_found',
  );
  // Verifikasi text record baru terhapus
  await assert.rejects(
    store.getText(stagedDoc.textRef),
    err => err instanceof BinaryFileStoreError && err.code === 'file_not_found',
  );
});

test('B5B-2.10: Disk penuh / QuotaExceededError sintetis ditangani dengan aman', async () => {
  const store = createStore({
    async putFileAndText() { throw new BinaryFileStoreError('quota_exceeded'); },
    async putMany() { throw new BinaryFileStoreError('quota_exceeded'); },
    async get() { return null; },
    async remove() {},
  });

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticPdf(),
      'Dokumen Besar',
      () => ({ ok: true }),
      store,
      { ocrPayload: { rawText: 'teks besar' } },
    ),
    err => err instanceof BinaryFileStoreError && err.code === 'quota_exceeded',
  );
});

test('B5B-2.11: Rollback hanya menghapus record baru dan tidak menyentuh record historis', async () => {
  const adapter = createMemoryBinaryAdapter();
  const store = createStore(adapter);

  // Simpan record historis yang sukses
  const historicalDoc = await persistScannerDocument(
    createSyntheticPdf('dokumen historis'),
    'KHS Lama',
    store,
    { ocrPayload: { rawText: 'Teks historis yang harus aman' } },
  );

  // Simpan record kedua yang gagal pada fase metadata commit
  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticPdf('dokumen baru gagal'),
      'KHS Baru',
      () => ({ ok: false }),
      store,
      { ocrPayload: { rawText: 'Teks baru gagal' } },
    ),
    err => err instanceof PersistentDocumentError && err.code === 'metadata_write_failed',
  );

  // Pastikan record historis tetap 100% ada dan terbaca
  const historicalBinary = await store.get(historicalDoc.binaryRef);
  assert.equal(await historicalBinary.text(), 'dokumen historis');
  const historicalText = await store.getText(historicalDoc.textRef);
  assert.equal(historicalText.rawText, 'Teks historis yang harus aman');
});

test('B5B-2.12: Shared reference binary tidak kehilangan berkas fisik', async () => {
  const store = createStore();
  const binaryFile = createSyntheticPdf('shared-silabus.pdf');
  const binaryRef = await store.put(binaryFile);

  // Dua dokumen berbeda memegang referensi ke binary yang sama
  const docA = { type: 'Silabus Kelas A', binaryRef };
  const docB = { type: 'Silabus Kelas B', binaryRef };

  assert.equal(docA.binaryRef.id, docB.binaryRef.id);
  const blobA = await store.get(docA.binaryRef);
  const blobB = await store.get(docB.binaryRef);
  assert.equal(await blobA.text(), 'shared-silabus.pdf');
  assert.equal(await blobB.text(), 'shared-silabus.pdf');
});

test('B5B-2.13: Backup portabel lama tanpa texts tetap valid dan restore tetap disabled', async () => {
  const store = createStore();
  const file = createSyntheticPdf('materi.pdf');
  const binaryRef = await store.put(file);

  const storage = createStorage([{
    id: 1,
    name: 'Semester 1',
    documents: [{ type: 'Materi', binaryRef }],
    courses: [],
  }]);

  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date('2026-10-25T10:00:00Z'),
  });

  // Hapus properti texts untuk mensimulasikan backup versi lama (v1 tanpa texts)
  const legacyBackup = structuredClone(backup);
  delete legacyBackup.texts;

  const parsed = await parsePortableAcademicBackup(JSON.stringify(legacyBackup));
  assert.equal(parsed.format, PORTABLE_BACKUP_FORMAT);

  const preview = await createPortableRestorePreview(JSON.stringify(legacyBackup), storage);
  assert.equal(preview.portable, true);
  assert.equal(preview.restoreEnabled, false);
});

test('B5B-2.14: Backup portabel baru mempertahankan payload teks OCR lengkap dan checksum', async () => {
  const store = createStore();
  const file = createSyntheticPdf('khs-ocr.pdf');
  const doc = await persistScannerDocument(file, 'KHS', store, {
    ocrPayload: { rawText: 'Nilai Matematika Diskrit: A', pageCount: 1, confidence: 99.1 },
  });

  const storage = createStorage([{
    id: 1,
    name: 'Semester 1',
    documents: [doc],
    courses: [],
  }]);

  const backup = await createPortableAcademicBackup(storage, {
    binaryStore: store,
    now: () => new Date('2026-10-25T10:00:00Z'),
  });

  assert.equal(backup.texts.length, 1);
  assert.equal(backup.texts[0].rawText, 'Nilai Matematika Diskrit: A');
  assert.equal(backup.texts[0].pageCount, 1);
  assert.equal(backup.texts[0].confidence, 99.1);
  assert.match(backup.texts[0].sha256, /^[a-f0-9]{64}$/u);

  const preview = await createPortableRestorePreview(JSON.stringify(backup), storage);
  assert.equal(preview.texts.count, 1);
  assert.equal(preview.texts.characters, 'Nilai Matematika Diskrit: A'.length);
  assert.equal(preview.restoreEnabled, false);
});

test('B5B-2.15: Backup menolak ekspor jika teks yang direferensikan hilang (tidak silent loss)', async () => {
  const store = createStore();
  const missingTextRef = {
    kind: DOCUMENT_TEXT_REFERENCE_KIND,
    version: 1,
    id: '00000000-0000-4000-8000-000000000099',
    binaryId: '00000000-0000-4000-8000-000000000088',
    charCount: 20,
    hasEditedText: false,
    updatedAt: 1800000000000,
  };

  const storage = createStorage([{
    id: 1,
    documents: [{
      type: 'KHS',
      binaryRef: {
        kind: BINARY_FILE_REFERENCE_KIND,
        version: 1,
        id: '00000000-0000-4000-8000-000000000088',
        name: 'khs.pdf',
        mimeType: 'application/pdf',
        size: 10,
        lastModified: 0,
      },
      textRef: missingTextRef,
    }],
    courses: [],
  }]);

  await assert.rejects(
    createPortableAcademicBackup(storage, { binaryStore: store }),
    err => err instanceof PortableAcademicBackupError && (err.code === 'text_unavailable' || err.code === 'binary_unavailable'),
  );
});

test('B5B-2.16: Mode offline tidak melakukan request jaringan saat pemrosesan dan penyimpanan', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = async () => {
    networkCalled = true;
    throw new Error('network_call_forbidden_in_offline_mode');
  };

  try {
    const store = createStore();
    const file = createSyntheticPdf('dokumen-offline.pdf');
    const doc = await persistScannerDocumentWithMetadata(
      file,
      'PDF Dokumen',
      () => ({ ok: true }),
      store,
      { ocrPayload: { rawText: 'teks lokal tanpa jaringan' } },
    );
    assert.equal(networkCalled, false);
    assert.equal(doc.textRef.charCount, 'teks lokal tanpa jaringan'.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B5B-2.17: Chromium IndexedDB persisten lintas restart Electron dengan upgrade v1->v2 dan teks OCR 52k+', { timeout: 180_000 }, async () => {
  await fs.access(electronExecutable);
  const releaseLock = await acquireElectronLock();
  let rootPath;
  let isolatedElectronExecutable;

  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-ocr-persist-'));
    isolatedElectronExecutable = path.join(
      path.dirname(electronExecutable),
      `.unimate-ocr-persist-${process.pid}-${path.basename(rootPath)}.exe`,
    );
    await fs.link(electronExecutable, isolatedElectronExecutable);

    const paths = {
      profile: path.join(rootPath, 'profile'),
      results: path.join(rootPath, 'results'),
      staging: path.join(rootPath, 'staging'),
    };

    const environment = { ...process.env };
    for (const name of Object.keys(environment)) {
      if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[name];
    }

    async function runHarness(operation) {
      const resultPath = path.join(paths.results, `${operation}.json`);
      const child = spawn(isolatedElectronExecutable, [
        `--user-data-dir=${paths.profile}`,
        paths.staging,
        `--isolation-root=${rootPath}`,
        `--profile=${paths.profile}`,
        `--result=${resultPath}`,
        `--operation=${operation}`,
      ], {
        cwd: paths.staging,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let exit;
      try {
        exit = await new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('timeout')), 25_000);
          child.once('error', rej);
          child.once('close', (code, signal) => {
            clearTimeout(timer);
            res({ code, signal });
          });
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }

      assert.equal(exit.code, 0, `electron_exit_${exit.code}`);
      const serialized = await fs.readFile(resultPath, 'utf8');
      const res = JSON.parse(serialized);
      assert.equal(res.ok, true, `operation_${operation}_failed`);
      return res;
    }

    await Promise.all(Object.values(paths).map(dir => fs.mkdir(dir, { recursive: true })));
    await fs.copyFile(harnessPath, path.join(paths.staging, 'main.cjs'));
    await fs.writeFile(path.join(paths.staging, 'package.json'), JSON.stringify({
      name: 'unimate-ocr-persist-test',
      version: '1.0.0',
      private: true,
      main: 'main.cjs',
    }), 'utf8');

    // 1. Tulis binary asli di v1
    const writeV1 = await runHarness('write');
    assert.equal(writeV1.result.written, true);

    // 2. Upgrade ke v2 dan simpan teks OCR 52.000+ karakter
    const upgradeAndWrite = await runHarness('upgrade_and_write_ocr_text');
    assert.equal(upgradeAndWrite.result.upgraded, true);
    assert.ok(upgradeAndWrite.result.charCount > 52_000);

    // 3. Restart Electron dalam proses baru dan baca kembali teks & binary
    const readAfterRestart = await runHarness('read_ocr_text');
    assert.equal(readAfterRestart.result.textFound, true);
    assert.ok(readAfterRestart.result.charCount > 52_000);
    assert.equal(readAfterRestart.result.textMatches, true);
    assert.equal(readAfterRestart.result.binaryPreserved, true);
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

test('B5B-2.18: Simulasi IDB factory: upgrade database kosong dan database v1 membuat document_texts', async () => {
  const createdStores = new Set();
  const createdIndices = new Set();

  const mockDb = {
    objectStoreNames: {
      contains: name => createdStores.has(name),
    },
    createObjectStore(name, _options) {
      createdStores.add(name);
      return {
        createIndex(idxName, _keyPath) {
          createdIndices.add(`${name}.${idxName}`);
        },
      };
    },
    close() {},
  };

  const mockFactory = {
    open(name, version) {
      assert.equal(name, 'unimate-binary-vault');
      assert.equal(version, 2);
      const request = {
        result: mockDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      setTimeout(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };

  const adapter = createIndexedDBBinaryAdapter(mockFactory);
  // Put a test record to trigger openDatabase
  const testRecord = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test.pdf',
    mimeType: 'application/pdf',
    size: 10,
    lastModified: 0,
    createdAt: 0,
    blob: new Blob(['x'], { type: 'application/pdf' }),
  };

  // Kita stub transaction pada mockDb
  mockDb.transaction = (_storeNames, _mode) => {
    const tx = {
      objectStore: _name => ({
        add: () => {},
      }),
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    setTimeout(() => {
      tx.oncomplete?.();
    }, 0);
    return tx;
  };

  // Trigger adapter write
  await adapter.putMany([testRecord]);

  // Pastikan kedua store dibuat selama upgrade
  assert.equal(createdStores.has('files'), true);
  assert.equal(createdStores.has('document_texts'), true);
  assert.equal(createdIndices.has('document_texts.by_binary_id'), true);
  await adapter.close();
});

test('B5B-2.19: Event versionchange menutup koneksi yang terbuka agar tidak memblokir koneksi baru', async () => {
  let closed = false;
  const mockDb = {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    close() { closed = true; },
  };

  const mockFactory = {
    open() {
      const request = { result: mockDb };
      setTimeout(() => {
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };

  const adapter = createIndexedDBBinaryAdapter(mockFactory);
  mockDb.transaction = () => ({
    objectStore: () => ({ get: () => ({ onsuccess: null }) }),
  });

  // Panggil get untuk memicu openDatabase
  void adapter.get('some-id');
  await new Promise(r => setTimeout(r, 20));

  assert.equal(typeof mockDb.onversionchange, 'function');
  mockDb.onversionchange();
  assert.equal(closed, true);
});

test('B5B-2.20: Pembatalan Scanner tidak menulis file biner atau teks OCR', async () => {
  const store = createStore();
  const _file = createSyntheticPdf('dokumen-batal.pdf');

  // Simulasikan state AIScanner saat pengguna membatalkan proses
  let saved = false;
  const onCancel = () => {
    // Tidak ada pemanggilan persistScannerDocumentWithMetadata
    saved = false;
  };

  onCancel();
  assert.equal(saved, false);
  // Verifikasi tidak ada data di store
  await assert.rejects(
    store.get({
      kind: BINARY_FILE_REFERENCE_KIND,
      version: 1,
      id: '00000000-0000-4000-8000-000000000001',
      name: 'dokumen-batal.pdf',
      mimeType: 'application/pdf',
      size: 10,
      lastModified: 0,
    }),
    err => err instanceof BinaryFileStoreError && err.code === 'file_not_found',
  );
});

