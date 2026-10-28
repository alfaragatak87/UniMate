/**
 * thesisRevisionBackup.js — Ekspor Teks & Backup Mandiri Revisi Skripsi (B8B)
 *
 * Kebijakan & Prinsip:
 * 1. Mandiri & Terpisah: Format backup berversi khusus riwayat revisi dan snapshot skripsi
 *    (format: 'unimate-thesis-revision-backup', version: 1).
 *    DILARANG memodifikasi atau mencemari skema portable academic backup v2 yang sudah stabil.
 * 2. Integritas Kriptografis: Checksum SHA-256 dihitung dari representasi kanonikal data
 *    catatan, checklist, metadata dokumen, dan snapshot teks (bukan hanya nama file).
 * 3. Privasi Data: Dilarang menyertakan API key, token otentikasi, atau data profil lain.
 * 4. Peringatan Pengguna: Menyertakan peringatan bahwa berkas berisi data teks pribadi dan tidak terenkripsi.
 * 5. Ekspor Klien Murni: Menggunakan Web Blob API lokal tanpa request jaringan.
 * 6. Validasi Read-Only: Memverifikasi integritas checksum, format, dan struktur sebelum data disentuh.
 * 7. Restore Produksi Terkunci: Jalur restore pada antarmuka produksi tetap dinonaktifkan (DISABLED).
 */

export const THESIS_BACKUP_FORMAT = 'unimate-thesis-revision-backup';
export const THESIS_BACKUP_VERSION = 1;
export const THESIS_BACKUP_MAX_BYTES = 50 * 1024 * 1024; // Maksimal 50MB

export class ThesisBackupError extends Error {
  constructor(code, message = '') {
    super(message || `Operasi cadangan revisi gagal (${code}).`);
    this.name = 'ThesisBackupError';
    this.code = code;
  }
}

/**
 * Sanitasi nama file yang aman untuk sistem operasi Windows / POSIX
 */
export function sanitizeFilename(name, extension = '') {
  const safeName = String(name || 'dokumen')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);

  const cleanExt = extension ? (extension.startsWith('.') ? extension : `.${extension}`) : '';
  return `${safeName || 'dokumen'}${cleanExt}`;
}

/**
 * Ekspor snapshot teks terpilih ke format plain text (.txt)
 */
export function exportSnapshotToTxt(snapshot) {
  if (!snapshot || typeof snapshot.text !== 'string') {
    throw new ThesisBackupError('invalid_snapshot', 'Snapshot teks tidak valid');
  }

  const filename = sanitizeFilename(
    `${snapshot.label || 'snapshot_skripsi'}_v${snapshot.versionNumber || 1}`,
    'txt'
  );

  const blob = new Blob([snapshot.text], { type: 'text/plain;charset=utf-8' });
  triggerBrowserDownload(blob, filename);

  return {
    filename,
    charCount: snapshot.text.length,
    size: blob.size,
  };
}

/**
 * Ekspor snapshot teks terpilih ke format Markdown (.md) lengkap dengan frontmatter metadata
 */
export function exportSnapshotToMarkdown(snapshot, options = {}) {
  if (!snapshot || typeof snapshot.text !== 'string') {
    throw new ThesisBackupError('invalid_snapshot', 'Snapshot teks tidak valid');
  }

  const documentTitle = options.documentTitle || 'Skripsi UniMate';
  const frontmatter = [
    '---',
    `title: "${documentTitle.replace(/"/g, '\\"')}"`,
    `version: ${snapshot.versionNumber || 1}`,
    `label: "${(snapshot.label || '').replace(/"/g, '\\"')}"`,
    `exportedAt: "${new Date().toISOString()}"`,
    `charCount: ${snapshot.text.length}`,
    'generator: "UniMate Thesis Workspace Offline"',
    '---',
    '',
    `# ${documentTitle}`,
    '',
    snapshot.text,
  ].join('\n');

  const filename = sanitizeFilename(
    `${snapshot.label || 'snapshot_skripsi'}_v${snapshot.versionNumber || 1}`,
    'md'
  );

  const blob = new Blob([frontmatter], { type: 'text/markdown;charset=utf-8' });
  triggerBrowserDownload(blob, filename);

  return {
    filename,
    charCount: frontmatter.length,
    size: blob.size,
  };
}

/**
 * Menghitung checksum SHA-256 kanonikal untuk objek backup revisi skripsi
 */
