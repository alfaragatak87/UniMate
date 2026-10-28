import { ACADEMIC_STORAGE_KEYS } from './academicBackup.js';

export const RESTORE_VAULT_DATABASE_NAME = 'unimate-restore-vault';
export const RESTORE_VAULT_DATABASE_VERSION = 1;
export const RESTORE_JOURNAL_STORE_NAME = 'journal_entries';
export const RESTORE_LOCK_NAME = 'unimate_academic_restore_lock';

export const JOURNAL_STATUS = Object.freeze({
  INITIALIZED: 'INITIALIZED',
  TARGETS_REGISTERED: 'TARGETS_REGISTERED',
  BINARIES_STAGED: 'BINARIES_STAGED',
  STAGING_METADATA: 'STAGING_METADATA',
  METADATA_WRITTEN: 'METADATA_WRITTEN',
  VERIFIED: 'VERIFIED',
  COMMITTED: 'COMMITTED',
  PURGED: 'PURGED',
  QUARANTINED: 'QUARANTINED',
});

export class RestoreJournalError extends Error {
  constructor(code, message) {
    super(message || `Kesalahan jurnal pemulihan: ${code}`);
    this.name = 'RestoreJournalError';
    this.code = code;
  }
}

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * Mengambil snapshot mendalam dari kunci-kunci storage lokal sebelum operasi mutasi.
 * Membedakan antara:
 * - Kunci tidak ada (exists: false, rawValue: null)
 * - Kunci ada berupa string kosong (exists: true, rawValue: "", isEmptyString: true)
 * - Kunci ada berupa JSON valid (exists: true, isValidJson: true, parsedValue)
 * - Kunci ada berupa string non-JSON (exists: true, isValidJson: false)
 */
export function takeStorageSnapshot(storage, keysToSnapshot = ACADEMIC_STORAGE_KEYS) {
  const snapshot = {};
  if (!storage || typeof storage.getItem !== 'function') return snapshot;

  for (const key of keysToSnapshot) {
    let rawValue;
    try {
      rawValue = storage.getItem(key);
    } catch {
      rawValue = null;
    }

    if (rawValue === null || rawValue === undefined) {
      snapshot[key] = Object.freeze({
        exists: false,
        rawValue: null,
        isEmptyString: false,
        isValidJson: false,
        parsedValue: null,
      });
      continue;
    }

    const isEmptyString = rawValue === '';
    let isValidJson = false;
    let parsedValue = null;

    if (!isEmptyString) {
      try {
        parsedValue = JSON.parse(rawValue);
        isValidJson = true;
      } catch {
        isValidJson = false;
        parsedValue = null;
      }
    }

    snapshot[key] = Object.freeze({
      exists: true,
      rawValue: String(rawValue),
      isEmptyString,
      isValidJson,
      parsedValue,
    });
  }

  return Object.freeze(snapshot);
}

/**
 * Adapter IndexedDB untuk unimate-restore-vault
 */
