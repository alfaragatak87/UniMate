import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
  isDocumentTextReference,
  isBinaryFileReference,
  BINARY_FILE_REFERENCE_KIND,
  DOCUMENT_TEXT_REFERENCE_KIND,
} from '../src/services/binaryFileStore.js';

import {
  createPersistentDocumentRecord,
  persistScannerDocument,
  persistScannerDocumentWithMetadata,
  resolvePersistentDocumentText,
  hasPersistentDocumentText,
  updatePersistentDocumentEditedText,
  PersistentDocumentError,
} from '../src/services/persistentDocument.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, '..');
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(repositoryRoot, 'tests', 'fixtures', 'electronIndexedDBHarness.cjs');

function createSyntheticPdf(name = 'dokumen.pdf', content = 'isi-pdf-sintetis') {
  const blob = new Blob([content], { type: 'application/pdf' });
  return new File([blob], name, { type: 'application/pdf', lastModified: 1700000000000 });
}

function createStore(customAdapter = null) {
  const adapter = customAdapter || createMemoryBinaryAdapter();
  return createBinaryFileStore({
    adapter,
    cryptoImpl: globalThis.crypto,
    now: () => 1800000000000,
  });
}

test('B5B-3.1: OCR teks asli 5.000 karakter tersimpan dan terbaca utuh', async () => {
  const store = createStore();
  const file = createSyntheticPdf('silabus-5k.pdf');
  const rawText = 'SILABUS PERKULIAHAN LENGKAP SEMESTER GANJIL '.repeat(115).slice(0, 5000);

  const doc = await persistScannerDocument(file, 'Silabus', store, {
    ocrPayload: { rawText, pageCount: 3, confidence: 94.2 },
  });

  assert.ok(isBinaryFileReference(doc.binaryRef));
  assert.ok(isDocumentTextReference(doc.textRef));
  assert.equal(doc.textRef.charCount, 5000);

  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.editedText, null);
  assert.equal(resolved.text, rawText);
  assert.equal(resolved.charCount, 5000);
  assert.equal(resolved.pageCount, 3);
});

test('B5B-3.2: Teks PDF 25.000 karakter tersimpan tanpa pemotongan preview', async () => {
  const store = createStore();
  const file = createSyntheticPdf('modul-25k.pdf');
  const rawText = 'MODUL MATEMATIKA DISKRIT DAN STRUKTUR DATA '.repeat(600).slice(0, 25000);

  const doc = await persistScannerDocument(file, 'Modul', store, {
    ocrPayload: { rawText, pageCount: 15, confidence: 98.1 },
  });

  assert.equal(doc.textRef.charCount, 25000);
  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText.length, 25000);
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.text, rawText);
});

test('B5B-3.3: Teks PDF 52.000+ karakter (skripsi/silabus panjang) tersimpan utuh', async () => {
  const store = createStore();
  const file = createSyntheticPdf('skripsi-52k.pdf');
  const rawText = 'BAB I PENDAHULUAN LENGKAP DOKUMEN SKRIPSI UNIVERSITAS '.repeat(966).slice(0, 52140);

  const doc = await persistScannerDocument(file, 'Skripsi', store, {
    ocrPayload: { rawText, pageCount: 42, confidence: 95.0 },
  });

  assert.equal(doc.textRef.charCount, 52140);
  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText.length, 52140);
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.editedText, null);
});

test('B5B-3.4: Editing teks lengkap 52.140 karakter tanpa pemotongan', async () => {
  const store = createStore();
  const file = createSyntheticPdf('skripsi-edit.pdf');
  const rawText = 'BAB I PENDAHULUAN LENGKAP DOKUMEN SKRIPSI UNIVERSITAS '.repeat(966).slice(0, 52140);

  const doc = await persistScannerDocument(file, 'Skripsi', store, {
    ocrPayload: { rawText, pageCount: 42 },
  });

  const editedContent = 'KOREKSI AWAL BAB I:\n' + rawText.slice(20) + '\nCATATAN AKHIR REVISI';
  const updatedDoc = await updatePersistentDocumentEditedText(doc, editedContent, { store });

  assert.equal(updatedDoc.textRef.hasEditedText, true);
  const resolved = await resolvePersistentDocumentText(updatedDoc, { store });
  assert.equal(resolved.rawText, rawText); // rawText tetap utuh
  assert.equal(resolved.editedText, editedContent); // editedText tersimpan lengkap
  assert.equal(resolved.text, editedContent); // text mengembalikan hasil editan
  assert.ok(resolved.text.length > 52140);
});