export async function computeRevisionBackupChecksum(payload, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) {
    throw new ThesisBackupError('crypto_unavailable', 'Web Crypto API tidak tersedia');
  }

  // Kanonikalisasi data yang diperhitungkan ke dalam hash
  const canonicalData = {
    format: payload.format,
    version: payload.version,
    exportedAt: payload.exportedAt,
    document: payload.document,
    notes: payload.notes,
    snapshots: payload.snapshots,
  };

  const jsonString = JSON.stringify(canonicalData);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(jsonString);
  const hashBuffer = await cryptoImpl.subtle.digest('SHA-256', dataBuffer);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return `sha256:${hexHash}`;
}

/**
 * Membangun paket backup mandiri untuk revisi skripsi lengkap dengan SHA-256
 */
export async function createThesisRevisionBackup({
  documentId,
  documentTitle,
  notes = [],
  snapshots = [],
  cryptoImpl = globalThis.crypto,
}) {
  if (!documentId || typeof documentId !== 'string') {
    throw new ThesisBackupError('invalid_document_id', 'documentId wajib ditentukan');
  }

  const safeTitle = String(documentTitle || 'Dokumen Skripsi').trim();
  const safeNotes = Array.isArray(notes) ? notes : [];
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];

  const now = new Date().toISOString();

  const backupPayload = {
    format: THESIS_BACKUP_FORMAT,
    version: THESIS_BACKUP_VERSION,
    exportedAt: now,
    warning: 'BERKAS INI BERISI DATA TEKS & REVISI PRIBADI. TIDAK DIENKRIPSI. SIMPAN DENGAN AMAN.',
    document: {
      id: documentId.trim(),
      title: safeTitle,
      noteCount: safeNotes.length,
      snapshotCount: safeSnapshots.length,
    },
    notes: safeNotes.map(n => ({
      id: n.id,
      documentId: n.documentId,
      title: n.title,
      content: n.content || '',
      sectionId: n.sectionId || null,
      sectionTitle: n.sectionTitle || '',
      status: n.status || 'todo',
      checklist: Array.isArray(n.checklist) ? n.checklist : [],
      supervisorNote: n.supervisorNote || '',
      history: Array.isArray(n.history) ? n.history : [],
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    snapshots: safeSnapshots.map(s => ({
      id: s.id,
      documentId: s.documentId,
      versionNumber: s.versionNumber,
      label: s.label || '',
      summary: s.summary || '',
      text: String(s.text || ''),
      charCount: s.charCount || (s.text ? s.text.length : 0),
      lineCount: s.lineCount || 0,
      createdAt: s.createdAt,
    })),
  };

  // Hitung checksum SHA-256
  const checksum = await computeRevisionBackupChecksum(backupPayload, cryptoImpl);
  backupPayload.checksum = checksum;

  return Object.freeze(backupPayload);
}

/**
 * Mengunduh paket backup revisi sebagai file JSON
 */
export function downloadThesisRevisionBackupFile(backupPayload) {
  const jsonString = JSON.stringify(backupPayload, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = sanitizeFilename(
    `backup_revisi_${backupPayload.document?.title || 'skripsi'}_${dateStr}`,
    'json'
  );

  triggerBrowserDownload(blob, filename);

  return {
    filename,
    size: blob.size,
    checksum: backupPayload.checksum,
  };
}

/**
 * Validasi mendalam isi file backup revisi skripsi secara 100% read-only
 */
export async function validateThesisRevisionBackup(rawInput, cryptoImpl = globalThis.crypto) {
  if (!rawInput) {
    return {
      valid: false,
      code: 'empty_input',
      message: 'File backup kosong atau tidak terbaca',
    };
  }

  let data;
  if (typeof rawInput === 'string') {
    if (rawInput.length > THESIS_BACKUP_MAX_BYTES) {
      return {
        valid: false,
        code: 'file_too_large',
        message: 'Ukuran file cadangan melebihi batas 50MB',
      };
    }
    try {
      data = JSON.parse(rawInput);
    } catch {
      return {
        valid: false,
        code: 'malformed_json',
        message: 'Format berkas rusak dan bukan JSON yang valid',
      };
    }
  } else if (typeof rawInput === 'object') {
    data = rawInput;
  } else {
    return {
      valid: false,
      code: 'invalid_type',
      message: 'Tipe data cadangan tidak valid',
    };
  }

  // 1. Verifikasi Format & Versi
  if (data.format !== THESIS_BACKUP_FORMAT) {
    return {
      valid: false,
      code: 'invalid_format',
      message: `Format cadangan "${data.format}" tidak dikenali sebagai cadangan revisi skripsi`,
    };
  }

  if (data.version !== THESIS_BACKUP_VERSION) {
    return {
      valid: false,
      code: 'unsupported_version',
      message: `Versi cadangan ${data.version} tidak didukung (harus versi ${THESIS_BACKUP_VERSION})`,
    };
  }

  // 2. Verifikasi Struktur Entitas
  if (!data.document || typeof data.document.id !== 'string' || !data.document.title) {
    return {
      valid: false,
      code: 'invalid_document_metadata',
      message: 'Metadata dokumen skripsi pada cadangan tidak lengkap',
    };
  }

  if (!Array.isArray(data.notes)) {
    return {
      valid: false,
      code: 'invalid_notes_structure',
      message: 'Struktur catatan revisi tidak berbentuk array',
    };
  }

  if (!Array.isArray(data.snapshots)) {
    return {
      valid: false,
      code: 'invalid_snapshots_structure',
      message: 'Struktur riwayat snapshot tidak berbentuk array',
    };
  }

  // 3. Verifikasi Checksum SHA-256
  if (!data.checksum || typeof data.checksum !== 'string' || !data.checksum.startsWith('sha256:')) {
    return {
      valid: false,
      code: 'missing_checksum',
      message: 'Berkas cadangan tidak memiliki tanda tangan checksum SHA-256 yang sah',
    };
  }

  let expectedChecksum;
  try {
    expectedChecksum = await computeRevisionBackupChecksum(data, cryptoImpl);
  } catch (err) {
    return {
      valid: false,
      code: 'checksum_calculation_failed',
      message: err.message,
    };
  }

  if (data.checksum !== expectedChecksum) {
    return {
      valid: false,
      code: 'integrity_failed',
      message: 'Integritas data rusak: Checksum SHA-256 tidak cocok dengan isi berkas',
    };
  }

  return {
    valid: true,
    code: 'valid',
    version: data.version,
    documentId: data.document.id,
    documentTitle: data.document.title,
    noteCount: data.notes.length,
    snapshotCount: data.snapshots.length,
    exportedAt: data.exportedAt,
    checksum: data.checksum,
    notes: data.notes,
    snapshots: data.snapshots,
  };
}

/**
 * Pemulihan Cadangan pada Lingkungan Terisolasi (Hanya untuk Testing / Profil Sintetis)
 * Jalur pada UI Produksi tetap DISABLED.
 */
export async function restoreThesisRevisionBackupIsolated(backupData, store, options = {}) {
  if (options.allowExecution !== true) {
    throw new ThesisBackupError(
      'execution_disabled',
      'Pemulihan cadangan revisi dinonaktifkan pada profil produksi'
    );
  }

  const validation = await validateThesisRevisionBackup(backupData);
  if (!validation.valid) {
    throw new ThesisBackupError(validation.code, validation.message);
  }

  if (!store || typeof store.createNote !== 'function' || typeof store.saveSnapshot !== 'function') {
    throw new ThesisBackupError('invalid_store', 'Store penyimpanan revisi tidak valid');
  }

  let restoredNotesCount = 0;
  let restoredSnapshotsCount = 0;

  // Pulihkan catatan
  for (const note of validation.notes) {
    await store.createNote({
      documentId: validation.documentId,
      title: note.title,
      content: note.content,
      sectionId: note.sectionId,
      sectionTitle: note.sectionTitle,
      status: note.status,
      checklist: note.checklist,
      supervisorNote: note.supervisorNote,
    });
    restoredNotesCount += 1;
  }

  // Pulihkan snapshot
  for (const snap of validation.snapshots) {
    await store.saveSnapshot({
      documentId: validation.documentId,
      text: snap.text,
      label: snap.label,
      summary: snap.summary,
    });
    restoredSnapshotsCount += 1;
  }

  return {
    success: true,
    restoredNotesCount,
    restoredSnapshotsCount,
    documentId: validation.documentId,
  };
}

/**
 * Helper internal pemicu download browser
 */
function triggerBrowserDownload(blob, filename) {
  if (typeof document === 'undefined' || !document.createElement) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