export function createIndexedDBJournalAdapter(indexedDBFactory = globalThis.indexedDB) {
  let databasePromise = null;

  const openDatabase = () => {
    if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') {
      return Promise.reject(new RestoreJournalError('storage_unavailable', 'IndexedDB tidak tersedia.'));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDBFactory.open(RESTORE_VAULT_DATABASE_NAME, RESTORE_VAULT_DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RESTORE_JOURNAL_STORE_NAME)) {
          const store = db.createObjectStore(RESTORE_JOURNAL_STORE_NAME, { keyPath: 'operationId' });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch {}
        };
        resolve(db);
      };

      request.onerror = () => {
        const err = request.error;
        if (err?.name === 'QuotaExceededError') {
          reject(new RestoreJournalError('quota_exceeded', 'Kapasitas penyimpanan recovery terlampaui.'));
          return;
        }
        reject(new RestoreJournalError('storage_unavailable', err?.message || 'Gagal membuka unimate-restore-vault.'));
      };

      request.onblocked = () => {
        reject(new RestoreJournalError('storage_blocked', 'Penyimpanan recovery terblokir oleh sesi lain.'));
      };
    });
  };

  const getDatabase = () => {
    databasePromise ??= openDatabase();
    return databasePromise;
  };

  const createTx = (database, mode) => {
    try {
      // Evaluasi durability: 'strict' jika didukung oleh browser/engine
      return database.transaction(RESTORE_JOURNAL_STORE_NAME, mode, { durability: 'strict' });
    } catch {
      // Fallback jujur ke transaksi standar jika opsi durability tidak didukung
      return database.transaction(RESTORE_JOURNAL_STORE_NAME, mode);
    }
  };

  return Object.freeze({
    async createJournal(entry) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = createTx(database, 'readwrite');
        const store = tx.objectStore(RESTORE_JOURNAL_STORE_NAME);
        store.add(entry);

        tx.oncomplete = () => resolve(entry);
        tx.onerror = event => {
          const err = tx.error || event?.target?.error;
          reject(new RestoreJournalError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed', err?.message));
        };
        tx.onabort = event => {
          const err = tx.error || event?.target?.error;
          reject(new RestoreJournalError(err?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'write_failed', err?.message));
        };
      });
    },

    async updateJournal(operationId, updates) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = createTx(database, 'readwrite');
        const store = tx.objectStore(RESTORE_JOURNAL_STORE_NAME);
        const getReq = store.get(operationId);

        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) {
            reject(new RestoreJournalError('not_found', `Jurnal ${operationId} tidak ditemukan.`));
            return;
          }
          const merged = { ...existing, ...updates, operationId };
          store.put(merged);
        };

        tx.oncomplete = () => resolve();
        tx.onerror = event => {
          const err = tx.error || event?.target?.error;
          reject(new RestoreJournalError('update_failed', err?.message));
        };
        tx.onabort = event => {
          const err = tx.error || event?.target?.error;
          reject(new RestoreJournalError('update_failed', err?.message));
        };
      });
    },

    async getJournal(operationId) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(RESTORE_JOURNAL_STORE_NAME, 'readonly');
        const store = tx.objectStore(RESTORE_JOURNAL_STORE_NAME);
        const req = store.get(operationId);

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(new RestoreJournalError('read_failed'));
      });
    },

    async listPendingJournals() {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(RESTORE_JOURNAL_STORE_NAME, 'readonly');
        const store = tx.objectStore(RESTORE_JOURNAL_STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const all = req.result || [];
          const pending = all.filter(j => j.status !== JOURNAL_STATUS.PURGED);
          resolve(pending);
        };
        req.onerror = () => reject(new RestoreJournalError('read_failed'));
      });
    },

    async purgeJournal(operationId) {
      const database = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = createTx(database, 'readwrite');
        const store = tx.objectStore(RESTORE_JOURNAL_STORE_NAME);
        store.delete(operationId);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new RestoreJournalError('delete_failed'));
        tx.onabort = () => reject(new RestoreJournalError('delete_failed'));
      });
    },

    async close() {
      if (databasePromise) {
        try {
          const db = await databasePromise;
          db.close();
        } catch {}
        databasePromise = null;
      }
    },
  });
}

/**
 * Adapter In-Memory untuk pengujian cepat Node.js tanpa IndexedDB browser
 */
