/**
 * Offline Academic Document Parser for UniMate.
 * 
 * Mengekstrak informasi akademik (KRS, KHS, Semester, Mata Kuliah, SKS, Nilai, IPS)
 * dari teks mentah OCR secara 100% OFFLINE dan deterministik.
 * Tidak ada request jaringan, tidak ada dependensi AI eksternal, dan tidak mengarang data.
 */

export const ACADEMIC_DOCUMENT_TYPES = Object.freeze({
  KRS: 'KRS',
  KHS: 'KHS',
  UNKNOWN: 'unknown',
});

export const VALID_LETTER_GRADES = Object.freeze(new Set([
  'A', 'A-', 'A/B', 'AB', 'B+', 'B', 'B-', 'B/C', 'BC', 'C+', 'C', 'C-', 'C/D', 'CD', 'D+', 'D', 'E',
]));

export const STANDARD_GRADE_POINTS = Object.freeze({
  'A': 4.0,
  'A-': 3.75,
  'A/B': 3.5,
  'AB': 3.5,
  'B+': 3.25,
  'B': 3.0,
  'B-': 2.75,
  'B/C': 2.5,
  'BC': 2.5,
  'C+': 2.25,
  'C': 2.0,
  'C-': 1.75,
  'C/D': 1.5,
  'CD': 1.5,
  'D+': 1.25,
  'D': 1.0,
  'E': 0.0,
});

const ROMAN_NUMERALS = Object.freeze({
  'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
  'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
  'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14,
});

const CODE_PATTERN = /^[A-Za-z]{2,5}[- ]?\d{2,6}[A-Za-z]?$/;

export const STANDARD_DAYS = Object.freeze([
  'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu',
]);

const DAY_NORMALIZATION_MAP = Object.freeze({
  'senin': 'Senin', 'sen': 'Senin',
  'selasa': 'Selasa', 'sel': 'Selasa',
  'rabu': 'Rabu', 'rab': 'Rabu',
  'kamis': 'Kamis', 'kam': 'Kamis',
  'jumat': 'Jumat', "jum'at": 'Jumat', 'jum': 'Jumat',
  'sabtu': 'Sabtu', 'sab': 'Sabtu',
  'minggu': 'Minggu', 'min': 'Minggu', 'mgu': 'Minggu',
});

/**
 * Normalisasi variasi penulisan hari (termasuk singkatan Sen, Sel, Rab, Kam, Jum, Sab, Min)
 * ke salah satu dari STANDARD_DAYS.
 */
export function normalizeScheduleDay(dayStr) {
  if (!dayStr || typeof dayStr !== 'string') return null;
  const cleaned = dayStr.trim().toLowerCase().replace(/[^a-z']/g, '');
  return DAY_NORMALIZATION_MAP[cleaned] || null;
}

/**
 * Ekstraksi rentang waktu jam kuliah (misal 07.00-08.40, 07:00 - 08:40, 07.00 s/d 08.40)
 * dan normalisasi ke format standar "HH:mm".
 */
export function parseScheduleTimeRange(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.trim();
  const match = cleaned.match(/(\d{1,2})[.:](\d{2})\s*(?:-|–|—|s[./]?d\.?|sd|sampai)\s*(\d{1,2})[.:](\d{2})/i);
  if (!match) return null;

  const h1 = Number.parseInt(match[1], 10);
  const m1 = Number.parseInt(match[2], 10);
  const h2 = Number.parseInt(match[3], 10);
  const m2 = Number.parseInt(match[4], 10);

  if (h1 < 0 || h1 > 23 || m1 < 0 || m1 > 59 || h2 < 0 || h2 > 23 || m2 < 0 || m2 > 59) {
    return null;
  }

  const startMinutes = h1 * 60 + m1;
  const endMinutes = h2 * 60 + m2;
  if (endMinutes <= startMinutes) {
    return null;
  }

  const timeStart = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
  const timeEnd = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;

  return { timeStart, timeEnd };
}

/**
 * Mendeteksi bentrok jadwal kuliah antarpertemuan (beririsan pada hari yang sama).
 *
 * @param {Array<Object>} courses - Daftar mata kuliah / kandidat
 * @returns {Array<Object>} clashes - Daftar bentrok terdeteksi
 */
export function detectScheduleClashes(courses = []) {
  const clashes = [];
  if (!Array.isArray(courses) || courses.length < 2) return clashes;

  const slots = [];
  courses.forEach((course, courseIdx) => {
    if (!course || typeof course !== 'object') return;
    const courseName = course.name || `Mata Kuliah #${courseIdx + 1}`;
    const courseId = course.id || `course-${courseIdx}`;
    const courseCode = course.code || '';

    if (course.day && course.timeStart && course.timeEnd) {
      slots.push({
        courseId,
        courseName,
        courseCode,
        day: course.day,
        timeStart: course.timeStart,
        timeEnd: course.timeEnd,
        room: course.room || '',
        sessionLabel: 'Sesi Utama',
      });
    }

    if (Array.isArray(course.schedules)) {
      course.schedules.forEach((sub, subIdx) => {
        if (sub && sub.day && sub.timeStart && sub.timeEnd) {
          if (sub.day === course.day && sub.timeStart === course.timeStart && sub.timeEnd === course.timeEnd) {
            return;
          }
          slots.push({
            courseId,
            courseName,
            courseCode,
            day: sub.day,
            timeStart: sub.timeStart,
            timeEnd: sub.timeEnd,
            room: sub.room || '',
            sessionLabel: `Sesi #${subIdx + 2}`,
          });
        }
      });
    }
  });

  const timeToMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const slotA = slots[i];
      const slotB = slots[j];

      if (slotA.courseId === slotB.courseId) continue;
      if (slotA.day.toLowerCase() !== slotB.day.toLowerCase()) continue;

      const startA = timeToMinutes(slotA.timeStart);
      const endA = timeToMinutes(slotA.timeEnd);
      const startB = timeToMinutes(slotB.timeStart);
      const endB = timeToMinutes(slotB.timeEnd);

      if (startA < endB && startB < endA) {
        clashes.push({
          courseA: { id: slotA.courseId, name: slotA.courseName, code: slotA.courseCode, session: slotA.sessionLabel },
          courseB: { id: slotB.courseId, name: slotB.courseName, code: slotB.courseCode, session: slotB.sessionLabel },
          day: slotA.day,
          timeA: `${slotA.timeStart} - ${slotA.timeEnd}`,
          timeB: `${slotB.timeStart} - ${slotB.timeEnd}`,
          roomA: slotA.room,
          roomB: slotB.room,
          message: `Bentrok jadwal pada hari ${slotA.day}: "${slotA.courseName}" (${slotA.timeStart}-${slotA.timeEnd}) beririsan dengan "${slotB.courseName}" (${slotB.timeStart}-${slotB.timeEnd}).`,
        });
      }
    }
  }

  return clashes;
}

