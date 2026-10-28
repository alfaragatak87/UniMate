import {
  ACADEMIC_STORAGE_KEYS,
  parseAcademicBackup,
} from './academicBackup.js';
import {
  PORTABLE_BACKUP_FORMAT,
  PORTABLE_BACKUP_MAX_BYTES,
  PortableAcademicBackupError,
  parsePortableAcademicBackup,
} from './portableAcademicBackup.js';
import {
  createPortableRestorePlan,
} from './portableAcademicRestorePlan.js';
import {
  BinaryFileStoreError,
  courseVaultBinaryStore,
} from './binaryFileStore.js';
import {
  JOURNAL_STATUS,
  RestoreJournalError,
  createRestoreJournalStore,
  takeStorageSnapshot,
  withRestoreLock,
} from './portableAcademicRestoreJournal.js';

export class PortableAcademicRestoreError extends Error {
  constructor(code, message) {
    super(message || `Operasi restore gagal: ${code}`);
    this.name = 'PortableAcademicRestoreError';
    this.code = code;
  }
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length < 1 || !BASE64_PATTERN.test(value)) {
    throw new PortableAcademicRestoreError('invalid_binary_encoding', 'Format biner tidak valid.');
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new PortableAcademicRestoreError('invalid_binary_encoding', 'Format biner tidak valid.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function createOperationId(cryptoImpl) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  if (typeof cryptoImpl?.getRandomValues === 'function') {
    const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return `restore-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(raw, fallback = null) {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function rollbackRestoreJournal(journal, storage, binaryStore, options = {}) {
  if (!journal || typeof journal !== 'object') return false;

  const journalStore = options.journalStore ?? null;

  // 1. Rollback storage keys yang sempat dimodifikasi
  if (storage && typeof storage.setItem === 'function') {
    const keysEntries = journal.stagedStorageKeys instanceof Map
      ? journal.stagedStorageKeys.entries()
      : Object.entries(journal.stagedStorageKeys || {});
    for (const [key, previousRaw] of keysEntries) {
      try {
        if (previousRaw === null || previousRaw === undefined) {
          if (typeof storage.removeItem === 'function') storage.removeItem(key);
        } else {
          storage.setItem(key, previousRaw);
        }
      } catch {
        // Abaikan kegagalan best-effort saat rollback in-process
      }
    }
  }

  // 2. Rollback file biner baru yang sempat ditulis ke IndexedDB
  // HANYA hapus yang dibuat baru oleh restore ini, lindungi file historis yang sudah ada
  const existingBinaries = new Set(journal.existingBinaryIds || []);
  if (binaryStore && Array.isArray(journal.stagedBinaryRefs)) {
    for (const ref of journal.stagedBinaryRefs) {
      if (existingBinaries.has(ref.id)) continue;
      try {
        if (typeof binaryStore.remove === 'function') {
          await binaryStore.remove(ref);
        }
      } catch {
        // Abaikan jika berkas memang belum sempat tersimpan
      }
    }
  }

  // 3. Rollback teks OCR baru yang sempat ditulis ke IndexedDB
  const existingTexts = new Set(journal.existingTextIds || []);
  if (binaryStore && Array.isArray(journal.stagedTextRefs)) {
    for (const ref of journal.stagedTextRefs) {
      if (existingTexts.has(ref.id)) continue;
      try {
        if (typeof binaryStore.removeText === 'function') {
          await binaryStore.removeText(ref);
        }
      } catch {
        // Abaikan jika teks memang belum sempat tersimpan
      }
    }
  }

  journal.status = 'rolled_back';

  if (journalStore && typeof journalStore.purgeJournal === 'function' && journal.operationId) {
    try {
      await journalStore.purgeJournal(journal.operationId);
    } catch {}
  }

  return true;
}

export async function executePortableRestore(serializedBackup, storage, options = {}) {
  if (typeof serializedBackup !== 'string' || !serializedBackup.trim()) {
    throw new PortableAcademicRestoreError('invalid_file', 'Berkas cadangan tidak valid.');
  }
  if (new TextEncoder().encode(serializedBackup).byteLength > PORTABLE_BACKUP_MAX_BYTES) {
    throw new PortableAcademicRestoreError('backup_too_large', 'Ukuran berkas melebihi batas maksimum.');
  }
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new PortableAcademicRestoreError('storage_unavailable', 'Media penyimpanan lokal tidak tersedia.');
  }

  const binaryStore = options.binaryStore ?? courseVaultBinaryStore;
  const journalStore = options.journalStore ?? createRestoreJournalStore(options);
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const now = options.now ?? (() => Date.now());

  // Jalankan seluruh alur di bawah perlindungan Web Locks eksklusif
  return await withRestoreLock(options, async () => {
    // 1. Validasi integritas backup dan bangun rencana pemulihan segar
    let parsedBackup;
    let isPortable = false;
    try {
      const rawParsed = JSON.parse(serializedBackup);
      if (rawParsed?.format === PORTABLE_BACKUP_FORMAT) {
        parsedBackup = await parsePortableAcademicBackup(serializedBackup, { cryptoImpl });
        isPortable = true;
      } else if (rawParsed?.format === 'unimate-academic-backup') {
        const academic = parseAcademicBackup(serializedBackup);
        parsedBackup = {
          format: academic.format,
          version: academic.version,
          exportedAt: academic.exportedAt,
          academic,
          binaries: [],
          texts: [],
        };
      } else {
        throw new PortableAcademicRestoreError('unsupported_format', 'Format berkas cadangan tidak didukung.');
      }
    } catch (error) {
      if (error instanceof PortableAcademicBackupError || error instanceof PortableAcademicRestoreError) {
        throw new PortableAcademicRestoreError(error.code || 'invalid_file', error.message);
      }
      throw new PortableAcademicRestoreError('invalid_file', 'Gagal memproses berkas cadangan.');
    }

    // 2. Evaluasi rencana terkini sesaat sebelum eksekusi (revalidasi storage)
    let freshPlan;
    try {
      freshPlan = await createPortableRestorePlan(serializedBackup, storage, { binaryStore, cryptoImpl });
    } catch (error) {
      if (error instanceof PortableAcademicBackupError || error instanceof PortableAcademicRestoreError) {
        throw new PortableAcademicRestoreError(error.code || 'invalid_plan', error.message);
      }
      throw new PortableAcademicRestoreError('invalid_plan', error.message || 'Gagal mengevaluasi rencana pemulihan.');
    }

    if (options.expectedPlan) {
      if (options.expectedPlan.storageSnapshotSignature !== freshPlan.storageSnapshotSignature) {
        throw new PortableAcademicRestoreError('plan_stale', 'Kondisi penyimpanan berubah sejak rencana pemulihan dibuat. Harap susun ulang rencana.');
      }
    }

    if (freshPlan.summary.conflicts > 0 || !freshPlan.canRestoreClean) {
      throw new PortableAcademicRestoreError('conflict_detected', 'Ditemukan konflik data antara cadangan dan penyimpanan lokal. Operasi dibatalkan.');
    }

    // 3. Ambil Snapshot Mendalam dan Inisialisasi Journal Persisten Sebelum Mutasi
    const initialStorageSnapshot = takeStorageSnapshot(storage, ACADEMIC_STORAGE_KEYS);
    const existingBinaryIds = freshPlan.entities.binaries.filter(b => b.status === 'unchanged').map(b => b.id);
    const existingTextIds = freshPlan.entities.texts.filter(t => t.status === 'unchanged').map(t => t.id);

    const stagedBinaryIds = [];
    const stagedBinaryRefs = [];
    const fileRecords = [];

    if (isPortable && Array.isArray(parsedBackup.binaries)) {
      const binaryPlanMap = new Map(freshPlan.entities.binaries.map(b => [b.id, b]));
      for (const bEntry of parsedBackup.binaries) {
        const planItem = binaryPlanMap.get(bEntry.reference.id);
        if (planItem && planItem.status === 'add') {
          const rawBytes = base64ToBytes(bEntry.data);
          const blob = typeof Blob === 'function'
            ? new Blob([rawBytes], { type: bEntry.reference.mimeType })
            : {
                size: rawBytes.byteLength,
                type: bEntry.reference.mimeType,
                arrayBuffer: async () => rawBytes.buffer,
              };
          fileRecords.push({
            id: bEntry.reference.id,
            name: bEntry.reference.name,
            mimeType: bEntry.reference.mimeType,
            size: bEntry.reference.size,
            lastModified: bEntry.reference.lastModified,
            createdAt: now(),
            blob,
          });
          stagedBinaryIds.push(bEntry.reference.id);
          stagedBinaryRefs.push(bEntry.reference);
        }
      }
    }

    const stagedTextIds = [];
    const stagedTextRefs = [];
    const textRecords = [];

    if (isPortable && Array.isArray(parsedBackup.texts)) {
      const textPlanMap = new Map(freshPlan.entities.texts.map(t => [t.id, t]));
      for (const tEntry of parsedBackup.texts) {
        const planItem = textPlanMap.get(tEntry.reference.id);
        if (planItem && planItem.status === 'add') {
          textRecords.push({
            id: tEntry.reference.id,
            binaryId: tEntry.reference.binaryId,
            documentType: tEntry.documentType || 'Dokumen',
            rawText: tEntry.rawText,
            editedText: typeof tEntry.editedText === 'string' ? tEntry.editedText : null,
            charCount: tEntry.rawText.length,
            pageCount: tEntry.pageCount ?? null,
            confidence: tEntry.confidence ?? null,
            createdAt: now(),
            updatedAt: now(),
          });
          stagedTextIds.push(tEntry.reference.id);
          stagedTextRefs.push(tEntry.reference);
        }
      }
    }

    const journal = {
      operationId: createOperationId(cryptoImpl),
      createdAt: now(),
      updatedAt: now(),
      status: JOURNAL_STATUS.INITIALIZED,
      backupFormat: parsedBackup.format,
      backupVersion: parsedBackup.version,
      backupExportedAt: parsedBackup.exportedAt,
      existingBinaryIds,
      existingTextIds,
      targetBinaryIds: (parsedBackup.binaries || []).map(b => b.reference?.id).filter(Boolean),
      targetTextIds: (parsedBackup.texts || []).map(t => t.reference?.id).filter(Boolean),
      stagedBinaryIds,
      stagedTextIds,
      stagedBinaryRefs,
      stagedTextRefs,
      previousStorageSnapshot: initialStorageSnapshot,
      stagedStorageKeys: new Map(), // format kompatibilitas rollback in-process
      modifiedStorageKeys: [],
      writtenStorageKeys: {},
      plannedEntityIds: {
        college_semesters: freshPlan.entities.semesters.filter(s => s.status === 'add').map(s => s.id),
        college_tasks: freshPlan.entities.tasks.filter(t => t.status === 'add').map(t => t.id),
        college_projects: freshPlan.entities.projects.filter(p => p.status === 'add').map(p => p.id),
      },
      storageWriteInfo: {
        keysPlanned: [],
        keysWritten: [],
        writtenAt: null,
      },
      verificationInfo: {
        verifiedAt: null,
        binariesCount: stagedBinaryIds.length,
        textsCount: stagedTextIds.length,
        status: 'pending',
      },
    };

    // Tulis jurnal awal ke unimate-restore-vault SEBELUM mutasi data apa pun
    try {
      await journalStore.createJournal(journal);
    } catch (err) {
      if (err instanceof RestoreJournalError && err.code === 'quota_exceeded') {
        throw new PortableAcademicRestoreError('quota_exceeded', 'Penyimpanan recovery penuh.');
      }
      throw new PortableAcademicRestoreError('journal_init_failed', err?.message || 'Gagal menginisialisasi jurnal pemulihan.');
    }

    journal.status = JOURNAL_STATUS.TARGETS_REGISTERED;
    journal.updatedAt = now();
    await journalStore.updateJournal(journal.operationId, {
      status: journal.status,
      updatedAt: journal.updatedAt,
    });

    if (options.simulateCrash === 'after_journal_created') {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      throw new PortableAcademicRestoreError('simulated_crash_after_journal', 'Simulasi kegagalan sesudah jurnal dibuat.');
    }

    // 4. Tahap Staging Biner & Teks ke IndexedDB (Additive only)
    try {
      if (fileRecords.length > 0 || textRecords.length > 0) {
        if (typeof binaryStore.restoreEntries !== 'function') {
          throw new PortableAcademicRestoreError('storage_unavailable', 'Store biner tidak mendukung pemulihan batch.');
        }
        await binaryStore.restoreEntries({ fileRecords, textRecords });
      }
    } catch (error) {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      if (error instanceof BinaryFileStoreError) {
        if (error.code === 'conflict_detected') {
          throw new PortableAcademicRestoreError('conflict_detected', 'Bentrok record biner/teks terdeteksi pada IndexedDB.');
        }
        if (error.code === 'quota_exceeded') {
          throw new PortableAcademicRestoreError('quota_exceeded', 'Kapasitas penyimpanan IndexedDB tidak mencukupi.');
        }
      }
      throw new PortableAcademicRestoreError('binary_write_failed', error.message || 'Gagal menyimpan berkas biner/teks.');
    }

    journal.status = JOURNAL_STATUS.BINARIES_STAGED;
    journal.updatedAt = now();
    await journalStore.updateJournal(journal.operationId, {
      status: journal.status,
      updatedAt: journal.updatedAt,
    });

    if (options.simulateCrash === 'after_binary_staging') {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      throw new PortableAcademicRestoreError('simulated_crash_after_staging', 'Simulasi kegagalan setelah staging biner.');
    }

    // 5. Tahap Staging Metadata Akademik ke Storage (Additive Merging)
    journal.status = JOURNAL_STATUS.STAGING_METADATA;
    journal.updatedAt = now();
    await journalStore.updateJournal(journal.operationId, {
      status: journal.status,
      updatedAt: journal.updatedAt,
    });

    const academicData = parsedBackup.academic?.data ?? {};
    const plannedKeys = [];
    if (freshPlan.entities.profile?.status === 'add') {
      plannedKeys.push('profile_nim', 'profile_name', 'profile_fullname', 'profile_instansi', 'profile_jurusan');
    }
    if (freshPlan.entities.semesters.some(s => s.status === 'add')) plannedKeys.push('college_semesters');
    if (freshPlan.entities.tasks.some(t => t.status === 'add')) plannedKeys.push('college_tasks');
    if (freshPlan.entities.projects.some(p => p.status === 'add')) plannedKeys.push('college_projects');
    if (freshPlan.entities.thesis?.status === 'add') plannedKeys.push('college_thesis');

    journal.storageWriteInfo.keysPlanned = plannedKeys;
    journal.modifiedStorageKeys = [...plannedKeys];

    try {
      // Catat seluruh state kunci awal ke stagedStorageKeys untuk in-process rollback
      for (const key of ACADEMIC_STORAGE_KEYS) {
        try {
          journal.stagedStorageKeys.set(key, storage.getItem(key));
        } catch {
          journal.stagedStorageKeys.set(key, null);
        }
      }

      // A. Profil Mahasiswa
      if (freshPlan.entities.profile?.status === 'add') {
        const setProfile = (k, val) => {
          if (val) {
            const raw = JSON.stringify(val);
            storage.setItem(k, raw);
            journal.writtenStorageKeys[k] = raw;
          }
        };
        setProfile('profile_nim', academicData.profile_nim);
        setProfile('profile_name', academicData.profile_name);
        setProfile('profile_fullname', academicData.profile_fullname);
        setProfile('profile_instansi', academicData.profile_instansi);
        setProfile('profile_instansi_nickname', academicData.profile_instansi_nickname);
        setProfile('profile_jurusan', academicData.profile_jurusan);
        setProfile('profile_picture', academicData.profile_picture);
      }

      // B. Semester & Dokumen
      const currentSemesters = safeJsonParse(storage.getItem('college_semesters'), []);
      const semestersToAdd = (academicData.college_semesters || []).filter(bSem => {
        return freshPlan.entities.semesters.some(s => String(s.id) === String(bSem.id) && s.status === 'add');
      });
      if (semestersToAdd.length > 0) {
        const mergedSemesters = [...currentSemesters, ...semestersToAdd];
        const raw = JSON.stringify(mergedSemesters);
        storage.setItem('college_semesters', raw);
        journal.writtenStorageKeys.college_semesters = raw;
      }

      // C. Tugas (Tasks)
      const currentTasks = safeJsonParse(storage.getItem('college_tasks'), []);
      const tasksToAdd = (academicData.college_tasks || []).filter(bTask => {
        return freshPlan.entities.tasks.some(t => String(t.id) === String(bTask.id) && t.status === 'add');
      });
      if (tasksToAdd.length > 0) {
        const mergedTasks = [...currentTasks, ...tasksToAdd];
        const raw = JSON.stringify(mergedTasks);
        storage.setItem('college_tasks', raw);
        journal.writtenStorageKeys.college_tasks = raw;
      }

      // D. Proyek (Projects)
      const currentProjects = safeJsonParse(storage.getItem('college_projects'), []);
      const projectsToAdd = (academicData.college_projects || []).filter(bProj => {
        return freshPlan.entities.projects.some(p => String(p.id) === String(bProj.id) && p.status === 'add');
      });
      if (projectsToAdd.length > 0) {
        const mergedProjects = [...currentProjects, ...projectsToAdd];
        const raw = JSON.stringify(mergedProjects);
        storage.setItem('college_projects', raw);
        journal.writtenStorageKeys.college_projects = raw;
      }

      // E. Thesis Kanban
      if (freshPlan.entities.thesis?.status === 'add' && academicData.college_thesis) {
        const raw = JSON.stringify(academicData.college_thesis);
        storage.setItem('college_thesis', raw);
        journal.writtenStorageKeys.college_thesis = raw;
      }

      journal.storageWriteInfo.keysWritten = Object.keys(journal.writtenStorageKeys);
      journal.storageWriteInfo.writtenAt = now();
      journal.status = JOURNAL_STATUS.METADATA_WRITTEN;
      journal.updatedAt = now();

      await journalStore.updateJournal(journal.operationId, {
        status: journal.status,
        updatedAt: journal.updatedAt,
        writtenStorageKeys: journal.writtenStorageKeys,
        storageWriteInfo: journal.storageWriteInfo,
      });
    } catch (error) {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      if (error?.name === 'QuotaExceededError' || error?.code === 'quota_exceeded') {
        throw new PortableAcademicRestoreError('quota_exceeded', 'Penyimpanan lokal penuh (QuotaExceededError). Seluruh perubahan telah dibatalkan.');
      }
      throw new PortableAcademicRestoreError('metadata_write_failed', error.message || 'Gagal menyimpan metadata akademik.');
    }

    if (options.simulateCrash === 'after_metadata_staging') {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      throw new PortableAcademicRestoreError('simulated_crash_after_metadata', 'Simulasi kegagalan setelah penulisan metadata.');
    }

    // 6. Tahap Verifikasi Konsistensi Pasca-Tulis (Post-Verification)
    journal.status = JOURNAL_STATUS.VERIFIED;
    journal.updatedAt = now();
    try {
      for (const ref of journal.stagedBinaryRefs) {
        const blob = await binaryStore.get(ref);
        if (!blob) throw new Error(`Berkas biner ${ref.id} tidak dapat diverifikasi.`);
      }

      for (const ref of journal.stagedTextRefs) {
        const textRecord = await binaryStore.getText(ref);
        if (!textRecord) throw new Error(`Teks OCR ${ref.id} tidak dapat diverifikasi.`);
      }

      journal.verificationInfo = {
        verifiedAt: now(),
        binariesCount: journal.stagedBinaryRefs.length,
        textsCount: journal.stagedTextRefs.length,
        status: 'passed',
      };

      await journalStore.updateJournal(journal.operationId, {
        status: journal.status,
        updatedAt: journal.updatedAt,
        verificationInfo: journal.verificationInfo,
      });
    } catch (error) {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      throw new PortableAcademicRestoreError('verification_failed', `Konsistensi penyimpanan pasca-tulis gagal: ${error.message}`);
    }

    if (options.simulateCrash === 'before_commit') {
      await rollbackRestoreJournal(journal, storage, binaryStore, { journalStore });
      throw new PortableAcademicRestoreError('simulated_crash_before_commit', 'Simulasi kegagalan sebelum commit final.');
    }

    // 7. Commit Selesai (Secara hukum data sekarang sah)
    journal.status = JOURNAL_STATUS.COMMITTED;
    journal.updatedAt = now();
    await journalStore.updateJournal(journal.operationId, {
      status: journal.status,
      updatedAt: journal.updatedAt,
    });

    if (options.simulateCrash === 'after_commit') {
      // Crash tepat setelah status COMMITTED terekam, SEBELUM purgeJournal
      throw new PortableAcademicRestoreError('simulated_crash_after_commit', 'Simulasi kegagalan setelah status COMMITTED terekam.');
    }

    // 8. Pembersihan Jurnal (Purge)
    try {
      await journalStore.purgeJournal(journal.operationId);
      journal.status = JOURNAL_STATUS.PURGED;
    } catch {
      // Jika purge gagal di akhir, jurnal tetap berstatus COMMITTED yang aman untuk commit-forward saat startup
    }

    return Object.freeze({
      success: true,
      operationId: journal.operationId,
      restored: Object.freeze({
        profile: freshPlan.entities.profile?.status === 'add',
        semesters: freshPlan.entities.semesters.filter(s => s.status === 'add').length,
        tasks: freshPlan.entities.tasks.filter(t => t.status === 'add').length,
        projects: freshPlan.entities.projects.filter(p => p.status === 'add').length,
        thesis: freshPlan.entities.thesis?.status === 'add',
        binaries: journal.stagedBinaryIds.length,
        texts: journal.stagedTextIds.length,
      }),
      skipped: Object.freeze({
        profile: freshPlan.entities.profile?.status === 'unchanged',
        semesters: freshPlan.entities.semesters.filter(s => s.status === 'unchanged').length,
        tasks: freshPlan.entities.tasks.filter(t => t.status === 'unchanged').length,
        projects: freshPlan.entities.projects.filter(p => p.status === 'unchanged').length,
        thesis: freshPlan.entities.thesis?.status === 'unchanged',
        binaries: freshPlan.entities.binaries.filter(b => b.status === 'unchanged').length,
        texts: freshPlan.entities.texts.filter(t => t.status === 'unchanged').length,
      }),
      journal: Object.freeze({
        operationId: journal.operationId,
        status: journal.status,
        stagedBinaryIds: Object.freeze([...journal.stagedBinaryIds]),
        stagedTextIds: Object.freeze([...journal.stagedTextIds]),
        modifiedKeys: Object.freeze([...journal.stagedStorageKeys.keys()]),
      }),
    });
  });
}
