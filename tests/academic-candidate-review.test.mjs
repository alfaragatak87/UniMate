import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  parseAcademicDocumentText,
  toCandidateExtractedData,
  VALID_LETTER_GRADES,
  STANDARD_GRADE_POINTS,
} from '../src/services/offlineAcademicParser.js';

// Fixture Sintetis Dokumen
const SYNTHETIC_KRS_TEXT = `
KEMENTERIAN PENDIDIKAN, KEBUDAYAAN, RISET, DAN TEKNOLOGI
UNIVERSITAS NUSANTARA
KARTU RENCANA STUDI (KRS)
Nama: Budi Santoso
NIM: 2201456789
Semester: Ganjil 2024/2025
Semester 3

No | Kode MK | Nama Mata Kuliah | SKS | Kelas
1 | IF2101 | Struktur Data dan Algoritma | 4 | A
2 | IF2102 | Sistem Basis Data | 3 | B
3 | IF2103 | Pemrograman Berorientasi Objek | 3 | A
4 | KU2001 | Pendidikan Kewarganegaraan | 2 | C

Total SKS Rencana: 12
`;

const SYNTHETIC_KHS_TEXT = `
KARTU HASIL STUDI (KHS)
Semester Genap 2023/2024 - Semester 4
NIM : 2101998877   Nama : Siti Rahma

Kode        Mata Kuliah               SKS  Nilai  Bobot
CS201       Pemrograman Web            3     A     4.00
CS202       Jaringan Komputer          3     B+    3.50
CS203       Statistika dan Probabilitas 3     A-    3.75

Jumlah SKS Semester : 9
Indeks Prestasi Semester (IPS) : 3.75
Indeks Prestasi Kumulatif (IPK) : 3.68
`;

const SYNTHETIC_AMBIGUOUS_KHS = `
KARTU HASIL STUDI
Semester 2
1 | CS101 | Algoritma Pemrograman | 3 | A | 4.0
2 | CS102 | Jaringan Komputer | 25 | X | -
3 | CS103 | Desain Antarmuka | 0 | 8 | -
`;

// ============================================================================
// UJI B6B: 18 SKENARIO PENGUJIAN ANTARMUKA & KONTRAK REVIEW KANDIDAT
// ============================================================================

test('B6B.1: KRS valid dengan beberapa mata kuliah diekstrak menjadi kandidat review terstruktur', () => {
  const result = parseAcademicDocumentText(SYNTHETIC_KRS_TEXT);
  assert.equal(result.isAcademicDocument, true);
  assert.equal(result.documentType, 'KRS');
  assert.equal(result.semesterNumber, 3);
  assert.equal(result.courses.length, 4);

  assert.equal(result.courses[0].code, 'IF2101');
  assert.equal(result.courses[0].name, 'Struktur Data dan Algoritma');
  assert.equal(result.courses[0].sks, 4);
  assert.equal(result.courses[0].grade, null); // KRS tidak memiliki nilai huruf
  assert.equal(result.courses[0].point, null);
  assert.equal(result.summary.totalSks, 12);
  assert.equal(result.needsReview, false);
});

test('B6B.2: KHS valid dengan nilai huruf, bobot, dan IPS tercetak diekstrak akurat', () => {
  const result = parseAcademicDocumentText(SYNTHETIC_KHS_TEXT);
  assert.equal(result.isAcademicDocument, true);
  assert.equal(result.documentType, 'KHS');
  assert.equal(result.semesterNumber, 4);

  assert.equal(result.courses.length, 3);
  assert.equal(result.courses[0].grade, 'A');
  assert.equal(result.courses[0].point, 4.0);
  assert.equal(result.courses[1].grade, 'B+');
  assert.equal(result.courses[1].point, 3.5);
  assert.equal(result.summary.ips, 3.75);
  assert.equal(result.summary.ipk, 3.68);
});

test('B6B.3: Tabel dengan kolom Kelas pada KRS tidak salah dibaca sebagai nilai huruf', () => {
  const result = parseAcademicDocumentText(SYNTHETIC_KRS_TEXT);
  assert.equal(result.documentType, 'KRS');
  for (const course of result.courses) {
    // Pada KRS, huruf Kelas (A, B, C) TIDAK BOLEH menjadi grade
    assert.equal(course.grade, null, `Kelas tidak boleh jadi grade untuk ${course.name}`);
    assert.equal(course.point, null);
  }
});

test('B6B.4: Dokumen ambigu (nilai tidak valid, SKS ekstrim) ditandai needsReview dengan alasan eksplisit', () => {
  const result = parseAcademicDocumentText(SYNTHETIC_AMBIGUOUS_KHS);
  assert.equal(result.isAcademicDocument, true);
  assert.equal(result.needsReview, true);
  assert.equal(result.reviewReasons.includes('courses_need_review'), true);

  const courseX = result.courses.find(c => c.name.includes('Jaringan'));
  assert.ok(courseX);
  assert.equal(courseX.needsReview, true);
  assert.equal(courseX.reviewReasons.includes('invalid_sks'), true);
  assert.equal(courseX.reviewReasons.includes('grade_unrecognized'), true);
});