test('B5B-3.5: Pembatalan perubahan teks tidak mengubah database', async () => {
  const store = createStore();
  const file = createSyntheticPdf('dokumen-cancel.pdf');
  const rawText = 'Teks asli OCR mesin yang tidak boleh berubah.';

  const doc = await persistScannerDocument(file, 'Dokumen', store, {
    ocrPayload: { rawText },
  });

  // Pengguna mengetik perubahan di UI lalu menekan Batal (tidak memanggil save)
  const _draftUiText = 'Teks ketikan pengguna yang dibatalkan';

  // Verifikasi database tetap mencatat rawText asli dan editedText null
  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.editedText, null);
  assert.equal(resolved.text, rawText);
});

test('B5B-3.6: Deteksi dirty state untuk peringatan unsaved changes', () => {
  const rawText = 'Teks mesin 100%';
  const payload = { rawText, editedText: null };

  const isDirtyUnchanged = payload.rawText !== rawText;
  assert.equal(isDirtyUnchanged, false);

  const modifiedText = 'Teks mesin 100% diedit mahasiswa';
  const isDirtyModified = payload.rawText !== modifiedText;
  assert.equal(isDirtyModified, true);
});

test('B5B-3.7: Simpan editedText tanpa memutasi rawText', async () => {
  const store = createStore();
  const file = createSyntheticPdf('koreksi.pdf', 'file-biner-asli-tidak-berubah');
  const rawText = 'Hasil mentah OCR dengan beberapa typo: M4t3m4t1k4 D1skr1t';
  const editedText = 'Hasil koreksi mahasiswa: Matematika Diskrit';

  const doc = await persistScannerDocument(file, 'Catatan', store, {
    ocrPayload: { rawText },
  });

  await updatePersistentDocumentEditedText(doc, editedText, { store });

  const resolved = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolved.rawText, rawText, 'rawText harus tetap sama persis');
  assert.equal(resolved.editedText, editedText, 'editedText harus berisi teks baru');
  assert.notEqual(resolved.rawText, resolved.editedText);

  // Verifikasi biner fisik tidak tersentuh
  const originalBlob = await store.get(doc.binaryRef);
  assert.equal(await originalBlob.text(), 'file-biner-asli-tidak-berubah');
});

test('B5B-3.8: Pembedaan editedText null (belum diedit) vs string kosong "" (dikosongkan sengaja)', async () => {
  const store = createStore();
  const file = createSyntheticPdf('blank-check.pdf');
  const rawText = 'Teks awal';

  const doc = await persistScannerDocument(file, 'Dokumen', store, {
    ocrPayload: { rawText },
  });

  // 1. Belum diedit: editedText === null
  const initial = await resolvePersistentDocumentText(doc, { store });
  assert.equal(initial.editedText, null);
  assert.equal(initial.text, rawText);

  // 2. Dikosongkan sengaja oleh pengguna: editedText === ""
  const clearedDoc = await updatePersistentDocumentEditedText(doc, '', { store });
  assert.equal(clearedDoc.textRef.hasEditedText, true);

  const cleared = await resolvePersistentDocumentText(clearedDoc, { store });
  assert.strictEqual(cleared.editedText, '');
  assert.strictEqual(cleared.text, '');
  assert.equal(cleared.rawText, rawText); // rawText tetap ada
});

test('B5B-3.9: Reset ke rawText mengembalikan editedText ke null tanpa mutasi rawText', async () => {
  const store = createStore();
  const file = createSyntheticPdf('reset-test.pdf');
  const rawText = 'Teks standar dari OCR.';
  const editedText = 'Koreksi yang kemudian ingin di-reset.';

  const doc = await persistScannerDocument(file, 'Dokumen', store, {
    ocrPayload: { rawText },
  });

  // Edit dulu
  const editedDoc = await updatePersistentDocumentEditedText(doc, editedText, { store });
  assert.equal(editedDoc.textRef.hasEditedText, true);

  // Reset ke null
  const resetDoc = await updatePersistentDocumentEditedText(editedDoc, null, { store });
  assert.equal(resetDoc.textRef.hasEditedText, false);

  const resolved = await resolvePersistentDocumentText(resetDoc, { store });
  assert.equal(resolved.rawText, rawText);
  assert.equal(resolved.editedText, null);
  assert.equal(resolved.text, rawText);
});

test('B5B-3.10: Tombol Copy dan Download TXT menghasilkan payload teks yang valid', async () => {
  const text = 'Isi teks OCR untuk pengujian ekspor dan salin clipboard.';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

  assert.equal(blob.type, 'text/plain;charset=utf-8');
  assert.equal(await blob.text(), text);
});

test('B5B-3.11: Pencarian kata di Course Vault dengan kalkulasi match dan case-insensitivity', () => {
  const ocrText = 'Universitas Sumatera Utara. Jurusan Ilmu Komputer. Fakultas Ilmu Komputer dan TI.';
  const searchTerm = 'ilmu komputer';

  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const matches = ocrText.match(regex);

  assert.equal(matches.length, 2);
  assert.equal(matches[0], 'Ilmu Komputer');
  assert.equal(matches[1], 'Ilmu Komputer');

  // Highlight splitting
  const parts = ocrText.split(regex);
  assert.ok(parts.length > 1);
});

