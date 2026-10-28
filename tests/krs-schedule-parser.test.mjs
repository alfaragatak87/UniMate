/**
 * tests/krs-schedule-parser.test.mjs
 *
 * Pengujian Terfokus B9B: Ekstraksi dan Validasi Jadwal Kuliah dari Dokumen KRS Offline.
 * Menguji normalisasi hari, rentang jam, ruang, kelas, dosen, multi-sesi, anti-halusinasi,
 * dan deteksi bentrok jadwal 100% offline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAcademicDocumentText,
  normalizeScheduleDay,
  parseScheduleTimeRange,
  detectScheduleClashes,
  STANDARD_DAYS,
  ACADEMIC_DOCUMENT_TYPES,
} from '../src/services/offlineAcademicParser.js';

test('B9B.1: normalizeScheduleDay menormalisasi seluruh variasi nama hari dan singkatan', () => {
  assert.equal(STANDARD_DAYS.length, 7);
  assert.equal(normalizeScheduleDay('Senin'), 'Senin');
  assert.equal(normalizeScheduleDay('sen'), 'Senin');
  assert.equal(normalizeScheduleDay('Selasa'), 'Selasa');
  assert.equal(normalizeScheduleDay('sel'), 'Selasa');
  assert.equal(normalizeScheduleDay('Rabu'), 'Rabu');
  assert.equal(normalizeScheduleDay('rab'), 'Rabu');
  assert.equal(normalizeScheduleDay('Kamis'), 'Kamis');
  assert.equal(normalizeScheduleDay('kam'), 'Kamis');
  assert.equal(normalizeScheduleDay('Jumat'), 'Jumat');
  assert.equal(normalizeScheduleDay("Jum'at"), 'Jumat');
  assert.equal(normalizeScheduleDay('jum'), 'Jumat');
  assert.equal(normalizeScheduleDay('Sabtu'), 'Sabtu');
  assert.equal(normalizeScheduleDay('sab'), 'Sabtu');
  assert.equal(normalizeScheduleDay('Minggu'), 'Minggu');
  assert.equal(normalizeScheduleDay('min'), 'Minggu');

  // Input invalid
  assert.equal(normalizeScheduleDay(''), null);
  assert.equal(normalizeScheduleDay('Januari'), null);
  assert.equal(normalizeScheduleDay(null), null);
});

test('B9B.2: parseScheduleTimeRange mengekstrak dan menormalisasi format jam kuliah', () => {
  // Format titik dua
  const r1 = parseScheduleTimeRange('07:00-08:40');
  assert.deepEqual(r1, { timeStart: '07:00', timeEnd: '08:40' });

  // Format titik
  const r2 = parseScheduleTimeRange('08.00 - 10.30');
  assert.deepEqual(r2, { timeStart: '08:00', timeEnd: '10:30' });

  // Format s/d dan s.d.
  const r3 = parseScheduleTimeRange('13.00 s/d 15.30');
  assert.deepEqual(r3, { timeStart: '13:00', timeEnd: '15:30' });

  const r4 = parseScheduleTimeRange('10:00 s.d. 12:30');
  assert.deepEqual(r4, { timeStart: '10:00', timeEnd: '12:30' });

  // Jam 1 digit
  const r5 = parseScheduleTimeRange('8.00-9.40');
  assert.deepEqual(r5, { timeStart: '08:00', timeEnd: '09:40' });

  // Invalid: jam selesai lebih awal dari mulai
  assert.equal(parseScheduleTimeRange('10:00-08:00'), null);
  // Invalid: jam > 23 atau menit > 59
  assert.equal(parseScheduleTimeRange('25:00-26:00'), null);
  assert.equal(parseScheduleTimeRange('08:70-10:00'), null);
  assert.equal(parseScheduleTimeRange('invalid'), null);
});

test('B9B.3: Ekstraksi jadwal KRS tabel pipe lengkap (Hari, Jam, Ruang, Kelas, Dosen)', () => {
  const krsText = `
KARTU RENCANA STUDI (KRS)
SEMESTER GANJIL 2024/2025
NIM: 2200010001
Nama: Budi Pratama
Fakultas Ilmu Komputer

| No | Kode MK | Nama Mata Kuliah | SKS | Kelas | Hari | Jam | Ruang | Dosen Pengampu |
| 1 | IF2101 | Pemrograman Berorientasi Objek | 3 | A | Senin | 08.00-10.30 | Lab Komputer 2 | Dr. Budi Santoso, M.Kom |
| 2 | IF2102 | Struktur Data & Algoritma | 4 | IF-4B | Rabu | 07:00-09:30 | R.301 | Ir. Siti Rahma, M.T. |
| 3 | IF2103 | Basis Data Lanjut | 3 | C | Kamis | 13.00 s/d 15.30 | GK2-204 | Prof. Dr. Ahmad Fauzi |
`;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.KRS);
  assert.equal(parsed.courses.length, 3);

  // Kursus 1
  const c1 = parsed.courses[0];
  assert.equal(c1.code, 'IF2101');
  assert.equal(c1.name, 'Pemrograman Berorientasi Objek');
  assert.equal(c1.sks, 3);
  assert.equal(c1.class, 'A');
  assert.equal(c1.day, 'Senin');
  assert.equal(c1.timeStart, '08:00');
  assert.equal(c1.timeEnd, '10:30');
  assert.equal(c1.room, 'Lab Komputer 2');
  assert.equal(c1.lecturer, 'Dr. Budi Santoso, M.Kom');
  assert.equal(c1.grade, null); // Harus null!
  assert.equal(c1.point, null);

  // Kursus 2
  const c2 = parsed.courses[1];
  assert.equal(c2.code, 'IF2102');
  assert.equal(c2.name, 'Struktur Data & Algoritma');
  assert.equal(c2.sks, 4);
  assert.equal(c2.class, 'IF-4B');
  assert.equal(c2.day, 'Rabu');
  assert.equal(c2.timeStart, '07:00');
  assert.equal(c2.timeEnd, '09:30');
  assert.equal(c2.room, 'R.301');
  assert.equal(c2.lecturer, 'Ir. Siti Rahma, M.T.');

  // Kursus 3
  const c3 = parsed.courses[2];
  assert.equal(c3.code, 'IF2103');
  assert.equal(c3.class, 'C');
  assert.equal(c3.day, 'Kamis');
  assert.equal(c3.timeStart, '13:00');
  assert.equal(c3.timeEnd, '15:30');
  assert.equal(c3.room, 'GK2-204');
});

test('B9B.4: Anti-Halusinasi Kelas: Kelas A/B/C tidak disalahartikan sebagai Nilai Huruf KHS', () => {
  const krsText = `
KARTU RENCANA STUDI (KRS)
Semester: Ganjil 2024/2025
| No | Kode | Nama MK | SKS | Kelas | Hari |
| 1 | IF101 | Pemrograman Dasar | 3 | A | Senin |
| 2 | IF102 | Logika Matematika | 3 | B | Selasa |
`;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.KRS);
  assert.equal(parsed.courses[0].class, 'A');
  assert.equal(parsed.courses[0].grade, null, 'Kelas A tidak boleh menjadi grade!');
  assert.equal(parsed.courses[1].class, 'B');
  assert.equal(parsed.courses[1].grade, null, 'Kelas B tidak boleh menjadi grade!');
});

test('B9B.5: Multi-sesi per mata kuliah diekstrak utuh ke dalam schedules', () => {
  const krsText = `
KARTU RENCANA STUDI (KRS)
| No | Kode | Nama Mata Kuliah | SKS | Kelas | Jadwal Perkuliahan |
| 1 | IF301 | Jaringan Komputer | 4 | A | Senin 08:00-09:40 R.201 / Rabu 13:00-15:30 Lab Jaringan |
`;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.courses.length, 1);
  const course = parsed.courses[0];

  assert.equal(course.name, 'Jaringan Komputer');
  assert.equal(course.day, 'Senin');
  assert.equal(course.timeStart, '08:00');
  assert.equal(course.timeEnd, '09:40');
  assert.equal(course.schedules.length, 2, 'Harus menyimpan 2 sesi perkuliahan');

  assert.equal(course.schedules[0].day, 'Senin');
  assert.equal(course.schedules[0].timeStart, '08:00');
  assert.equal(course.schedules[0].timeEnd, '09:40');

  assert.equal(course.schedules[1].day, 'Rabu');
  assert.equal(course.schedules[1].timeStart, '13:00');
  assert.equal(course.schedules[1].timeEnd, '15:30');
  assert.equal(course.schedules[1].room, 'Lab Jaringan');
});

test('B9B.6: KRS tanpa jadwal tidak mengarang jam, ruang, atau dosen fiktif', () => {
  const krsText = `
KARTU RENCANA STUDI (KRS)
| No | Kode | Nama MK | SKS | Kelas |
| 1 | IF401 | Skripsi | 6 | A |
| 2 | IF402 | Kerja Praktik | 2 | B |
`;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.courses.length, 2);

  assert.equal(parsed.courses[0].day, null);
  assert.equal(parsed.courses[0].timeStart, null);
  assert.equal(parsed.courses[0].timeEnd, null);
  assert.equal(parsed.courses[0].room, null);
  assert.equal(parsed.courses[0].lecturer, null);
  assert.equal(parsed.courses[0].schedules.length, 0);

  assert.equal(parsed.courses[1].day, null);
  assert.equal(parsed.courses[1].timeStart, null);
  assert.equal(parsed.courses[1].timeEnd, null);
});

test('B9B.7: Baris KRS non-pipe mengekstrak jadwal, hari, jam, dan ruang', () => {
  const krsText = `
KARTU RENCANA STUDI
Semester Ganjil 2024/2025
1 IF101 Pemrograman Web 3 A Senin 08.00-10.30 R.301 Dr. Budi
2 IF102 Kecerdasan Buatan 3 B Rabu 13:00-15:30 Lab AI Prof. Ahmad
`;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.courses.length, 2);

  assert.equal(parsed.courses[0].name, 'Pemrograman Web');
  assert.equal(parsed.courses[0].sks, 3);
  assert.equal(parsed.courses[0].class, 'A');
  assert.equal(parsed.courses[0].day, 'Senin');
  assert.equal(parsed.courses[0].timeStart, '08:00');
  assert.equal(parsed.courses[0].timeEnd, '10:30');

  assert.equal(parsed.courses[1].name, 'Kecerdasan Buatan');
  assert.equal(parsed.courses[1].sks, 3);
  assert.equal(parsed.courses[1].class, 'B');
  assert.equal(parsed.courses[1].day, 'Rabu');
  assert.equal(parsed.courses[1].timeStart, '13:00');
  assert.equal(parsed.courses[1].timeEnd, '15:30');
});

test('B9B.8: detectScheduleClashes mendeteksi irisan waktu pada hari yang sama', () => {
  const courses = [
    {
      id: 'c1',
      name: 'Matematika Diskrit',
      day: 'Senin',
      timeStart: '08:00',
      timeEnd: '10:00',
    },
    {
      id: 'c2',
      name: 'Algoritma Pemrograman',
      day: 'Senin',
      timeStart: '09:30', // Bentrok dengan c1 (08:00 - 10:00)
      timeEnd: '11:30',
    },
    {
      id: 'c3',
      name: 'Bahasa Inggris',
      day: 'Senin',
      timeStart: '13:00', // Aman, tidak beririsan
      timeEnd: '14:30',
    },
    {
      id: 'c4',
      name: 'Fisika Dasar',
      day: 'Selasa', // Beda hari, jam sama dengan c1 -> tidak bentrok
      timeStart: '08:00',
      timeEnd: '10:00',
    },
  ];

  const clashes = detectScheduleClashes(courses);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].day, 'Senin');
  assert.equal(clashes[0].courseA.name, 'Matematika Diskrit');
  assert.equal(clashes[0].courseB.name, 'Algoritma Pemrograman');
});
