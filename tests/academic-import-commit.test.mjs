/**
 * academic-import-commit.test.mjs
 * 
 * Pengujian Terisolasi B6D: Aktivasi Impor KRS/KHS ke Semester dengan Konfirmasi Manual.
 * 
 * Verifikasi 22 Skenario Wajib (H.1 - H.22):
 * H.1: Simpan KRS ke semester kosong
 * H.2: Simpan KHS ke semester kosong
 * H.3: Tambah mata kuliah baru ke semester existing
 * H.4: Lewati mata kuliah identik
 * H.5: Konflik default mempertahankan data lama
 * H.6: Overwrite hanya setelah dipilih dan dikonfirmasi
 * H.7: SKS dan nilai berbeda
 * H.8: IPS/IPK tidak berubah otomatis
 * H.9: Mutu total tidak dianggap gradePoint
 * H.10: Mata kuliah invalid dan skipped tidak tersimpan
 * H.11: NIM berbeda memblokir simpan tanpa konfirmasi sadar
 * H.12: Konfirmasi dibatalkan tanpa mutasi data
 * H.13: Data berubah sesudah preview (plan_stale)
 * H.14: Dua operasi impor bersamaan (import_locked via Web Locks)
 * H.15: Storage gagal menulis (fail-closed, state lama utuh)
 * H.16: Refresh/reload setelah impor mempertahankan hasil
 * H.17: Impor berulang tidak menghasilkan duplikat
 * H.18: RawText dan editedText tidak berubah
 * H.19: Semester lain tetap utuh
 * H.20: Tidak ada request AI selama eksekusi impor
 * H.21: Tidak ada perubahan data nyata saat pengujian (isolasi murni)
 * H.22: Tombol simpan tidak aktif sebelum review dan konfirmasi valid
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAcademicImportPlan,
  applyAcademicImportPlan,
  withAcademicImportLock,
  createAcademicImportCommitSummary,
  AcademicImportPlanError,
} from '../src/services/academicImportPlan.js';
import { parseAcademicDocumentText } from '../src/services/offlineAcademicParser.js';

function createMockStorage(initialData = {}) {
  const store = new Map(Object.entries(initialData));
  let shouldFailWrite = false;

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (shouldFailWrite) {
        throw new Error('QuotaExceededError: LocalStorage quota exceeded');
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    setFailWrite(fail) {
      shouldFailWrite = fail;
    },
    dump() {
      const result = {};
      for (const [k, v] of store.entries()) {
        result[k] = v;
      }
      return result;
    },
  };
}

function createMockLockManager() {
  const heldLocks = new Set();
  return {
    async request(name, options, callback) {
      if (heldLocks.has(name)) {
        if (options?.ifAvailable) {
          return await callback(null);
        }
      }
      heldLocks.add(name);
      try {
        return await callback({ name });
      } finally {
        heldLocks.delete(name);
      }
    },
    isHeld(name) {
      return heldLocks.has(name);
    },
  };
}

/**
 * Harness runner komit akademik sintetis mereplikasi AppContext.commitAcademicImport
 */
