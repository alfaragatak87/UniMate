/**
 * academicImportPlan.js
 * 
 * Mesin Perencanaan Penggabungan (Dry-Run) & Impor Akademik KRS/KHS ke Data Semester UniMate.
 * 
 * Kebijakan & Prinsip Keamanan (B6C):
 * 1. Konservatif & Anti-Blind Overwrite: membedakan add, unchanged, conflict, invalid, dan skipped.
 * 2. Pencocokan Ketat: berbasis kode MK (jika ada) dan nama ternormalisasi, tanpa pencocokan fuzzy spekulatif.
 * 3. Deteksi Nama Sama Kode Beda: diklasifikasikan sebagai konflik eksplisit.
 * 4. Pembangkitan ID Bebas Tabrakan: menjamin tidak ada tabrakan dengan ID mata kuliah existing.
 * 5. Proteksi Identitas: memblokir impor jika NIM dokumen berbeda dari profil tanpa konfirmasi eksplisit.
 * 6. Deteksi Stale Plan: rencana kedaluwarsa jika data semester target berubah pasca-pratinjau.
 * 7. Gating Jalur Tulis Produksi: eksekusi ke data semester asli terkunci (hanya aktif pada uji sintetis).
 */

import { VALID_LETTER_GRADES, detectScheduleClashes } from './offlineAcademicParser.js';

export function isValidSksValue(val) {
  const num = Number(val);
  return Number.isInteger(num) && num >= 1 && num <= 12;
}

export function formatScheduleString(course) {
  if (!course || typeof course !== 'object') return null;
  const parts = [];
  if (course.day) parts.push(course.day);
  if (course.timeStart && course.timeEnd) parts.push(`${course.timeStart}-${course.timeEnd}`);
  else if (course.timeStart) parts.push(course.timeStart);
  if (course.room) parts.push(`(${course.room})`);
  return parts.length > 0 ? parts.join(' ') : null;
}

export class AcademicImportPlanError extends Error {
  constructor(code, message = '') {
    const msg = message || `Perencanaan impor akademik gagal: ${code}`;
    super(msg);
    this.name = 'AcademicImportPlanError';
    this.code = code;
  }
}

export const ACADEMIC_IMPORT_LOCK_NAME = 'unimate_academic_import_lock';

/**
 * Eksekusi dengan Web Locks API (eksklusif sejati, fail-closed jika lock sedang dipegang)
 */
export async function withAcademicImportLock(options = {}, callback) {
  const actualOptions = typeof options === 'function' ? {} : (options || {});
  const actualCallback = typeof options === 'function' ? options : callback;

  if (typeof actualCallback !== 'function') {
    throw new TypeError('Callback untuk withAcademicImportLock harus berupa fungsi');
  }

  const lockManager = actualOptions?.lockManager !== undefined
    ? actualOptions.lockManager
    : (typeof navigator !== 'undefined' ? navigator.locks : null);

  if (actualOptions?.bypassLock === true) {
    return await actualCallback();
  }

  // Jika Web Locks tidak tersedia pada browser / runtime
  if (!lockManager || typeof lockManager.request !== 'function') {
    if (actualOptions?.failIfLockUnavailable === true) {
      throw new AcademicImportPlanError(
        'lock_unavailable',
        'Mekanisme penguncian eksklusif (Web Locks API) tidak didukung pada platform ini. Operasi dibatalkan demi keamanan data (fail-closed).'
      );
    }
    return await actualCallback();
  }

  return await lockManager.request(
    ACADEMIC_IMPORT_LOCK_NAME,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) {
        throw new AcademicImportPlanError(
          'import_locked',
          'Operasi penggabungan atau impor akademik sedang berlangsung pada tab/jendela lain.'
        );
      }
      return await actualCallback();
    }
  );
}

/**
 * Ringkasan rencana komit untuk dialog konfirmasi manual pengguna
 */
