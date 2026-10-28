import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_CAPABILITIES } from '../shared/ai/contracts.mjs';
import { validateCapabilityResult } from '../shared/ai/validation.mjs';
import { createCourseMergePlan } from '../src/services/aiScannerMerge.js';
import {
  ACADEMIC_DOCUMENT_TYPES,
  parseAcademicDocumentText,
  resolveDocumentText,
  toCandidateExtractedData,
} from '../src/services/offlineAcademicParser.js';
import { processOfflineScannerFile } from '../src/services/offlineScanner.js';

test('B6A.1: KRS sederhana dengan kode, nama matkul, dan SKS diparsing akurat', () => {
  const krsText = `
    KEMENTERIAN PENDIDIKAN, KEBUDAYAAN, RISET, DAN TEKNOLOGI
    UNIVERSITAS NUSANTARA
    KARTU RENCANA STUDI (KRS)
    Semester: Ganjil 2024/2025
    NIM: 2024010099   Nama Mahasiswa: Budi Santoso
    Program Studi: Informatika

    No | Kode MK | Nama Mata Kuliah | SKS | Kelas
    1  | IF184101 | Pemrograman Dasar | 3 | A
    2  | IF184102 | Struktur Data | 4 | B
    3  | IF184103 | Matematika Diskrit | 3 | A
    4  | UN180001 | Bahasa Indonesia | 2 | C

    Total SKS Diambil: 12
  `;

  const parsed = parseAcademicDocumentText(krsText);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.KRS);
  assert.equal(parsed.semester, null); // Semester Ganjil tanpa angka semester spesifik
  assert.equal(parsed.academicYear, '2024/2025');
  assert.equal(parsed.student.nim, '2024010099');
  assert.equal(parsed.student.name, 'Budi Santoso');
  assert.equal(parsed.summary.totalSks, 12);
  assert.equal(parsed.courses.length, 4);

  assert.equal(parsed.courses[0].code, 'IF184101');
  assert.equal(parsed.courses[0].name, 'Pemrograman Dasar');
  assert.equal(parsed.courses[0].sks, 3);
  assert.equal(parsed.courses[0].grade, null); // KRS tidak memiliki nilai

  assert.equal(parsed.courses[1].code, 'IF184102');
  assert.equal(parsed.courses[1].name, 'Struktur Data');
  assert.equal(parsed.courses[1].sks, 4);
});

test('B6A.2: KHS sederhana dengan kode, nama, SKS, nilai huruf, bobot, dan IPS tercetak', () => {
  const khsText = `
    KARTU HASIL STUDI (KHS)
    Semester 4 (Genap 2023/2024)
    NIM: 2022090011  Nama: Siti Aminah

    No | Kode | Mata Kuliah | SKS | Nilai | Bobot
    1  | CS201 | Sistem Basis Data | 3 | A | 4.00
    2  | CS202 | Rekayasa Perangkat Lunak | 3 | B+ | 3.25
    3  | CS203 | Jaringan Komputer | 3 | A- | 3.75
    4  | CS204 | Pemrograman Web | 3 | AB | 3.50

    Jumlah SKS Semester : 12
    Indeks Prestasi Semester (IPS) : 3.63
    Indeks Prestasi Kumulatif (IPK) : 3.70
  `;

  const parsed = parseAcademicDocumentText(khsText);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.KHS);
  assert.equal(parsed.semester, 4);
  assert.equal(parsed.academicYear, '2023/2024');
  assert.equal(parsed.student.nim, '2022090011');
  assert.equal(parsed.student.name, 'Siti Aminah');
  assert.equal(parsed.summary.totalSks, 12);
  assert.equal(parsed.summary.ips, 3.63);
  assert.equal(parsed.summary.ipk, 3.7);
  assert.equal(parsed.courses.length, 4);

  assert.equal(parsed.courses[0].name, 'Sistem Basis Data');
  assert.equal(parsed.courses[0].sks, 3);
  assert.equal(parsed.courses[0].grade, 'A');
  assert.equal(parsed.courses[0].gradePoint, 4.0);

  assert.equal(parsed.courses[1].name, 'Rekayasa Perangkat Lunak');
  assert.equal(parsed.courses[1].sks, 3);
  assert.equal(parsed.courses[1].grade, 'B+');
  assert.equal(parsed.courses[1].gradePoint, 3.25);
});