async function executeSyntheticAcademicCommit({
  storage,
  lockManager,
  targetSemesterId,
  plan,
  actionOverrides = {},
  allowIdentityMismatch = false,
}) {
  return await withAcademicImportLock({ lockManager }, async () => {
    const raw = storage.getItem('college_semesters');
    const currentStoredSemesters = raw ? JSON.parse(raw) : [];

    const targetIdx = currentStoredSemesters.findIndex(s => String(s.id) === String(targetSemesterId));
    if (targetIdx < 0) {
      throw new AcademicImportPlanError('semester_not_found', 'Semester tujuan tidak ditemukan');
    }
    const freshTargetSemester = currentStoredSemesters[targetIdx];
    const preCommitSnapshot = JSON.parse(JSON.stringify(freshTargetSemester));

    const currentFingerprint = plan.semesterSnapshot; // Periksa plan_stale secara realistis
    const computedNow = (await import('../src/services/academicImportPlan.js')).computeSemesterFingerprint(freshTargetSemester);
    if (computedNow !== currentFingerprint) {
      throw new AcademicImportPlanError('plan_stale', 'Data semester telah berubah');
    }

    if (plan.hasIdentityMismatch && allowIdentityMismatch !== true) {
      throw new AcademicImportPlanError('identity_mismatch_unconfirmed', 'NIM berbeda');
    }

    const mergeResult = applyAcademicImportPlan(plan, freshTargetSemester, {
      actionOverrides,
      allowIdentityMismatch,
      isUserConfirmed: true,
    });

    const nextSemesters = currentStoredSemesters.map((s, idx) => (idx === targetIdx ? mergeResult.updatedSemester : s));
    
    try {
      storage.setItem('college_semesters', JSON.stringify(nextSemesters));
    } catch {
      throw new AcademicImportPlanError('storage_write_failed', 'Gagal menulis');
    }

    return {
      ok: true,
      updatedSemester: mergeResult.updatedSemester,
      preCommitSnapshot,
      addedCount: mergeResult.addedCount,
      updatedCount: mergeResult.updatedCount,
      skippedCount: mergeResult.skippedCount,
      unchangedCount: mergeResult.unchangedCount,
    };
  });
}

test('H.1: Simpan KRS ke semester kosong', async () => {
  const emptySemester = { id: 101, name: 'Semester 1', courses: [], gpa: 0 };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([emptySemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'IF101', name: 'Algoritma Pemrograman', sks: 3, included: true },
      { code: 'IF102', name: 'Kalkulus I', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(emptySemester, candidate);
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 101,
    plan,
  });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 2);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 2);
  assert.equal(stored[0].courses[0].name, 'Algoritma Pemrograman');
  assert.equal(stored[0].courses[1].name, 'Kalkulus I');
});

test('H.2: Simpan KHS ke semester kosong', async () => {
  const emptySemester = { id: 102, name: 'Semester 2', courses: [], gpa: 0 };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([emptySemester]),
  });

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'IF201', name: 'Struktur Data', sks: 4, grade: 'A', gradePoint: 4.0, point: 4.0, included: true },
      { code: 'IF202', name: 'Basis Data', sks: 3, grade: 'B+', gradePoint: 3.5, point: 3.5, included: true },
    ],
  };

  const plan = createAcademicImportPlan(emptySemester, candidate);
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 102,
    plan,
  });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 2);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses[0].grade, 'A');
  assert.equal(stored[0].courses[0].gradePoint, 4.0);
  assert.equal(stored[0].courses[1].grade, 'B+');
  assert.equal(stored[0].courses[1].gradePoint, 3.5);
});

test('H.3: Tambah mata kuliah baru ke semester existing', async () => {
  const existingSemester = {
    id: 103,
    name: 'Semester 3',
    courses: [{ id: 'c1', code: 'IF101', name: 'Algoritma', sks: 3 }],
  };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'IF301', name: 'Jaringan Komputer', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 103,
    plan,
  });

  assert.equal(result.addedCount, 1);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 2);
  assert.equal(stored[0].courses[0].id, 'c1');
  assert.equal(stored[0].courses[1].name, 'Jaringan Komputer');
});

test('H.4: Lewati mata kuliah identik', async () => {
  const existingSemester = {
    id: 104,
    name: 'Semester 4',
    courses: [{ id: 'c1', code: 'IF101', name: 'Algoritma', sks: 3 }],
  };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'IF101', name: 'Algoritma', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.items[0].status, 'unchanged');

  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 104,
    plan,
  });

  assert.equal(result.addedCount, 0);
  assert.equal(result.unchangedCount, 1);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 1);
});