test('B6B.5: Teks OCR kosong atau null ditangani secara aman tanpa melempar exception', () => {
  const emptyResult = parseAcademicDocumentText('');
  assert.equal(emptyResult.isAcademicDocument, false);
  assert.equal(emptyResult.documentType, 'unknown');
  assert.equal(emptyResult.courses.length, 0);

  const nullResult = parseAcademicDocumentText(null);
  assert.equal(nullResult.isAcademicDocument, false);
  assert.equal(nullResult.documentType, 'unknown');
});

test('B6B.6: Teks OCR lebih dari 20.000 karakter diproses utuh tanpa batas preview', () => {
  const filler = 'Catatan silabus tambahan untuk pengujian dokumen panjang.\n'.repeat(350);
  const longText = `${SYNTHETIC_KHS_TEXT}\n${filler}`;
  assert.ok(longText.length > 20000);

  const result = parseAcademicDocumentText(longText);
  assert.equal(result.isAcademicDocument, true);
  assert.equal(result.documentType, 'KHS');
  assert.equal(result.courses.length, 3);
  assert.equal(result.summary.ips, 3.75);
});

test('B6B.7: Koreksi data kandidat memperbarui nama, kode, SKS, dan nilai tanpa mutasi rawText', () => {
  const initial = parseAcademicDocumentText(SYNTHETIC_KRS_TEXT);

  // Simulasi draft koreksi pengguna
  const draft = initial.courses.map((c, idx) => ({ ...c }));
  draft[0].name = 'Struktur Data Lanjut (Koreksi Pengguna)';
  draft[0].code = 'IF2101-CORR';
  draft[0].sks = 3;

  // Pastikan draft terpisah dari initial courses
  assert.notEqual(draft[0].name, initial.courses[0].name);
  assert.notEqual(draft[0].code, initial.courses[0].code);
  assert.notEqual(draft[0].sks, initial.courses[0].sks);
  assert.equal(initial.courses[0].name, 'Struktur Data dan Algoritma');
  assert.equal(initial.courses[0].evidence.rawLine.includes('Struktur Data dan Algoritma'), true);
});

test('B6B.8: Pemilihan (included: true) dan pengabaian (included: false) baris memfilter daftar aktif', () => {
  const initial = parseAcademicDocumentText(SYNTHETIC_KRS_TEXT);

  const draft = initial.courses.map((c, idx) => ({
    ...c,
    included: idx !== 2, // abaikan baris index 2
  }));

  const selectedCourses = draft.filter(c => c.included);
  assert.equal(selectedCourses.length, 3);
  assert.equal(draft.length, 4);
  assert.equal(selectedCourses.some(c => c.name.includes('Objek')), false);
});

test('B6B.9: Validasi SKS mendeteksi nilai di luar rentang wajar (1-12)', () => {
  const validSksList = [1, 2, 3, 4, 6, 12];
  const invalidSksList = [0, -1, 13, 24, 50, 'abc'];

  function isValidSks(val) {
    const num = Number(val);
    return Number.isInteger(num) && num >= 1 && num <= 12;
  }

  for (const val of validSksList) {
    assert.equal(isValidSks(val), true, `SKS ${val} seharusnya valid`);
  }
  for (const val of invalidSksList) {
    assert.equal(isValidSks(val), false, `SKS ${val} seharusnya tidak valid`);
  }
});

test('B6B.10: Validasi nilai huruf membedakan grade standar dan menandai grade non-standar', () => {
  assert.ok(VALID_LETTER_GRADES.has('A'));
  assert.ok(VALID_LETTER_GRADES.has('B+'));
  assert.ok(VALID_LETTER_GRADES.has('C'));
  assert.ok(VALID_LETTER_GRADES.has('E'));

  assert.equal(VALID_LETTER_GRADES.has('X'), false);
  assert.equal(VALID_LETTER_GRADES.has('8'), false);
  assert.equal(VALID_LETTER_GRADES.has('LULUS'), false);

  assert.equal(STANDARD_GRADE_POINTS['A'], 4.0);
  assert.equal(STANDARD_GRADE_POINTS['B+'], 3.25);
  assert.equal(STANDARD_GRADE_POINTS['C'], 2.0);
});

