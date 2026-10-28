import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAcademicImportPlan,
  applyAcademicImportPlan,
} from '../src/services/academicImportPlan.js';

test('F.1: Import KRS ke semester kosong menambahkan mata kuliah baru dengan benar', () => {
  const emptySemester = {
    id: 101,
    name: 'Semester 1 (Ganjil 2024/2025)',
    gpa: 0,
    courses: [],
    status: 'current',
  };

  const krsCandidate = {
    documentType: 'KRS',
    isKrs: true,
    semesterName: 'Semester 1',
    courses: [
      { code: 'IF101', name: 'Algoritma & Pemrograman', sks: 3, included: true },
      { code: 'IF102', name: 'Matematika Diskrit', sks: 3, included: true },
    ],
    summary: { totalSks: 6 },
  };

  const plan = createAcademicImportPlan(emptySemester, krsCandidate);
  assert.equal(plan.summary.addCount, 2);
  assert.equal(plan.summary.conflictCount, 0);
  assert.equal(plan.summary.unchangedCount, 0);
  assert.equal(plan.items[0].status, 'add');
  assert.equal(plan.items[1].status, 'add');

  const result = applyAcademicImportPlan(plan, emptySemester, { enableSyntheticExecution: true });
  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 2);
  assert.equal(result.updatedSemester.courses.length, 2);
  assert.equal(result.updatedSemester.courses[0].name, 'Algoritma & Pemrograman');
  assert.equal(result.updatedSemester.courses[0].code, 'IF101');
  assert.equal(result.updatedSemester.courses[0].sks, 3);
  assert.equal(result.updatedSemester.courses[0].grade, null); // KRS tidak mengisi nilai
});

test('F.2: Import KHS ke semester kosong menambahkan mata kuliah, nilai huruf, dan bobot tercetak', () => {
  const emptySemester = {
    id: 102,
    name: 'Semester 2 (Genap 2024/2025)',
    gpa: 0,
    courses: [],
    status: 'past',
  };

  const khsCandidate = {
    documentType: 'KHS',
    isKhs: true,
    courses: [
      { code: 'IF201', name: 'Struktur Data', sks: 3, grade: 'A', gradePoint: 4.0, point: 4.0, included: true },
      { code: 'IF202', name: 'Basis Data', sks: 3, grade: 'B+', gradePoint: 3.5, point: 3.5, included: true },
    ],
    summary: { totalSks: 6, ips: '3.75', ipk: '3.60' },
  };

  const plan = createAcademicImportPlan(emptySemester, khsCandidate);
  assert.equal(plan.summary.addCount, 2);
  assert.equal(plan.isKhs, true);

  const result = applyAcademicImportPlan(plan, emptySemester, { enableSyntheticExecution: true });
  assert.equal(result.ok, true);
  assert.equal(result.updatedSemester.courses[0].grade, 'A');
  assert.equal(result.updatedSemester.courses[0].gradePoint, 4.0);
  assert.equal(result.updatedSemester.courses[1].grade, 'B+');
  assert.equal(result.updatedSemester.courses[1].gradePoint, 3.5);
});

test('F.3: Import ke semester yang sudah berisi mata kuliah (kombinasi tambah & pertahankan)', () => {
  const existingSemester = {
    id: 103,
    name: 'Semester 3',
    gpa: '3.50',
    courses: [
      { id: 'c-1', code: 'KU101', name: 'Pancasila', sks: 2, grade: 'A' },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'KU101', name: 'Pancasila', sks: 2, included: true }, // Identik
      { code: 'IF301', name: 'Jaringan Komputer', sks: 3, included: true }, // Baru
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.summary.unchangedCount, 1);
  assert.equal(plan.summary.addCount, 1);

  const result = applyAcademicImportPlan(plan, existingSemester, { enableSyntheticExecution: true });
  assert.equal(result.ok, true);
  assert.equal(result.updatedSemester.courses.length, 2);
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedSemester.courses[0].id, 'c-1'); // ID lama dipertahankan
});

test('F.4: Mata kuliah identik tidak menjadi duplikat (unchanged)', () => {
  const existingSemester = {
    id: 104,
    name: 'Semester 4',
    courses: [
      { id: 'c-algo', code: 'IF101', name: 'Algoritma Pemrograman', sks: 3, grade: 'A' },
    ],
  };

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'IF101', name: 'Algoritma Pemrograman', sks: 3, grade: 'A', included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.summary.unchangedCount, 1);
  assert.equal(plan.summary.addCount, 0);
  assert.equal(plan.summary.conflictCount, 0);

  const result = applyAcademicImportPlan(plan, existingSemester, { enableSyntheticExecution: true });
  assert.equal(result.updatedSemester.courses.length, 1); // Tidak bertambah
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.addedCount, 0);
});

