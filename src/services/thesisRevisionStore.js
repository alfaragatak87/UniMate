/**
 * thesisRevisionStore.js — Penyimpanan Catatan & Riwayat Snapshot Revisi Skripsi (B7B)
 *
 * Kebijakan & Prinsip Desain:
 * 1. Database Terpisah: Menggunakan database IndexedDB terpisah `unimate-thesis-revisions` v1,
 *    tanpa memodifikasi atau mencemari skema `unimate-binary-vault` v2.
 * 2. Tanpa Dokumen Panjang di localStorage: Seluruh teks snapshot versi disimpan
 *    secara append-only di IndexedDB.
 * 3. Referensi Dokumen Stabil: Mengaitkan catatan dan snapshot ke documentId unik yang stabil.
 * 4. Immutability Snapshot: Versi baru tidak menimpa versi lama (append-only v1, v2, ...).
 * 5. Teks OCR Asli Terlindungi: Dilarang memutasi rawText atau berkas biner asli dokumen.
 * 6. Penghapusan Aman: Penghapusan catatan hanya dieksekusi jika konfirmasi eksplisit diberikan.
 * 7. Penanganan Kuota: Menangani QuotaExceededError secara fail-closed dan aman.
 */

export const REVISION_DB_NAME = 'unimate-thesis-revisions';
export const REVISION_DB_VERSION = 1;
export const STORE_NOTES = 'revision_notes';
export const STORE_SNAPSHOTS = 'text_snapshots';

export const REVISION_STATUS = Object.freeze({
  TODO: 'todo',             // Belum Dikerjakan
  IN_PROGRESS: 'in_progress', // Dikerjakan
  DONE: 'done',             // Selesai
});

export class ThesisRevisionStoreError extends Error {
  constructor(code, message = '') {
    super(message || `Operasi revisi skripsi gagal (${code}).`);
    this.name = 'ThesisRevisionStoreError';
    this.code = code;
  }
}

/**
 * Komputasi perbandingan (diff) baris demi baris secara murni dan deterministik
 * tanpa memerlukan pustaka eksternal pihak ketiga.
 */
export function computeTextDiff(oldText, newText) {
  const safeOld = typeof oldText === 'string' ? oldText : '';
  const safeNew = typeof newText === 'string' ? newText : '';

  const oldLines = safeOld.split(/\r?\n/);
  const newLines = safeNew.split(/\r?\n/);

  // Implementasi LCS (Longest Common Subsequence) sederhana untuk baris
  const m = oldLines.length;
  const n = newLines.length;

  // Batasi ukuran tabel LCS untuk dokumen sangat besar guna mencegah memory overhead berlebih
  if (m * n > 250000) {
    // Fallback streaming diff sederhana jika dokumen terlalu raksasa
    return fallbackFastDiff(oldLines, newLines);
  }

  // Matriks LCS
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtracking hasil diff
  const diffLines = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffLines.push({ type: 'unchanged', text: oldLines[i - 1], lineOld: i, lineNew: j });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffLines.push({ type: 'added', text: newLines[j - 1], lineNew: j });
      j -= 1;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffLines.push({ type: 'removed', text: oldLines[i - 1], lineOld: i });
      i -= 1;
    }
  }

  diffLines.reverse();

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const line of diffLines) {
    if (line.type === 'added') addedCount += 1;
    else if (line.type === 'removed') removedCount += 1;
    else unchangedCount += 1;
  }

  return {
    diffLines,
    addedCount,
    removedCount,
    unchangedCount,
    isIdentical: addedCount === 0 && removedCount === 0,
  };
}

/**
 * Diff fallback untuk baris dokumen yang sangat banyak (> 500 baris)
 */
function fallbackFastDiff(oldLines, newLines) {
  const diffLines = [];
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let idx = 0; idx < maxLen; idx += 1) {
    const o = oldLines[idx];
    const n = newLines[idx];
    if (o === n) {
      diffLines.push({ type: 'unchanged', text: o, lineOld: idx + 1, lineNew: idx + 1 });
      unchangedCount += 1;
    } else {
      if (o !== undefined) {
        diffLines.push({ type: 'removed', text: o, lineOld: idx + 1 });
        removedCount += 1;
      }
      if (n !== undefined) {
        diffLines.push({ type: 'added', text: n, lineNew: idx + 1 });
        addedCount += 1;
      }
    }
  }

  return {
    diffLines,
    addedCount,
    removedCount,
    unchangedCount,
    isIdentical: addedCount === 0 && removedCount === 0,
  };
}