export function createMemoryJournalAdapter() {
  const records = new Map();

  return Object.freeze({
    async createJournal(entry) {
      if (records.has(entry.operationId)) {
        throw new RestoreJournalError('write_failed', 'ID jurnal sudah ada.');
      }
      records.set(entry.operationId, deepClone(entry));
      return deepClone(entry);
    },

    async updateJournal(operationId, updates) {
      if (!records.has(operationId)) {
        throw new RestoreJournalError('not_found', 'Jurnal tidak ditemukan.');
      }
      const existing = records.get(operationId);
      const merged = { ...existing, ...updates, operationId };
      records.set(operationId, deepClone(merged));
    },

    async getJournal(operationId) {
      return records.has(operationId) ? deepClone(records.get(operationId)) : null;
    },

    async listPendingJournals() {
      return [...records.values()]
        .filter(j => j.status !== JOURNAL_STATUS.PURGED)
        .map(deepClone);
    },

    async purgeJournal(operationId) {
      records.delete(operationId);
    },

    async close() {},
  });
}

/**
 * Pembuatan store jurnal pemulihan yang membungkus adapter
 */
export function createRestoreJournalStore(options = {}) {
  const adapter = options.adapter ?? (
    typeof globalThis.indexedDB !== 'undefined'
      ? createIndexedDBJournalAdapter(options.indexedDBFactory ?? globalThis.indexedDB)
      : createMemoryJournalAdapter()
  );

  return Object.freeze({
    createJournal: entry => adapter.createJournal(entry),
    updateJournal: (opId, updates) => adapter.updateJournal(opId, updates),
    getJournal: opId => adapter.getJournal(opId),
    listPendingJournals: () => adapter.listPendingJournals(),
    purgeJournal: opId => adapter.purgeJournal(opId),
    close: () => adapter.close(),
  });
}

/**
 * Eksekusi dengan Web Locks API (eksklusif sejati, fail-closed jika tidak ada)
 */
export async function withRestoreLock(options, callback) {
  const lockManager = options?.lockManager !== undefined
    ? options.lockManager
    : (typeof navigator !== 'undefined' ? navigator.locks : null);

  // Jika opsi eksplisit bypassLock diberikan (misal uji internal yang tidak relevan dengan konkurensi)
  if (options?.bypassLock === true) {
    return await callback();
  }

  // Persyaratan D.4 & D.5: Fail-closed jika Web Locks tidak tersedia
  if (!lockManager || typeof lockManager.request !== 'function') {
    throw new RestoreJournalError(
      'lock_unavailable',
      'Mekanisme penguncian eksklusif (Web Locks API) tidak didukung pada platform ini. Operasi ditolak demi keamanan data (fail-closed).'
    );
  }

  return await lockManager.request(
    RESTORE_LOCK_NAME,
    { mode: 'exclusive', ifAvailable: true },
    async lock => {
      if (!lock) {
        throw new RestoreJournalError(
          'restore_locked',
          'Operasi Restore atau Rekonsiliasi sedang berjalan pada tab/jendela lain.'
        );
      }
      return await callback();
    }
  );
}

/**
 * Helper Rekonsiliasi Idempoten untuk Startup atau Uji Crash
 */