/**
 * Menyelesaikan input teks dokumen dengan menghormati koreksi pengguna:
 * - Jika editedText !== null dan !== undefined, gunakan editedText (termasuk string kosong "").
 * - Fallback ke rawText HANYA jika editedText === null atau undefined.
 */
export function resolveDocumentText(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    if (input.editedText !== null && input.editedText !== undefined) {
      return String(input.editedText);
    }
    if (input.rawText !== null && input.rawText !== undefined) {
      return String(input.rawText);
    }
  }
  return '';
}

function parseRomanNumeral(val) {
  if (!val) return null;
  const upper = String(val).trim().toUpperCase();
  return ROMAN_NUMERALS[upper] ?? null;
}

function normalizeDecimal(val) {
  if (!val) return null;
  const cleaned = String(val).trim().replace(',', '.');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) && num >= 0 && num <= 4.0 ? num : null;
}

function parseAnyDecimal(val) {
  if (!val) return null;
  const cleaned = String(val).trim().replace(',', '.');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function isHeaderLine(line) {
  const normalized = line.toLowerCase().replace(/[\s|_|-]+/g, ' ');
  return (
    (normalized.includes('mata kuliah') || normalized.includes('nama mk') || normalized.includes('matakuliah'))
    && (normalized.includes('sks') || normalized.includes('kredit'))
  );
}

function inspectTableHeaders(rawLine) {
  if (!rawLine || !rawLine.includes('|')) return null;
  const cells = rawLine.split('|').map(c => c.trim().toLowerCase());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();

  const gradeIdx = cells.findIndex(c =>
    c.includes('nilai') || c === 'nh' || c === 'huruf' || c === 'grade'
  );
  if (gradeIdx < 0) return null;

  const trailingHeaders = cells.slice(gradeIdx + 1);
  const hasBobotColumn = trailingHeaders.some(h =>
    (h.includes('bobot') || h === 'am' || h.includes('angka mutu') || h === 'na') && !h.includes('sks') && !h.includes('*')
  );
  const hasMutuColumn = trailingHeaders.some(h =>
    h.includes('mutu') || h.includes('sksn') || h.includes('kn') || h.includes('*') || h.includes('sks x')
  );
  const hasMutuOnly = hasMutuColumn && !hasBobotColumn;

  return {
    trailingHeaders,
    hasBobotColumn,
    hasMutuColumn,
    hasMutuOnly,
  };
}

function isFooterLine(line) {
  const normalized = line.toLowerCase();
  return (
    normalized.includes('total sks')
    || normalized.includes('jumlah sks')
    || normalized.includes('indeks prestasi')
    || normalized.includes('sks diambil')
    || normalized.includes('sks lulus')
    || normalized.includes('tanda tangan')
    || normalized.includes('dosen pembimbing')
    || normalized.includes('ketua jurusan')
  );
}

function isNonTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // Baris metadata berlabel dengan titik dua (kecuali jika ada pipe table atau titik dua adalah bagian dari jam perkuliahan)
  if (trimmed.includes(':') && !trimmed.includes('|')) {
    const strippedTimes = trimmed.replace(/\b\d{1,2}:\d{2}\b/g, '');
    if (strippedTimes.includes(':')) {
      return true;
    }
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('semester ')
    || lower.startsWith('smt ')
    || lower.startsWith('kementerian')
    || lower.startsWith('universitas')
    || lower.startsWith('fakultas')
    || lower.startsWith('jurusan')
    || lower.startsWith('program studi')
    || lower.startsWith('resep ')
    || lower.startsWith('bahan-')
    || lower.startsWith('langkah ')
    || lower.startsWith('kartu rencana')
    || lower.startsWith('kartu hasil')
  ) {
    return true;
  }
  return false;
}