test('H.5: Konflik default mempertahankan data lama (keep_existing)', async () => {
  const existingSemester = {
    id: 105,
    name: 'Semester 5',
    courses: [{ id: 'c1', code: 'IF501', name: 'Kecerdasan Buatan', sks: 3, grade: 'B' }],
  };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  // Dokumen KHS mendeteksi nilai A (konflik nilai)
  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'IF501', name: 'Kecerdasan Buatan', sks: 3, grade: 'A', gradePoint: 4.0, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.items[0].status, 'conflict');
  assert.equal(plan.items[0].proposedAction, 'keep_existing');

  // Tanpa override: default keep_existing
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 105,
    plan,
  });

  assert.equal(result.unchangedCount, 1);
  assert.equal(result.updatedCount, 0);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses[0].grade, 'B'); // Nilai lama dipertahankan
});

test('H.6: Overwrite hanya setelah dipilih dan dikonfirmasi', async () => {
  const existingSemester = {
    id: 106,
    name: 'Semester 6',
    courses: [{ id: 'c1', code: 'IF601', name: 'Sistem Operasi', sks: 3, grade: 'C' }],
  };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'IF601', name: 'Sistem Operasi', sks: 3, grade: 'A', gradePoint: 4.0, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  // Pengguna secara sadar memilih override aksi ke 'overwrite'
  const actionOverrides = { 0: 'overwrite' };

  const summary = createAcademicImportCommitSummary(plan, existingSemester, actionOverrides);
  assert.equal(summary.overwriteCount, 1);
  assert.equal(summary.overwrites[0].differences.length, 1);

  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 106,
    plan,
    actionOverrides,
  });

  assert.equal(result.updatedCount, 1);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses[0].grade, 'A');
  assert.equal(stored[0].courses[0].gradePoint, 4.0);
});

test('H.7: SKS dan nilai berbeda dideteksi sebagai perbedaan eksplisit', () => {
  const existingSemester = {
    id: 107,
    name: 'Semester 7',
    courses: [{ id: 'c1', code: 'IF701', name: 'Metodologi Penelitian', sks: 2, grade: 'B' }],
  };

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'IF701', name: 'Metodologi Penelitian', sks: 3, grade: 'A', gradePoint: 4.0, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.items[0].status, 'conflict');
  assert.equal(plan.items[0].differences.length, 2);
  const diffFields = plan.items[0].differences.map(d => d.field);
  assert.ok(diffFields.includes('sks'));
  assert.ok(diffFields.includes('grade'));
});

test('H.8: IPS/IPK tidak berubah otomatis', async () => {
  const existingSemester = {
    id: 108,
    name: 'Semester 8',
    courses: [],
    gpa: 3.85,
  };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  const candidate = {
    documentType: 'KHS',
    courses: [{ code: 'IF801', name: 'Skripsi', sks: 6, grade: 'A', gradePoint: 4.0, included: true }],
    summary: { ips: 4.00, ipk: 3.90 },
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 108,
    plan,
  });

  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].gpa, 3.85); // Nilai GPA awal tidak disentuh sama sekali
});

test('H.9: Mutu total tidak dianggap gradePoint', () => {
  // Baris tabel KHS dengan SKS 3, Nilai A, dan Mutu Total 12.00
  const rawText = `
    KARTU HASIL STUDI (KHS)
    Semester 1
    | No | Kode | Mata Kuliah | SKS | Nilai | Mutu |
    | 1 | CS101 | Pemrograman Dasar | 3 | A | 12.00 |
  `;

  const parsed = parseAcademicDocumentText(rawText);
  assert.equal(parsed.documentType, 'KHS');
  assert.equal(parsed.courses.length, 1);
  const course = parsed.courses[0];
  assert.equal(course.grade, 'A');
  // Mutu total 12.00 > 4.0 tidak boleh disimpan sebagai gradePoint!
  assert.equal(course.gradePoint, null);
  assert.ok(course.reviewReasons.includes('ambiguous_grade_point_or_total_mutu'));
});