test('B6A.3: KRS tanpa kode matkul (hanya nomor urut, nama, dan SKS)', () => {
  const text = `
    KARTU RENCANA STUDI (KRS)
    Semester 2
    Tahun Akademik: 2024/2025

    No | Nama Mata Kuliah | SKS
    1  | Kalkulus II | 3
    2  | Fisika Dasar II | 3
    3  | Bahasa Inggris Profesi | 2
    4  | Pendidikan Agama | 2
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.KRS);
  assert.equal(parsed.semester, 2);
  assert.equal(parsed.courses.length, 4);
  assert.equal(parsed.courses[0].code, null);
  assert.equal(parsed.courses[0].name, 'Kalkulus II');
  assert.equal(parsed.courses[0].sks, 3);
  assert.equal(parsed.courses[1].name, 'Fisika Dasar II');
  assert.equal(parsed.courses[1].sks, 3);
});

test('B6A.4: KHS dengan nilai ambigu ditandai needsReview tanpa menebak', () => {
  const text = `
    KARTU HASIL STUDI (KHS)
    Semester 3 (Ganjil 2023/2024)

    No | Kode | Mata Kuliah | SKS | Nilai
    1  | MK101 | Aljabar Linear | 3 | A
    2  | MK102 | Grafika Komputer | 3 | X
    3  | MK103 | Teori Komputasi | 3 | 8
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.courses.length, 3);
  // Matkul 1 valid
  assert.equal(parsed.courses[0].grade, 'A');
  assert.equal(parsed.courses[0].needsReview, false);

  // Matkul 2 nilai 'X' (bukan nilai resmi UniMate)
  assert.equal(parsed.courses[1].grade, 'X');
  assert.equal(parsed.courses[1].needsReview, true);
  assert.ok(parsed.courses[1].reviewReasons.includes('grade_unrecognized'));

  // Matkul 3 nilai '8' (artefak OCR)
  assert.equal(parsed.courses[2].grade, '8');
  assert.equal(parsed.courses[2].needsReview, true);
  assert.ok(parsed.courses[2].reviewReasons.includes('grade_unrecognized'));
});

test('B6A.5: Nama mata kuliah multi-baris tersambung dengan utuh', () => {
  const text = `
    KARTU RENCANA STUDI (KRS)
    Semester 5 (Ganjil 2024/2025)

    No | Kode | Mata Kuliah | SKS
    1  | IF301 | Perancangan dan
               | Pemrograman Berorientasi Objek | 4
    2  | IF302 | Etika Profesi dan Aspek
               | Legal Informatika | 2
    3  | IF303 | Kriptografi | 3
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.courses.length, 3);
  assert.equal(parsed.courses[0].name, 'Perancangan dan Pemrograman Berorientasi Objek');
  assert.equal(parsed.courses[0].sks, 4);
  assert.equal(parsed.courses[1].name, 'Etika Profesi dan Aspek Legal Informatika');
  assert.equal(parsed.courses[1].sks, 2);
  assert.equal(parsed.courses[2].name, 'Kriptografi');
  assert.equal(parsed.courses[2].sks, 3);
});

test('B6A.6: OCR dengan spasi tidak beraturan dan artefak karakter tetap diekstrak', () => {
  const text = `
    |  KARTU  HASIL   STUDI   (KHS)   |
    Semester    :   6  (Genap 2024/2025)

    | No | Kode    |   Mata Kuliah            |  SKS  | Nilai |
    | 1  | IF601   |   Kecerdasan   Buatan    |   3   |  A    |
    | 2  | IF602   |   Pembelajaran Mesin     |   3   |  B+   |
    | 3  | IF603   |   Sistem Terdistribusi   |   4   |  AB   |
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.semester, 6);
  assert.equal(parsed.courses.length, 3);
  assert.equal(parsed.courses[0].name, 'Kecerdasan Buatan');
  assert.equal(parsed.courses[0].sks, 3);
  assert.equal(parsed.courses[0].grade, 'A');
  assert.equal(parsed.courses[1].name, 'Pembelajaran Mesin');
  assert.equal(parsed.courses[1].grade, 'B+');
});

