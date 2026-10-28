import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createThesisRevisionStore,
  computeTextDiff,
  REVISION_STATUS,
  ThesisRevisionStoreError,
} from '../src/services/thesisRevisionStore.js';

test('B7B.1: Membuat dan mengambil catatan revisi dengan metadata lengkap', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const note = await store.createNote({
    documentId: 'doc_thesis_001',
    title: 'Revisi Rumusan Masalah',
    content: 'Perlu memperjelas batasan implementasi sistem pada lingkungan offline.',
    sectionId: 'sec_1_1',
    sectionTitle: '1.2 Rumusan Masalah',
    status: REVISION_STATUS.TODO,
    checklist: [
      { text: 'Tambah batasan web storage 50MB', done: false },
      { text: 'Perjelas lingkup platform Electron', done: true },
    ],
    supervisorNote: 'Fokuskan pada aspek privasi data lokal tanpa cloud.',
  });

  assert.ok(note.id.startsWith('note_'));
  assert.equal(note.documentId, 'doc_thesis_001');
  assert.equal(note.title, 'Revisi Rumusan Masalah');
  assert.equal(note.status, 'todo');
  assert.equal(note.checklist.length, 2);
  assert.equal(note.checklist[0].done, false);
  assert.equal(note.checklist[1].done, true);
  assert.equal(note.supervisorNote, 'Fokuskan pada aspek privasi data lokal tanpa cloud.');
  assert.equal(note.history.length, 1);
  assert.equal(note.history[0].action, 'created');

  // Ambil catatan berdasarkan documentId
  const notes = await store.getNotesByDocument('doc_thesis_001');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, note.id);
});

test('B7B.2: Memperbarui catatan revisi, checklist, status, dan mencatat riwayat perubahan', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const initialNote = await store.createNote({
    documentId: 'doc_thesis_002',
    title: 'Perbaikan Bab 2',
    status: REVISION_STATUS.TODO,
    checklist: [{ text: 'Tambah referensi jurnal', done: false }],
  });

  // Update status ke IN_PROGRESS dan tandai checklist selesai
  const updatedNote = await store.updateNote(initialNote.id, {
    status: REVISION_STATUS.IN_PROGRESS,
    checklist: [{ text: 'Tambah referensi jurnal', done: true }],
  });

  assert.equal(updatedNote.status, 'in_progress');
  assert.equal(updatedNote.checklist[0].done, true);
  assert.ok(updatedNote.history.length >= 2, 'Riwayat harus mencatat mutasi pembaruan');

  // Update lagi ke DONE
  const doneNote = await store.updateNote(initialNote.id, {
    status: REVISION_STATUS.DONE,
  });
  assert.equal(doneNote.status, 'done');
});

test('B7B.3: Menghapus catatan revisi hanya dapat dilakukan setelah konfirmasi eksplisit', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const note = await store.createNote({
    documentId: 'doc_thesis_003',
    title: 'Catatan untuk Dihapus',
  });

  // Hapus tanpa konfirmasi -> harus throw error confirmation_required
  await assert.rejects(
    async () => {
      await store.deleteNote(note.id, { confirmed: false });
    },
    (err) => {
      assert.ok(err instanceof ThesisRevisionStoreError);
      assert.equal(err.code, 'confirmation_required');
      return true;
    }
  );

  // Pastikan catatan belum terhapus
  const notesBefore = await store.getNotesByDocument('doc_thesis_003');
  assert.equal(notesBefore.length, 1);

  // Hapus dengan konfirmasi eksplisit
  const deleteResult = await store.deleteNote(note.id, { confirmed: true });
  assert.equal(deleteResult.deleted, true);

  const notesAfter = await store.getNotesByDocument('doc_thesis_003');
  assert.equal(notesAfter.length, 0);
});

