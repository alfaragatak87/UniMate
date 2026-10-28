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
  isBinaryFileReference,
  isDocumentTextReference,
} from './binaryFileStore.js';

const FORBIDDEN_CREDENTIAL_KEYWORDS = Object.freeze([
  'gemini_api_key',
  'gateway_token',
  'apikey',
  'api_key',
  'secret',
  'token',
  'password',
  'credential',
]);

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function scanForForbiddenCredentials(value, depth = 0) {
  if (depth > 32 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) scanForForbiddenCredentials(item, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_CREDENTIAL_KEYWORDS) {
      if (lowerKey.includes(forbidden)) {
        throw new PortableAcademicBackupError('forbidden_credential_in_backup');
      }
    }
    scanForForbiddenCredentials(item, depth + 1);
  }
}

function collectReferences(value, { binaryRefs, textRefs }, depth = 0) {
  if (depth > 32 || value === null || typeof value !== 'object') return;
  if (isBinaryFileReference(value)) {
    const existing = binaryRefs.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new PortableAcademicBackupError('reference_conflict');
    }
    binaryRefs.set(value.id, value);
    return;
  }
  if (isDocumentTextReference(value)) {
    const existing = textRefs.get(value.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new PortableAcademicBackupError('reference_conflict');
    }
    textRefs.set(value.id, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, { binaryRefs, textRefs }, depth + 1);
    return;
  }
  for (const item of Object.values(value)) {
    collectReferences(item, { binaryRefs, textRefs }, depth + 1);
  }
}

function readStorageSnapshot(storage) {
  const current = {};
  if (!storage || typeof storage.getItem !== 'function') return current;
  for (const key of ACADEMIC_STORAGE_KEYS) {
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        current[key] = JSON.parse(raw);
      }
    } catch {
      // Ignorir kunci malformed agar proses analisis tetap berjalan
    }
  }
  return current;
}