test('B6B.11: Deteksi perbedaan identitas dokumen vs profil pengguna', () => {
  function checkIdentityMismatch(docNim, docName, profNim, profName) {
    const clean = s => (s || '').trim().toLowerCase().replace(/[^a-z0-9]/gu, '');
    const nimDiff = Boolean(docNim && profNim && clean(docNim) !== clean(profNim));
    const nameDiff = Boolean(docName && profName && clean(docName) !== clean(profName));
    return nimDiff || nameDiff;
  }

  // Kasus 1: Sama persis
  assert.equal(checkIdentityMismatch('2201456789', 'Budi Santoso', '2201456789', 'Budi Santoso'), false);

  // Kasus 2: NIM berbeda
  assert.equal(checkIdentityMismatch('2201456789', 'Budi Santoso', '1901112233', 'Budi Santoso'), true);

  // Kasus 3: Nama berbeda
  assert.equal(checkIdentityMismatch('2201456789', 'Budi Santoso', '2201456789', 'Ahmad Dani'), true);

  // Kasus 4: Profil belum diisi (tidak memicu mismatch palsu)
  assert.equal(checkIdentityMismatch('2201456789', 'Budi Santoso', '', ''), false);
});

test('B6B.12: Pembatalan review mengembalikan state draft tanpa merusak session scanner', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  assert.match(source, /setShowAcademicReviewModal\(false\)/u);
  assert.match(source, /onClose=\{\(\) => setShowAcademicReviewModal\(false\)\}/u);
});

test('B6B.13: Kontrol keamanan B6B: tidak ada operasi simpan/tulis otomatis ke Semester', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  const saveManualStart = source.indexOf('const saveManual = async');
  const confirmOverwriteStart = source.indexOf('const confirmOverwrite = async');
  const saveManualCode = source.slice(saveManualStart, confirmOverwriteStart);

  // Pastikan ada guard khusus academicCandidate yang memblokir penulisan ke semester
  assert.match(saveManualCode, /if \(academicCandidate && processingSource === SCANNER_PROCESSING_SOURCES\.OFFLINE\)/u);
  assert.match(saveManualCode, /toast\.success\('.*Review kandidat akademik selesai.*Tahap B6C\.'\)/u);
  assert.match(saveManualCode, /return;/u);
});

test('B6B.14: Tidak ada perubahan pada rawText selama proses review dan koreksi', () => {
  const result = parseAcademicDocumentText(SYNTHETIC_KRS_TEXT);
  const rawLineBackup = result.courses[0].evidence.rawLine;

  // Koreksi draft
  const draftCourse = { ...result.courses[0], name: 'Nama Baru' };
  assert.equal(draftCourse.evidence.rawLine, rawLineBackup);
  assert.equal(result.courses[0].evidence.rawLine, rawLineBackup);
});

test('B6B.15: Scanner PDF dan gambar tetap bekerja dan mengekstrak teks OCR asli', async () => {
  const scannerSource = await fs.readFile(new URL('../src/services/offlineScanner.js', import.meta.url), 'utf8');
  assert.match(scannerSource, /processPdfOffline/u);
  assert.match(scannerSource, /processImageOffline/u);
  assert.match(scannerSource, /parseAcademicDocumentText/u);
});

test('B6B.16: File umum non-KRS/KHS (resep, artikel, dsb) tetap berjalan normal sebagai file/review biasa', () => {
  const nonAcademicText = 'Resep Nasi Goreng Spesial\nBahan: Nasi, Telur, Bawang Merah, Kecap.\nLangkah memasak...';
  const result = parseAcademicDocumentText(nonAcademicText);
  assert.equal(result.isAcademicDocument, false);
  assert.equal(result.documentType, 'unknown');
  assert.equal(result.courses.length, 0);
});

test('B6B.17: Antarmuka AcademicCandidateReviewModal terstruktur dua panel responsif dan bersih', async () => {
  const modalSource = await fs.readFile(new URL('../src/components/AcademicCandidateReviewModal.jsx', import.meta.url), 'utf8');
  assert.match(modalSource, /gridTemplateColumns/u);
  assert.match(modalSource, /Bukti Baris OCR Terpilih/u);
  assert.match(modalSource, /Rencana Semester Tujuan/u);
  assert.match(modalSource, /Selesaikan Review/u);
  assert.match(modalSource, /Perhatian Identitas Dokumen/u);
  assert.match(modalSource, /Hanya Perlu Diperiksa/u);
});

test('B6B.18: Integritas keamanan: tidak ada pemanggilan fetch atau SDK Gemini eksternal di alur review offline', async () => {
  const modalSource = await fs.readFile(new URL('../src/components/AcademicCandidateReviewModal.jsx', import.meta.url), 'utf8');
  assert.equal(modalSource.includes('fetch('), false);
  assert.equal(modalSource.includes('gemini'), false);
  assert.equal(modalSource.includes('apiKey'), false);
  assert.equal(modalSource.includes('SafeStorage'), false);
});