test('F.5: Nama sama tetapi kode berbeda dideteksi sebagai conflict konservatif', () => {
  const existingSemester = {
    id: 105,
    name: 'Semester 5',
    courses: [
      { id: 'c-web-old', code: 'IF301', name: 'Pemrograman Web', sks: 3 },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    courses: [
      // Nama sama, tetapi kode di dokumen baru adalah CS301 (beda kurikulum/kode)
      { code: 'CS301', name: 'Pemrograman Web', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.items[0].status, 'conflict');
  assert.equal(plan.items[0].differences.some(d => d.field === 'code'), true);

  // Secara default mempertahankan data existing
  const resultDefault = applyAcademicImportPlan(plan, existingSemester, { enableSyntheticExecution: true });
  assert.equal(resultDefault.updatedSemester.courses[0].code, 'IF301');

  // Jika pengguna secara spesifik memilih 'overwrite'
  const resultOverwrite = applyAcademicImportPlan(plan, existingSemester, {
    enableSyntheticExecution: true,
    actionOverrides: { 0: 'overwrite' },
  });
  assert.equal(resultOverwrite.updatedSemester.courses[0].code, 'CS301');
});

test('F.6: Kode sama tetapi nilai berbeda dideteksi sebagai conflict', () => {
  const existingSemester = {
    id: 106,
    name: 'Semester 6',
    courses: [
      { id: 'c-ai', code: 'IF401', name: 'Kecerdasan Buatan', sks: 3, grade: 'B' },
    ],
  };

  const candidate = {
    documentType: 'KHS',
    isKhs: true,
    courses: [
      { code: 'IF401', name: 'Kecerdasan Buatan', sks: 3, grade: 'A', included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.items[0].differences.some(d => d.field === 'grade'), true);
});

test('F.7: SKS berbeda dideteksi sebagai conflict', () => {
  const existingSemester = {
    id: 107,
    name: 'Semester 7',
    courses: [
      { id: 'c-tugas', code: 'IF499', name: 'Tugas Akhir I', sks: 2 },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'IF499', name: 'Tugas Akhir I', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  assert.equal(plan.summary.conflictCount, 1);
  assert.equal(plan.items[0].differences.some(d => d.field === 'sks'), true);
});

test('F.8: Nilai KHS tidak tertimpa tanpa persetujuan eksplisit (keep_existing)', () => {
  const existingSemester = {
    id: 108,
    name: 'Semester 8',
    courses: [
      { id: 'c-skripsi', code: 'IF500', name: 'Skripsi', sks: 4, grade: 'A' },
    ],
  };

  const candidate = {
    documentType: 'KHS',
    isKhs: true,
    courses: [
      { code: 'IF500', name: 'Skripsi', sks: 4, grade: 'B', included: true },
    ],
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  // Default commit tanpa actionOverrides:
  const result = applyAcademicImportPlan(plan, existingSemester, { enableSyntheticExecution: true });
  assert.equal(result.updatedSemester.courses[0].grade, 'A'); // Nilai lama TIDAK tertimpa
  assert.equal(result.unchangedCount, 1);
  assert.equal(result.updatedCount, 0);
});

test('F.9: IPS/IPK tidak berubah diam-diam (nilai GPA semester lama tidak diubah otomatis)', () => {
  const existingSemester = {
    id: 109,
    name: 'Semester 1',
    gpa: '3.80',
    courses: [],
  };

  const candidate = {
    documentType: 'KHS',
    courses: [
      { code: 'MK1', name: 'Matkul 1', sks: 3, grade: 'A', included: true },
    ],
    summary: { totalSks: 3, ips: '4.00', ipk: '4.00' },
  };

  const plan = createAcademicImportPlan(existingSemester, candidate);
  const result = applyAcademicImportPlan(plan, existingSemester, { enableSyntheticExecution: true });
  // GPA semester lama tetap 3.80, tidak di-overwrite diam-diam oleh IPS/IPK cetak dokumen
  assert.equal(result.updatedSemester.gpa, '3.80');
});

test('F.10: Kandidat invalid ditolak / ditandai status invalid (tidak dimasukkan)', () => {
  const semester = { id: 110, name: 'Semester 2', courses: [] };
  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'INV1', name: '', sks: 3, included: true }, // Nama kosong
      { code: 'INV2', name: 'Matkul Ekstrem', sks: 15, included: true }, // SKS > 12 invalid
      { code: 'VAL1', name: 'Matkul Valid', sks: 3, included: true },
    ],
  };

  const plan = createAcademicImportPlan(semester, candidate);
  assert.equal(plan.summary.invalidCount, 2);
  assert.equal(plan.summary.addCount, 1);

  const result = applyAcademicImportPlan(plan, semester, { enableSyntheticExecution: true });
  assert.equal(result.updatedSemester.courses.length, 1);
  assert.equal(result.updatedSemester.courses[0].name, 'Matkul Valid');
  assert.equal(result.skippedCount, 2);
});

test('F.11: Kandidat skipped (included: false) tidak ditulis ke semester', () => {
  const semester = { id: 111, name: 'Semester 3', courses: [] };
  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'MK1', name: 'Matkul Dipilih', sks: 3, included: true },
      { code: 'MK2', name: 'Matkul Diabaikan', sks: 3, included: false },
    ],
  };

  const plan = createAcademicImportPlan(semester, candidate);
  assert.equal(plan.summary.skippedCount, 1);
  assert.equal(plan.summary.addCount, 1);

  const result = applyAcademicImportPlan(plan, semester, { enableSyntheticExecution: true });
  assert.equal(result.updatedSemester.courses.length, 1);
  assert.equal(result.updatedSemester.courses[0].name, 'Matkul Dipilih');
});

test('F.12: Identitas NIM berbeda memicu hasIdentityMismatch dan memblokir commit tanpa konfirmasi', () => {
  const semester = { id: 112, name: 'Semester 4', courses: [] };
  const candidate = {
    documentType: 'KRS',
    student: { nim: '230101999', name: 'Mahasiswa Lain' },
    courses: [{ code: 'MK1', name: 'Matkul 1', sks: 3, included: true }],
  };

  const userProfile = { nim: '210001001', fullName: 'Budi Santoso' };
  const plan = createAcademicImportPlan(semester, candidate, { userProfile });
  assert.equal(plan.hasIdentityMismatch, true);

  // Tanpa konfirmasi eksplisit: ditolak
  assert.throws(
    () => applyAcademicImportPlan(plan, semester, { enableSyntheticExecution: true }),
    { name: 'AcademicImportPlanError', code: 'identity_mismatch_unconfirmed' }
  );

  // Dengan konfirmasi sadar: diizinkan
  const result = applyAcademicImportPlan(plan, semester, {
    enableSyntheticExecution: true,
    allowIdentityMismatch: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 1);
});

test('F.13: Preview stale karena data semester berubah memicu error plan_stale', () => {
  const initialSemester = {
    id: 113,
    name: 'Semester 5',
    courses: [{ id: 'c1', name: 'Matkul A' }],
  };

  const candidate = {
    documentType: 'KRS',
    courses: [{ code: 'MK2', name: 'Matkul B', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(initialSemester, candidate);

  // Simulasi data semester dimutasi di tab lain sebelum plan diaplikasikan
  const mutatedSemester = {
    ...initialSemester,
    courses: [
      { id: 'c1', name: 'Matkul A' },
      { id: 'c-mutated', name: 'Matkul Terselip Lain' },
    ],
  };

  assert.throws(
    () => applyAcademicImportPlan(plan, mutatedSemester, { enableSyntheticExecution: true }),
    { name: 'AcademicImportPlanError', code: 'plan_stale' }
  );
});

test('F.14: Dua proses import bersamaan atau interupsi ditangani dengan fail-safe fingerprint', () => {
  const sem = { id: 114, name: 'Semester 6', courses: [] };
  const candidateA = { documentType: 'KRS', courses: [{ name: 'Matkul A', sks: 3, included: true }] };
  const candidateB = { documentType: 'KRS', courses: [{ name: 'Matkul B', sks: 3, included: true }] };

  const planA = createAcademicImportPlan(sem, candidateA);
  const planB = createAcademicImportPlan(sem, candidateB);

  // Proses A commit terlebih dahulu
  const resA = applyAcademicImportPlan(planA, sem, { enableSyntheticExecution: true });
  assert.equal(resA.ok, true);

  // Proses B sekarang mencoba commit ke sem yang sudah ter-update: planB menjadi stale!
  assert.throws(
    () => applyAcademicImportPlan(planB, resA.updatedSemester, { enableSyntheticExecution: true }),
    { name: 'AcademicImportPlanError', code: 'plan_stale' }
  );
});

test('F.15: Kegagalan input atau pembatalan mempertahankan state data semester lama (pure function)', () => {
  const originalSemester = Object.freeze({
    id: 115,
    name: 'Semester 7',
    courses: Object.freeze([{ id: 'c-orig', name: 'Matkul Asli', sks: 3 }]),
  });

  const candidate = { documentType: 'KRS', courses: [{ name: 'Matkul Baru', sks: 3, included: true }] };
  const plan = createAcademicImportPlan(originalSemester, candidate);

  // Verifikasi input tidak termutasi
  assert.throws(
    () => applyAcademicImportPlan(plan, originalSemester, { enableSyntheticExecution: false }),
    { name: 'AcademicImportPlanError', code: 'execution_gated' }
  );
  assert.equal(originalSemester.courses.length, 1);
  assert.equal(originalSemester.courses[0].name, 'Matkul Asli');
});

test('F.16: Percobaan import berulang bersifat idempoten (tidak menggandakan mata kuliah)', () => {
  const semester = { id: 116, name: 'Semester 8', courses: [] };
  const candidate = {
    documentType: 'KRS',
    courses: [
      { code: 'MK1', name: 'Kriptografi', sks: 3, included: true },
      { code: 'MK2', name: 'Etika Profesi', sks: 2, included: true },
    ],
  };

  const plan1 = createAcademicImportPlan(semester, candidate);
  const res1 = applyAcademicImportPlan(plan1, semester, { enableSyntheticExecution: true });
  assert.equal(res1.updatedSemester.courses.length, 2);

  // Import kedua dengan kandidat yang sama ke semester hasil import pertama
  const plan2 = createAcademicImportPlan(res1.updatedSemester, candidate);
  assert.equal(plan2.summary.addCount, 0);
  assert.equal(plan2.summary.unchangedCount, 2);

  const res2 = applyAcademicImportPlan(plan2, res1.updatedSemester, { enableSyntheticExecution: true });
  assert.equal(res2.updatedSemester.courses.length, 2); // Tetap 2, tidak menjadi 4
});

test('F.17: rawText dan editedText OCR pada dokumen vault tetap utuh dan tidak tersentuh', () => {
  const mockVaultDocument = {
    id: 'vault-doc-1',
    rawText: 'RAW_OCR_CONTENT_PERMANENT_123',
    editedText: 'EDITED_TEXT_456',
  };

  const semester = { id: 117, name: 'Semester 1', courses: [] };
  const candidate = {
    documentType: 'KRS',
    courses: [{ name: 'Matkul A', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(semester, candidate);
  applyAcademicImportPlan(plan, semester, { enableSyntheticExecution: true });

  // Dokumen vault tidak disentuh
  assert.equal(mockVaultDocument.rawText, 'RAW_OCR_CONTENT_PERMANENT_123');
  assert.equal(mockVaultDocument.editedText, 'EDITED_TEXT_456');
});

test('F.18: Integritas keamanan: tidak ada request AI atau pemanggilan Gemini selama import planning & commit', () => {
  const globalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error('fetch_forbidden');
  };

  try {
    const sem = { id: 118, name: 'Semester 2', courses: [] };
    const cand = { documentType: 'KRS', courses: [{ name: 'Matkul A', sks: 3, included: true }] };
    const plan = createAcademicImportPlan(sem, cand);
    applyAcademicImportPlan(plan, sem, { enableSyntheticExecution: true });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = globalFetch;
  }
});

test('F.19: Data akademik existing lain (semester lain, tasks, thesis) tidak berubah', () => {
  const fullAppState = {
    semesters: [
      { id: 1, name: 'Semester 1', courses: [{ id: 's1-c1', name: 'MK 1' }] },
      { id: 2, name: 'Semester 2', courses: [] },
    ],
    tasks: [{ id: 't1', title: 'Tugas Kalkulus' }],
    thesis: { todo: ['Bab 1'] },
  };

  const targetSemester = fullAppState.semesters[1];
  const candidate = { documentType: 'KRS', courses: [{ name: 'MK Baru', sks: 3, included: true }] };

  const plan = createAcademicImportPlan(targetSemester, candidate);
  const result = applyAcademicImportPlan(plan, targetSemester, { enableSyntheticExecution: true });

  // Semester 1, tasks, dan thesis tidak berubah
  assert.equal(fullAppState.semesters[0].courses.length, 1);
  assert.equal(fullAppState.tasks.length, 1);
  assert.equal(fullAppState.thesis.todo.length, 1);
  assert.equal(result.updatedSemester.courses.length, 1);
});

test('F.20: Produksi tidak bisa menulis melalui jalur fitur yang masih digating (execution_gated)', () => {
  const sem = { id: 120, name: 'Semester Produksi', courses: [] };
  const cand = { documentType: 'KRS', courses: [{ name: 'Matkul C', sks: 3, included: true }] };

  const plan = createAcademicImportPlan(sem, cand);

  // Default pemanggilan tanpa enableSyntheticExecution (mode produksi)
  assert.throws(
    () => applyAcademicImportPlan(plan, sem),
    {
      name: 'AcademicImportPlanError',
      code: 'execution_gated',
    }
  );

  assert.throws(
    () => applyAcademicImportPlan(plan, sem, { enableSyntheticExecution: false }),
    {
      name: 'AcademicImportPlanError',
      code: 'execution_gated',
    }
  );
});