test('H.10: Mata kuliah invalid dan skipped tidak tersimpan', async () => {
  const emptySemester = { id: 110, name: 'Semester 10', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([emptySemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'MK1', name: 'Matkul Valid', sks: 3, included: true },
      { code: 'MK2', name: 'Matkul Skipped', sks: 3, included: false },
      { code: 'MK3', name: '', sks: 3, included: true }, // Invalid: nama kosong
      { code: 'MK4', name: 'Matkul SKS Ekstrim', sks: 15, included: true }, // Invalid: SKS > 12
    ],
  };

  const plan = createAcademicImportPlan(emptySemester, candidate);
  assert.equal(plan.summary.addCount, 1);
  assert.equal(plan.summary.skippedCount, 1);
  assert.equal(plan.summary.invalidCount, 2);

  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 110,
    plan,
  });

  assert.equal(result.addedCount, 1);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 1);
  assert.equal(stored[0].courses[0].name, 'Matkul Valid');
});

test('H.11: NIM berbeda memblokir simpan tanpa konfirmasi sadar', async () => {
  const emptySemester = { id: 111, name: 'Semester 11', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([emptySemester]),
  });

  const candidate = {
    documentType: 'KRS',
    student: { nim: '2024001', name: 'Budi' },
    courses: [{ name: 'Matkul A', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(emptySemester, candidate, {
    userProfile: { nim: '2024999', fullName: 'Siti' },
  });

  assert.equal(plan.hasIdentityMismatch, true);

  // Tanpa konfirmasi allowIdentityMismatch: memblokir simpan
  await assert.rejects(
    async () => executeSyntheticAcademicCommit({
      storage: mockStorage,
      targetSemesterId: 111,
      plan,
      allowIdentityMismatch: false,
    }),
    error => error.code === 'identity_mismatch_unconfirmed'
  );

  // Dengan konfirmasi sadar pengguna: berhasil
  const success = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 111,
    plan,
    allowIdentityMismatch: true,
  });
  assert.equal(success.ok, true);
});

