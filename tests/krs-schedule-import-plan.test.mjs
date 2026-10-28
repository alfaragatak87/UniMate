/**
 * tests/krs-schedule-import-plan.test.mjs
 *
 * Pengujian Terfokus B9C: Review dan Impor Manual Jadwal KRS ke Data Semester.
 * Menguji komparasi jadwal, update jadwal tanpa merusak nilai KHS, deteksi bentrok,
 * proteksi NIM, deteksi staleness, dan kepatuhan skema Timetable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAcademicImportPlan,
  applyAcademicImportPlan,
  AcademicImportPlanError,
} from '../src/services/academicImportPlan.js';

test('B9C.1: Penambahan mata kuliah baru dengan jadwal menyertakan hari, jam, ruang, kelas, dan dosen', () => {
  const targetSemester = {
    id: 101,
    name: 'Semester 3 (Ganjil 2024/2025)',
    status: 'current',
    courses: [],
  };

  const candidate = {
    documentType: 'KRS',
    isKrs: true,
    student: { nim: '220001', name: 'Budi Pratama' },
    courses: [
      {
        name: 'Pemrograman Web Lanjut',
        code: 'IF301',
        sks: 3,
        class: 'A',
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '10:30',
        room: 'Lab Komputer 3',
        lecturer: 'Dr. Ir. Budi Santoso, M.Kom',
        mode: null,
        included: true,
      },
    ],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001', fullName: 'Budi Pratama' },
  });

  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].status, 'add');
  assert.equal(plan.items[0].proposedAction, 'add');
  assert.equal(plan.items[0].candidateCourse.day, 'Senin');
  assert.equal(plan.items[0].candidateCourse.timeStart, '08:00');
  assert.equal(plan.items[0].candidateCourse.timeEnd, '10:30');
  assert.equal(plan.items[0].candidateCourse.room, 'Lab Komputer 3');
  assert.equal(plan.items[0].candidateCourse.class, 'A');

  const result = applyAcademicImportPlan(plan, targetSemester, {
    enableSyntheticExecution: true,
    isUserConfirmed: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedSemester.courses.length, 1);

  const savedCourse = result.updatedSemester.courses[0];
  assert.equal(savedCourse.name, 'Pemrograman Web Lanjut');
  assert.equal(savedCourse.code, 'IF301');
  assert.equal(savedCourse.sks, 3);
  assert.equal(savedCourse.day, 'Senin');
  assert.equal(savedCourse.timeStart, '08:00');
  assert.equal(savedCourse.timeEnd, '10:30');
  assert.equal(savedCourse.room, 'Lab Komputer 3');
  assert.equal(savedCourse.lecturer, 'Dr. Ir. Budi Santoso, M.Kom');
  assert.equal(savedCourse.class, 'A');
  assert.equal(savedCourse.grade, null, 'KRS tidak boleh menyimpan grade');
});

test('B9C.2: Komparasi jadwal mendeteksi perbedaan jadwal existing vs jadwal dokumen (conflict vs fill)', () => {
  const targetSemester = {
    id: 102,
    name: 'Semester 3',
    status: 'current',
    courses: [
      {
        id: 'c1',
        code: 'IF101',
        name: 'Algoritma',
        sks: 3,
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '10:00',
        room: 'R.101',
      },
      {
        id: 'c2',
        code: 'IF102',
        name: 'Basis Data',
        sks: 3,
        day: null, // Belum ada jadwal
        timeStart: null,
        timeEnd: null,
      },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    isKrs: true,
    student: { nim: '220001', name: 'Budi' },
    courses: [
      {
        name: 'Algoritma',
        code: 'IF101',
        sks: 3,
        day: 'Selasa', // Jadwal berubah: Senin -> Selasa
        timeStart: '09:00',
        timeEnd: '11:30',
        room: 'Lab 1',
        included: true,
      },
      {
        name: 'Basis Data',
        code: 'IF102',
        sks: 3,
        day: 'Kamis', // Pengisian jadwal baru
        timeStart: '13:00',
        timeEnd: '15:30',
        room: 'R.202',
        included: true,
      },
    ],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  assert.equal(plan.items.length, 2);

  // Item 1: Konflik perubahan jadwal
  const item1 = plan.items[0];
  assert.equal(item1.status, 'conflict');
  assert.equal(item1.proposedAction, 'keep_existing'); // Konservatif default
  const schedDiff1 = item1.differences.find(d => d.field === 'schedule');
  assert.ok(schedDiff1, 'Harus mendeteksi perbedaan jadwal');
  assert.equal(schedDiff1.severity, 'conflict');

  // Item 2: Pengisian jadwal baru (fill)
  const item2 = plan.items[1];
  assert.equal(item2.status, 'update');
  assert.equal(item2.proposedAction, 'update_schedule');
  const schedDiff2 = item2.differences.find(d => d.field === 'schedule');
  assert.ok(schedDiff2);
  assert.equal(schedDiff2.severity, 'fill');
});

test('B9C.3: update_schedule pada mata kuliah existing TIDAK merusak nilai KHS atau SKS yang ada', () => {
  const targetSemester = {
    id: 103,
    name: 'Semester 4',
    status: 'current',
    courses: [
      {
        id: 'c-khs-1',
        code: 'IF201',
        name: 'Sistem Operasi',
        sks: 3,
        grade: 'A', // Nilai KHS yang sudah diperoleh
        gradePoint: 4.0,
        point: 4.0,
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '10:00',
        room: 'R.101',
      },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    isKrs: true,
    student: { nim: '220001' },
    courses: [
      {
        name: 'Sistem Operasi',
        code: 'IF201',
        sks: 3,
        class: 'B',
        day: 'Jumat', // Jadwal baru
        timeStart: '13:30',
        timeEnd: '16:00',
        room: 'Lab Komputer 1',
        lecturer: 'Dra. Marlina, M.Kom',
        included: true,
      },
    ],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  // Pengguna secara sadar memilih menimpa jadwal perkuliahan
  const result = applyAcademicImportPlan(plan, targetSemester, {
    enableSyntheticExecution: true,
    isUserConfirmed: true,
    actionOverrides: { 0: 'update_schedule' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.updatedCount, 1);

  const updatedCourse = result.updatedSemester.courses[0];
  // Jadwal terbarui:
  assert.equal(updatedCourse.day, 'Jumat');
  assert.equal(updatedCourse.timeStart, '13:30');
  assert.equal(updatedCourse.timeEnd, '16:00');
  assert.equal(updatedCourse.room, 'Lab Komputer 1');
  assert.equal(updatedCourse.lecturer, 'Dra. Marlina, M.Kom');
  assert.equal(updatedCourse.class, 'B');

  // NILAI KHS HARUS 100% UTUH!
  assert.equal(updatedCourse.grade, 'A', 'Nilai KHS tidak boleh terhapus atau berubah!');
  assert.equal(updatedCourse.point, 4.0, 'Bobot nilai harus tetap 4.0');
});

test('B9C.4: Deteksi bentrok jadwal di level semester target (scheduleClashes)', () => {
  const targetSemester = {
    id: 104,
    name: 'Semester 5',
    status: 'current',
    courses: [
      {
        id: 'existing-c1',
        code: 'IF301',
        name: 'Kecerdasan Buatan',
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '10:30',
        room: 'R.301',
      },
    ],
  };

  const candidate = {
    documentType: 'KRS',
    isKrs: true,
    student: { nim: '220001' },
    courses: [
      {
        name: 'Machine Learning', // Mata kuliah baru yang jamnya bentrok dengan Kecerdasan Buatan
        code: 'IF302',
        sks: 3,
        day: 'Senin',
        timeStart: '09:00', // Bentrok dengan 08:00-10:30
        timeEnd: '11:30',
        room: 'Lab AI',
        included: true,
      },
    ],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  assert.ok(plan.scheduleClashes, 'Harus menyediakan properti scheduleClashes');
  assert.equal(plan.scheduleClashes.length, 1, 'Harus mendeteksi 1 bentrok jadwal');
  assert.equal(plan.scheduleClashes[0].day, 'Senin');
});

test('B9C.5: Proteksi identitas: NIM berbeda memicu hasIdentityMismatch dan menolak commit tanpa izin eksplisit', () => {
  const targetSemester = { id: 105, name: 'Semester 1', courses: [] };
  const candidate = {
    documentType: 'KRS',
    student: { nim: '220099' }, // NIM berbeda dari profil pengguna
    courses: [{ name: 'Fisika', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  assert.equal(plan.hasIdentityMismatch, true);

  // Menolak commit jika allowIdentityMismatch !== true
  assert.throws(
    () => applyAcademicImportPlan(plan, targetSemester, { enableSyntheticExecution: true, isUserConfirmed: true }),
    (err) => err instanceof AcademicImportPlanError && err.code === 'identity_mismatch_unconfirmed'
  );

  // Berhasil jika allowIdentityMismatch: true
  const result = applyAcademicImportPlan(plan, targetSemester, {
    enableSyntheticExecution: true,
    isUserConfirmed: true,
    allowIdentityMismatch: true,
  });
  assert.equal(result.ok, true);
});

test('B9C.6: Proteksi Staleness: Perubahan data semester setelah pembuatan preview memicu error plan_stale', () => {
  const initialSemester = {
    id: 106,
    name: 'Semester 1',
    courses: [{ id: 'c1', name: 'Kalkulus', sks: 3 }],
  };

  const candidate = {
    documentType: 'KRS',
    student: { nim: '220001' },
    courses: [{ name: 'Fisika', sks: 3, included: true }],
  };

  const plan = createAcademicImportPlan(initialSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  // Simulasi semester berubah di tab lain (misal ada kursus bertambah atau jadwal berubah)
  const modifiedSemester = {
    ...initialSemester,
    courses: [
      ...initialSemester.courses,
      { id: 'c2', name: 'Kimia', sks: 2 },
    ],
  };

  assert.throws(
    () => applyAcademicImportPlan(plan, modifiedSemester, { enableSyntheticExecution: true, isUserConfirmed: true }),
    (err) => err instanceof AcademicImportPlanError && err.code === 'plan_stale'
  );
});

test('B9C.7: Kontrak Timetable: Properti hasil simpan jadwal kompatibel dengan filter dan sorting Timetable.jsx', () => {
  const targetSemester = {
    id: 107,
    name: 'Semester 1',
    status: 'current',
    courses: [],
  };

  const candidate = {
    documentType: 'KRS',
    isKrs: true,
    student: { nim: '220001' },
    courses: [
      {
        name: 'Struktur Data',
        sks: 3,
        day: 'Kamis',
        timeStart: '10:00',
        timeEnd: '12:30',
        room: 'Lab 2',
        lecturer: 'Bapak Ahmad',
        included: true,
      },
      {
        name: 'Arsitektur Komputer',
        sks: 3,
        day: 'Kamis',
        timeStart: '07:30',
        timeEnd: '10:00',
        room: 'R.302',
        lecturer: 'Ibu Siti',
        included: true,
      },
    ],
  };

  const plan = createAcademicImportPlan(targetSemester, candidate, {
    userProfile: { nim: '220001' },
  });

  const result = applyAcademicImportPlan(plan, targetSemester, {
    enableSyntheticExecution: true,
    isUserConfirmed: true,
  });

  const allCourses = result.updatedSemester.courses;

  // Verifikasi filter & sorting yang dipakai oleh Timetable.jsx:
  // courses.filter(course => course.day && course.day.trim().toLowerCase().includes('kamis'.toLowerCase()))
  //   .sort((a, b) => (a.timeStart || '00:00').localeCompare(b.timeStart || '00:00'))
  const thursdayCourses = allCourses
    .filter(c => c.day && c.day.toLowerCase().includes('kamis'))
    .sort((a, b) => (a.timeStart || '00:00').localeCompare(b.timeStart || '00:00'));

  assert.equal(thursdayCourses.length, 2);
  assert.equal(thursdayCourses[0].name, 'Arsitektur Komputer', '07:30 harus di urutan pertama');
  assert.equal(thursdayCourses[1].name, 'Struktur Data', '10:00 harus di urutan kedua');
});