/**
 * Deteksi jenis dokumen (KRS, KHS, atau UNKNOWN) berdasarkan teks.
 */
function detectDocumentType(text, lines) {
  const lower = text.toLowerCase();

  const hasKhsKeywords = (
    lower.includes('kartu hasil studi')
    || /\bkhs\b/i.test(text)
    || lower.includes('transkrip nilai')
    || lower.includes('daftar hasil studi')
    || lower.includes('laporan kemajuan studi')
  );

  const hasKrsKeywords = (
    lower.includes('kartu rencana studi')
    || /\bkrs\b/i.test(text)
    || lower.includes('rencana studi')
    || lower.includes('formulir rencana studi')
    || lower.includes('study plan')
  );

  let hasGradeColumns = false;
  for (const line of lines.slice(0, 30)) {
    const l = line.toLowerCase();
    if (
      (l.includes('nilai') || l.includes('grade') || l.includes('mutu') || l.includes('bobot') || l.includes('ips'))
      && (l.includes('sks') || l.includes('mata kuliah') || l.includes('matakuliah'))
    ) {
      hasGradeColumns = true;
      break;
    }
  }

  if (hasKhsKeywords && !hasKrsKeywords) return ACADEMIC_DOCUMENT_TYPES.KHS;
  if (hasKrsKeywords && !hasKhsKeywords && !hasGradeColumns) return ACADEMIC_DOCUMENT_TYPES.KRS;
  if (hasGradeColumns) return ACADEMIC_DOCUMENT_TYPES.KHS;
  if (hasKrsKeywords) return ACADEMIC_DOCUMENT_TYPES.KRS;

  return ACADEMIC_DOCUMENT_TYPES.UNKNOWN;
}

/**
 * Ekstraksi semester dan tahun akademik.
 */
function extractSemesterInfo(text) {
  let semesterNum = null;
  let term = null;
  let academicYear = null;

  // 1. Tahun Akademik (misal 2024/2025 atau 2024-2025)
  const yearMatch = text.match(/(?:tahun\s*(?:akademik|ajaran)|thn\s*akademik|t\.?a\.?)\s*[:.\s]?\s*(\d{4}\s*[/-]\s*\d{4})/i)
    || text.match(/\b(\d{4}\s*[/-]\s*\d{4})\b/);
  if (yearMatch) {
    academicYear = yearMatch[1].replace(/\s+/g, '').replace('-', '/');
  }

  // 2. Term (Ganjil / Genap / Gasal)
  if (/\b(?:ganjil|gasal)\b/i.test(text)) {
    term = 'Ganjil';
  } else if (/\bgenap\b/i.test(text)) {
    term = 'Genap';
  }

  // 3. Semester angka atau romawi
  const semMatches = text.matchAll(/(?:semester|smt|smtr)\s*[:.\s]?\s*(\d{1,2}|[IVXLCDM]+)\b/gi);
  for (const match of semMatches) {
    const parsedInt = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsedInt) && parsedInt >= 1 && parsedInt <= 14) {
      semesterNum = parsedInt;
      break;
    }
    const roman = parseRomanNumeral(match[1]);
    if (roman !== null) {
      semesterNum = roman;
      break;
    }
  }

  let semesterName = null;
  if (semesterNum !== null) {
    const parts = [`Semester ${semesterNum}`];
    const subParts = [];
    if (term) subParts.push(term);
    if (academicYear) subParts.push(academicYear);
    if (subParts.length > 0) parts.push(`(${subParts.join(' ')})`);
    semesterName = parts.join(' ');
  } else if (term || academicYear) {
    const subParts = [];
    if (term) subParts.push(term);
    if (academicYear) subParts.push(academicYear);
    semesterName = `Semester (${subParts.join(' ')})`;
  }

  return {
    number: semesterNum,
    term,
    academicYear,
    semesterName,
  };
}

/**
 * Ekstraksi informasi mahasiswa (NIM & Nama).
 */
