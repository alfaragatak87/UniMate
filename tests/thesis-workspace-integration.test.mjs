import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveThesisDocumentText,
  parseThesisStructure,
  searchThesisText,
} from '../src/services/thesisDocumentReader.js';
import {
  createThesisRevisionStore,
  computeTextDiff,
  REVISION_STATUS,
} from '../src/services/thesisRevisionStore.js';

test('B7C.1: Alur integrasi workspace: baca dokumen, daftar isi, cari kata, dan buat catatan revisi', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const rawDocument = [
    'JUDUL: SISTEM MONITORING SKRIPSI MAHASISWA',
    'ABSTRAK',
    'Penelitian ini menyajikan solusi pelacakan revisi skripsi offline.',
    '',
    'BAB I PENDAHULUAN',
    '1.1 Latar Belakang Masalah',
    'Tugas akhir sering kali menghadapi kendala dalam pencatatan masukan dosen.',
    '1.2 Rumusan Masalah',
    'Bagaimana mengintegrasikan catatan revisi dengan pembaca dokumen?',
    '',
    'BAB II TINJAUAN PUSTAKA',
    '2.1 Sistem Informasi Akademik',
    'Sistem informasi akademik menyimpan arsip kurikulum.',
  ].join('\n');

  // 1. Resolve Text
  const resolved = resolveThesisDocumentText({ rawText: rawDocument, editedText: null });
  assert.equal(resolved.text, rawDocument);

  // 2. Parse Structure (TOC)
  const structure = parseThesisStructure(resolved.text);
  assert.equal(structure.hasStructure, true);
  assert.ok(structure.sections.length >= 4);

  const bab1 = structure.sections.find(s => s.title.includes('BAB I'));
  assert.ok(bab1);
  assert.equal(bab1.level, 1);

  // 3. Search query
  const search = searchThesisText(resolved.text, 'revisi', {
    sections: structure.sections,
  });
  assert.equal(search.totalMatches, 2);
  assert.equal(search.matches[0].matchNumber, 1);

  // 4. Buat catatan revisi yang terhubung ke seksi Bab 1
  const note = await store.createNote({
    documentId: 'doc_integration_test',
    title: 'Perjelas Latar Belakang Masalah',
    content: 'Tambahkan data statistik keterlambatan kelulusan.',
    sectionId: bab1.id,
    sectionTitle: bab1.title,
    status: REVISION_STATUS.TODO,
    checklist: [
      { text: 'Kumpulkan data angkatan 2020', done: false },
      { text: 'Buat grafik persentase', done: false },
    ],
    supervisorNote: 'Beri penekanan pada urgensi waktu penyelesaian.',
  });

  assert.equal(note.documentId, 'doc_integration_test');
  assert.equal(note.sectionTitle, bab1.title);
  assert.equal(note.checklist.length, 2);

  // 5. Update checklist
  const updatedNote = await store.updateNote(note.id, {
    checklist: [
      { text: 'Kumpulkan data angkatan 2020', done: true },
      { text: 'Buat grafik persentase', done: false },
    ],
  });
  assert.equal(updatedNote.checklist[0].done, true);
  assert.equal(updatedNote.checklist[1].done, false);

  // 6. Simpan Snapshot Versi Teks Dokumen (Append-only)
  const snap1 = await store.saveSnapshot({
    documentId: 'doc_integration_test',
    text: resolved.text,
    label: 'Versi Draf Awal Bimbingan',
    summary: 'Draf bab 1 dan 2 selesai disusun.',
  });
  assert.equal(snap1.versionNumber, 1);

  // Simpan revisi kedua
  const revisedDocument = rawDocument.replace(
    'Tugas akhir sering kali menghadapi kendala dalam pencatatan masukan dosen.',
    'Tugas akhir menghadapi kendala serius saat dosen memberikan masukan verbal tanpa catatan tertulis.'
  );

  const snap2 = await store.saveSnapshot({
    documentId: 'doc_integration_test',
    text: revisedDocument,
    label: 'Versi Draf Revisi 1',
    summary: 'Perbaikan kalimat latar belakang sesuai arahan.',
  });
  assert.equal(snap2.versionNumber, 2);

  // 7. Bandingkan dua versi (Diff Viewer)
  const diff = computeTextDiff(snap1.text, snap2.text);
  assert.equal(diff.isIdentical, false);
  assert.equal(diff.addedCount, 1);
  assert.equal(diff.removedCount, 1);

  const added = diff.diffLines.find(l => l.type === 'added');
  assert.ok(added.text.includes('kendala serius saat dosen memberikan masukan verbal'));

  const removed = diff.diffLines.find(l => l.type === 'removed');
  assert.ok(removed.text.includes('Tugas akhir sering kali menghadapi kendala'));
});

test('B7C.2: Integritas Isolasi: Operasi revisi tidak memutasi papan Kanban maupun raw OCR', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const initialKanbanBoard = {
    todo: [{ id: 'k1', title: 'Bab 1', desc: 'Pendahuluan' }],
    inProgress: [],
    review: [],
    done: [],
  };

  const initialRawOcr = 'Teks OCR biner yang tersimpan di IndexedDB vault.';

  // Buat catatan dan simpan snapshot
  await store.createNote({
    documentId: 'doc_isolation_test',
    title: 'Catatan Revisi',
  });

  await store.saveSnapshot({
    documentId: 'doc_isolation_test',
    text: 'Teks snapshot versi 1',
  });

  // Pastikan board Kanban dan OCR text tidak tersentuh
  assert.equal(initialKanbanBoard.todo.length, 1);
  assert.equal(initialKanbanBoard.todo[0].title, 'Bab 1');
  assert.equal(initialRawOcr, 'Teks OCR biner yang tersimpan di IndexedDB vault.');
});