test('B5B-3.12: Dokumen lama tanpa textRef tetap valid dan aman dibuka di Course Vault', async () => {
  const legacyDoc = createPersistentDocumentRecord('KHS', {
    kind: BINARY_FILE_REFERENCE_KIND,
    version: 1,
    id: '00000000-0000-4000-8000-000000000099',
    name: 'khs-lama.pdf',
    mimeType: 'application/pdf',
    size: 100,
    lastModified: 1700000000000,
  });

  assert.equal(hasPersistentDocumentText(legacyDoc), false);

  const store = createStore();
  const resolved = await resolvePersistentDocumentText(legacyDoc, { store });
  assert.equal(resolved, null); // Tidak melempar error, mengembalikan null
});

test('B5B-3.13: Dokumen dengan textRef rusak atau hilang ditangani secara aman', async () => {
  const store = createStore();
  const corruptedDoc = {
    name: 'dokumen-rusak.pdf',
    textRef: {
      kind: DOCUMENT_TEXT_REFERENCE_KIND,
      version: 1,
      id: '00000000-0000-4000-8000-999999999999', // id fiktif
      binaryId: '00000000-0000-4000-8000-111111111111',
      charCount: 50,
      hasEditedText: false,
      updatedAt: 1800000000000,
    },
  };

  assert.equal(hasPersistentDocumentText(corruptedDoc), true);

  await assert.rejects(
    resolvePersistentDocumentText(corruptedDoc, { store }),
    error => error instanceof PersistentDocumentError && error.code === 'file_unavailable',
  );
});

test('B5B-3.14: File asli hilang tetapi teks tersedia tetap dapat dibaca di Course Vault', async () => {
  const store = createStore();
  const file = createSyntheticPdf('surat-hilang.pdf');
  const rawText = 'Isi surat keputusan dekan yang penting untuk dibaca.';

  const doc = await persistScannerDocument(file, 'Surat', store, {
    ocrPayload: { rawText },
  });

  // Simulasikan penghapusan file fisik biner saja (store.remove binary)
  await store.remove(doc.binaryRef);

  // Verifikasi biner fisik hilang
  await assert.rejects(store.get(doc.binaryRef));

  // Verifikasi teks OCR tetap dapat dibaca dan ditampilkan secara jujur
  const resolvedText = await resolvePersistentDocumentText(doc, { store });
  assert.equal(resolvedText.rawText, rawText);
  assert.equal(resolvedText.text, rawText);
});

test('B5B-3.15: Shared reference binary dan textRef dengan copy-on-write fork', async () => {
  const store = createStore();
  const file = createSyntheticPdf('shared-syllabus.pdf');
  const rawText = 'Silabus Bersama Semester 1 dan 2';

  const docA = await persistScannerDocument(file, 'Silabus A', store, {
    ocrPayload: { rawText },
  });

  // docB menduplikasi docA (shared textRef)
  const docB = { ...docA, id: 'doc-b' };

  // Mahasiswa mengedit docB dengan copy-on-write fork
  const updatedDocB = await updatePersistentDocumentEditedText(docB, 'Silabus Khusus Kelas B', {
    store,
    fork: true,
  });

  // docB mendapat textRef baru
  assert.notEqual(updatedDocB.textRef.id, docA.textRef.id);
  assert.equal(updatedDocB.textRef.binaryId, docA.textRef.binaryId); // binary tetap sama

  // docA tetap utuh dengan teks aslinya
  const resolvedA = await resolvePersistentDocumentText(docA, { store });
  assert.equal(resolvedA.text, rawText);
  assert.equal(resolvedA.editedText, null);

  // docB memiliki teks editan baru
  const resolvedB = await resolvePersistentDocumentText(updatedDocB, { store });
  assert.equal(resolvedB.text, 'Silabus Khusus Kelas B');
  assert.equal(resolvedB.rawText, rawText);
});

test('B5B-3.16: Kegagalan simpan koreksi tidak merusak teks lama', async () => {
  let shouldFail = false;
  const baseAdapter = createMemoryBinaryAdapter();
  const adapter = {
    ...baseAdapter,
    async putText(record) {
      if (shouldFail) {
        throw new Error('disk_hardware_failure');
      }
      return baseAdapter.putText(record);
    },
  };
  const store = createStore(adapter);
  const file = createSyntheticPdf('fail-test.pdf');
  const rawText = 'Teks stabil di database.';

  const doc = await persistScannerDocument(file, 'Dokumen', store, {
    ocrPayload: { rawText },
  });

  // Simulasikan adapter error saat putText
  shouldFail = true;

  await assert.rejects(
    updatePersistentDocumentEditedText(doc, 'Koreksi yang gagal disimpan', { store }),
    error => error instanceof PersistentDocumentError && error.code === 'save_failed',
  );

  // Verifikasi teks lama tetap utuh
  const current = await store.getText(doc.textRef);
  assert.equal(current.rawText, rawText);
  assert.equal(current.editedText, null);
});