test('B6A.7: Membedakan mata kuliah dengan nama mirip tanpa saling timpa', () => {
  const text = `
    TRANSKRIP KHS
    1 | MAT101 | Matematika I | 3 | A
    2 | MAT102 | Matematika II | 3 | B+
    3 | MAT103 | Matematika Diskrit | 3 | A
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.courses.length, 3);
  assert.equal(parsed.courses[0].name, 'Matematika I');
  assert.equal(parsed.courses[1].name, 'Matematika II');
  assert.equal(parsed.courses[2].name, 'Matematika Diskrit');
});

test('B6A.8: SKS tidak valid (angka di luar rentang 1-12) ditandai needsReview', () => {
  const text = `
    KARTU RENCANA STUDI
    Semester 1
    1 | MK01 | Pengantar TI | 0
    2 | MK02 | Algoritma | 25
  `;

  const parsed = parseAcademicDocumentText(text);
  assert.equal(parsed.courses.length, 2);
  assert.equal(parsed.courses[0].sks, null);
  assert.equal(parsed.courses[0].needsReview, true);
  assert.ok(parsed.courses[0].reviewReasons.includes('invalid_sks'));

  assert.equal(parsed.courses[1].sks, null);
  assert.equal(parsed.courses[1].needsReview, true);
  assert.ok(parsed.courses[1].reviewReasons.includes('invalid_sks'));
});

test('B6A.9: Dokumen yang bukan KRS/KHS diklasifikasikan unknown tanpa mengarang data', () => {
  const nonAcademicText = `
    RESEP MEMBUAT NASI GORENG SPESIAL
    Bahan-bahan:
    - 2 piring nasi putih
    - 3 siung bawang merah
    - 2 siung bawang putih
    - 1 butir telur ayam
    - Kecap manis secukupnya

    Langkah memasak:
    1. Panaskan minyak di wajan.
    2. Tumis bawang hingga harum.
    3. Masukkan telur dan nasi.
  `;

  const parsed = parseAcademicDocumentText(nonAcademicText);
  assert.equal(parsed.isAcademicDocument, false);
  assert.equal(parsed.documentType, ACADEMIC_DOCUMENT_TYPES.UNKNOWN);
  assert.equal(parsed.semester, null);
  assert.equal(parsed.courses.length, 0);
  assert.equal(parsed.summary.ips, null);
});

test('B6A.10: Teks kosong, null, atau whitespace ditangani secara aman', () => {
  const empty1 = parseAcademicDocumentText('');
  assert.equal(empty1.isAcademicDocument, false);
  assert.equal(empty1.courses.length, 0);

  const empty2 = parseAcademicDocumentText('   \n\t  \r\n   ');
  assert.equal(empty2.isAcademicDocument, false);
  assert.equal(empty2.courses.length, 0);

  const empty3 = parseAcademicDocumentText(null);
  assert.equal(empty3.isAcademicDocument, false);
  assert.equal(empty3.courses.length, 0);
});

test('B6A.11: Teks panjang (> 20.000 karakter) diproses utuh tanpa batas preview', () => {
  // Bentuk teks panjang dengan 50 mata kuliah sintetis
  const header = `KARTU HASIL STUDI (KHS)\nSemester 1\nNo | Kode | Mata Kuliah | SKS | Nilai\n`;
  const courseLines = [];
  for (let i = 1; i <= 60; i++) {
    courseLines.push(`${i} | CS${String(i).padStart(3, '0')} | Mata Kuliah Uji Skala Besar Nomor Urut ${i} | 3 | A`);
  }
  // Tambah narasi pelengkap panjang
  const filler = 'Dokumen catatan akademik mahasiswa universitas negeri terakreditasi unggul. '.repeat(250);
  const longText = `${header}${courseLines.join('\n')}\n${filler}`;

  assert.ok(longText.length > 20000);
  const parsed = parseAcademicDocumentText(longText);
  assert.equal(parsed.isAcademicDocument, true);
  assert.equal(parsed.courses.length, 60);
  assert.equal(parsed.courses[59].code, 'CS060');
});

test('B6A.12: Ketiadaan field tidak memicu pembuatan data fiktif', () => {
  const minimalText = `
    KRS MAHASISWA
    1 | MK01 | Analisis Algoritma | 3
  `;

  const parsed = parseAcademicDocumentText(minimalText);
  assert.equal(parsed.semester, null); // Tidak ada semester
  assert.equal(parsed.academicYear, null); // Tidak ada tahun
  assert.equal(parsed.student.nim, null); // Tidak ada NIM
  assert.equal(parsed.student.name, null); // Tidak ada nama
  assert.equal(parsed.summary.ips, null); // Tidak ada IPS
  assert.equal(parsed.courses[0].grade, null); // KRS tidak memuat nilai
});

test('B6A.13: Parser bersifat pure function tanpa mutasi storage', () => {
  // Pastikan global storage tidak tersentuh
  const originalLocalStorage = globalThis.localStorage;
  let touchedStorage = false;
  globalThis.localStorage = {
    setItem() { touchedStorage = true; },
    removeItem() { touchedStorage = true; },
  };

  try {
    parseAcademicDocumentText('KRS\n1 | IF101 | Dasar Pemrograman | 3');
    assert.equal(touchedStorage, false, 'Parser dilarang memanggil localStorage');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('B6A.14: Tidak ada request jaringan atau ketergantungan API AI', () => {
  const originalFetch = globalThis.fetch;
  let fetchAttempted = false;
  globalThis.fetch = async () => {
    fetchAttempted = true;
    throw new Error('Jaringan eksternal dilarang');
  };

  try {
    parseAcademicDocumentText('KHS\n1 | IF101 | Basis Data | 3 | A');
    assert.equal(fetchAttempted, false, 'Parser dilarang memanggil fetch');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('B6A.15: Kompatibilitas skema toCandidateExtractedData dengan DOCUMENT_SCAN dan merge plan', () => {
  const khsText = `
    KARTU HASIL STUDI (KHS)
    Semester 5 (Ganjil 2024/2025)
    1 | IF501 | Keamanan Informasi | 3 | A
    2 | IF502 | Kecerdasan Komputasional | 3 | B+
    Indeks Prestasi Semester (IPS) : 3.80
  `;

  const parsed = parseAcademicDocumentText(khsText);
  const candidate = toCandidateExtractedData(parsed);

  // 1. Validasi capability DOCUMENT_SCAN
  const fullResult = {
    description: 'Deskripsi kandidat data KHS',
    direction: 'khs',
    extracted_data: candidate,
  };
  const validation = validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, fullResult);
  assert.equal(validation.valid, true, `Hasil tidak lolos validasi kontrak AI: ${JSON.stringify(validation.errors)}`);

  // 2. Validasi dapat langsung diproses oleh createCourseMergePlan
  const existingCourses = [
    { id: 'c-old', name: 'Keamanan Informasi', sks: 3, grade: null },
  ];
  const mergePlan = createCourseMergePlan(existingCourses, candidate.courses);
  assert.equal(mergePlan.summary.updates, 1); // Melengkapi grade 'A' pada Keamanan Informasi
  assert.equal(mergePlan.summary.additions, 1); // Menambahkan Kecerdasan Komputasional
});

test('B6A.16: Perilaku resolveDocumentText menghormati editedText kosong vs null', () => {
  // Kasus 1: editedText === "" (pengguna sengaja mengosongkan teks) -> HARUS TETAP KOSONG
  const emptyEdited = {
    rawText: 'KRS LAMA YANG ADA ISINYA',
    editedText: '',
  };
  assert.equal(resolveDocumentText(emptyEdited), '');
  const parsedEmpty = parseAcademicDocumentText(emptyEdited);
  assert.equal(parsedEmpty.courses.length, 0);

  // Kasus 2: editedText === null (pengguna belum mengedit) -> FALLBACK KE rawText
  const unedited = {
    rawText: 'KRS\n1 | IF101 | Struktur Data | 3',
    editedText: null,
  };
  assert.equal(resolveDocumentText(unedited), unedited.rawText);
  const parsedUnedited = parseAcademicDocumentText(unedited);
  assert.equal(parsedUnedited.courses.length, 1);

  // Kasus 3: editedText ada isinya hasil koreksi -> GUNAKAN editedText
  const userEdited = {
    rawText: 'KRS\n1 | IF101 | Struktur Data | 3',
    editedText: 'KRS\n1 | IF101 | Struktur Data Terkoreksi | 4',
  };
  assert.equal(resolveDocumentText(userEdited), userEdited.editedText);
  const parsedEdited = parseAcademicDocumentText(userEdited);
  assert.equal(parsedEdited.courses[0].name, 'Struktur Data Terkoreksi');
  assert.equal(parsedEdited.courses[0].sks, 4);
});

test('B6A.17: Integrasi Offline Scanner memetakan file teks KRS menjadi kandidat terstruktur', async () => {
  const krsContent = `
    KARTU RENCANA STUDI (KRS)
    Semester 3 (Ganjil 2024/2025)
    1 | CS301 | Arsitektur Komputer | 3
    2 | CS302 | Desain Algoritma | 4
  `;
  const file = new File([krsContent], 'krs-sintetis.txt', { type: 'text/plain' });
  const review = await processOfflineScannerFile(file);

  assert.equal(review.source, 'offline');
  assert.equal(review.parser, 'text');
  assert.equal(review.structured, true);
  assert.equal(review.direction, 'khs');
  assert.equal(review.suggestion.extracted_data.courses.length, 2);
  assert.equal(review.suggestion.extracted_data.courses[0].name, 'Arsitektur Komputer');
  assert.equal(review.suggestion.extracted_data.courses[0].sks, 3);
  assert.equal(review.suggestion.extracted_data.courses[1].name, 'Desain Algoritma');
  assert.equal(review.suggestion.extracted_data.courses[1].sks, 4);
});

test('B6A.18: Integrasi Offline Scanner memetakan file teks KHS dengan nilai dan IPS', async () => {
  const khsContent = `
    KARTU HASIL STUDI (KHS)
    Semester 2 (Genap 2023/2024)
    1 | MK201 | Matematika Diskrit | 3 | A | 4.00
    2 | MK202 | Organisasi Komputer | 3 | B+ | 3.25
    Indeks Prestasi Semester (IPS) : 3.75
  `;
  const file = new File([khsContent], 'khs-sintetis.txt', { type: 'text/plain' });
  const review = await processOfflineScannerFile(file);

  assert.equal(review.source, 'offline');
  assert.equal(review.structured, true);
  assert.equal(review.direction, 'khs');
  assert.equal(review.suggestion.extracted_data.courses.length, 2);
  assert.equal(review.suggestion.extracted_data.courses[0].grade, 'A');
  assert.equal(review.suggestion.extracted_data.gpa, '3.75');
});