function compareObjects(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function computeStorageSnapshotSignature(storageSnapshot) {
  if (!storageSnapshot || typeof storageSnapshot !== 'object') return '';
  const keys = Object.keys(storageSnapshot).sort();
  const sortedPairs = keys.map(k => [k, storageSnapshot[k]]);
  return JSON.stringify(sortedPairs);
}

export async function createPortableRestorePlan(serialized, storage, options = {}) {
  if (typeof serialized !== 'string') {
    throw new PortableAcademicBackupError('invalid_file');
  }
  if (new TextEncoder().encode(serialized).byteLength > PORTABLE_BACKUP_MAX_BYTES) {
    throw new PortableAcademicBackupError('backup_too_large');
  }

  let rawParsed;
  try {
    rawParsed = JSON.parse(serialized);
  } catch {
    throw new PortableAcademicBackupError('invalid_file');
  }

  // Pindai adanya kredensial atau rahasia yang disisipkan
  scanForForbiddenCredentials(rawParsed);

  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const binaryStore = options.binaryStore ?? null;

  let backup;
  let isPortable = false;

  if (rawParsed?.format === PORTABLE_BACKUP_FORMAT) {
    backup = await parsePortableAcademicBackup(serialized, { cryptoImpl });
    isPortable = true;
  } else if (rawParsed?.format === 'unimate-academic-backup') {
    const academic = parseAcademicBackup(serialized);
    backup = {
      format: academic.format,
      version: academic.version,
      exportedAt: academic.exportedAt,
      academic,
      binaries: [],
      texts: [],
    };
  } else {
    throw new PortableAcademicBackupError('unsupported_format');
  }

  const academicData = backup.academic?.data ?? {};
  const currentStorage = readStorageSnapshot(storage);

  // Validasi konsistensi referensi data akademik dengan entri binaries dan texts
  const binaryRefs = new Map();
  const textRefs = new Map();
  collectReferences(academicData, { binaryRefs, textRefs });

  const backupBinariesById = new Map();
  for (const entry of (backup.binaries ?? [])) {
    if (backupBinariesById.has(entry.reference.id)) {
      const existing = backupBinariesById.get(entry.reference.id);
      if (existing.sha256 !== entry.sha256 || existing.reference.size !== entry.reference.size) {
        throw new PortableAcademicBackupError('duplicate_id_conflict');
      }
    }
    backupBinariesById.set(entry.reference.id, entry);
  }

  const backupTextsById = new Map();
  for (const entry of (backup.texts ?? [])) {
    if (backupTextsById.has(entry.reference.id)) {
      const existing = backupTextsById.get(entry.reference.id);
      if (existing.sha256 !== entry.sha256 || existing.rawText !== entry.rawText) {
        throw new PortableAcademicBackupError('duplicate_id_conflict');
      }
    }
    backupTextsById.set(entry.reference.id, entry);
  }

  if (isPortable) {
    for (const id of binaryRefs.keys()) {
      if (!backupBinariesById.has(id)) {
        throw new PortableAcademicBackupError('missing_binary_reference');
      }
    }
    for (const id of textRefs.keys()) {
      if (!backupTextsById.has(id)) {
        throw new PortableAcademicBackupError('missing_text_reference');
      }
    }
  }

  // Inisialisasi struktur analisis
  const risks = [];
  const plan = {
    format: backup.format,
    version: backup.version,
    exportedAt: backup.exportedAt,
    portable: isPortable,
    canRestoreClean: true,
    summary: {
      totalEntities: 0,
      toAdd: 0,
      toSkip: 0,
      conflicts: 0,
      binariesCount: backup.binaries?.length ?? 0,
      textsCount: backup.texts?.length ?? 0,
    },
    entities: {
      profile: null,
      semesters: [],
      tasks: [],
      projects: [],
      thesis: null,
      binaries: [],
      texts: [],
    },
    risks,
    integrity: {
      binariesVerified: isPortable && (backup.binaries?.length ?? 0) > 0,
      textsVerified: isPortable && (backup.texts?.length ?? 0) > 0,
      editedTextProtected: isPortable ? backup.version >= 2 : true,
    },
    storageSnapshotSignature: computeStorageSnapshotSignature(currentStorage),
    restoreEnabled: false,
  };

  // 1. Analisis Profil
  const currentNim = String(currentStorage.profile_nim ?? '').trim();
  const backupNim = String(academicData.profile_nim ?? '').trim();
  const currentName = String(currentStorage.profile_fullname || currentStorage.profile_name || '').trim();
  const backupName = String(academicData.profile_fullname || academicData.profile_name || '').trim();

  let profileStatus = 'unchanged';
  let profileReason = 'Identitas profil mahasiswa sesuai.';

  if (currentNim && backupNim && currentNim !== backupNim) {
    profileStatus = 'conflict';
    profileReason = `NIM mahasiswa berbeda (Lokal: "${currentNim}" vs Backup: "${backupNim}").`;
    risks.push(profileReason);
  } else if (currentName && backupName && currentName !== backupName && currentName !== 'Mahasiswa') {
    profileStatus = 'conflict';
    profileReason = `Nama mahasiswa berbeda (Lokal: "${currentName}" vs Backup: "${backupName}").`;
    risks.push(profileReason);
  } else if (!currentNim && backupNim) {
    profileStatus = 'add';
    profileReason = 'Mengisi profil mahasiswa lokal yang masih kosong.';
  }

  plan.entities.profile = {
    status: profileStatus,
    reason: profileReason,
    current: { nim: currentNim, name: currentName },
    backup: { nim: backupNim, name: backupName },
  };

  if (profileStatus === 'add') plan.summary.toAdd += 1;
  else if (profileStatus === 'conflict') plan.summary.conflicts += 1;
  else plan.summary.toSkip += 1;
  plan.summary.totalEntities += 1;

  // 2. Analisis Semesters (college_semesters)
  const currentSemesters = Array.isArray(currentStorage.college_semesters) ? currentStorage.college_semesters : [];
  const backupSemesters = Array.isArray(academicData.college_semesters) ? academicData.college_semesters : [];

  for (const bSem of backupSemesters) {
    plan.summary.totalEntities += 1;
    const matchById = currentSemesters.find(s => String(s.id) === String(bSem.id));
    const matchByName = currentSemesters.find(s => s.name?.trim().toLowerCase() === bSem.name?.trim().toLowerCase());

    if (matchById) {
      if (compareObjects(matchById, bSem)) {
        plan.entities.semesters.push({
          id: bSem.id,
          name: bSem.name || 'Semester',
          status: 'unchanged',
          reason: 'Data semester dan mata kuliah identik dengan versi lokal.',
        });
        plan.summary.toSkip += 1;
      } else {
        const conflictReason = `Semester "${bSem.name}" (ID ${bSem.id}) memiliki perbedaan data mata kuliah, nilai, atau dokumen.`;
        plan.entities.semesters.push({
          id: bSem.id,
          name: bSem.name || 'Semester',
          status: 'conflict',
          reason: conflictReason,
          details: {
            coursesInBackup: bSem.courses?.length ?? 0,
            coursesInLocal: matchById.courses?.length ?? 0,
          },
        });
        plan.summary.conflicts += 1;
        risks.push(conflictReason);
      }
    } else if (matchByName) {
      const conflictReason = `Nama semester "${bSem.name}" sama dengan semester lokal tetapi memiliki ID berbeda (${bSem.id} vs ${matchByName.id}).`;
      plan.entities.semesters.push({
        id: bSem.id,
        name: bSem.name || 'Semester',
        status: 'conflict',
        reason: conflictReason,
        details: { backupId: bSem.id, localId: matchByName.id },
      });
      plan.summary.conflicts += 1;
      risks.push(conflictReason);
    } else {
      plan.entities.semesters.push({
        id: bSem.id,
        name: bSem.name || 'Semester Baru',
        status: 'add',
        reason: 'Semester baru (belum ada di perangkat lokal).',
      });
      plan.summary.toAdd += 1;
    }
  }

  // 3. Analisis Tasks (college_tasks)
  const currentTasks = Array.isArray(currentStorage.college_tasks) ? currentStorage.college_tasks : [];
  const backupTasks = Array.isArray(academicData.college_tasks) ? academicData.college_tasks : [];

  for (const bTask of backupTasks) {
    plan.summary.totalEntities += 1;
    const matchById = currentTasks.find(t => String(t.id) === String(bTask.id));
    const matchByTitle = currentTasks.find(t => t.title?.trim().toLowerCase() === bTask.title?.trim().toLowerCase() && t.deadline === bTask.deadline);

    if (matchById) {
      if (compareObjects(matchById, bTask)) {
        plan.entities.tasks.push({ id: bTask.id, title: bTask.title, status: 'unchanged', reason: 'Tugas identik.' });
        plan.summary.toSkip += 1;
      } else {
        plan.entities.tasks.push({ id: bTask.id, title: bTask.title, status: 'conflict', reason: 'Status/deadline tugas berbeda dengan data lokal.' });
        plan.summary.conflicts += 1;
      }
    } else if (matchByTitle) {
      plan.entities.tasks.push({ id: bTask.id, title: bTask.title, status: 'conflict', reason: 'Judul tugas dan deadline sama tetapi memiliki ID berbeda.' });
      plan.summary.conflicts += 1;
    } else {
      plan.entities.tasks.push({ id: bTask.id, title: bTask.title, status: 'add', reason: 'Tugas baru.' });
      plan.summary.toAdd += 1;
    }
  }

  // 4. Analisis Projects (college_projects)
  const currentProjects = Array.isArray(currentStorage.college_projects) ? currentStorage.college_projects : [];
  const backupProjects = Array.isArray(academicData.college_projects) ? academicData.college_projects : [];

  for (const bProj of backupProjects) {
    plan.summary.totalEntities += 1;
    const matchById = currentProjects.find(p => String(p.id) === String(bProj.id));
    if (matchById) {
      if (compareObjects(matchById, bProj)) {
        plan.entities.projects.push({ id: bProj.id, title: bProj.title, status: 'unchanged', reason: 'Proyek identik.' });
        plan.summary.toSkip += 1;
      } else {
        plan.entities.projects.push({ id: bProj.id, title: bProj.title, status: 'conflict', reason: 'Perbedaan detail proyek lokal.' });
        plan.summary.conflicts += 1;
      }
    } else {
      plan.entities.projects.push({ id: bProj.id, title: bProj.title, status: 'add', reason: 'Proyek baru.' });
      plan.summary.toAdd += 1;
    }
  }

  // 5. Analisis Thesis Kanban (college_thesis)
  const currentThesis = currentStorage.college_thesis ?? { todo: [], inProgress: [], review: [], done: [] };
  const backupThesis = academicData.college_thesis ?? { todo: [], inProgress: [], review: [], done: [] };
  const currentThesisCount = ['todo', 'inProgress', 'review', 'done'].reduce((sum, col) => sum + (Array.isArray(currentThesis[col]) ? currentThesis[col].length : 0), 0);
  const backupThesisCount = ['todo', 'inProgress', 'review', 'done'].reduce((sum, col) => sum + (Array.isArray(backupThesis[col]) ? backupThesis[col].length : 0), 0);

  if (currentThesisCount === 0 && backupThesisCount > 0) {
    plan.entities.thesis = { status: 'add', reason: `Memulihkan ${backupThesisCount} item skripsi/tugas akhir ke papan kosong.` };
    plan.summary.toAdd += 1;
  } else if (compareObjects(currentThesis, backupThesis)) {
    plan.entities.thesis = { status: 'unchanged', reason: 'Papan skripsi identik.' };
    plan.summary.toSkip += 1;
  } else {
    plan.entities.thesis = { status: 'conflict', reason: `Papan skripsi lokal memiliki kartu/progres berbeda (${currentThesisCount} vs ${backupThesisCount} item).` };
    plan.summary.conflicts += 1;
    risks.push('Papan skripsi lokal memiliki perbedaan progres dengan cadangan.');
  }
  plan.summary.totalEntities += 1;

  // 6. Analisis Berkas Biner (IndexedDB)
  for (const entry of (backup.binaries ?? [])) {
    plan.summary.totalEntities += 1;
    let bStatus = 'add';
    let bReason = 'Berkas fisik baru siap dipulihkan ke IndexedDB.';

    if (binaryStore && typeof binaryStore.get === 'function') {
      try {
        const existingBlob = await binaryStore.get(entry.reference);
        if (existingBlob && existingBlob.size === entry.reference.size) {
          bStatus = 'unchanged';
          bReason = 'Berkas biner sudah ada di IndexedDB dengan ukuran identik.';
        } else if (existingBlob) {
          bStatus = 'conflict';
          bReason = 'ID biner bentrok dengan berkas lokal yang memiliki ukuran berbeda.';
          risks.push(`ID berkas ${entry.reference.id} (${entry.reference.name}) bentrok dengan ukuran berbeda.`);
        }
      } catch {
        // file_not_found berarti aman ditambah
      }
    }

    plan.entities.binaries.push({
      id: entry.reference.id,
      name: entry.reference.name,
      size: entry.reference.size,
      sha256: entry.sha256,
      status: bStatus,
      reason: bReason,
    });

    if (bStatus === 'add') plan.summary.toAdd += 1;
    else if (bStatus === 'conflict') plan.summary.conflicts += 1;
    else plan.summary.toSkip += 1;
  }

  // 7. Analisis Teks OCR (IndexedDB)
  for (const entry of (backup.texts ?? [])) {
    plan.summary.totalEntities += 1;
    let tStatus = 'add';
    let tReason = 'Teks OCR baru siap dipulihkan ke IndexedDB.';

    if (binaryStore && typeof binaryStore.getText === 'function') {
      try {
        const existingText = await binaryStore.getText(entry.reference);
        if (existingText && existingText.rawText === entry.rawText && existingText.editedText === entry.editedText) {
          tStatus = 'unchanged';
          tReason = 'Teks OCR sudah ada di IndexedDB dengan isi identik.';
        } else if (existingText) {
          tStatus = 'conflict';
          tReason = 'ID teks bentrok dengan catatan OCR lokal yang memiliki teks berbeda.';
          risks.push(`ID teks OCR ${entry.reference.id} memiliki teks lokal yang berbeda.`);
        }
      } catch {
        // text_not_found berarti aman ditambah
      }
    }

    plan.entities.texts.push({
      id: entry.reference.id,
      binaryId: entry.reference.binaryId,
      charCount: entry.reference.charCount,
      hasEditedText: entry.reference.hasEditedText,
      status: tStatus,
      reason: tReason,
    });

    if (tStatus === 'add') plan.summary.toAdd += 1;
    else if (tStatus === 'conflict') plan.summary.conflicts += 1;
    else plan.summary.toSkip += 1;
  }

  // Catatan peringatan checksum editedText untuk backup v1
  if (isPortable && backup.version === 1 && (backup.texts?.length ?? 0) > 0) {
    risks.push('Perhatian Integritas: Checksum SHA-256 teks pada cadangan versi 1 hanya memverifikasi rawText; editedText tidak terlindungi checksum.');
  }

  plan.canRestoreClean = plan.summary.conflicts === 0 && risks.filter(r => !r.startsWith('Perhatian Integritas')).length === 0;

  return deepFreeze(plan);
}