test('B7B.4: Snapshot versi teks skripsi bersifat append-only dan tidak saling menimpa', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const textV1 = 'BAB I PENDAHULUAN\nDraft awal skripsi mahasiswa.';
  const textV2 = 'BAB I PENDAHULUAN\nDraft kedua skripsi setelah masukan dosen pembimbing.';
  const textV3 = 'BAB I PENDAHULUAN\nDraft final siap uji coba.';

  const snap1 = await store.saveSnapshot({
    documentId: 'doc_thesis_004',
    text: textV1,
    label: 'Draft Awal',
  });
  assert.equal(snap1.versionNumber, 1);
  assert.equal(snap1.text, textV1);

  const snap2 = await store.saveSnapshot({
    documentId: 'doc_thesis_004',
    text: textV2,
    label: 'Revisi Bimbingan 1',
  });
  assert.equal(snap2.versionNumber, 2);
  assert.equal(snap2.text, textV2);

  const snap3 = await store.saveSnapshot({
    documentId: 'doc_thesis_004',
    text: textV3,
    label: 'Revisi Bimbingan 2',
  });
  assert.equal(snap3.versionNumber, 3);
  assert.equal(snap3.text, textV3);

  // Verifikasi versi lama tetap utuh
  const allSnapshots = await store.getSnapshotsByDocument('doc_thesis_004');
  assert.equal(allSnapshots.length, 3);
  assert.equal(allSnapshots[0].versionNumber, 1);
  assert.equal(allSnapshots[0].text, textV1);
  assert.equal(allSnapshots[1].versionNumber, 2);
  assert.equal(allSnapshots[1].text, textV2);
  assert.equal(allSnapshots[2].versionNumber, 3);
  assert.equal(allSnapshots[2].text, textV3);

  // Ambil snapshot spesifik
  const fetchedSnap1 = await store.getSnapshot(snap1.id);
  assert.equal(fetchedSnap1.text, textV1);
});

test('B7B.5: computeTextDiff menghitung perbandingan baris dua versi secara akurat', () => {
  const oldText = [
    'BAB I PENDAHULUAN',
    '1.1 Latar Belakang Masalah',
    'Penelitian ini menggunakan metode konvensional.',
    '1.2 Tujuan',
  ].join('\n');

  const newText = [
    'BAB I PENDAHULUAN',
    '1.1 Latar Belakang Masalah',
    'Penelitian ini menggunakan metode machine learning terisolasi.',
    'Metode ini memproses data secara offline.',
    '1.2 Tujuan',
  ].join('\n');

  const diff = computeTextDiff(oldText, newText);

  assert.equal(diff.isIdentical, false);
  assert.equal(diff.removedCount, 1, 'Harus mendeteksi 1 baris dihapus');
  assert.equal(diff.addedCount, 2, 'Harus mendeteksi 2 baris ditambahkan');
  assert.ok(diff.diffLines.length >= 5);

  const removedLine = diff.diffLines.find(l => l.type === 'removed');
  assert.ok(removedLine.text.includes('metode konvensional'));

  const addedLines = diff.diffLines.filter(l => l.type === 'added');
  assert.ok(addedLines.some(l => l.text.includes('machine learning terisolasi')));
  assert.ok(addedLines.some(l => l.text.includes('secara offline')));
});

test('B7B.6: computeTextDiff menangani teks identik dan teks kosong secara aman', () => {
  const sameText = 'BAB I PENDAHULUAN\nLatar belakang skripsi.';
  const diffSame = computeTextDiff(sameText, sameText);
  assert.equal(diffSame.isIdentical, true);
  assert.equal(diffSame.addedCount, 0);
  assert.equal(diffSame.removedCount, 0);
  assert.equal(diffSame.unchangedCount, 2);

  const diffEmpty = computeTextDiff('', '');
  assert.equal(diffEmpty.isIdentical, true);
  assert.equal(diffEmpty.addedCount, 0);
  assert.equal(diffEmpty.removedCount, 0);
});

test('B7B.7: Penanganan input tidak valid dan error fail-closed', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  // Dokumen ID tidak valid saat buat catatan
  await assert.rejects(
    async () => {
      await store.createNote({ documentId: '', title: 'Test' });
    },
    { code: 'invalid_document_id' }
  );

  // Judul kosong
  await assert.rejects(
    async () => {
      await store.createNote({ documentId: 'doc_1', title: '   ' });
    },
    { code: 'invalid_title' }
  );

  // Dokumen ID tidak valid saat simpan snapshot
  await assert.rejects(
    async () => {
      await store.saveSnapshot({ documentId: null, text: 'Teks' });
    },
    { code: 'invalid_document_id' }
  );

  // Teks snapshot bukan string
  await assert.rejects(
    async () => {
      await store.saveSnapshot({ documentId: 'doc_1', text: 12345 });
    },
    { code: 'invalid_text' }
  );
});
