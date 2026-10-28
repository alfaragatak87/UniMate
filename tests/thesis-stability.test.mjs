import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveThesisDocumentText,
  chunkTextForVirtualization,
} from '../src/services/thesisDocumentReader.js';
import {
  createThesisRevisionStore,
  REVISION_STATUS,
} from '../src/services/thesisRevisionStore.js';

test('B8A.1: Isolasi Catatan & Snapshot: Dokumen A dan Dokumen B tidak pernah bertukar data', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const docAId = 'doc_skripsi_a_001';
  const docBId = 'doc_skripsi_b_002';

  // Buat catatan untuk Dokumen A
  await store.createNote({
    documentId: docAId,
    title: 'Catatan Dokumen A',
    content: 'Koreksi khusus Bab 1 Skripsi A',
    status: REVISION_STATUS.TODO,
  });

  // Buat snapshot untuk Dokumen A
  await store.saveSnapshot({
    documentId: docAId,
    text: 'Teks snapshot Dokumen A',
    label: 'Versi 1 A',
  });

  // Buat catatan untuk Dokumen B
  await store.createNote({
    documentId: docBId,
    title: 'Catatan Dokumen B',
    content: 'Koreksi khusus Bab 2 Skripsi B',
    status: REVISION_STATUS.IN_PROGRESS,
  });

  // Buat snapshot untuk Dokumen B
  await store.saveSnapshot({
    documentId: docBId,
    text: 'Teks snapshot Dokumen B',
    label: 'Versi 1 B',
  });

  // Verifikasi Catatan Dokumen A
  const notesA = await store.getNotesByDocument(docAId);
  assert.equal(notesA.length, 1);
  assert.equal(notesA[0].title, 'Catatan Dokumen A');
  assert.equal(notesA[0].documentId, docAId);

  // Verifikasi Snapshot Dokumen A
  const snapsA = await store.getSnapshotsByDocument(docAId);
  assert.equal(snapsA.length, 1);
  assert.equal(snapsA[0].label, 'Versi 1 A');
  assert.equal(snapsA[0].documentId, docAId);

  // Verifikasi Catatan Dokumen B
  const notesB = await store.getNotesByDocument(docBId);
  assert.equal(notesB.length, 1);
  assert.equal(notesB[0].title, 'Catatan Dokumen B');
  assert.equal(notesB[0].documentId, docBId);

  // Verifikasi Snapshot Dokumen B
  const snapsB = await store.getSnapshotsByDocument(docBId);
  assert.equal(snapsB.length, 1);
  assert.equal(snapsB[0].label, 'Versi 1 B');
  assert.equal(snapsB[0].documentId, docBId);
});

test('B8A.2: Dua berkas dengan nama sama tetapi ID berbeda diperlakukan sebagai entitas berbeda', async () => {
  const store = createThesisRevisionStore({ useMemoryFallback: true });

  const fileId1 = 'course_101_file_draft.pdf';
  const fileId2 = 'course_202_file_draft.pdf';
  const sameFileName = 'draft_skripsi.pdf';

  assert.equal(fileId1 !== fileId2, true, 'ID harus berbeda meskipun nama file identik');

  await store.createNote({
    documentId: fileId1,
    title: `Catatan untuk ${sameFileName} (Semester 1)`,
  });

  await store.createNote({
    documentId: fileId2,
    title: `Catatan untuk ${sameFileName} (Semester 2)`,
  });

  const notes1 = await store.getNotesByDocument(fileId1);
  const notes2 = await store.getNotesByDocument(fileId2);

  assert.equal(notes1.length, 1);
  assert.equal(notes2.length, 1);
  assert.notEqual(notes1[0].title, notes2[0].title);
});

test('B8A.3: Chunking virtualisasi untuk dokumen ekstra panjang (> 50.000 karakter)', () => {
  const hugeText = 'BAB I PENDAHULUAN\n' + 'Kalimat pengantar skripsi yang berulang. '.repeat(1500);
  assert.ok(hugeText.length > 50000, 'Dokumen harus lebih besar dari 50.000 karakter');

  const chunks = chunkTextForVirtualization(hugeText, 4000);
  assert.ok(chunks.length >= 12, 'Harus terbagi ke dalam setidaknya 12 chunk aman');

  // Pastikan rekonsiliasi chunk kembali ke teks utuh 1:1 tanpa kehilangan karakter
  const reassembled = chunks.map(c => c.content).join('');
  assert.equal(reassembled.length, hugeText.length);
  assert.equal(reassembled, hugeText);
});

test('B8A.4: editedText kosong tetap dihormati dan rawText biner tidak berubah', () => {
  const originalVaultFile = {
    name: 'Skripsi_Original.pdf',
    binaryRef: { id: 'bin_vault_99' },
    textRef: {
      id: 'txt_vault_99',
      rawText: 'BAB I PENDAHULUAN\nTeks OCR asli di vault.',
      editedText: '', // Pengguna mengosongkan teks draf
    },
  };

  const resolved = resolveThesisDocumentText(originalVaultFile.textRef);

  assert.equal(resolved.text, '');
  assert.equal(resolved.isEdited, true);
  assert.equal(resolved.charCount, 0);

  // Pastikan rawText pada objek sumber tidak termutasi
  assert.equal(originalVaultFile.textRef.rawText, 'BAB I PENDAHULUAN\nTeks OCR asli di vault.');
});