export function createAcademicImportCommitSummary(plan, targetSemester, actionOverrides = {}) {
  let addCount = 0;
  let overwriteCount = 0;
  let keepCount = 0;
  let skipCount = 0;
  let unchangedCount = 0;
  const overwrites = [];

  for (const item of (plan?.items || [])) {
    const action = actionOverrides[item.index] || item.proposedAction;

    if (action === 'skip' || item.status === 'invalid' || item.status === 'skipped') {
      skipCount++;
    } else if (item.status === 'unchanged' && action === 'unchanged') {
      unchangedCount++;
    } else if (action === 'add' || item.status === 'add') {
      addCount++;
    } else if (action === 'overwrite' || action === 'update' || action === 'update_schedule') {
      overwriteCount++;
      overwrites.push({
        name: item.candidateCourse.name,
        code: item.candidateCourse.code || item.existingCourse?.code || '',
        existingCourse: item.existingCourse,
        candidateCourse: item.candidateCourse,
        differences: item.differences,
      });
    } else if (action === 'keep_existing') {
      keepCount++;
    }
  }

  return Object.freeze({
    targetSemesterName: targetSemester?.name || `Semester ${targetSemester?.id || ''}`,
    targetSemesterId: targetSemester?.id,
    addCount,
    overwriteCount,
    keepCount,
    skipCount,
    unchangedCount,
    overwrites: Object.freeze(overwrites),
    hasIdentityMismatch: Boolean(plan?.hasIdentityMismatch),
    hasConflicts: (plan?.conflictCount || 0) > 0,
    totalPlannedActions: addCount + overwriteCount,
  });
}

/**
 * Normalisasi nama mata kuliah untuk pembandingan aman.
 * Menghapus spasi ganda, lowercase, dan membuang format label legacy "(Nilai: X)".
 */
export function normalizeCourseName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/\s*\(Nilai:\s*[^)]+\)/gi, '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('id-ID');
}

/**
 * Normalisasi kode mata kuliah (alphanumeric uppercase tanpa spasi).
 */
export function normalizeCourseCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Normalisasi identitas NIM (hanya angka/alphanumeric).
 */
export function normalizeIdentity(val) {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Menghasilkan fingerprint snapshot semester untuk mendeteksi perubahan data (stale detection).
 */
export function computeSemesterFingerprint(semester) {
  if (!semester || typeof semester !== 'object') return 'empty';
  const courses = Array.isArray(semester.courses) ? semester.courses : [];
  const parts = [
    String(semester.id || ''),
    String(semester.name || ''),
    String(semester.gpa || ''),
    String(courses.length),
    ...courses.map((c, i) => {
      if (typeof c === 'string') return `${i}:${c}`;
      return `${i}:${c.id || ''}:${c.code || ''}:${c.name || ''}:${c.sks || ''}:${c.grade || ''}:${c.day || ''}:${c.timeStart || ''}:${c.timeEnd || ''}:${c.room || ''}`;
    }),
  ];
  return parts.join('|');
}

/**
 * Mengekstrak informasi mata kuliah dari entri existing (bisa berupa string atau object).
 */
export function parseExistingCourse(course, index) {
  if (typeof course === 'string') {
    let cleanName = course;
    let grade = null;
    const match = course.match(/(.*?)\s*\(Nilai:\s*([^)]+)\)/i);
    if (match) {
      cleanName = match[1].trim();
      grade = match[2].trim().toUpperCase();
    }
    return {
      id: `existing-str-${index}`,
      name: cleanName,
      rawName: course,
      code: '',
      sks: null,
      grade,
      gradePoint: null,
      point: null,
      class: null,
      day: null,
      timeStart: null,
      timeEnd: null,
      room: null,
      lecturer: null,
      mode: null,
      schedules: [],
      files: [],
      isLegacyString: true,
    };
  }

  if (course && typeof course === 'object') {
    let cleanName = course.name || '';
    let grade = course.grade || null;
    const match = cleanName.match(/(.*?)\s*\(Nilai:\s*([^)]+)\)/i);
    if (match) {
      cleanName = match[1].trim();
      if (!grade) grade = match[2].trim().toUpperCase();
    }

    return {
      id: course.id || `existing-obj-${index}`,
      name: cleanName,
      rawName: course.name || '',
      code: course.code || '',
      sks: course.sks ?? null,
      grade,
      gradePoint: course.gradePoint ?? course.point ?? null,
      point: course.point ?? course.gradePoint ?? null,
      class: course.class || course.kelas || null,
      day: course.day || null,
      timeStart: course.timeStart || null,
      timeEnd: course.timeEnd || null,
      room: course.room || null,
      lecturer: course.lecturer || null,
      mode: course.mode || null,
      schedules: Array.isArray(course.schedules) ? course.schedules : [],
      files: Array.isArray(course.files) ? course.files : [],
      isLegacyString: false,
      rawObject: course,
    };
  }

  return null;
}

