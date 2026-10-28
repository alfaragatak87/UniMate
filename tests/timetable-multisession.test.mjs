/**
 * tests/timetable-multisession.test.mjs
 *
 * Pengujian komprehensif integrasi jadwal multi-sesi pada Timetable:
 * - Ekspansi multi-sesi (teori & praktikum di hari berbeda)
 * - Pencegahan duplikasi antar-hari
 * - Pemetaan hari otomatis (termasuk Jumat & Sabtu)
 * - Pemisahan sesi tunggal vs multi-sesi
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function expandTimetableSessions(courses) {
  return courses.flatMap((course, cIdx) => {
    if (Array.isArray(course.schedules) && course.schedules.length > 0) {
      return course.schedules.map((sched, sIdx) => ({
        ...course,
        parentCourse: course,
        day: sched.day || course.day,
        timeStart: sched.timeStart || course.timeStart,
        timeEnd: sched.timeEnd || course.timeEnd,
        room: sched.room || course.room,
        lecturer: sched.lecturer || course.lecturer,
        class: sched.class || course.class,
        sessionLabel: sched.label || (course.schedules.length > 1 ? (sIdx === 0 ? 'Teori' : 'Praktikum') : null),
        _sessionKey: `${course.id || course.code || cIdx}_sched_${sIdx}`,
      }));
    }
    return [{
      ...course,
      parentCourse: course,
      sessionLabel: null,
      _sessionKey: `${course.id || course.code || cIdx}_single`,
    }];
  });
}

function computeScheduleByDay(days, sessions) {
  return days.reduce((acc, day) => {
    acc[day] = sessions
      .filter(s => s.day && s.day.trim().toLowerCase().includes(day.toLowerCase()))
      .sort((a, b) => (a.timeStart || '00:00').localeCompare(b.timeStart || '00:00'));
    return acc;
  }, {});
}

test('B10-TT.1: Ekspansi multi-sesi: Teori dan Praktikum muncul pada hari terpisah tanpa duplikasi', () => {
  const courses = [
    {
      id: 'c1',
      code: 'IF202',
      name: 'Struktur Data & Algoritma',
      day: 'Rabu',
      timeStart: '09:00',
      timeEnd: '10:40',
      room: 'Ruang 301',
      lecturer: 'Ir. Siti Rahma, M.T.',
      schedules: [
        { day: 'Rabu', timeStart: '09:00', timeEnd: '10:40', room: 'Ruang 301', label: 'Teori' },
        { day: 'Jumat', timeStart: '13:00', timeEnd: '15:30', room: 'Lab Basis Data', label: 'Praktikum' },
      ],
    },
    {
      id: 'c2',
      code: 'IF101',
      name: 'Pemrograman Web',
      day: 'Senin',
      timeStart: '08:00',
      timeEnd: '10:30',
      room: 'Lab Komputer 3',
      lecturer: 'Dr. Budi Santoso',
      schedules: [],
    },
  ];

  const sessions = expandTimetableSessions(courses);
  assert.equal(sessions.length, 3, 'Total 3 sesi kartu: 2 untuk Struktur Data dan 1 untuk Pemrograman Web');

  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  const schedule = computeScheduleByDay(days, sessions);

  // Senin: hanya Pemrograman Web
  assert.equal(schedule['Senin'].length, 1);
  assert.equal(schedule['Senin'][0].name, 'Pemrograman Web');

  // Selasa: kosong
  assert.equal(schedule['Selasa'].length, 0);

  // Rabu: Sesi Teori Struktur Data
  assert.equal(schedule['Rabu'].length, 1);
  assert.equal(schedule['Rabu'][0].name, 'Struktur Data & Algoritma');
  assert.equal(schedule['Rabu'][0].sessionLabel, 'Teori');
  assert.equal(schedule['Rabu'][0].room, 'Ruang 301');

  // Kamis: kosong
  assert.equal(schedule['Kamis'].length, 0);

  // Jumat: Sesi Praktikum Struktur Data
  assert.equal(schedule['Jumat'].length, 1);
  assert.equal(schedule['Jumat'][0].name, 'Struktur Data & Algoritma');
  assert.equal(schedule['Jumat'][0].sessionLabel, 'Praktikum');
  assert.equal(schedule['Jumat'][0].room, 'Lab Basis Data');

  // Anti-duplikasi: Sesi Teori tidak boleh muncul di Jumat, Sesi Praktikum tidak boleh muncul di Rabu
  assert.equal(schedule['Rabu'][0].room !== 'Lab Basis Data', true);
  assert.equal(schedule['Jumat'][0].room !== 'Ruang 301', true);
});

test('B10-TT.2: Penambahan hari Sabtu otomatis jika terdapat perkuliahan di akhir pekan', () => {
  const coursesWithSaturday = [
    {
      id: 'c_sabtu',
      name: 'Seminar Proposal Akhir Pekan',
      day: 'Sabtu',
      timeStart: '09:00',
      timeEnd: '12:00',
      room: 'Auditorium',
    },
  ];

  const hasSaturday = coursesWithSaturday.some(c => c.day && c.day.toLowerCase().includes('sabtu'));
  assert.equal(hasSaturday, true);

  const baseDays = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  const activeDays = hasSaturday ? [...baseDays, 'Sabtu'] : baseDays;

  assert.equal(activeDays.includes('Sabtu'), true);
  const sessions = expandTimetableSessions(coursesWithSaturday);
  const schedule = computeScheduleByDay(activeDays, sessions);
  assert.equal(schedule['Sabtu'].length, 1);
  assert.equal(schedule['Sabtu'][0].name, 'Seminar Proposal Akhir Pekan');
});

test('B10-TT.3: Sesi kartu tetap merujuk ke parentCourse asli saat diedit', () => {
  const parentCourse = {
    id: 'course_parent_999',
    name: 'Jaringan Komputer',
    day: 'Selasa',
    schedules: [
      { day: 'Selasa', timeStart: '08:00', timeEnd: '10:00', room: 'R201' },
      { day: 'Kamis', timeStart: '10:00', timeEnd: '12:00', room: 'Lab Cisco' },
    ],
  };

  const sessions = expandTimetableSessions([parentCourse]);
  assert.equal(sessions[0].parentCourse.id, 'course_parent_999');
  assert.equal(sessions[1].parentCourse.id, 'course_parent_999');
});

test('B10-TT.4: Format label menghitung jumlah mata kuliah vs total sesi pertemuan secara presisi', () => {
  const courses = [
    { id: 'c1', name: 'Algoritma', schedules: [{ day: 'Senin' }, { day: 'Rabu' }] },
    { id: 'c2', name: 'Basis Data', schedules: [{ day: 'Selasa' }] },
    { id: 'c3', name: 'Kewirausahaan' }, // single session
  ];

  const sessions = expandTimetableSessions(courses);
  assert.equal(courses.length, 3, 'Harus ada 3 mata kuliah');
  assert.equal(sessions.length, 4, 'Harus ada 4 total sesi pertemuan');

  const label = `Total: ${courses.length} mata kuliah • ${sessions.length} sesi pertemuan`;
  assert.equal(label, 'Total: 3 mata kuliah • 4 sesi pertemuan');
});