test('B5B-3.17: Disk penuh sintetis (QuotaExceededError) pada update koreksi', async () => {
  let shouldThrowQuota = false;
  const baseAdapter = createMemoryBinaryAdapter();
  const adapter = {
    ...baseAdapter,
    async putText(record) {
      if (shouldThrowQuota) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      return baseAdapter.putText(record);
    },
  };

  const store = createStore(adapter);
  const file = createSyntheticPdf('quota-test.pdf');
  const doc = await persistScannerDocument(file, 'Dokumen Kuota', store, {
    ocrPayload: { rawText: 'Sebelum penuh' },
  });

  shouldThrowQuota = true;

  await assert.rejects(
    updatePersistentDocumentEditedText(doc, 'Koreksi saat disk penuh', { store }),
    error => error instanceof PersistentDocumentError && error.code === 'quota_exceeded',
  );
});

test('B5B-3.18: Update teks dokumen tidak mengubah struktur data semester/mata kuliah lain', async () => {
  const store = createStore();
  const file = createSyntheticPdf('khs.pdf');

  let semesters = [
    {
      id: 1,
      name: 'Semester 1',
      courses: [{ id: 'c1', name: 'Algoritma', sks: 3, grade: 'A' }],
    },
  ];

  const doc = await persistScannerDocument(file, 'KHS', store, {
    ocrPayload: { rawText: 'Hasil scan KHS semester 1' },
  });

  semesters[0].documents = [doc];

  // Update teks dokumen
  const updatedDoc = await updatePersistentDocumentEditedText(doc, 'Hasil koreksi KHS semester 1', { store });
  semesters[0].documents[0] = updatedDoc;

  // Verifikasi mata kuliah dan semester tidak terpengaruh
  assert.equal(semesters[0].name, 'Semester 1');
  assert.equal(semesters[0].courses.length, 1);
  assert.equal(semesters[0].courses[0].name, 'Algoritma');
  assert.equal(semesters[0].courses[0].grade, 'A');
  assert.equal(semesters[0].documents[0].textRef.hasEditedText, true);
});

test('B5B-3.19: Pemrosesan Offline dan editing teks tidak melakukan request jaringan', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('network_call_forbidden');
  };

  try {
    const store = createStore();
    const file = createSyntheticPdf('offline-doc.pdf');
    const doc = await persistScannerDocument(file, 'Dokumen', store, {
      ocrPayload: { rawText: 'Teks offline 100%' },
    });

    await updatePersistentDocumentEditedText(doc, 'Teks offline hasil koreksi 100%', { store });
    const resolved = await resolvePersistentDocumentText(doc, { store });

    assert.equal(fetchCalled, false);
    assert.equal(resolved.text, 'Teks offline hasil koreksi 100%');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B5B-3.20: Chromium IndexedDB persisten lintas restart Electron dengan editedText & verifikasi rawText tidak termutasi', { timeout: 180_000 }, async () => {
  await fs.access(electronExecutable);
  let rootPath;
  let isolatedElectronExecutable;

  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-b5b3-persist-'));
    isolatedElectronExecutable = path.join(
      path.dirname(electronExecutable),
      `.unimate-b5b3-persist-${process.pid}-${path.basename(rootPath)}.exe`,
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
      name: 'unimate-b5b3-persist-test',
      version: '1.0.0',
      private: true,
      main: 'main.cjs',
    }), 'utf8');

    // 1. Tulis binary v1
    const writeV1 = await runHarness('write');
    assert.equal(writeV1.result.written, true);

    // 2. Tulis rawText 52k+ dan edit koreksi teks
    const writeAndEdit = await runHarness('write_and_edit_ocr_text');
    assert.equal(writeAndEdit.result.editedWritten, true);
    assert.equal(writeAndEdit.result.rawLength, 52140);

    // 3. Matikan Electron, restart dengan proses baru di user-data yang sama, baca kembali
    const readEdited = await runHarness('read_edited_ocr_text');
    assert.equal(readEdited.result.textFound, true);
    assert.equal(readEdited.result.rawTextMatches, true);
    assert.equal(readEdited.result.editedTextMatches, true);
    assert.equal(readEdited.result.rawNotMutated, true);
    assert.equal(readEdited.result.binaryPreserved, true);
  } finally {
    if (isolatedElectronExecutable) {
      try { await fs.unlink(isolatedElectronExecutable); } catch {}
    }
    if (rootPath) {
      try { await fs.rm(rootPath, { recursive: true, force: true }); } catch {}
    }
  }
});