export async function reconcileInterruptedRestore({
  storage,
  binaryStore,
  journalStore,
  lockManager = undefined,
  bypassLock = false,
  now = () => Date.now(),
} = {}) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new RestoreJournalError('storage_unavailable', 'Storage lokal tidak tersedia untuk rekonsiliasi.');
  }
  if (!binaryStore) {
    throw new RestoreJournalError('storage_unavailable', 'Store biner tidak tersedia untuk rekonsiliasi.');
  }
  if (!journalStore) {
    throw new RestoreJournalError('storage_unavailable', 'Store jurnal tidak tersedia untuk rekonsiliasi.');
  }

  return await withRestoreLock({ lockManager, bypassLock }, async () => {
    const pendingJournals = await journalStore.listPendingJournals();
    if (pendingJournals.length === 0) {
      return {
        reconciled: false,
        pendingCount: 0,
        actions: [],
      };
    }

    const actions = [];

    for (const journal of pendingJournals) {
      const opId = journal.operationId;
      const status = journal.status;

      // 1. Kasus COMMITTED: Crash terjadi sesudah commit sah, sebelum purge.
      // JANGAN ROLLBACK! Data sah milik pengguna. Cukup verifikasi dan hapus jurnal (commit-forward).
      if (status === JOURNAL_STATUS.COMMITTED) {
        await journalStore.purgeJournal(opId);
        actions.push({
          operationId: opId,
          status,
          action: 'commit_forward_purged',
          preserved: true,
        });
        continue;
      }

      // 2. Kasus INITIALIZED atau TARGETS_REGISTERED:
      // Belum ada penulisan biner atau metadata yang terekam committed.
      // Verifikasi apakah ada biner staged yang sempat masuk ke vault.
      if (status === JOURNAL_STATUS.INITIALIZED || status === JOURNAL_STATUS.TARGETS_REGISTERED) {
        // Bersihkan jika ada artefak biner yang tidak sengaja tertinggal
        const stagedBinaries = journal.stagedBinaryIds || [];
        const existingBinaries = new Set(journal.existingBinaryIds || []);
        for (const binId of stagedBinaries) {
          if (!existingBinaries.has(binId) && typeof binaryStore.remove === 'function') {
            try { await binaryStore.remove(binId); } catch {}
          }
        }
        const stagedTexts = journal.stagedTextIds || [];
        const existingTexts = new Set(journal.existingTextIds || []);
        for (const txtId of stagedTexts) {
          if (!existingTexts.has(txtId) && typeof binaryStore.removeText === 'function') {
            try { await binaryStore.removeText(txtId); } catch {}
          }
        }
        await journalStore.purgeJournal(opId);
        actions.push({
          operationId: opId,
          status,
          action: 'clean_aborted_restore',
          binariesCleaned: stagedBinaries.length,
          textsCleaned: stagedTexts.length,
        });
        continue;
      }

      // 3. Kasus BINARIES_STAGED, STAGING_METADATA, METADATA_WRITTEN, atau VERIFIED:
      // Transaksi BELUM committed, sehingga harus dikompensasi secara aman.
      if (
        status === JOURNAL_STATUS.BINARIES_STAGED ||
        status === JOURNAL_STATUS.STAGING_METADATA ||
        status === JOURNAL_STATUS.METADATA_WRITTEN ||
        status === JOURNAL_STATUS.VERIFIED
      ) {
        // A. Kompensasi Storage:
        // Kembalikan kunci-kunci yang sempat dimodifikasi oleh restore jika belum diubah oleh pihak ketiga.
        const snapshot = journal.previousStorageSnapshot || {};
        const writtenKeys = journal.writtenStorageKeys || {};
        const modifiedKeys = journal.modifiedStorageKeys || Object.keys(writtenKeys);
        let storageReverted = 0;
        let storageConflictPreserved = 0;

        for (const key of modifiedKeys) {
          const snapItem = snapshot[key];
          if (!snapItem) continue;

          let currentRaw;
          try {
            currentRaw = storage.getItem(key);
          } catch {
            currentRaw = null;
          }

          const rawWrittenByRestore = writtenKeys[key];

          // Periksa apakah storage telah mengalami perubahan independen sejak ditulis oleh restore
          if (rawWrittenByRestore !== undefined && currentRaw !== rawWrittenByRestore) {
            // Ada perubahan independen di tab/jendela lain!
            // Jangan timpa membabi buta. Jika ini array collection, filter out hanya item restore.
            if (snapItem.isValidJson && Array.isArray(snapItem.parsedValue)) {
              try {
                const currentArr = JSON.parse(currentRaw);
                if (Array.isArray(currentArr)) {
                  // Dapatkan daftar ID yang ditambahkan oleh restore
                  const addedIds = new Set((journal.plannedEntityIds && journal.plannedEntityIds[key]) || []);
                  const filtered = currentArr.filter(item => !addedIds.has(item.id));
                  storage.setItem(key, JSON.stringify(filtered));
                  storageReverted += 1;
                  continue;
                }
              } catch {}
            }
            // Jika bukan array yang bisa difilter, lindungi perubahan independen pengguna!
            storageConflictPreserved += 1;
            continue;
          }

          // Tidak ada perubahan pihak ketiga: aman dikembalikan ke snapshot semula
          try {
            if (!snapItem.exists || snapItem.rawValue === null) {
              if (typeof storage.removeItem === 'function') storage.removeItem(key);
            } else {
              storage.setItem(key, snapItem.rawValue);
            }
            storageReverted += 1;
          } catch {}
        }

        // B. Kompensasi Biner & Teks:
        // HANYA hapus biner/teks yang benar-benar dibuat baru oleh restore ini.
        // Dilarang keras menghapus existing records!
        const existingBinaries = new Set(journal.existingBinaryIds || []);
        const stagedBinaries = new Set(journal.stagedBinaryIds || []);
        const stagedBinaryRefs = Array.isArray(journal.stagedBinaryRefs) ? journal.stagedBinaryRefs : [];
        let binariesRemoved = 0;

        for (const ref of stagedBinaryRefs) {
          if (!existingBinaries.has(ref.id)) {
            try {
              if (typeof binaryStore.remove === 'function') {
                await binaryStore.remove(ref);
                stagedBinaries.delete(ref.id);
                binariesRemoved += 1;
              }
            } catch {}
          }
        }

        for (const binId of stagedBinaries) {
          if (!existingBinaries.has(binId)) {
            try {
              if (typeof binaryStore.remove === 'function') {
                await binaryStore.remove({ kind: 'unimate-binary-file', version: 1, id: binId, name: 'staged.pdf', mimeType: 'application/pdf', size: 10, lastModified: 0 });
                binariesRemoved += 1;
              } else if (typeof binaryStore.adapter?.remove === 'function') {
                await binaryStore.adapter.remove(binId);
                binariesRemoved += 1;
              }
            } catch {
              try {
                if (typeof binaryStore.adapter?.remove === 'function') {
                  await binaryStore.adapter.remove(binId);
                  binariesRemoved += 1;
                }
              } catch {}
            }
          }
        }

        const existingTexts = new Set(journal.existingTextIds || []);
        const stagedTexts = new Set(journal.stagedTextIds || []);
        const stagedTextRefs = Array.isArray(journal.stagedTextRefs) ? journal.stagedTextRefs : [];
        let textsRemoved = 0;

        for (const ref of stagedTextRefs) {
          if (!existingTexts.has(ref.id)) {
            try {
              if (typeof binaryStore.removeText === 'function') {
                await binaryStore.removeText(ref);
                stagedTexts.delete(ref.id);
                textsRemoved += 1;
              }
            } catch {}
          }
        }

        for (const txtId of stagedTexts) {
          if (!existingTexts.has(txtId)) {
            try {
              if (typeof binaryStore.removeText === 'function') {
                await binaryStore.removeText({ kind: 'unimate-document-text', version: 1, id: txtId, binaryId: 'placeholder', charCount: 0, hasEditedText: false, updatedAt: 0 });
                textsRemoved += 1;
              } else if (typeof binaryStore.adapter?.removeText === 'function') {
                await binaryStore.adapter.removeText(txtId);
                textsRemoved += 1;
              }
            } catch {
              try {
                if (typeof binaryStore.adapter?.removeText === 'function') {
                  await binaryStore.adapter.removeText(txtId);
                  textsRemoved += 1;
                }
              } catch {}
            }
          }
        }

        // C. Jurnal dihapus setelah kompensasi terverifikasi
        await journalStore.purgeJournal(opId);
        actions.push({
          operationId: opId,
          status,
          action: 'compensated_and_purged',
          storageReverted,
          storageConflictPreserved,
          binariesRemoved,
          textsRemoved,
        });
        continue;
      }

      // 4. Kasus Ambigu / Jurnal Rusak:
      // Karantina jurnal, jangan hapus data secara spekulatif!
      await journalStore.updateJournal(opId, {
        status: JOURNAL_STATUS.QUARANTINED,
        diagnostic: {
          reason: 'unrecognized_or_corrupted_journal_status',
          observedStatus: status,
          quarantinedAt: now(),
        },
      });
      actions.push({
        operationId: opId,
        status,
        action: 'quarantined',
        reason: 'ambiguous_state',
      });
    }

    return {
      reconciled: true,
      pendingCount: pendingJournals.length,
      actions,
    };
  });
}

