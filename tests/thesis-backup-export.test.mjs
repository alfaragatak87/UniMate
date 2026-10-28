import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilename,
  exportSnapshotToTxt,
  exportSnapshotToMarkdown,
  createThesisRevisionBackup,
  validateThesisRevisionBackup,
  restoreThesisRevisionBackupIsolated,
  THESIS_BACKUP_FORMAT,
  THESIS_BACKUP_VERSION,
  ThesisBackupError,
} from '../src/services/thesisRevisionBackup.js';
import { createThesisRevisionStore } from '../src/services/thesisRevisionStore.js';

test('B8B.1: sanitizeFilename membersihkan karakter ilegal Windows/POSIX dan membatasi panjang', () => {
  const dirty = 'Bab 1: Pendahuluan/Latar Belakang?*<>"|';
  const clean = sanitizeFilename(dirty, 'txt');
  assert.equal(clean.includes(':'), false);
  assert.equal(clean.includes('/'), false);
  assert.equal(clean.includes('?'), false);
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('>'), false);
  assert.ok(clean.endsWith('.txt'));

  const longName = 'A'.repeat(200);
  const shortened = sanitizeFilename(longName, 'md');
  assert.ok(shortened.length <= 85);
});

test('B8B.2: exportSnapshotToTxt dan exportSnapshotToMarkdown memvalidasi snapshot', () => {
  // Snapshot tidak valid
  assert.throws(
    () => exportSnapshotToTxt(null),
    { code: 'invalid_snapshot' }
  );

  assert.throws(
    () => exportSnapshotToMarkdown({ text: 123 }),
    { code: 'invalid_snapshot' }
  );
});

test('B8B.3: createThesisRevisionBackup menghasilkan paket backup mandiri ber-checksum SHA-256', async () => {
  const notes = [
    {
      id: 'note_1',
      documentId: 'doc_1',
      title: 'Perbaiki Metodologi',
      content: 'Tambahkan bagan alur.',
      sectionTitle: 'BAB III METODOLOGI PENELITIAN',
      status: 'todo',
      checklist: [{ text: 'Gambar flowchart', done: true }],
      supervisorNote: 'Bagan harus jelas.',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const snapshots = [
    {
      id: 'snap_1',
      documentId: 'doc_1',
      versionNumber: 1,
      label: 'Draf Awal',
      summary: 'Draf 1',
      text: 'BAB I PENDAHULUAN\nIsi draf...',
      createdAt: 1000,
    },
  ];

  const backup = await createThesisRevisionBackup({
    documentId: 'doc_1',
    documentTitle: 'Skripsi Sistem Informasi',
    notes,
    snapshots,
  });

  assert.equal(backup.format, THESIS_BACKUP_FORMAT);
  assert.equal(backup.version, THESIS_BACKUP_VERSION);
  assert.equal(backup.document.id, 'doc_1');
  assert.equal(backup.document.title, 'Skripsi Sistem Informasi');
  assert.equal(backup.notes.length, 1);
  assert.equal(backup.snapshots.length, 1);
  assert.ok(backup.checksum.startsWith('sha256:'));
  assert.ok(backup.warning.includes('TIDAK DIENKRIPSI'));

  // Validasi read-only harus menyatakan valid
  const validation = await validateThesisRevisionBackup(backup);
  assert.equal(validation.valid, true);
  assert.equal(validation.noteCount, 1);
  assert.equal(validation.snapshotCount, 1);
});

test('B8B.4: validateThesisRevisionBackup mendeteksi manipulasi isi / checksum mismatch (integrity_failed)', async () => {
  const backup = await createThesisRevisionBackup({
    documentId: 'doc_2',
    documentTitle: 'Skripsi Mahasiswa',
    notes: [{ id: 'n1', title: 'Catatan Asli', content: 'Asli', status: 'todo' }],
    snapshots: [{ id: 's1', versionNumber: 1, text: 'Teks Asli' }],
  });

  // Manipulasi teks snapshot tanpa mengubah checksum
  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.snapshots[0].text = 'Teks yang sudah dimanipulasi!';

  const validation = await validateThesisRevisionBackup(tampered);
  assert.equal(validation.valid, false);
  assert.equal(validation.code, 'integrity_failed');
});

test('B8B.5: validateThesisRevisionBackup menolak format rusak, versi tidak dikenal, dan non-JSON', async () => {
  // 1. Non-JSON string
  const malformed = await validateThesisRevisionBackup('{"broken json');
  assert.equal(malformed.valid, false);
  assert.equal(malformed.code, 'malformed_json');

  // 2. Format tidak dikenal
  const wrongFormat = await validateThesisRevisionBackup({
    format: 'unknown-format',
    version: 1,
  });
  assert.equal(wrongFormat.valid, false);
  assert.equal(wrongFormat.code, 'invalid_format');

  // 3. Versi tidak didukung (misal versi 99)
  const wrongVersion = await validateThesisRevisionBackup({
    format: THESIS_BACKUP_FORMAT,
    version: 99,
  });
  assert.equal(wrongVersion.valid, false);
  assert.equal(wrongVersion.code, 'unsupported_version');
});

test('B8B.6: Tidak ada kredensial atau API key yang dimasukkan ke dalam berkas cadangan', async () => {
  const backup = await createThesisRevisionBackup({
    documentId: 'doc_secure',
    documentTitle: 'Dokumen Uji',
    notes: [],
    snapshots: [],
  });

  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('gemini_api_key'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('B8B.7: restoreThesisRevisionBackupIsolated fail-closed jika allowExecution !== true', async () => {
  const backup = await createThesisRevisionBackup({
    documentId: 'doc_restore_test',
    documentTitle: 'Dokumen Restore',
    notes: [{ id: 'n_res', title: 'Catatan', status: 'todo' }],
    snapshots: [{ id: 's_res', versionNumber: 1, text: 'Teks' }],
  });

  const store = createThesisRevisionStore({ useMemoryFallback: true });

  // Jalur tanpa allowExecution harus menolak
  await assert.rejects(
    async () => {
      await restoreThesisRevisionBackupIsolated(backup, store, { allowExecution: false });
    },
    (err) => {
      assert.ok(err instanceof ThesisBackupError);
      assert.equal(err.code, 'execution_disabled');
      return true;
    }
  );

  // Jalur dengan allowExecution: true pada lingkungan pengujian sintetis
  const result = await restoreThesisRevisionBackupIsolated(backup, store, { allowExecution: true });
  assert.equal(result.success, true);
  assert.equal(result.restoredNotesCount, 1);
  assert.equal(result.restoredSnapshotsCount, 1);
});