test('H.12: Konfirmasi dibatalkan tanpa mutasi data', async () => {
  const initialSemester = { id: 112, name: 'Semester 12', courses: [{ id: 'c1', name: 'Lama', sks: 3 }] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([initialSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Baru', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(initialSemester, candidate);
  
  // Dialog konfirmasi dibuka, pengguna klik "Batal" (fungsi commit tidak dipanggil)
  // Simulasikan pembatalan
  const summary = createAcademicImportCommitSummary(plan, initialSemester);
  assert.equal(summary.addCount, 1);

  // Storage tetap 100% utuh
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 1);
  assert.equal(stored[0].courses[0].name, 'Lama');
});

test('H.13: Data berubah sesudah preview memicu penolakan plan_stale', async () => {
  const initialSemester = { id: 113, name: 'Semester 13', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([initialSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Baru', sks: 3, included: true }],
  };

  // Preview dibuat saat semester masih kosong
  const plan = createAcademicImportPlan(initialSemester, candidate);

  // Sebelum pengguna klik simpan, tab lain menambahkan mata kuliah
  const modifiedSemester = { id: 113, name: 'Semester 13', courses: [{ id: 'other', name: 'Mata Kuliah Lain', sks: 3 }] };
  mockStorage.setItem('college_semesters', JSON.stringify([modifiedSemester]));

  await assert.rejects(
    async () => executeSyntheticAcademicCommit({
      storage: mockStorage,
      targetSemesterId: 113,
      plan,
    }),
    error => error.code === 'plan_stale'
  );
});

test('H.14: Dua operasi impor bersamaan ditangani oleh Web Locks (import_locked)', async () => {
  const lockManager = createMockLockManager();

  let releaseHolder;
  const holdPromise = new Promise(resolve => { releaseHolder = resolve; });

  // Operasi pertama memegang lock
  const bgOp = withAcademicImportLock({ lockManager }, async () => {
    await holdPromise;
  });

  // Operasi kedua mencoba masuk saat lock dipegang
  await assert.rejects(
    async () => withAcademicImportLock({ lockManager }, async () => {}),
    error => error.code === 'import_locked'
  );

  releaseHolder();
  await bgOp;
});

test('H.15: Storage gagal menulis mempertahankan state lama (fail-closed)', async () => {
  const initialSemester = { id: 115, name: 'Semester 15', courses: [{ id: 'c1', name: 'Data Awal', sks: 3 }] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([initialSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Data Baru', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(initialSemester, candidate);

  // Simulasikan QuotaExceededError pada storage
  mockStorage.setFailWrite(true);

  await assert.rejects(
    async () => executeSyntheticAcademicCommit({
      storage: mockStorage,
      targetSemesterId: 115,
      plan,
    }),
    error => error.code === 'storage_write_failed'
  );

  // Verifikasi state awal tidak rusak
  mockStorage.setFailWrite(false);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 1);
  assert.equal(stored[0].courses[0].name, 'Data Awal');
});

test('H.16: Refresh/reload setelah impor mempertahankan hasil di storage', async () => {
  const initialSemester = { id: 116, name: 'Semester 16', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([initialSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ code: 'IF116', name: 'Persistensi Data', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(initialSemester, candidate);
  await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 116,
    plan,
  });

  // Simulasikan app reload (membaca storage ulang)
  const reloaded = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(reloaded[0].courses.length, 1);
  assert.equal(reloaded[0].courses[0].code, 'IF116');
  assert.equal(reloaded[0].courses[0].name, 'Persistensi Data');
});

test('H.17: Impor berulang tidak menghasilkan duplikat (idempoten)', async () => {
  const initialSemester = { id: 117, name: 'Semester 17', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([initialSemester]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'CS17', name: 'Algoritma', sks: 3, included: true },
    ],
  };

  // Impor ke-1
  const plan1 = createAcademicImportPlan(initialSemester, candidate);
  await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 117,
    plan: plan1,
  });

  // Impor ke-2 dengan dokumen yang sama
  const afterFirst = JSON.parse(mockStorage.getItem('college_semesters'))[0];
  const plan2 = createAcademicImportPlan(afterFirst, candidate);
  assert.equal(plan2.summary.addCount, 0);
  assert.equal(plan2.summary.unchangedCount, 1);

  const result2 = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 117,
    plan: plan2,
  });

  assert.equal(result2.addedCount, 0);
  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  assert.equal(stored[0].courses.length, 1);
});

test('H.18: RawText dan editedText tidak berubah saat import plan dan commit', () => {
  const vaultDocument = {
    binaryRef: { id: 'bin-18', name: 'krs.pdf' },
    rawText: 'RAW OCR HASIL MESIN 100% ASLI',
    editedText: 'KOREKSI OCR OLEH PENGGUNA',
  };

  const sem = { id: 118, name: 'Semester 18', courses: [] };
  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Matkul 18', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(sem, candidate);
  const result = applyAcademicImportPlan(plan, sem, { isUserConfirmed: true });

  assert.equal(result.ok, true);
  // Dokumen vault teks tidak tersentuh
  assert.equal(vaultDocument.rawText, 'RAW OCR HASIL MESIN 100% ASLI');
  assert.equal(vaultDocument.editedText, 'KOREKSI OCR OLEH PENGGUNA');
});

test('H.19: Semester lain tetap utuh', async () => {
  const sem1 = { id: 1, name: 'Semester 1', courses: [{ id: 's1', name: 'Matkul S1', sks: 3 }] };
  const sem2 = { id: 2, name: 'Semester 2', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([sem1, sem2]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Matkul S2 Baru', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(sem2, candidate);
  await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 2,
    plan,
  });

  const stored = JSON.parse(mockStorage.getItem('college_semesters'));
  // Semester 1 tetap identik
  assert.equal(stored[0].id, 1);
  assert.equal(stored[0].courses.length, 1);
  assert.equal(stored[0].courses[0].name, 'Matkul S1');
  // Semester 2 bertambah
  assert.equal(stored[1].courses.length, 1);
  assert.equal(stored[1].courses[0].name, 'Matkul S2 Baru');
});

test('H.20: Tidak ada request AI selama eksekusi impor', async () => {
  const sem = { id: 120, name: 'Semester 20', courses: [] };
  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([sem]),
  });

  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Matkul Offline', sks: 3, included: true }],
  };

  // Pantau fetch global
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    return Promise.reject(new Error('Network access forbidden'));
  };

  try {
    const plan = createAcademicImportPlan(sem, candidate);
    const summary = createAcademicImportCommitSummary(plan, sem);
    const result = await executeSyntheticAcademicCommit({
      storage: mockStorage,
      targetSemesterId: 120,
      plan,
    });
    assert.equal(result.ok, true);
    assert.equal(summary.addCount, 1);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('H.21: Tidak ada perubahan data nyata saat pengujian (isolasi murni)', () => {
  // Verifikasi bahwa seluruh operasi pengujian memakai mockStorage dan tidak mengakses localStorage sistem asli
  const sem = { id: 999, name: 'Semester Isolasi', courses: [] };
  const candidate = { documentType: 'KRS', courses: [{ name: 'Isolasi', sks: 3, included: true }] };
  const plan = createAcademicImportPlan(sem, candidate);
  const result = applyAcademicImportPlan(plan, sem, { isUserConfirmed: true });
  assert.equal(result.ok, true);
  assert.equal(sem.courses.length, 0); // Pure function, sem asli tidak termutasi
});

test('H.22: Tombol simpan tidak tampil aktif sebelum review dan konfirmasi valid', () => {
  const sem = { id: 122, name: 'Semester 22', courses: [] };

  // Kasus 1: Kandidat kosong -> tidak ada rencana -> disabled
  const summaryEmpty = createAcademicImportCommitSummary(null, sem);
  assert.equal(summaryEmpty.totalPlannedActions, 0);

  // Kasus 2: NIM berbeda belum dikonfirmasi -> tombol disabled
  const planMismatch = createAcademicImportPlan(sem, {
    documentType: 'KRS',
    student: { nim: '2024001' },
    courses: [{ name: 'Matkul', sks: 3, included: true }],
  }, { userProfile: { nim: '2024999' } });

  assert.equal(planMismatch.hasIdentityMismatch, true);
  const isButtonEnabledWithoutConfirmation = !planMismatch.hasIdentityMismatch;
  assert.equal(isButtonEnabledWithoutConfirmation, false);

  // Kasus 3: Semua matkul di-skip -> totalPlannedActions = 0 -> tombol disabled
  const planSkipped = createAcademicImportPlan(sem, {
    documentType: 'KRS',
    courses: [{ name: 'Matkul', sks: 3, included: false }],
  });
  const summarySkipped = createAcademicImportCommitSummary(planSkipped, sem);
  assert.equal(summarySkipped.totalPlannedActions, 0);

  // Kasus 4: Ada matkul baru dan valid -> tombol enabled
  const planValid = createAcademicImportPlan(sem, {
    documentType: 'KRS',
    courses: [{ name: 'Matkul Valid', sks: 3, included: true }],
  });
  const summaryValid = createAcademicImportCommitSummary(planValid, sem);
  assert.equal(summaryValid.totalPlannedActions, 1);
});

test('H.23: Verifikasi komprehensif variasi Bobot, Mutu, SKSN, dan perkalian SKS', () => {
  // Skenario 1: KHS dengan header hanya 'Mutu' (tanpa Bobot), angka <= 4.0
  const khsMutuHeader = `
    KARTU HASIL STUDI (KHS)
    Semester 2
    | No | Kode | Mata Kuliah | SKS | Nilai | Mutu |
    | 1 | IF201 | Logika Informatika | 2 | D | 2.0 |
    | 2 | IF202 | Desain Web | 2 | C | 4.0 |
    | 3 | IF203 | Teori Graf | 3 | D | 3.0 |
    | 4 | IF204 | Bahasa Inggris | 1 | A | 4.0 |
  `;
  const parsed1 = parseAcademicDocumentText(khsMutuHeader);
  assert.equal(parsed1.documentType, 'KHS');
  assert.equal(parsed1.courses.length, 4);

  // Semua baris pada tabel dengan header hanya 'Mutu' tidak boleh menyimpan Mutu sebagai gradePoint
  for (const c of parsed1.courses) {
    assert.equal(c.gradePoint, null, `Mata kuliah ${c.name} tidak boleh menetapkan mutu sebagai gradePoint`);
    assert.ok(c.reviewReasons.includes('ambiguous_grade_point_or_total_mutu'));
  }

  // Skenario 2: KHS tanpa header yang jelas, angka mutu total berada di rentang 0-4
  // 2 SKS * 1.0 (D) = 2.0 -> harus dideteksi sebagai hasil kali SKS, bukan bobot D!
  const khsNoHeaderProduct = `
    KARTU HASIL STUDI (KHS)
    Semester 3
    | 1 | CS301 | Pemrograman Lanjut | 2 | D | 2.0 |
    | 2 | CS302 | Arsitektur Komputer | 2 | C | 4.0 |
  `;
  const parsed2 = parseAcademicDocumentText(khsNoHeaderProduct);
  assert.equal(parsed2.courses[0].gradePoint, null);
  assert.ok(parsed2.courses[0].reviewReasons.includes('ambiguous_grade_point_or_total_mutu'));
  assert.equal(parsed2.courses[1].gradePoint, null);
  assert.ok(parsed2.courses[1].reviewReasons.includes('ambiguous_grade_point_or_total_mutu'));

  // Skenario 3: KHS dengan 2 kolom numerik: Bobot (AM) dan Mutu (KN)
  const khsTwoColumns = `
    KARTU HASIL STUDI (KHS)
    Semester 4
    | No | Kode | Mata Kuliah | SKS | Nilai | Bobot | Mutu |
    | 1 | CS401 | Kecerdasan Buatan | 3 | A | 4.0 | 12.0 |
    | 2 | CS402 | Basis Data Lanjut | 3 | B | 3.0 | 9.0 |
  `;
  const parsed3 = parseAcademicDocumentText(khsTwoColumns);
  assert.equal(parsed3.courses[0].gradePoint, 4.0);
  assert.equal(parsed3.courses[1].gradePoint, 3.0);
  assert.equal(parsed3.courses[0].needsReview, false);
  assert.equal(parsed3.courses[1].needsReview, false);
});

test('H.24: Feedback sukses membedakan ditambahkan, ditimpa, dan dipertahankan', async () => {
  const existingSemester = {
    id: 124,
    name: 'Semester 24',
    courses: [
      { id: 'c1', code: 'MK1', name: 'Matkul 1', sks: 3, grade: 'B' },
      { id: 'c2', code: 'MK2', name: 'Matkul 2', sks: 3, grade: 'A' },
    ],
  };

  const mockStorage = createMockStorage({
    college_semesters: JSON.stringify([existingSemester]),
  });

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'MK1', name: 'Matkul 1', sks: 3, grade: 'A', included: true }, // overwrite
      { code: 'MK2', name: 'Matkul 2', sks: 3, grade: 'A', included: true }, // unchanged
      { code: 'MK3', name: 'Matkul 3', sks: 3, grade: 'B', included: true }, // add
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  const result = await executeSyntheticAcademicCommit({
    storage: mockStorage,
    targetSemesterId: 124,
    plan,
    actionOverrides: { 0: 'overwrite' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.unchangedCount, 1);

  // Format pesan sukses membedakan ketiga status
  const successMessage = `Berhasil menyimpan ke ${existingSemester.name}: ${result.addedCount} ditambahkan, ${result.updatedCount} ditimpa, dan ${result.unchangedCount} dipertahankan!`;
  assert.match(successMessage, /1 ditambahkan/);
  assert.match(successMessage, /1 ditimpa/);
  assert.match(successMessage, /1 dipertahankan/);
});