/**
 * Inspeksi status pemulihan tertunda secara 100% read-only untuk kebutuhan startup dan UI.
 * Tidak memutasi storage, tidak menghapus berkas, tidak memodifikasi jurnal.
 *
 * Status hasil inspeksi:
 * - 'clean': Pemeriksaan berhasil dan tidak ada sesi pemulihan yang tertunda.
 * - 'pending': Pemeriksaan berhasil dan ditemukan minimal 1 sesi pemulihan tertunda.
 * - 'unavailable': Media IndexedDB atau store jurnal tidak tersedia pada platform.
 * - 'failed': Terjadi kegagalan I/O saat membaca database recovery.
 */
export async function inspectPendingRestoreJournals(options = {}) {
  let journalStore = options.journalStore;
  let shouldCloseStore = false;

  // Jika factory IndexedDB tersedia, cek apakah database sudah pernah dibuat
  // untuk mencegah pemanggilan indexedDB.open yang secara otomatis membuat database baru kosong
  if (!journalStore && options.adapter === undefined) {
    const factory = options.indexedDBFactory ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
    if (factory && typeof factory.databases === 'function') {
      try {
        const dbs = await factory.databases();
        const exists = Array.isArray(dbs) && dbs.some(d => d.name === RESTORE_VAULT_DATABASE_NAME);
        if (!exists) {
          return {
            status: 'clean',
            hasPending: false,
            pendingCount: 0,
            journals: [],
            error: null,
            databaseExists: false,
          };
        }
      } catch {
        // Abaikan jika lingkungan membatasi databases(), lanjutkan dengan safe store creation
      }
    }
  }

  if (!journalStore && options.adapter === null) {
    return {
      status: 'unavailable',
      hasPending: false,
      pendingCount: 0,
      journals: [],
      error: 'storage_unavailable',
      databaseExists: null,
    };
  }

  if (!journalStore) {
    try {
      journalStore = createRestoreJournalStore(options);
      shouldCloseStore = true;
    } catch (err) {
      return {
        status: 'unavailable',
        hasPending: false,
        pendingCount: 0,
        journals: [],
        error: err?.message || 'store_unavailable',
        databaseExists: null,
      };
    }
  }

  try {
    const pendingList = await journalStore.listPendingJournals();
    const formatted = pendingList.map(j => ({
      operationId: j.operationId,
      status: j.status,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      stagedBinariesCount: (j.stagedBinaryIds || []).length,
      stagedTextsCount: (j.stagedTextIds || []).length,
      modifiedStorageKeys: j.modifiedStorageKeys || [],
      isCommitted: j.status === JOURNAL_STATUS.COMMITTED,
    }));

    const hasPending = formatted.length > 0;
    return {
      status: hasPending ? 'pending' : 'clean',
      hasPending,
      pendingCount: formatted.length,
      journals: formatted,
      error: null,
      databaseExists: true,
    };
  } catch (error) {
    const isUnavailable = error?.code === 'storage_unavailable' || error?.code === 'storage_blocked';
    return {
      status: isUnavailable ? 'unavailable' : 'failed',
      hasPending: false,
      pendingCount: 0,
      journals: [],
      error: error?.message || 'inspection_failed',
      databaseExists: null,
    };
  } finally {
    if (shouldCloseStore && typeof journalStore.close === 'function') {
      try { await journalStore.close(); } catch {}
    }
  }
}

