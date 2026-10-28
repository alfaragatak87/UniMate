/**
 * tests/thesis-hardening.test.mjs
 * 
 * Pengujian komprehensif Hardening Workspace Skripsi (B9A):
 * - Identitas dokumen stabil dan backward-compatibility alias legacy
 * - Isolasi catatan dan snapshot revisi saat file di-rename atau di-reorder
 * - Virtualisasi & chunking teks panjang (20k, 100k, 500k karakter) beserta pengukuran durasi
 * - Keutuhan pencarian kata & navigasi pada teks raksasa
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStableDocumentIdentity,
  parseThesisStructure,
  searchThesisText,
  chunkTextForVirtualization,
} from '../src/services/thesisDocumentReader.js';
import {
  thesisRevisionStore,
  REVISION_STATUS,
} from '../src/services/thesisRevisionStore.js';
import { isNoteAlreadyInKanban } from '../src/services/thesisKanbanLink.js';
import {
  createThesisRevisionBackup,
  validateThesisRevisionBackup,
} from '../src/services/thesisRevisionBackup.js';
import {
  createAcademicBackup,
  ACADEMIC_STORAGE_KEYS,
} from '../src/services/academicBackup.js';

test('B9A.1: createStableDocumentIdentity memprioritaskan ID fisik persisten dan menjaga alias legacy', () => {
  const fileWithBinary = {
    id: 'f_att_101',
    name: 'Draf_Bab_1_Final.pdf',
    binaryRef: { id: 'bin_vault_9999_hash', name: 'Draf_Bab_1_Final.pdf', size: 45000 },
  };

  const identity1 = createStableDocumentIdentity({
    courseId: 'course_skripsi_1',
    semesterId: 'sem_7',
    file: fileWithBinary,
    fileIndex: 0,
  });

  assert.equal(identity1.canonicalId, 'doc_file_bin_vault_9999_hash');
  assert.equal(identity1.isPersistent, true);
  assert.ok(identity1.aliases.includes('doc_file_bin_vault_9999_hash'));
  assert.ok(identity1.aliases.includes('doc_vault_course_skripsi_1_bin_vault_9999_hash'));

  // Jika allowPositionalFallback secara eksplisit diaktifkan untuk migrasi backward
  const identityWithPositional = createStableDocumentIdentity({
    courseId: 'course_skripsi_1',
    semesterId: 'sem_7',
    file: fileWithBinary,
    fileIndex: 0,
    allowPositionalFallback: true,
  });
  assert.ok(identityWithPositional.aliases.includes('doc_vault_course_skripsi_1_0_Draf_Bab_1_Final.pdf'));
  assert.ok(identityWithPositional.aliases.includes('doc_vault_course_skripsi_1_Draf_Bab_1_Final.pdf'));

  // Kasus: Urutan file bergeser dari index 0 ke index 4 (misal karena ada file baru disisipkan)
  const identityShifted = createStableDocumentIdentity({
    courseId: 'course_skripsi_1',
    semesterId: 'sem_7',
    file: fileWithBinary,
    fileIndex: 4,
  });
  // canonicalId TETAP SAMA karena mengacu pada binaryRef.id
  assert.equal(identityShifted.canonicalId, identity1.canonicalId);

  // Kasus: File di-rename namanya oleh pengguna
  const fileRenamed = {
    ...fileWithBinary,
    name: 'Draf_Bab_1_Revisi_Dosen_ACC.pdf',
  };
  const identityRenamed = createStableDocumentIdentity({
    courseId: 'course_skripsi_1',
    semesterId: 'sem_7',
    file: fileRenamed,
    fileIndex: 0,
  });
  // canonicalId TETAP SAMA karena berkas fisik biner tidak berubah
  assert.equal(identityRenamed.canonicalId, identity1.canonicalId);

  // Kasus fallback: File tanpa binaryRef maupun id
  const legacyFile = { name: 'Catatan_Manual.docx' };
  const identityFallback = createStableDocumentIdentity({
    courseId: 'course_abc',
    file: legacyFile,
    fileIndex: 2,
  });
  assert.equal(identityFallback.canonicalId, 'doc_vault_course_abc_Catatan_Manual.docx');
  assert.equal(identityFallback.isPersistent, false);
});

test('B9A.2: thesisRevisionStore membaca catatan historis legacy melalui array alias ID dokumen', async () => {
  const legacyDocId = 'doc_vault_course_skripsi_0_bab1.pdf';
  const canonicalDocId = 'doc_file_bin_persistent_123';
  const aliases = [canonicalDocId, legacyDocId];

  // 1. Simpan catatan lama di bawah legacyDocId
  const legacyNote = await thesisRevisionStore.createNote({
    documentId: legacyDocId,
    title: 'Catatan Warisan Sebelum Update B9A',
    content: 'Perlu revisi metodologi di Bab 1',
    status: REVISION_STATUS.TODO,
  });

  // 2. Simpan catatan baru di bawah canonicalDocId
  const newNote = await thesisRevisionStore.createNote({
    documentId: canonicalDocId,
    title: 'Catatan Baru dengan ID Persisten',
    content: 'ACC dari pembimbing utama',
    status: REVISION_STATUS.DONE,
  });

  // 3. Ambil catatan menggunakan daftar aliases [canonical, legacy]
  const notesUnified = await thesisRevisionStore.getNotesByDocument(aliases);

  assert.ok(notesUnified.length >= 2);
  const foundLegacy = notesUnified.find(n => n.id === legacyNote.id);
  const foundNew = notesUnified.find(n => n.id === newNote.id);
  assert.ok(foundLegacy, 'Catatan legacy wajib terbaca tanpa migrasi destruktif');
  assert.ok(foundNew, 'Catatan baru wajib terbaca bersamaan');

  // De-duplikasi: jika array alias memuat ID duplikat, tidak ada catatan ganda
  const notesWithDuplicateAliases = await thesisRevisionStore.getNotesByDocument([canonicalDocId, canonicalDocId, legacyDocId]);
  const idsOnly = notesWithDuplicateAliases.map(n => n.id);
  const uniqueIds = new Set(idsOnly);
  assert.equal(idsOnly.length, uniqueIds.size, 'Tidak boleh ada catatan terduplikasi di hasil query');
});

test('B9A.3: Isolasi Dokumen: Berkas dengan nama sama tetapi ID berbeda tidak saling bocor', async () => {
  const docA = createStableDocumentIdentity({
    courseId: 'course_sem1_ti',
    file: { id: 'file_a_unique', name: 'proposal.pdf' },
  });
  const docB = createStableDocumentIdentity({
    courseId: 'course_sem2_si',
    file: { id: 'file_b_unique', name: 'proposal.pdf' },
  });

  assert.notEqual(docA.canonicalId, docB.canonicalId);

  // Buat catatan di Dokumen A
  const noteA = await thesisRevisionStore.createNote({
    documentId: docA.canonicalId,
    title: 'Revisi Proposal TI',
    content: 'Khusus prodi TI',
  });

  // Buat snapshot di Dokumen B
  const snapB = await thesisRevisionStore.saveSnapshot({
    documentId: docB.canonicalId,
    text: 'Draf Proposal SI Versi 1',
    label: 'Versi Draf Awal SI',
  });

  const notesInB = await thesisRevisionStore.getNotesByDocument(docB.aliases);
  const snapsInA = await thesisRevisionStore.getSnapshotsByDocument(docA.aliases);

  assert.equal(notesInB.some(n => n.id === noteA.id), false, 'Catatan Dokumen A tidak boleh bocor ke Dokumen B');
  assert.equal(snapsInA.some(s => s.id === snapB.id), false, 'Snapshot Dokumen B tidak boleh bocor ke Dokumen A');
});

test('B9A.4: Pengujian Virtualisasi & Chunking Dokumen Raksasa (20k, 100k, 500k karakter)', () => {
  // Generator teks sintetis dengan heading bab dan paragraf
  function generateSyntheticThesis(targetChars) {
    const chapters = ['BAB I PENDAHULUAN', 'BAB II TINJAUAN PUSTAKA', 'BAB III METODOLOGI', 'BAB IV HASIL DAN PEMBAHASAN', 'BAB V KESIMPULAN'];
    let result = '';
    let chIdx = 0;
    while (result.length < targetChars) {
      const heading = `\n\n${chapters[chIdx % chapters.length]}\n`;
      const paragraph = `Penelitian ini mengkaji penerapan arsitektur offline-first pada sistem pendamping akademik mahasiswa tingkat akhir. Kata kunci optimasi: KATA_KUNCI_TEST_${chIdx}. Seluruh proses pemindaian dan ekstraksi teks berjalan pada layer digital tanpa komputasi cloud.\n`.repeat(5);
      result += heading + paragraph;
      chIdx += 1;
    }
    return result.slice(0, targetChars);
  }

  const sizes = [20_000, 100_000, 500_000];
  const measurements = [];

  for (const size of sizes) {
    const text = generateSyntheticThesis(size);
    assert.equal(text.length, size);

    // 1. Ukur parse struktur
    const t0 = performance.now();
    const structure = parseThesisStructure(text);
    const tParse = performance.now() - t0;

    // 2. Ukur chunking
    const t1 = performance.now();
    const chunks = chunkTextForVirtualization(text, 4000);
    const tChunk = performance.now() - t1;

    // 3. Ukur pencarian
    const t2 = performance.now();
    const searchRes = searchThesisText(text, 'KATA_KUNCI_TEST_0');
    const tSearch = performance.now() - t2;

    assert.ok(structure.sections.length > 0);
    assert.ok(chunks.length > 0);
    assert.ok(searchRes.totalMatches > 0);

    // Verifikasi bahwa panjang total chunk sama persis dengan panjang teks asli
    const reassembled = chunks.map(c => c.content).join('');
    assert.equal(reassembled.length, size);

    measurements.push({
      size,
      tParseMs: tParse.toFixed(2),
      tChunkMs: tChunk.toFixed(2),
      tSearchMs: tSearch.toFixed(2),
      chunkCount: chunks.length,
      sectionCount: structure.sections.length,
    });
  }

  // Tampilkan data pengukuran faktual untuk laporan
  // Pastikan waktu pemrosesan dokumen 500.000 karakter tetap berada dalam batas wajar (< 100ms)
  const perf500k = measurements.find(m => m.size === 500_000);
  assert.ok(perf500k, 'Pengukuran 500k karakter harus ada');
  assert.ok(Number(perf500k.tChunkMs) < 150, `Chunking 500k karakter harus cepat (<150ms), aktual: ${perf500k.tChunkMs}ms`);
  assert.ok(Number(perf500k.tSearchMs) < 100, `Pencarian 500k karakter harus responsif (<100ms), aktual: ${perf500k.tSearchMs}ms`);
});

test('B9A.5: Audit Kanban: Anti-duplikasi kartu dan perlindungan catatan sumber', () => {
  const sampleBoard = {
    todo: [{ id: 'k1', title: 'Tugas Lain', desc: '', sourceNoteId: 'some_other_note' }],
    inProgress: [{ id: 'k2', title: 'Tugas Bab 1', desc: 'Rincian', sourceNoteId: 'note_target_123' }],
    review: [],
    done: [],
  };

  // 1. Deteksi apakah catatan sudah ada di Kanban
  const check = isNoteAlreadyInKanban(sampleBoard, 'note_target_123');
  assert.equal(check.exists, true);
  assert.equal(check.columnId, 'inProgress');
  assert.equal(check.task.id, 'k2');

  // 2. Catatan yang belum pernah dikonversi
  const checkUnlinked = isNoteAlreadyInKanban(sampleBoard, 'note_brand_new_999');
  assert.equal(checkUnlinked.exists, false);
  assert.equal(checkUnlinked.columnId, null);
});

test('B9A.6: Anti-collision alias: Berkas baru pada posisi dan nama yang sama tidak mewarisi catatan berkas lama', async () => {
  const courseId = 'course_vault_skripsi_col';
  const fileName = 'Skripsi_Final.pdf';
  const fileIndex = 0;

  // 1. Catatan berkas lama (sebelum B9) tersimpan dengan format positional legacy
  const legacyDocId = `doc_vault_${courseId}_${fileIndex}_${fileName}`;
  const oldNote = await thesisRevisionStore.createNote({
    documentId: legacyDocId,
    title: 'Catatan Revisi Berkas Lama',
    content: 'Ini adalah catatan untuk berkas lama yang sudah dihapus/digantikan.',
  });

  // 2. Berkas baru diunggah ke posisi dan nama yang sama persis, tetapi memiliki binaryRef unik baru
  const newFile = {
    name: fileName,
    binaryRef: { id: 'bin_vault_brand_new_9988', name: fileName, size: 78000 },
  };
  const identityNew = createStableDocumentIdentity({
    courseId,
    file: newFile,
    fileIndex,
  });

  // 3. Query catatan untuk berkas baru menggunakan aliases resminya
  const notesForNewFile = await thesisRevisionStore.getNotesByDocument(identityNew.aliases);

  // Verifikasi: catatan berkas lama TIDAK tertaut ke berkas baru
  const containsOldNote = notesForNewFile.some(n => n.id === oldNote.id);
  assert.equal(containsOldNote, false, 'Berkas baru dengan ID unik tidak boleh mewarisi catatan berkas lama');
});

test('B12-AUDIT.1: Audit cakupan backup: Academic Backup mencakup semester, tugas, proyek & biner vault, namun TIDAK mencakup catatan/snapshot revisi skripsi (terpisah)', () => {
  // 1. Verifikasi whitelist skema academic backup
  assert.ok(ACADEMIC_STORAGE_KEYS.includes('college_semesters'));
  assert.ok(ACADEMIC_STORAGE_KEYS.includes('college_tasks'));
  assert.ok(ACADEMIC_STORAGE_KEYS.includes('college_projects'));
  assert.ok(ACADEMIC_STORAGE_KEYS.includes('college_thesis')); // Kanban board cards
  // Catatan revisi dan snapshots skripsi TIDAK berada di localStorage/academicBackup
  assert.equal(ACADEMIC_STORAGE_KEYS.includes('thesis_notes'), false);
  assert.equal(ACADEMIC_STORAGE_KEYS.includes('thesis_snapshots'), false);

  // 2. Simulasi pembuatan academic backup
  const fakeStorage = {
    getItem: (key) => {
      if (key === 'college_semesters') return JSON.stringify([{ id: 's1', name: 'Semester 1', courses: [] }]);
      if (key === 'college_tasks') return JSON.stringify([{ id: 't1', title: 'Tugas 1' }]);
      if (key === 'college_projects') return JSON.stringify([{ id: 'p1', title: 'Proyek 1' }]);
      if (key === 'college_thesis') return JSON.stringify({ todo: [], inProgress: [], review: [], done: [] });
      return null;
    },
  };

  const academicBackup = createAcademicBackup(fakeStorage);
  assert.equal(academicBackup.format, 'unimate-academic-backup');
  assert.ok(academicBackup.data.college_semesters);
  assert.ok(academicBackup.data.college_tasks);
  assert.ok(academicBackup.data.college_projects);
  assert.equal(academicBackup.data.thesis_notes, undefined);
  assert.equal(academicBackup.data.thesis_snapshots, undefined);
});

test('B12-AUDIT.2: Audit kebenaran backup revisi skripsi: Diekspor terpisah dengan SHA-256 dan peringatan non-enkripsi', async () => {
  const revisionBackup = await createThesisRevisionBackup({
    documentId: 'doc_skripsi_sintetis_b12',
    documentTitle: 'Draf Skripsi Sintetis B12',
    notes: [
      {
        id: 'n_b12_1',
        title: 'Perbaiki Abstrak',
        content: 'Tuliskan metrik hasil pengujian.',
        status: REVISION_STATUS.TODO,
        checklist: [{ text: 'Tulis 250 kata', done: false }],
        supervisorNote: 'Gunakan Bahasa Indonesia baku.',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    snapshots: [
      {
        id: 's_b12_1',
        versionNumber: 1,
        label: 'Versi Draf Awal',
        summary: 'Bab 1 sampai Bab 3',
        text: 'BAB I PENDAHULUAN\nLatar Belakang Penelitian...',
        createdAt: 1000,
      },
    ],
  });

  // Validasi format dan peringatan non-enkripsi
  assert.equal(revisionBackup.format, 'unimate-thesis-revision-backup');
  assert.equal(revisionBackup.version, 1);
  assert.ok(revisionBackup.warning.includes('TIDAK DIENKRIPSI'));
  assert.ok(revisionBackup.checksum.startsWith('sha256:'));
  assert.equal(revisionBackup.notes.length, 1);
  assert.equal(revisionBackup.snapshots.length, 1);

  // Verifikasi validasi integritas
  const validation = await validateThesisRevisionBackup(revisionBackup);
  assert.equal(validation.valid, true);
  assert.equal(validation.noteCount, 1);
  assert.equal(validation.snapshotCount, 1);
});