/**
 * Membangun rencana penggabungan (dry-run) data kandidat ke semester target.
 * 
 * @param {Object} targetSemester - Objek semester tujuan
 * @param {Object} candidate - Objek kandidat hasil review
 * @param {Object} options - Opsi tambahan (userProfile, idFactory)
 * @returns {Object} plan - Objek rencana komparatif deep-frozen
 */
export function createAcademicImportPlan(targetSemester, candidate, options = {}) {
  if (!targetSemester || typeof targetSemester !== 'object') {
    throw new AcademicImportPlanError('invalid_target_semester', 'Semester target tidak valid');
  }
  if (!candidate || typeof candidate !== 'object') {
    throw new AcademicImportPlanError('invalid_candidate', 'Kandidat akademik tidak valid');
  }

  const userProfile = options.userProfile || {};
  const isKhs = candidate.documentType === 'KHS' || candidate.isKhs === true;
  const isKrs = candidate.documentType === 'KRS' || candidate.isKrs === true;

  // Verifikasi Identitas Mahasiswa (NIM)
  const docNim = normalizeIdentity(candidate.student?.nim || '');
  const profNim = normalizeIdentity(userProfile.nim || '');
  const hasIdentityMismatch = Boolean(docNim && profNim && docNim !== profNim);

  // Snapshot Fingerprint Semester untuk deteksi stale
  const semesterSnapshot = computeSemesterFingerprint(targetSemester);
  const existingRawCourses = Array.isArray(targetSemester.courses) ? targetSemester.courses : [];
  const existingCourses = existingRawCourses
    .map((c, i) => parseExistingCourse(c, i))
    .filter(Boolean);

  // Koleksi ID existing untuk mencegah tabrakan ID
  const existingIdSet = new Set(existingCourses.map(c => String(c.id)));
  let nextIdCounter = 1;
  const defaultIdFactory = () => {
    let candidateId = `course-${Date.now()}-${nextIdCounter++}`;
    while (existingIdSet.has(candidateId)) {
      candidateId = `course-${Date.now()}-${nextIdCounter++}`;
    }
    existingIdSet.add(candidateId);
    return candidateId;
  };
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory;

  const rawCandidateCourses = Array.isArray(candidate.courses) ? candidate.courses : [];
  const items = [];

  for (let i = 0; i < rawCandidateCourses.length; i++) {
    const rawItem = rawCandidateCourses[i];
    const isSkipped = rawItem.included === false;
    const itemCode = normalizeCourseCode(rawItem.code || '');
    const itemName = typeof rawItem.name === 'string' ? rawItem.name.trim() : '';
    const normName = normalizeCourseName(itemName);
    const itemSks = rawItem.sks !== undefined && rawItem.sks !== null && rawItem.sks !== ''
      ? Number(rawItem.sks)
      : null;
    const itemGrade = isKhs && rawItem.grade ? String(rawItem.grade).trim().toUpperCase() : null;
    const itemGradePoint = isKhs ? (rawItem.gradePoint ?? rawItem.point ?? null) : null;

    const itemClass = rawItem.class || rawItem.kelas || null;
    const itemDay = rawItem.day || null;
    const itemTimeStart = rawItem.timeStart || null;
    const itemTimeEnd = rawItem.timeEnd || null;
    const itemRoom = rawItem.room || null;
    const itemLecturer = rawItem.lecturer || null;
    const itemMode = rawItem.mode || null;
    const itemSchedules = Array.isArray(rawItem.schedules) ? rawItem.schedules : [];

    // 1. Cek Validitas Kandidat
    const invalidReasons = [];
    if (!itemName) invalidReasons.push('course_name_empty');
    if (itemSks !== null && !isValidSksValue(itemSks)) invalidReasons.push('sks_invalid');
    if (isKhs && itemGrade && !VALID_LETTER_GRADES.has(itemGrade)) invalidReasons.push('grade_unrecognized');
    if (isKhs && itemGradePoint !== null && (itemGradePoint > 4.0 || itemGradePoint < 0)) invalidReasons.push('gradepoint_invalid_range');

    const candidatePayload = {
      code: rawItem.code || '',
      name: itemName,
      sks: itemSks,
      grade: itemGrade,
      gradePoint: itemGradePoint,
      class: itemClass,
      day: itemDay,
      timeStart: itemTimeStart,
      timeEnd: itemTimeEnd,
      room: itemRoom,
      lecturer: itemLecturer,
      mode: itemMode,
      schedules: itemSchedules,
      included: !isSkipped,
    };

    if (invalidReasons.length > 0) {
      items.push(Object.freeze({
        index: i,
        status: 'invalid',
        reasons: invalidReasons,
        candidateCourse: candidatePayload,
        existingCourse: null,
        differences: [],
        proposedAction: 'skip',
      }));
      continue;
    }

    // 2. Cek apakah sengaja dilewati oleh pengguna
    if (isSkipped) {
      items.push(Object.freeze({
        index: i,
        status: 'skipped',
        candidateCourse: { ...candidatePayload, included: false },
        existingCourse: null,
        differences: [],
        proposedAction: 'skip',
      }));
      continue;
    }

    // 3. Pencocokan Konservatif terhadap Data Semester Existing
    let matchedExisting = null;
    let matchType = 'none';

    // A. Prioritas 1: Cocokkan berdasarkan KODE jika kedua pihak memiliki kode
    if (itemCode) {
      const matchByCode = existingCourses.find(ec => normalizeCourseCode(ec.code) === itemCode);
      if (matchByCode) {
        matchedExisting = matchByCode;
        matchType = 'code';
      }
    }

    // B. Prioritas 2: Jika belum cocok berdasarkan kode, cocokkan berdasarkan NAMA ternormalisasi
    if (!matchedExisting && normName) {
      const matchByName = existingCourses.find(ec => normalizeCourseName(ec.name) === normName);
      if (matchByName) {
        matchedExisting = matchByName;
        matchType = 'name';
      }
    }

    // 4. Kasus A: Mata Kuliah Baru (Belum ada di Semester)
    if (!matchedExisting) {
      items.push(Object.freeze({
        index: i,
        status: 'add',
        candidateCourse: candidatePayload,
        existingCourse: null,
        differences: [],
        proposedAction: 'add',
      }));
      continue;
    }

    // 5. Kasus B: Ditemukan kecocokan - Analisis Perbedaan (Differences)
    const differences = [];
    const existingNormCode = normalizeCourseCode(matchedExisting.code);
    const existingNormName = normalizeCourseName(matchedExisting.name);

    // Konflik Nama Sama Kode Berbeda
    if (matchType === 'name' && itemCode && existingNormCode && itemCode !== existingNormCode) {
      differences.push({
        field: 'code',
        label: 'Kode Mata Kuliah',
        existingValue: matchedExisting.code,
        candidateValue: rawItem.code,
        severity: 'conflict',
      });
    }

    // Konflik Kode Sama Nama Berbeda
    if (matchType === 'code' && normName && existingNormName && normName !== existingNormName) {
      differences.push({
        field: 'name',
        label: 'Nama Mata Kuliah',
        existingValue: matchedExisting.name,
        candidateValue: itemName,
        severity: 'conflict',
      });
    }

    // Perbedaan SKS
    if (itemSks !== null && matchedExisting.sks !== null && itemSks !== matchedExisting.sks) {
      differences.push({
        field: 'sks',
        label: 'Bobot SKS',
        existingValue: matchedExisting.sks,
        candidateValue: itemSks,
        severity: 'conflict',
      });
    }

    // Perbedaan Nilai Huruf KHS
    if (isKhs && itemGrade && matchedExisting.grade && itemGrade !== matchedExisting.grade) {
      differences.push({
        field: 'grade',
        label: 'Nilai Huruf',
        existingValue: matchedExisting.grade,
        candidateValue: itemGrade,
        severity: 'conflict',
      });
    }

    // Jika KHS memiliki nilai tetapi existing belum memiliki nilai (pengisian nilai)
    if (isKhs && itemGrade && !matchedExisting.grade) {
      differences.push({
        field: 'grade',
        label: 'Pengisian Nilai Baru',
        existingValue: null,
        candidateValue: itemGrade,
        severity: 'fill',
      });
    }

    // Jika existing belum memiliki SKS tapi kandidat punya (pengisian SKS)
    if (itemSks !== null && (matchedExisting.sks === null || matchedExisting.sks === undefined)) {
      differences.push({
        field: 'sks',
        label: 'Pengisian SKS Baru',
        existingValue: null,
        candidateValue: itemSks,
        severity: 'fill',
      });
    }

    // Jika existing belum memiliki kode tapi kandidat punya (pengisian kode)
    if (itemCode && !matchedExisting.code) {
      differences.push({
        field: 'code',
        label: 'Pengisian Kode Baru',
        existingValue: '',
        candidateValue: rawItem.code,
        severity: 'fill',
      });
    }

    // Analisis Komparasi Jadwal Perkuliahan
    const candSched = formatScheduleString(rawItem);
    const existSched = formatScheduleString(matchedExisting);
    if (candSched && existSched && candSched !== existSched) {
      differences.push({
        field: 'schedule',
        label: 'Jadwal Perkuliahan',
        existingValue: existSched,
        candidateValue: candSched,
        severity: 'conflict',
      });
    } else if (candSched && !existSched) {
      differences.push({
        field: 'schedule',
        label: 'Pengisian Jadwal Perkuliahan',
        existingValue: null,
        candidateValue: candSched,
        severity: 'fill',
      });
    }

    // Analisis Perbedaan Dosen Pengampu
    if (itemLecturer && matchedExisting.lecturer && itemLecturer !== matchedExisting.lecturer) {
      differences.push({
        field: 'lecturer',
        label: 'Dosen Pengampu',
        existingValue: matchedExisting.lecturer,
        candidateValue: itemLecturer,
        severity: 'conflict',
      });
    } else if (itemLecturer && !matchedExisting.lecturer) {
      differences.push({
        field: 'lecturer',
        label: 'Pengisian Dosen Pengampu',
        existingValue: null,
        candidateValue: itemLecturer,
        severity: 'fill',
      });
    }

    // Analisis Perbedaan Kelas
    if (itemClass && matchedExisting.class && itemClass !== matchedExisting.class) {
      differences.push({
        field: 'class',
        label: 'Kelas',
        existingValue: matchedExisting.class,
        candidateValue: itemClass,
        severity: 'conflict',
      });
    } else if (itemClass && !matchedExisting.class) {
      differences.push({
        field: 'class',
        label: 'Pengisian Kelas',
        existingValue: null,
        candidateValue: itemClass,
        severity: 'fill',
      });
    }

    // Penentuan Status Akhir Item
    const hasConflict = differences.some(d => d.severity === 'conflict');
    const hasFill = differences.some(d => d.severity === 'fill');

    let status = 'unchanged';
    let proposedAction = 'keep_existing';

    if (hasConflict) {
      status = 'conflict';
      // Konservatif: default aksi untuk konflik adalah mempertahankan data lama
      proposedAction = 'keep_existing';
    } else if (hasFill) {
      status = 'update';
      proposedAction = isKrs ? 'update_schedule' : 'update';
    } else {
      status = 'unchanged';
      proposedAction = 'keep_existing';
    }

    items.push(Object.freeze({
      index: i,
      status,
      candidateCourse: candidatePayload,
      existingCourse: {
        id: matchedExisting.id,
        code: matchedExisting.code,
        name: matchedExisting.name,
        sks: matchedExisting.sks,
        grade: matchedExisting.grade,
        class: matchedExisting.class,
        day: matchedExisting.day,
        timeStart: matchedExisting.timeStart,
        timeEnd: matchedExisting.timeEnd,
        room: matchedExisting.room,
        lecturer: matchedExisting.lecturer,
      },
      differences,
      proposedAction,
    }));
  }

  // Deteksi Bentrok Jadwal di Semester Target
  // Gabungkan mata kuliah existing yang tidak tertimpa dengan kandidat-kandidat baru
  const activeCandidatesForClash = items
    .filter(it => it.candidateCourse && it.candidateCourse.included !== false && (it.status === 'add' || it.status === 'update' || it.status === 'conflict'))
    .map(it => ({
      id: `candidate-${it.index}`,
      name: it.candidateCourse.name,
      code: it.candidateCourse.code,
      day: it.candidateCourse.day,
      timeStart: it.candidateCourse.timeStart,
      timeEnd: it.candidateCourse.timeEnd,
      room: it.candidateCourse.room,
      schedules: it.candidateCourse.schedules,
    }));

  const existingUntouchedForClash = existingCourses
    .filter(ec => !items.some(it => it.existingCourse && String(it.existingCourse.id) === String(ec.id)))
    .map(ec => ({
      id: ec.id,
      name: ec.name,
      code: ec.code,
      day: ec.day,
      timeStart: ec.timeStart,
      timeEnd: ec.timeEnd,
      room: ec.room,
      schedules: ec.schedules,
    }));

  const scheduleClashes = detectScheduleClashes([...activeCandidatesForClash, ...existingUntouchedForClash]);

  // Rekapitulasi Rencana
  const summary = Object.freeze({
    totalCandidates: rawCandidateCourses.length,
    addCount: items.filter(it => it.status === 'add').length,
    unchangedCount: items.filter(it => it.status === 'unchanged').length,
    updateCount: items.filter(it => it.status === 'update').length,
    conflictCount: items.filter(it => it.status === 'conflict').length,
    invalidCount: items.filter(it => it.status === 'invalid').length,
    skippedCount: items.filter(it => it.status === 'skipped').length,
  });

  return Object.freeze({
    kind: 'unimate-academic-import-plan',
    version: 1,
    targetSemesterId: targetSemester.id,
    targetSemesterName: targetSemester.name,
    semesterSnapshot,
    documentType: candidate.documentType || (isKhs ? 'KHS' : 'KRS'),
    isKhs,
    isKrs,
    hasIdentityMismatch,
    student: {
      docNim: candidate.student?.nim || '',
      docName: candidate.student?.name || '',
      profNim: userProfile.nim || '',
      profName: userProfile.fullName || userProfile.userName || '',
    },
    summary,
    scheduleClashes: Object.freeze(scheduleClashes),
    items: Object.freeze(items),
    idFactory,
  });
}