function extractStudentInfo(text) {
  let nim = null;
  let name = null;

  const nimMatch = text.match(/(?:nim|npm|nrp|no\.?\s*induk)\s*[:.\s]?\s*([0-9A-Za-z/.-]{6,24})/i);
  if (nimMatch) {
    nim = nimMatch[1].trim();
  }

  const nameMatch = text.match(/(?:nama|nama\s*mahasiswa|mhs)\s*[:.\s]?\s*([A-Za-z\s'.,-]{3,60})(?:\n|$|\r)/i);
  if (nameMatch) {
    const raw = nameMatch[1].trim();
    const cleaned = raw.replace(/\b(fakultas|jurusan|program\s*studi|prodi|nim|npm)\b.*$/i, '').trim();
    if (cleaned.length >= 3 && !/^(mahasiswa|lengkap)$/i.test(cleaned)) {
      name = cleaned;
    }
  }

  return { nim, name };
}

/**
 * Ekstraksi ringkasan KHS (Total SKS, IPS, IPK).
 */
function extractSummary(text) {
  let totalSks = null;
  let ips = null;
  let ipk = null;

  const sksMatch = text.match(/(?:total|jumlah|jml)\s*(?:sks|kredit)\s*(?:diambil|tempuh|semester|rencana)?\s*[:.\s]?\s*(\d{1,2})/i);
  if (sksMatch) {
    const val = Number.parseInt(sksMatch[1], 10);
    if (Number.isFinite(val) && val >= 1 && val <= 40) {
      totalSks = val;
    }
  }

  const ipsMatch = text.match(/(?:indeks\s*prestasi\s*semester(?:\s*\(ips\))?|ips|ip\s*semester)\s*[:.\s]?\s*([0-4][.,]\d{1,2})/i);
  if (ipsMatch) {
    ips = normalizeDecimal(ipsMatch[1]);
  }

  const ipkMatch = text.match(/(?:indeks\s*prestasi\s*kumulatif(?:\s*\(ipk\))?|ipk|ip\s*kumulatif)\s*[:.\s]?\s*([0-4][.,]\d{1,2})/i);
  if (ipkMatch) {
    ipk = normalizeDecimal(ipkMatch[1]);
  }

  return { totalSks, ips, ipk };
}

/**
 * Parsing baris berformat pipe table: | 1 | IF101 | Pemrograman Dasar | 3 | A |
 */
function parsePipeTableRow(cells, isKhs, rawLine, headerContext = null) {
  if (cells.length < 2) return null;

  // Cek apakah sel pertama adalah nomor urut
  let idx = 0;
  let rowNo = null;
  if (/^\d{1,2}$/.test(cells[0])) {
    rowNo = Number.parseInt(cells[0], 10);
    idx = 1;
  }

  if (idx >= cells.length) return null;

  // Cek apakah sel berikutnya adalah kode mata kuliah
  let code = null;
  if (CODE_PATTERN.test(cells[idx])) {
    code = cells[idx];
    idx++;
  }

  if (idx >= cells.length) return null;

  // Nama mata kuliah
  let name = cells[idx].replace(/\s+/g, ' ').trim();
  idx++;

  if (idx >= cells.length) {
    // Incomplete row (multi-line start)
    return {
      incomplete: true,
      rowNo,
      code,
      name,
      rawLine,
    };
  }

  // SKS
  const sksRaw = cells[idx];
  idx++;

  const parsedSks = Number.parseInt(sksRaw, 10);
  const reviewReasons = [];
  let sks = parsedSks;
  if (Number.isNaN(parsedSks) || parsedSks < 1 || parsedSks > 12) {
    reviewReasons.push('invalid_sks');
    sks = null;
  }

  let grade = null;
  let gradePoint = null;
  let day = null;

  if (idx < cells.length) {
    if (isKhs) {
      grade = cells[idx].toUpperCase();
      idx++;

      // KHS cells dapat memuat beberapa kolom numerik:
      // contoh: Bobot (AM, 0.0 - 4.0) dan/atau Mutu (SKSN / KN, SKS * AM)
      const trailingNumbers = [];
      while (idx < cells.length) {
        const parsed = parseAnyDecimal(cells[idx]);
        if (parsed !== null) {
          trailingNumbers.push(parsed);
        }
        idx++;
      }

      if (trailingNumbers.length === 1) {
        const num = trailingNumbers[0];
        const expectedGp = STANDARD_GRADE_POINTS[grade];
        const isHeaderMutuOnly = headerContext && headerContext.hasMutuOnly;

        if (num > 4.0 || isHeaderMutuOnly) {
          // Angka melebihi 4.0 atau kolom secara eksplisit bertajuk Mutu / SKSN / KN (tanpa kolom Bobot)
          gradePoint = null;
          reviewReasons.push('ambiguous_grade_point_or_total_mutu');
        } else if (sks !== null && sks > 1 && expectedGp !== undefined) {
          // Deteksi angka mutu total yang kebetulan berada di rentang 0-4
          // Misal: 2 SKS * Nilai D (1.0) = 2.0 (num === 2.0)
          // Misal: 2 SKS * Nilai C (2.0) = 4.0 (num === 4.0)
          // Misal: 3 SKS * Nilai D (1.0) = 3.0 (num === 3.0)
          // Misal: 4 SKS * Nilai D (1.0) = 4.0 (num === 4.0)
          const isProductOfSks = Math.abs(num - (sks * expectedGp)) < 0.05 && Math.abs(num - expectedGp) >= 0.05;
          const isStandardGpMatch = Math.abs(num - expectedGp) < 0.05;

          if (isProductOfSks) {
            // Angka terbukti hasil kali SKS * Bobot (Mutu Total), bukan gradePoint per SKS!
            gradePoint = null;
            reviewReasons.push('ambiguous_grade_point_or_total_mutu');
          } else if (isStandardGpMatch) {
            // Angka cocok persis dengan bobot standar per SKS untuk grade tersebut
            gradePoint = num;
          } else {
            // Nilai tidak cocok dengan bobot standar dan tidak jelas asal angkanya: tandai ambigu
            gradePoint = null;
            reviewReasons.push('ambiguous_grade_point_or_total_mutu');
          }
        } else if (sks !== null && sks > 1 && num === 4.0 && !['A', 'A+'].includes(grade)) {
          gradePoint = null;
          reviewReasons.push('ambiguous_grade_point_or_total_mutu');
        } else if (headerContext && !headerContext.hasBobotColumn && !['A', 'B', 'C', 'D', 'E'].includes(grade)) {
          gradePoint = null;
          reviewReasons.push('ambiguous_grade_point_or_total_mutu');
        } else {
          gradePoint = num;
        }
      } else if (trailingNumbers.length >= 2) {
        // Terdapat 2 angka atau lebih (misal: Bobot dan Mutu total)
        const num1 = trailingNumbers[0];
        const num2 = trailingNumbers[1];

        if (num1 <= 4.0 && (num2 > 4.0 || (sks !== null && Math.abs(sks * num1 - num2) < 0.05))) {
          gradePoint = num1;
        } else if (num2 <= 4.0 && num1 > 4.0) {
          gradePoint = num2;
        } else if (num1 <= 4.0 && num2 <= 4.0) {
          if (sks === 1 && Math.abs(num1 - num2) < 0.05) {
            gradePoint = num1;
          } else if (sks !== null && sks > 1 && Math.abs(sks * Math.min(num1, num2) - Math.max(num1, num2)) < 0.05) {
            gradePoint = Math.min(num1, num2);
          } else {
            gradePoint = null;
            reviewReasons.push('ambiguous_grade_point_or_total_mutu');
          }
        } else {
          gradePoint = null;
          reviewReasons.push('ambiguous_grade_point_or_total_mutu');
        }
      }

      if (!VALID_LETTER_GRADES.has(grade)) {
        reviewReasons.push('grade_unrecognized');
      }
      // Bobot nilai (gradePoint) hanya diisi jika benar-benar terbukti sebagai bobot per SKS (0.0-4.0).
      // Mutu total (SKS * bobot) dilarang disimpan sebagai gradePoint.
      return {
        incomplete: false,
        rowNo,
        code,
        name,
        sks,
        grade,
        gradePoint,
        point: gradePoint,
        class: null,
        day,
        timeStart: null,
        timeEnd: null,
        room: null,
        lecturer: null,
        mode: null,
        schedules: [],
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        rawLine,
      };
    } else {
      // Pada KRS, baris dapat memuat: Kelas, Hari, Jam, Ruang, Dosen, atau Multi-sesi
      const schedules = [];
      let parsedClass = null;
      let parsedDay = null;
      let parsedTime = null;
      let parsedRoom = null;
      let parsedLecturer = null;

      const remainingCells = cells.slice(idx);
      for (const cell of remainingCells) {
        const trimmed = cell.trim();
        if (!trimmed) continue;

        // Cek multi-sesi dalam satu sel (misal: "Senin 08:00-09:40 R.101 / Rabu 10:00-11:40 Lab 1")
        if (trimmed.includes('/') || trimmed.includes(';') || trimmed.includes('\n')) {
          const parts = trimmed.split(/[/;\n]+/).map(p => p.trim()).filter(Boolean);
          let foundMulti = false;
          for (const part of parts) {
            const partDay = part.split(/\s+/).map(normalizeScheduleDay).find(Boolean);
            const partTime = parseScheduleTimeRange(part);
            if (partDay && partTime) {
              foundMulti = true;
              let partRoom = null;
              const words = part.split(/\s+/);
              const roomIdx = words.findIndex(w => /^(?:r\.|ruang|lab|gk|gd|gedung)\b/i.test(w) || /^[A-Z]\.?[0-9-]{2,6}$/i.test(w));
              if (roomIdx >= 0) {
                partRoom = words.slice(roomIdx).join(' ');
              }
              schedules.push({
                day: partDay,
                timeStart: partTime.timeStart,
                timeEnd: partTime.timeEnd,
                room: partRoom,
                lecturer: null,
                mode: null,
              });
            }
          }
          if (foundMulti) continue;
        }

        // Cek Hari
        const dayMatch = normalizeScheduleDay(trimmed);
        if (dayMatch && !parsedDay) {
          parsedDay = dayMatch;
          continue;
        }

        // Cek Rentang Waktu (Jam Mulai - Jam Selesai)
        const timeMatch = parseScheduleTimeRange(trimmed);
        if (timeMatch && !parsedTime) {
          parsedTime = timeMatch;
          continue;
        }

        // Cek Ruangan
        if (/^(?:r\.|ruang|lab|gk|gd|gedung)\b/i.test(trimmed) || /^[A-Z]\.?[0-9-]{2,6}$/i.test(trimmed)) {
          if (!parsedRoom) {
            parsedRoom = trimmed;
            continue;
          }
        }

        // Cek Dosen (nama bergelar atau nama pengajar di kolom)
        if (/(?:dr\.|prof\.|ir\.|drs\.|dra\.|m\.kom|s\.kom|m\.t\.|ph\.d|m\.sc)/i.test(trimmed) || (trimmed.includes(' ') && trimmed.length > 8 && !parsedLecturer)) {
          if (!parsedLecturer && !normalizeScheduleDay(trimmed) && !parseScheduleTimeRange(trimmed)) {
            parsedLecturer = trimmed;
            continue;
          }
        }

        // Cek Kelas (misal "A", "B", "C", "IF-4A", "01", dsb - PENTING: BUKAN NILAI KHS!)
        if (/^(?:kls|kelas\s*)?([A-Za-z0-9-]{1,6})$/i.test(trimmed) && !parsedClass && !normalizeScheduleDay(trimmed)) {
          const matchClass = trimmed.match(/^(?:kls|kelas\s*)?([A-Za-z0-9-]{1,6})$/i);
          parsedClass = matchClass ? matchClass[1].toUpperCase() : trimmed.toUpperCase();
          continue;
        }

        // Fallback untuk sel teks lain
        if (!parsedRoom && trimmed.length <= 15 && !/^\d+$/.test(trimmed)) {
          parsedRoom = trimmed;
        } else if (!parsedLecturer && trimmed.length > 3) {
          parsedLecturer = trimmed;
        }
      }

      if (parsedDay || parsedTime) {
        const primarySession = {
          day: parsedDay || null,
          timeStart: parsedTime?.timeStart || null,
          timeEnd: parsedTime?.timeEnd || null,
          room: parsedRoom || null,
          lecturer: parsedLecturer || null,
          mode: null,
        };
        if (schedules.length === 0) {
          schedules.push(primarySession);
        } else if (parsedDay && parsedTime && !schedules.some(s => s.day === parsedDay && s.timeStart === parsedTime.timeStart)) {
          schedules.unshift(primarySession);
        }
      }

      const activeSession = schedules[0] || null;

      return {
        incomplete: false,
        rowNo,
        code,
        name,
        sks,
        grade: null, // KRS tidak memiliki nilai huruf KHS!
        gradePoint: null,
        point: null,
        class: parsedClass,
        day: activeSession?.day || parsedDay || null,
        timeStart: activeSession?.timeStart || parsedTime?.timeStart || null,
        timeEnd: activeSession?.timeEnd || parsedTime?.timeEnd || null,
        room: activeSession?.room || parsedRoom || null,
        lecturer: activeSession?.lecturer || parsedLecturer || null,
        mode: null,
        schedules: schedules.length > 0 ? schedules : [],
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        rawLine,
      };
    }
  }

  return {
    incomplete: false,
    rowNo,
    code,
    name,
    sks,
    grade,
    gradePoint,
    point: gradePoint,
    class: null,
    day,
    timeStart: null,
    timeEnd: null,
    room: null,
    lecturer: null,
    mode: null,
    schedules: [],
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    rawLine,
  };
}

/**
 * Parse baris tabel menjadi kandidat mata kuliah.
 */
function parseTableRows(lines, documentType) {
  const courses = [];
  const isKhs = documentType === ACADEMIC_DOCUMENT_TYPES.KHS;

  // Regex baris KHS tanpa pipe
  const khsRegex = /^(?:(\d{1,2})[\s.|)]\s*)?(?:([A-Za-z]{2,5}[- ]?\d{2,6}[A-Za-z]?)\s+)?([A-Za-z0-9\s/&,().'-]+?)\s+(\d{1,2})\s+([A-Za-z0-9+-/]+)(?:\s+([0-4][.,]\d{1,2}))?(?:\s+(\d+[.,]\d+))?$/;
  // Regex baris KRS tanpa pipe
  const krsRegex = /^(?:(\d{1,2})[\s.|)]\s*)?(?:([A-Za-z]{2,5}[- ]?\d{2,6}[A-Za-z]?)\s+)?([A-Za-z0-9\s/&,().'-]+?)\s+(\d{1,2})(?:\s+(?:sks|kredit))?(?:\s+(.+))?$/i;

  let incompleteRow = null;
  let currentHeaderContext = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Abaikan baris metadata non-tabel, header kolom, dan ringkasan footer
    if (isHeaderLine(rawLine)) {
      if (rawLine.includes('|')) {
        currentHeaderContext = inspectTableHeaders(rawLine);
      }
      if (incompleteRow) {
        if (!incompleteRow.incomplete) courses.push(incompleteRow);
        incompleteRow = null;
      }
      continue;
    }

    if (isNonTableRow(rawLine) || isFooterLine(rawLine)) {
      if (incompleteRow) {
        if (!incompleteRow.incomplete) courses.push(incompleteRow);
        incompleteRow = null;
      }
      continue;
    }

    // 1. Jika baris memuat pemisah tabel '|'
    if (rawLine.includes('|')) {
      const rawCells = rawLine.split('|').map(c => c.trim());
      // Buang sel kosong di ujung jika baris diawali atau diakhiri '|'
      if (rawCells.length > 0 && rawCells[0] === '') rawCells.shift();
      if (rawCells.length > 0 && rawCells[rawCells.length - 1] === '') rawCells.pop();

      // Cek apakah ini baris kelanjutan (multi-line continuation)
      if (incompleteRow && incompleteRow.incomplete) {
        // Gabungkan teks nama
        const continuationText = rawCells.find(c => c.length > 0 && !/^\d+$/.test(c)) || '';
        const combinedRaw = `${incompleteRow.rawLine}\n${rawLine}`;
        const newCells = [
          incompleteRow.rowNo !== null ? String(incompleteRow.rowNo) : '',
          incompleteRow.code || '',
          `${incompleteRow.name} ${continuationText}`.trim(),
          ...rawCells.filter(c => c !== continuationText && c.length > 0),
        ].filter(Boolean);

        const mergedRow = parsePipeTableRow(newCells, isKhs, combinedRaw, currentHeaderContext);
        if (mergedRow && !mergedRow.incomplete) {
          courses.push(mergedRow);
          incompleteRow = null;
          continue;
        }
      }

      const parsedPipe = parsePipeTableRow(rawCells, isKhs, rawLine, currentHeaderContext);
      if (parsedPipe) {
        if (parsedPipe.incomplete) {
          incompleteRow = parsedPipe;
        } else {
          courses.push(parsedPipe);
          incompleteRow = null;
        }
        continue;
      }
    }

    // 2. Baris tanpa '|' (dipisahkan spasi / tab)
    const cleanedLine = rawLine.replace(/\s+/g, ' ').trim();
    let match = null;
    let matchedType = null;

    if (isKhs || documentType === ACADEMIC_DOCUMENT_TYPES.UNKNOWN) {
      match = cleanedLine.match(khsRegex);
      if (match) matchedType = 'KHS';
    }

    if (!match && (documentType === ACADEMIC_DOCUMENT_TYPES.KRS || documentType === ACADEMIC_DOCUMENT_TYPES.UNKNOWN)) {
      match = cleanedLine.match(krsRegex);
      if (match) matchedType = 'KRS';
    }

    if (match) {
      if (incompleteRow && !incompleteRow.incomplete) {
        courses.push(incompleteRow);
      }
      incompleteRow = null;

      const rowNo = match[1] ? Number.parseInt(match[1], 10) : null;
      const code = match[2] ? match[2].trim() : null;
      let name = match[3] ? match[3].trim() : '';
      const rawSks = match[4] ? Number.parseInt(match[4], 10) : null;
      const rawGrade = matchedType === 'KHS' && match[5] ? match[5].trim().toUpperCase() : null;
      const rawGradePoint = matchedType === 'KHS' && match[6] ? normalizeDecimal(match[6]) : null;

      let day = null;
      let timeStart = null;
      let timeEnd = null;
      let room = null;
      let lecturer = null;
      let parsedClass = null;
      const schedules = [];

      if (matchedType === 'KRS' && match[5]) {
        const trailing = match[5].trim();
        const timeRange = parseScheduleTimeRange(trailing);
        if (timeRange) {
          timeStart = timeRange.timeStart;
          timeEnd = timeRange.timeEnd;
        }

        const tokens = trailing.split(/\s+/);
        for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
          const tok = tokens[tIdx];
          const normalizedDay = normalizeScheduleDay(tok);
          if (normalizedDay && !day) {
            day = normalizedDay;
            continue;
          }

          if (/^(?:r\.|ruang|lab|gk|gd|gedung)\b/i.test(tok) || /^[A-Z]\.?[0-9-]{2,6}$/i.test(tok)) {
            if (!room) {
              const restTokens = tokens.slice(tIdx);
              const docIdx = restTokens.findIndex(w => /(?:dr\.|prof\.|ir\.|drs\.|dra\.)/i.test(w));
              if (docIdx > 0) {
                room = restTokens.slice(0, docIdx).join(' ');
                tIdx += docIdx - 1;
              } else {
                room = tok;
              }
              continue;
            }
          }

          if (/(?:dr\.|prof\.|ir\.|drs\.|dra\.|m\.kom|s\.kom|m\.t\.|ph\.d|m\.sc)/i.test(tok)) {
            if (!lecturer) {
              lecturer = tokens.slice(tIdx).join(' ');
              break;
            }
          }

          if (/^(?:kls|kelas\s*)?([A-Za-z0-9-]{1,6})$/i.test(tok) && !parsedClass && !normalizeScheduleDay(tok) && !parseScheduleTimeRange(tok)) {
            const mClass = tok.match(/^(?:kls|kelas\s*)?([A-Za-z0-9-]{1,6})$/i);
            parsedClass = mClass ? mClass[1].toUpperCase() : tok.toUpperCase();
            continue;
          }
        }

        if (day && timeStart && timeEnd) {
          schedules.push({
            day,
            timeStart,
            timeEnd,
            room: room || null,
            lecturer: lecturer || null,
            mode: null,
          });
        }
      }

      if (name.length < 2 || /^\d+$/.test(name)) continue;

      const reviewReasons = [];
      let sks = rawSks;
      if (sks === null || Number.isNaN(sks) || sks < 1 || sks > 12) {
        reviewReasons.push('invalid_sks');
        sks = null;
      }

      let grade = rawGrade;
      let gradePoint = rawGradePoint;
      if (matchedType === 'KHS') {
        if (!grade || !VALID_LETTER_GRADES.has(grade)) {
          reviewReasons.push('grade_unrecognized');
        }
      }

      courses.push({
        rowNo,
        code,
        name,
        sks,
        grade,
        gradePoint,
        point: gradePoint,
        class: parsedClass,
        day,
        timeStart,
        timeEnd,
        room,
        lecturer,
        mode: null,
        schedules,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        rawLine,
      });
    } else {
      // Kelanjutan nama pada baris berikutnya tanpa pemisah
      if (courses.length > 0 && !rawLine.includes(':') && !/^\d+$/.test(rawLine)) {
        const lastCourse = courses[courses.length - 1];
        if (!/[0-9]/.test(rawLine) && rawLine.length > 2 && rawLine.length < 50) {
          lastCourse.name += ` ${rawLine}`;
          lastCourse.rawLine += `\n${rawLine}`;
        }
      }
    }
  }

  return courses;
}

/**
 * Parser utama untuk dokumen akademik OCR.
 *
 * @param {string|object} input - String teks lengkap atau payload { rawText, editedText }
 * @param {object} options - Opsi parsing tambahan
 * @returns {object} Hasil ekstraksi kandidat data akademik
 */
export function parseAcademicDocumentText(input, options = {}) {
  const text = resolveDocumentText(input);

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return Object.freeze({
      isAcademicDocument: false,
      documentType: ACADEMIC_DOCUMENT_TYPES.UNKNOWN,
      semester: null,
      semesterName: null,
      academicYear: null,
      student: { nim: null, name: null },
      summary: { totalSks: null, ips: null, ipk: null },
      courses: [],
      needsReview: false,
      reviewReasons: ['empty_text'],
      evidence: { lineCount: 0, rawLength: 0 },
    });
  }

  const rawLines = text.split(/\r?\n/).map(l => l.trim());
  const nonBlankLines = rawLines.filter(Boolean);

  // 1. Deteksi Jenis Dokumen
  let documentType = options.forceDocumentType || detectDocumentType(text, nonBlankLines);

  // 2. Ekstraksi Semester & Tahun Akademik
  const semesterInfo = extractSemesterInfo(text);

  // 3. Ekstraksi Data Mahasiswa
  const studentInfo = extractStudentInfo(text);

  // 4. Ekstraksi Ringkasan Nilai
  const summary = extractSummary(text);

  // 5. Ekstraksi Daftar Mata Kuliah
  const courses = parseTableRows(rawLines, documentType);

  // Jika belum terdeteksi jenis dokumen tetapi ditemukan daftar mata kuliah dengan nilai, simpulkan KHS
  if (documentType === ACADEMIC_DOCUMENT_TYPES.UNKNOWN && courses.length > 0) {
    const coursesWithGrade = courses.filter(c => c.grade);
    if (coursesWithGrade.length > 0) {
      documentType = ACADEMIC_DOCUMENT_TYPES.KHS;
    } else {
      documentType = ACADEMIC_DOCUMENT_TYPES.KRS;
    }
  }

  const isAcademic = documentType !== ACADEMIC_DOCUMENT_TYPES.UNKNOWN && courses.length > 0;
  const overallReviewReasons = [];

  if (isAcademic) {
    if (semesterInfo.number === null) {
      overallReviewReasons.push('semester_not_detected');
    }
    const coursesNeedingReview = courses.filter(c => c.needsReview);
    if (coursesNeedingReview.length > 0) {
      overallReviewReasons.push('courses_need_review');
    }
  }

  return Object.freeze({
    isAcademicDocument: isAcademic,
    documentType,
    semester: semesterInfo.number,
    semesterNumber: semesterInfo.number,
    semesterName: semesterInfo.semesterName,
    term: semesterInfo.term,
    academicYear: semesterInfo.academicYear,
    student: studentInfo,
    summary,
    courses: courses.map(c => ({
      ...c,
      evidence: { rawLine: c.rawLine },
    })),
    needsReview: overallReviewReasons.length > 0,
    reviewReasons: overallReviewReasons,
    evidence: {
      lineCount: nonBlankLines.length,
      rawLength: text.length,
    },
  });
}

/**
 * Mengonversi hasil parser menjadi skema extracted_data yang kompatibel
 * dengan kontrak DOCUMENT_SCAN dan createCourseMergePlan.
 */
export function toCandidateExtractedData(parsedResult) {
  if (!parsedResult || !parsedResult.isAcademicDocument) {
    return {
      semester_name: null,
      status: null,
      gpa: null,
      courses: [],
      tasks: [],
      title: null,
      deadline: null,
      course_name: null,
      exam_type: null,
      task_type: null,
      project_type: null,
      task_number: null,
      meeting_number: null,
      is_completed: null,
      semester: null,
      document_type: null,
    };
  }

  return {
    semester_name: parsedResult.semesterName || null,
    status: parsedResult.documentType === ACADEMIC_DOCUMENT_TYPES.KHS ? 'past' : 'current',
    gpa: parsedResult.summary?.ips !== null && parsedResult.summary?.ips !== undefined
      ? String(parsedResult.summary.ips)
      : null,
    courses: (parsedResult.courses || []).map(c => ({
      name: c.name,
      sks: c.sks !== null ? Number(c.sks) : null,
      grade: c.grade || null,
      day: c.day || null,
      timeStart: c.timeStart || null,
      timeEnd: c.timeEnd || null,
      room: c.room || null,
      lecturer: c.lecturer || null,
      mode: c.mode || null,
      kehadiran_ujian: null,
    })),
    tasks: [],
    title: null,
    deadline: null,
    course_name: null,
    exam_type: null,
    task_type: null,
    project_type: null,
    task_number: null,
    meeting_number: null,
    is_completed: null,
    semester: parsedResult.semester || null,
    document_type: parsedResult.documentType === ACADEMIC_DOCUMENT_TYPES.KRS
      ? 'KRS'
      : (parsedResult.documentType === ACADEMIC_DOCUMENT_TYPES.KHS ? 'KHS' : 'Lainnya'),
  };
}