/**
 * Pembuatan Factory Storage Catatan & Snapshot Skripsi
 */
export function createThesisRevisionStore({
  databaseName = REVISION_DB_NAME,
  idbFactory = globalThis.indexedDB,
  useMemoryFallback = false,
} = {}) {
  // In-memory fallback untuk lingkungan testing Node tanpa IndexedDB mock
  const memoryNotes = new Map();
  const memorySnapshots = new Map();

  let dbPromise = null;

  async function openDatabase() {
    if (useMemoryFallback || !idbFactory) return null;
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = idbFactory.open(databaseName, REVISION_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const notesStore = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
          notesStore.createIndex('by_document_id', 'documentId', { unique: false });
          notesStore.createIndex('by_status', 'status', { unique: false });
          notesStore.createIndex('by_created', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
          snapStore.createIndex('by_document_id', 'documentId', { unique: false });
          snapStore.createIndex('by_version', 'versionNumber', { unique: false });
          snapStore.createIndex('by_created', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(new ThesisRevisionStoreError('storage_unavailable', request.error?.message));
      };
      request.onblocked = () => {
        reject(new ThesisRevisionStoreError('storage_blocked', 'Penyimpanan revisi terblokir'));
      };
    });

    return dbPromise;
  }

  return {
    // --- 1. Manajemen Catatan Revisi ---

    /**
     * Membuat catatan revisi baru
     */
    async createNote({
      documentId,
      title,
      content = '',
      sectionId = null,
      sectionTitle = '',
      status = REVISION_STATUS.TODO,
      checklist = [],
      supervisorNote = '',
    }) {
      if (!documentId || typeof documentId !== 'string') {
        throw new ThesisRevisionStoreError('invalid_document_id', 'documentId wajib berupa string');
      }
      if (!title || typeof title !== 'string' || !title.trim()) {
        throw new ThesisRevisionStoreError('invalid_title', 'Judul catatan tidak boleh kosong');
      }

      const validStatus = Object.values(REVISION_STATUS).includes(status)
        ? status
        : REVISION_STATUS.TODO;

      const formattedChecklist = Array.isArray(checklist)
        ? checklist.map((item, idx) => ({
            id: item.id || `chk_${Date.now()}_${idx}`,
            text: String(item.text || '').trim(),
            done: Boolean(item.done),
          })).filter(item => item.text.length > 0)
        : [];

      const now = Date.now();
      const noteRecord = {
        id: `note_${now}_${Math.random().toString(36).slice(2, 7)}`,
        documentId: documentId.trim(),
        title: title.trim(),
        content: String(content || ''),
        sectionId: sectionId ? String(sectionId) : null,
        sectionTitle: String(sectionTitle || ''),
        status: validStatus,
        checklist: formattedChecklist,
        supervisorNote: String(supervisorNote || ''),
        history: [
          {
            timestamp: now,
            action: 'created',
            summary: 'Catatan revisi dibuat',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const db = await openDatabase();
      if (!db) {
        memoryNotes.set(noteRecord.id, noteRecord);
        return Object.freeze(noteRecord);
      }

      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NOTES, 'readwrite');
          const store = tx.objectStore(STORE_NOTES);
          store.add(noteRecord);

          tx.oncomplete = () => resolve(Object.freeze(noteRecord));
          tx.onerror = () => {
            const err = tx.error;
            if (err?.name === 'QuotaExceededError') {
              reject(new ThesisRevisionStoreError('quota_exceeded', 'Penyimpanan penuh'));
            } else {
              reject(new ThesisRevisionStoreError('write_failed', err?.message));
            }
          };
          tx.onabort = () => reject(new ThesisRevisionStoreError('write_failed'));
        } catch (err) {
          if (err?.name === 'QuotaExceededError') {
            reject(new ThesisRevisionStoreError('quota_exceeded', 'Penyimpanan penuh'));
          } else {
            reject(new ThesisRevisionStoreError('write_failed', err?.message));
          }
        }
      });
    },

    /**
     * Memperbarui catatan revisi
     */
    async updateNote(noteId, updates = {}) {
      if (!noteId || typeof noteId !== 'string') {
        throw new ThesisRevisionStoreError('invalid_note_id');
      }

      const db = await openDatabase();
      let existing;

      if (!db) {
        existing = memoryNotes.get(noteId);
        if (!existing) throw new ThesisRevisionStoreError('note_not_found');
      } else {
        existing = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NOTES, 'readonly');
          const req = tx.objectStore(STORE_NOTES).get(noteId);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(new ThesisRevisionStoreError('read_failed'));
        });
        if (!existing) throw new ThesisRevisionStoreError('note_not_found');
      }

      const now = Date.now();
      const changeLogs = [];

      let updatedTitle = existing.title;
      if (typeof updates.title === 'string' && updates.title.trim()) {
        if (updates.title.trim() !== existing.title) {
          changeLogs.push(`Judul diubah menjadi "${updates.title.trim()}"`);
          updatedTitle = updates.title.trim();
        }
      }

      let updatedStatus = existing.status;
      if (updates.status && Object.values(REVISION_STATUS).includes(updates.status)) {
        if (updates.status !== existing.status) {
          changeLogs.push(`Status diubah menjadi ${updates.status}`);
          updatedStatus = updates.status;
        }
      }

      let updatedChecklist = existing.checklist;
      if (Array.isArray(updates.checklist)) {
        updatedChecklist = updates.checklist.map((item, idx) => ({
          id: item.id || `chk_${now}_${idx}`,
          text: String(item.text || '').trim(),
          done: Boolean(item.done),
        })).filter(item => item.text.length > 0);
        changeLogs.push('Checklist diperbarui');
      }

      const updatedRecord = {
        ...existing,
        title: updatedTitle,
        content: updates.content !== undefined ? String(updates.content) : existing.content,
        sectionId: updates.sectionId !== undefined ? (updates.sectionId ? String(updates.sectionId) : null) : existing.sectionId,
        sectionTitle: updates.sectionTitle !== undefined ? String(updates.sectionTitle) : existing.sectionTitle,
        status: updatedStatus,
        checklist: updatedChecklist,
        supervisorNote: updates.supervisorNote !== undefined ? String(updates.supervisorNote) : existing.supervisorNote,
        history: [
          ...existing.history,
          ...(changeLogs.length > 0
            ? [
                {
                  timestamp: now,
                  action: 'updated',
                  summary: changeLogs.join(', '),
                },
              ]
            : []),
        ],
        updatedAt: now,
      };

      if (!db) {
        memoryNotes.set(noteId, updatedRecord);
        return Object.freeze(updatedRecord);
      }

      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NOTES, 'readwrite');
          tx.objectStore(STORE_NOTES).put(updatedRecord);
          tx.oncomplete = () => resolve(Object.freeze(updatedRecord));
          tx.onerror = () => {
            const err = tx.error;
            if (err?.name === 'QuotaExceededError') {
              reject(new ThesisRevisionStoreError('quota_exceeded'));
            } else {
              reject(new ThesisRevisionStoreError('write_failed', err?.message));
            }
          };
        } catch (err) {
          if (err?.name === 'QuotaExceededError') {
            reject(new ThesisRevisionStoreError('quota_exceeded'));
          } else {
            reject(new ThesisRevisionStoreError('write_failed', err?.message));
          }
        }
      });
    },

    /**
     * Menghapus catatan revisi hanya jika konfirmasi eksplisit diberikan
     */
    async deleteNote(noteId, options = {}) {
      if (!options?.confirmed) {
        throw new ThesisRevisionStoreError(
          'confirmation_required',
          'Penghapusan catatan revisi memerlukan konfirmasi eksplisit dari pengguna'
        );
      }

      const db = await openDatabase();
      if (!db) {
        if (!memoryNotes.has(noteId)) throw new ThesisRevisionStoreError('note_not_found');
        memoryNotes.delete(noteId);
        return { deleted: true, id: noteId };
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NOTES, 'readwrite');
        tx.objectStore(STORE_NOTES).delete(noteId);
        tx.oncomplete = () => resolve({ deleted: true, id: noteId });
        tx.onerror = () => reject(new ThesisRevisionStoreError('delete_failed'));
      });
    },

    /**
     * Mengambil seluruh catatan revisi berdasarkan documentId (atau array of documentIds/aliases)
     */
    async getNotesByDocument(documentIdOrIds) {
      const targetIds = Array.isArray(documentIdOrIds)
        ? Array.from(new Set(documentIdOrIds.map(s => String(s || '').trim()).filter(Boolean)))
        : (typeof documentIdOrIds === 'string' && documentIdOrIds.trim() ? [documentIdOrIds.trim()] : []);

      if (targetIds.length === 0) return [];
      const idSet = new Set(targetIds);

      const db = await openDatabase();
      if (!db) {
        const res = Array.from(memoryNotes.values()).filter(n => idSet.has(n.documentId));
        res.sort((a, b) => b.createdAt - a.createdAt);
        return res;
      }

      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NOTES, 'readonly');
          const store = tx.objectStore(STORE_NOTES);
          const hasIndex = store.indexNames.contains('by_document_id');

          if (targetIds.length === 1 && hasIndex) {
            const req = store.index('by_document_id').getAll(targetIds[0]);
            req.onsuccess = () => {
              const list = req.result || [];
              list.sort((a, b) => b.createdAt - a.createdAt);
              resolve(list);
            };
            req.onerror = () => reject(new ThesisRevisionStoreError('read_failed'));
            return;
          }

          // Jika banyak alias ID, panggil atau scan secara efisien
          const noteMap = new Map();
          let completed = 0;
          let hasError = false;

          targetIds.forEach(id => {
            const req = hasIndex
              ? store.index('by_document_id').getAll(id)
              : store.getAll();

            req.onsuccess = () => {
              if (hasError) return;
              let items = req.result || [];
              if (!hasIndex) {
                items = items.filter(n => n.documentId === id);
              }
              items.forEach(note => {
                if (note && note.id && !noteMap.has(note.id)) {
                  noteMap.set(note.id, note);
                }
              });

              completed += 1;
              if (completed === targetIds.length) {
                const list = Array.from(noteMap.values());
                list.sort((a, b) => b.createdAt - a.createdAt);
                resolve(list);
              }
            };

            req.onerror = () => {
              if (!hasError) {
                hasError = true;
                reject(new ThesisRevisionStoreError('read_failed'));
              }
            };
          });
        } catch {
          reject(new ThesisRevisionStoreError('read_failed'));
        }
      });
    },

    // --- 2. Manajemen Snapshot Versi Skripsi (Append-Only) ---

    /**
     * Menyimpan snapshot versi teks skripsi baru secara append-only
     */
    async saveSnapshot({ documentId, text, label = '', summary = '' }) {
      if (!documentId || typeof documentId !== 'string') {
        throw new ThesisRevisionStoreError('invalid_document_id');
      }
      if (typeof text !== 'string') {
        throw new ThesisRevisionStoreError('invalid_text', 'Teks snapshot harus berupa string');
      }

      // Ambil daftar snapshot yang sudah ada untuk menentukan nomor versi berikutnya
      const existingSnapshots = await this.getSnapshotsByDocument(documentId);
      const nextVersionNumber = existingSnapshots.length + 1;

      const now = Date.now();
      const lines = text.split(/\r?\n/);

      const snapshotRecord = {
        id: `snap_${now}_v${nextVersionNumber}_${Math.random().toString(36).slice(2, 7)}`,
        documentId: documentId.trim(),
        versionNumber: nextVersionNumber,
        label: label ? label.trim() : `Versi ${nextVersionNumber}`,
        summary: summary ? summary.trim() : '',
        text,
        charCount: text.length,
        lineCount: lines.length,
        createdAt: now,
      };

      const db = await openDatabase();
      if (!db) {
        memorySnapshots.set(snapshotRecord.id, snapshotRecord);
        return Object.freeze(snapshotRecord);
      }

      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
          tx.objectStore(STORE_SNAPSHOTS).add(snapshotRecord);

          tx.oncomplete = () => resolve(Object.freeze(snapshotRecord));
          tx.onerror = () => {
            const err = tx.error;
            if (err?.name === 'QuotaExceededError') {
              reject(new ThesisRevisionStoreError('quota_exceeded', 'Penyimpanan penuh saat menyimpan versi'));
            } else {
              reject(new ThesisRevisionStoreError('write_failed', err?.message));
            }
          };
          tx.onabort = () => reject(new ThesisRevisionStoreError('write_failed'));
        } catch (err) {
          if (err?.name === 'QuotaExceededError') {
            reject(new ThesisRevisionStoreError('quota_exceeded', 'Penyimpanan penuh saat menyimpan versi'));
          } else {
            reject(new ThesisRevisionStoreError('write_failed', err?.message));
          }
        }
      });
    },

    /**
     * Mengambil riwayat seluruh snapshot versi teks skripsi untuk suatu dokumen (atau array of documentIds/aliases)
     */
    async getSnapshotsByDocument(documentIdOrIds) {
      const targetIds = Array.isArray(documentIdOrIds)
        ? Array.from(new Set(documentIdOrIds.map(s => String(s || '').trim()).filter(Boolean)))
        : (typeof documentIdOrIds === 'string' && documentIdOrIds.trim() ? [documentIdOrIds.trim()] : []);

      if (targetIds.length === 0) return [];
      const idSet = new Set(targetIds);

      const db = await openDatabase();
      if (!db) {
        const res = Array.from(memorySnapshots.values()).filter(s => idSet.has(s.documentId));
        res.sort((a, b) => a.versionNumber - b.versionNumber);
        return res;
      }

      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
          const store = tx.objectStore(STORE_SNAPSHOTS);
          const hasIndex = store.indexNames.contains('by_document_id');

          if (targetIds.length === 1 && hasIndex) {
            const req = store.index('by_document_id').getAll(targetIds[0]);
            req.onsuccess = () => {
              const list = req.result || [];
              list.sort((a, b) => a.versionNumber - b.versionNumber);
              resolve(list);
            };
            req.onerror = () => reject(new ThesisRevisionStoreError('read_failed'));
            return;
          }

          const snapMap = new Map();
          let completed = 0;
          let hasError = false;

          targetIds.forEach(id => {
            const req = hasIndex
              ? store.index('by_document_id').getAll(id)
              : store.getAll();

            req.onsuccess = () => {
              if (hasError) return;
              let items = req.result || [];
              if (!hasIndex) {
                items = items.filter(s => s.documentId === id);
              }
              items.forEach(snap => {
                if (snap && snap.id && !snapMap.has(snap.id)) {
                  snapMap.set(snap.id, snap);
                }
              });

              completed += 1;
              if (completed === targetIds.length) {
                const list = Array.from(snapMap.values());
                list.sort((a, b) => a.versionNumber - b.versionNumber);
                resolve(list);
              }
            };

            req.onerror = () => {
              if (!hasError) {
                hasError = true;
                reject(new ThesisRevisionStoreError('read_failed'));
              }
            };
          });
        } catch {
          reject(new ThesisRevisionStoreError('read_failed'));
        }
      });
    },

    /**
     * Mengambil satu snapshot spesifik berdasarkan ID
     */
    async getSnapshot(snapshotId) {
      if (!snapshotId || typeof snapshotId !== 'string') return null;

      const db = await openDatabase();
      if (!db) {
        return memorySnapshots.get(snapshotId) ?? null;
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const req = tx.objectStore(STORE_SNAPSHOTS).get(snapshotId);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(new ThesisRevisionStoreError('read_failed'));
      });
    },

    /**
     * Menghapus seluruh data untuk pengujian terisolasi
     */
    async _clearAll() {
      memoryNotes.clear();
      memorySnapshots.clear();
      const db = await openDatabase();
      if (db) {
        await new Promise((resolve) => {
          const tx = db.transaction([STORE_NOTES, STORE_SNAPSHOTS], 'readwrite');
          tx.objectStore(STORE_NOTES).clear();
          tx.objectStore(STORE_SNAPSHOTS).clear();
          tx.oncomplete = () => resolve();
        });
      }
    },
  };
}

// Singleton instance default untuk aplikasi UniMate
export const thesisRevisionStore = createThesisRevisionStore();