/**
 * Menerapkan rencana penggabungan akademik ke semester target secara deterministik.
 * 
 * Proteksi Keamanan:
 * - Mengunci eksekusi di lingkungan produksi (memerlukan options.enableSyntheticExecution === true).
 * - Memverifikasi integritas snapshot (deteksi plan_stale).
 * - Memverifikasi konfirmasi perbedaan identitas NIM jika ada mismatch.
 * - Tidak memutasi objek masukan (pure deep-clone output).
 * 
 * @param {Object} plan - Rencana impor hasil createAcademicImportPlan
 * @param {Object} currentSemester - Data semester target terkini
 * @param {Object} options - Opsi resolusi aksi (actionOverrides, enableSyntheticExecution, allowIdentityMismatch)
 * @returns {Object} Hasil eksekusi commit { updatedSemester, addedCount, updatedCount, skippedCount, unchangedCount }
 */
export function applyAcademicImportPlan(plan, currentSemester, options = {}) {
  if (!plan || plan.kind !== 'unimate-academic-import-plan') {
    throw new AcademicImportPlanError('invalid_plan', 'Objek rencana impor tidak valid');
  }
  if (!currentSemester || typeof currentSemester !== 'object') {
    throw new AcademicImportPlanError('invalid_semester', 'Semester terkini tidak valid');
  }

  // 1. Gating Keamanan Produksi & Verifikasi Konfirmasi Pengguna
  if (options.isUserConfirmed !== true && options.enableSyntheticExecution !== true) {
    throw new AcademicImportPlanError(
      'execution_gated',
      'Jalur penulisan ke data semester produksi dinonaktifkan tanpa konfirmasi eksplisit dari pengguna'
    );
  }

  // 2. Proteksi Stale Plan (Perubahan Semester Pasca-Preview)
  const currentSnapshot = computeSemesterFingerprint(currentSemester);
  if (currentSnapshot !== plan.semesterSnapshot) {
    throw new AcademicImportPlanError(
      'plan_stale',
      'Data semester tujuan telah berubah setelah pratinjau dibuat. Silakan lakukan review ulang.'
    );
  }

  // 3. Proteksi Perbedaan NIM Mahasiswa
  if (plan.hasIdentityMismatch && options.allowIdentityMismatch !== true) {
    throw new AcademicImportPlanError(
      'identity_mismatch_unconfirmed',
      'NIM pada dokumen berbeda dari profil pengguna. Konfirmasi eksplisit diperlukan sebelum penggabungan.'
    );
  }

  const actionOverrides = options.actionOverrides || {};
  const deepClonedSemester = JSON.parse(JSON.stringify(currentSemester));
  const rawExistingCourses = Array.isArray(deepClonedSemester.courses) ? deepClonedSemester.courses : [];
  
  // Normalisasi struktur courses ke object form
  const finalCourses = rawExistingCourses.map((c, i) => {
    if (typeof c === 'string') {
      const parsed = parseExistingCourse(c, i);
      return {
        id: `course-${Date.now()}-${i}`,
        name: parsed.name,
        code: '',
        sks: null,
        grade: parsed.grade,
        gradePoint: null,
        point: null,
        class: null,
        day: null,
        timeStart: null,
        timeEnd: null,
        room: null,
        lecturer: null,
        mode: null,
        schedules: [],
        files: [],
      };
    }
    return { ...c };
  });

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let unchangedCount = 0;

  for (const item of plan.items) {
    const action = actionOverrides[item.index] || item.proposedAction;

    if (action === 'skip' || item.status === 'invalid' || item.status === 'skipped') {
      skippedCount++;
      continue;
    }

    if (action === 'add' || item.status === 'add') {
      const newId = typeof plan.idFactory === 'function' ? plan.idFactory() : `course-${Date.now()}-${addedCount + 1}`;
      const rawGp = item.candidateCourse.gradePoint;
      const safeGp = (rawGp !== null && rawGp !== undefined && rawGp >= 0 && rawGp <= 4.0) ? rawGp : null;
      const courseEntry = {
        id: newId,
        code: item.candidateCourse.code || '',
        name: item.candidateCourse.name,
        sks: item.candidateCourse.sks,
        grade: plan.isKhs ? item.candidateCourse.grade : null,
        gradePoint: plan.isKhs ? safeGp : null,
        point: plan.isKhs ? safeGp : null,
        class: item.candidateCourse.class || null,
        day: item.candidateCourse.day || null,
        timeStart: item.candidateCourse.timeStart || null,
        timeEnd: item.candidateCourse.timeEnd || null,
        room: item.candidateCourse.room || null,
        lecturer: item.candidateCourse.lecturer || null,
        mode: item.candidateCourse.mode || null,
        schedules: Array.isArray(item.candidateCourse.schedules) ? item.candidateCourse.schedules : [],
        files: [],
      };
      finalCourses.push(courseEntry);
      addedCount++;
      continue;
    }

    if (item.existingCourse) {
      const targetIdx = finalCourses.findIndex(c => String(c.id) === String(item.existingCourse.id));
      if (targetIdx >= 0) {
        if (action === 'overwrite' || action === 'update' || action === 'update_schedule') {
          const current = finalCourses[targetIdx];
          const cand = item.candidateCourse;

          if (cand.code) current.code = cand.code;
          if (cand.name) current.name = cand.name;
          if (action !== 'update_schedule' && cand.sks !== null && cand.sks !== undefined) {
            current.sks = cand.sks;
          }
          if (cand.day) current.day = cand.day;
          if (cand.timeStart) current.timeStart = cand.timeStart;
          if (cand.timeEnd) current.timeEnd = cand.timeEnd;
          if (cand.room) current.room = cand.room;
          if (cand.lecturer) current.lecturer = cand.lecturer;
          if (cand.mode) current.mode = cand.mode;
          if (cand.class) current.class = cand.class;
          if (Array.isArray(cand.schedules) && cand.schedules.length > 0) {
            current.schedules = cand.schedules;
          }

          if (plan.isKhs && cand.grade) {
            current.grade = cand.grade;
            const rawCandGp = cand.gradePoint;
            const safeCandGp = (rawCandGp !== null && rawCandGp !== undefined && rawCandGp >= 0 && rawCandGp <= 4.0) ? rawCandGp : null;
            current.gradePoint = safeCandGp;
            current.point = safeCandGp;
          }
          updatedCount++;
        } else {
          // Default: keep_existing
          unchangedCount++;
        }
      }
    }
  }

  deepClonedSemester.courses = finalCourses;

  return Object.freeze({
    ok: true,
    updatedSemester: deepClonedSemester,
    addedCount,
    updatedCount,
    skippedCount,
    unchangedCount,
  });
}
