import Papa from 'papaparse';

import {
  AI_CAPABILITIES,
  AI_LIMITS,
} from '../../shared/ai/contracts.mjs';
import { isAIDocumentNameMimeMatch } from '../../shared/ai/documentValidation.mjs';
import { validateCapabilityResult } from '../../shared/ai/validation.mjs';
import {
  OfflineDocumentEngineError,
  processPdfDocumentOffline,
  recognizeImageText,
} from './offlineDocumentEngine.js';
import {
  parseAcademicDocumentText,
  toCandidateExtractedData,
} from './offlineAcademicParser.js';

export const SCANNER_PROCESSING_SOURCES = Object.freeze({
  OFFLINE: 'offline',
  GEMINI: 'gemini',
});

export const OFFLINE_SCANNER_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
]);
export const OFFLINE_SCANNER_PDF_MIME = 'application/pdf';
export const OFFLINE_SCANNER_MIME_TYPES = Object.freeze([
  'text/plain',
  'text/csv',
  OFFLINE_SCANNER_PDF_MIME,
  ...OFFLINE_SCANNER_IMAGE_MIME_TYPES,
]);

// Batas resolusi piksel gambar untuk mencegah kehabisan RAM (setara ~5000 x 5000)
const MAX_IMAGE_PIXELS = 25_000_000;

// Preview teks PDF dan gambar dibatasi untuk performa UI
const MAX_PDF_PREVIEW_CHARACTERS = 20_000;

const MAX_PREVIEW_CHARACTERS = 20_000;
const MAX_CSV_ROWS = 2_000;
const MAX_CSV_COLUMNS = 50;
const MAX_HEADER_CHARACTERS = 128;
const MAX_CELL_CHARACTERS = 2_000;
const UNSAFE_OBJECT_KEYS = new Set(['proto', 'prototype', 'constructor']);
const UNSAFE_FORMULA_PATTERN = /^(?:[=+@]|-[A-Za-z(])/u;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

const HEADER_ALIASES = Object.freeze({
  courseName: Object.freeze(['name', 'course', 'coursename', 'matakuliah', 'namamatakuliah']),
  sks: Object.freeze(['sks', 'credits', 'credit']),
  grade: Object.freeze(['grade', 'nilai']),
  day: Object.freeze(['day', 'hari']),
  timeStart: Object.freeze(['timestart', 'jammulai', 'waktumulai']),
  timeEnd: Object.freeze(['timeend', 'jamselesai', 'waktuselesai']),
  room: Object.freeze(['room', 'ruang', 'kelas']),
  lecturer: Object.freeze(['lecturer', 'dosen', 'pengajar']),
  mode: Object.freeze(['mode', 'moda']),
  attendance: Object.freeze(['kehadiran', 'kehadiranujian', 'attendance']),
  taskTitle: Object.freeze(['title', 'judul', 'namatugas', 'agenda']),
  deadline: Object.freeze(['deadline', 'tenggat', 'tanggal']),
  completed: Object.freeze(['completed', 'selesai', 'iscompleted']),
  course: Object.freeze(['coursename', 'course', 'matakuliah']),
});

const DAY_VALUES = Object.freeze(new Map([
  ['senin', 'Senin'],
  ['selasa', 'Selasa'],
  ['rabu', 'Rabu'],
  ['kamis', 'Kamis'],
  ['jumat', 'Jumat'],
  ['sabtu', 'Sabtu'],
  ['minggu', 'Minggu'],
]));

const MODE_VALUES = Object.freeze(new Map([
  ['online', 'Online'],
  ['offline', 'Offline'],
]));

const ATTENDANCE_VALUES = Object.freeze(new Map([
  ['hadir', 'Hadir'],
  ['belum', 'Belum'],
]));

export class OfflineScannerError extends Error {
  constructor(code) {
    super('Dokumen tidak dapat diproses secara Offline.');
    this.name = 'OfflineScannerError';
    this.code = code;
  }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new OfflineScannerError('request_cancelled');
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeHeader(value) {
  return String(value)
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('id-ID')
    .replace(/[\s_-]+/gu, '');
}

function buildHeaderLookup(fields) {
  const lookup = Object.create(null);
  const normalizedFields = new Set();
  for (const field of fields) {
    if (typeof field !== 'string' || field.trim().length < 1 || field.length > MAX_HEADER_CHARACTERS) {
      throw new OfflineScannerError('invalid_csv');
    }
    const normalized = normalizeHeader(field);
    if (!normalized || UNSAFE_OBJECT_KEYS.has(normalized) || normalizedFields.has(normalized)) {
      throw new OfflineScannerError('invalid_csv');
    }
    normalizedFields.add(normalized);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (!aliases.includes(normalized)) continue;
      if (lookup[canonical] !== undefined) throw new OfflineScannerError('ambiguous_csv');
      lookup[canonical] = field;
    }
  }
  return lookup;
}

function cell(row, field, required = false) {
  const raw = field === undefined ? null : row[field];
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    if (required) throw new OfflineScannerError('invalid_csv_content');
    return null;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    throw new OfflineScannerError('invalid_csv_content');
  }
  const value = String(raw).trim();
  if (
    value.length > MAX_CELL_CHARACTERS
    || UNSAFE_CONTROL_PATTERN.test(value)
    || UNSAFE_FORMULA_PATTERN.test(value)
  ) throw new OfflineScannerError('unsafe_csv_content');
  return value;
}

function enumCell(row, field, allowedValues) {
  const value = cell(row, field);
  if (value === null) return null;
  const normalized = value.toLocaleLowerCase('id-ID').replace(/[^a-z]/gu, '');
  const mapped = allowedValues.get(normalized);
  if (!mapped) throw new OfflineScannerError('invalid_csv_content');
  return mapped;
}

function timeCell(row, field) {
  const value = cell(row, field);
  if (value === null) return null;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new OfflineScannerError('invalid_csv_content');
  }
  return value;
}

function sksCell(row, field) {
  const value = cell(row, field);
  if (value === null) return null;
  if (!/^\d{1,2}$/u.test(value)) throw new OfflineScannerError('invalid_csv_content');
  const parsed = Number(value);
  if (parsed < 1 || parsed > 12) throw new OfflineScannerError('invalid_csv_content');
  return parsed;
}

function booleanCell(row, field) {
  const value = cell(row, field, true).toLocaleLowerCase('id-ID');
  if (['true', 'ya', 'selesai'].includes(value)) return true;
  if (['false', 'tidak', 'belum'].includes(value)) return false;
  throw new OfflineScannerError('invalid_csv_content');
}

function deadlineCell(row, field) {
  const value = cell(row, field);
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new OfflineScannerError('invalid_csv_content');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new OfflineScannerError('invalid_csv_content');
  }
  return value;
}

function emptyExtractedData(documentType = null) {
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
    document_type: documentType,
  };
}

function mapCourseRows(rows, headers) {
  return rows.map(row => ({
    name: cell(row, headers.courseName, true),
    sks: sksCell(row, headers.sks),
    grade: cell(row, headers.grade),
    day: enumCell(row, headers.day, DAY_VALUES),
    timeStart: timeCell(row, headers.timeStart),
    timeEnd: timeCell(row, headers.timeEnd),
    room: cell(row, headers.room),
    lecturer: cell(row, headers.lecturer),
    mode: enumCell(row, headers.mode, MODE_VALUES),
    kehadiran_ujian: enumCell(row, headers.attendance, ATTENDANCE_VALUES),
  }));
}

function mapTaskRows(rows, headers) {
  return rows.map(row => ({
    title: cell(row, headers.taskTitle, true),
    deadline: deadlineCell(row, headers.deadline),
    course_name: cell(row, headers.course),
    exam_type: null,
    task_type: null,
    project_type: null,
    task_number: null,
    meeting_number: null,
    is_completed: booleanCell(row, headers.completed),
    semester: null,
    document_type: 'Tugas',
  }));
}

function createResult({ description, direction = 'file', courses = [], tasks = [], documentType = null }) {
  const result = {
    description,
    direction,
    extracted_data: {
      ...emptyExtractedData(documentType),
      courses,
      tasks,
    },
  };
  if (!validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, result).valid) {
    throw new OfflineScannerError('invalid_result');
  }
  return result;
}

function createAcademicResult({ description, direction = 'khs', extractedData }) {
  const result = {
    description,
    direction,
    extracted_data: {
      ...emptyExtractedData(extractedData.document_type),
      ...extractedData,
    },
  };
  if (!validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, result).valid) {
    throw new OfflineScannerError('invalid_result');
  }
  return result;
}

function parseCsv(text, scanType) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: header => header.trim(),
  });
  if (
    parsed.errors.length > 0
    || !Array.isArray(parsed.data)
    || parsed.data.length < 1
    || parsed.data.length > MAX_CSV_ROWS
    || !Array.isArray(parsed.meta.fields)
    || parsed.meta.fields.length < 1
    || parsed.meta.fields.length > MAX_CSV_COLUMNS
    || (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length > 0)
  ) throw new OfflineScannerError('invalid_csv');

  const headers = buildHeaderLookup(parsed.meta.fields);
  const canMapCourses = headers.courseName !== undefined;
  const canMapTasks = headers.taskTitle !== undefined && headers.completed !== undefined;
  const mapping = scanType === 'khs'
    ? (canMapCourses ? 'courses' : null)
    : scanType === 'calendar'
      ? (canMapTasks ? 'tasks' : null)
      : canMapCourses !== canMapTasks
        ? (canMapCourses ? 'courses' : 'tasks')
        : null;

  if (mapping === 'courses') {
    const courses = mapCourseRows(parsed.data, headers);
    return {
      structured: true,
      result: createResult({
        description: `${courses.length} mata kuliah dipetakan secara lokal dari CSV dan menunggu tinjauan Anda.`,
        direction: 'khs',
        courses,
        documentType: 'Lainnya',
      }),
    };
  }
  if (mapping === 'tasks') {
    const tasks = mapTaskRows(parsed.data, headers);
    return {
      structured: true,
      result: createResult({
        description: `${tasks.length} tugas atau agenda dipetakan secara lokal dari CSV dan menunggu tinjauan Anda.`,
        direction: 'event',
        tasks,
        documentType: 'Tugas',
      }),
    };
  }
  return {
    structured: false,
    result: createResult({
      description: 'CSV berhasil dibaca secara lokal, tetapi kolomnya belum cukup jelas untuk dipetakan sebagai data akademik.',
    }),
  };
}

async function readUtf8(file, signal) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let text = '';
  try {
    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader();
      const cancelReader = () => { void reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', cancelReader, { once: true });
      try {
        while (true) {
          assertNotAborted(signal);
          const chunk = await reader.read();
          assertNotAborted(signal);
          if (chunk.done) break;
          byteLength += chunk.value.byteLength;
          if (byteLength > AI_LIMITS.DOCUMENT_BYTES) throw new OfflineScannerError('file_too_large');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        signal?.removeEventListener('abort', cancelReader);
      }
    } else {
      const buffer = await file.arrayBuffer();
      assertNotAborted(signal);
      byteLength = buffer.byteLength;
      text = decoder.decode(buffer);
    }
  } catch (error) {
    if (error instanceof OfflineScannerError) throw error;
    if (signal?.aborted) throw new OfflineScannerError('request_cancelled');
    if (error instanceof TypeError) throw new OfflineScannerError('invalid_encoding');
    throw new OfflineScannerError('file_read_failed');
  }
  if (byteLength !== file.size) throw new OfflineScannerError('file_size_mismatch');
  if (UNSAFE_CONTROL_PATTERN.test(text)) throw new OfflineScannerError('invalid_text_content');
  if (!text.trim()) throw new OfflineScannerError('empty_content');
  return text;
}

function buildPreview(text) {
  const truncated = text.length > MAX_PREVIEW_CHARACTERS;
  return {
    text: truncated ? text.slice(0, MAX_PREVIEW_CHARACTERS) : text,
    fullText: text,
    truncated,
    totalCharacters: text.length,
  };
}

export function isOfflineScannerMimeType(mimeType) {
  return OFFLINE_SCANNER_MIME_TYPES.includes(mimeType);
}

export function isPdfOfflineScannerMimeType(mimeType) {
  return mimeType === OFFLINE_SCANNER_PDF_MIME;
}

export function isImageOfflineScannerMimeType(mimeType) {
  return OFFLINE_SCANNER_IMAGE_MIME_TYPES.includes(mimeType);
}

/**
 * Memproses PDF secara Offline menggunakan ekstraksi teks PDF.js lokal.
 * Tidak ada request jaringan, Gateway, atau API key yang digunakan.
 *
 * Menangani empat kondisi secara jujur:
 * 1. PDF teks asli lengkap — teks diekstrak dari semua halaman.
 * 2. PDF campuran — teks diekstrak dari halaman yang ada teksnya; halaman scan ditandai.
 * 3. PDF semua scan — tidak ada teks yang dapat diekstrak; pengguna diberi tahu.
 * 4. PDF rusak/kosong/terenkripsi — pesan aman tanpa crash.
 */
async function processPdfOffline(file, options = {}) {
  const signal = options.signal;
  const onProgress = options.onProgress;

  // Baca seluruh file sebagai ArrayBuffer sebelum menyerahkan ke PDF.js.
  let buffer;
  try {
    buffer = await file.arrayBuffer();
    assertNotAborted(signal);
  } catch (error) {
    if (error instanceof OfflineScannerError) throw error;
    if (signal?.aborted) throw new OfflineScannerError('request_cancelled');
    throw new OfflineScannerError('file_read_failed');
  }

  const processDocument = options.pdfDocumentProcessor ?? processPdfDocumentOffline;
  let extraction;
  try {
    extraction = await processDocument(buffer, {
      signal,
      baseUrl: options.baseUrl,
      onProgress,
    });
  } catch (error) {
    if (error instanceof OfflineScannerError) throw error;
    if (signal?.aborted) throw new OfflineScannerError('request_cancelled');
    // Terjemahkan error engine ke kode OfflineScannerError yang aman.
    if (error instanceof OfflineDocumentEngineError) {
      const mapping = {
        request_cancelled: 'request_cancelled',
        invalid_pdf: 'pdf_invalid',
        pdf_processing_failed: 'pdf_processing_failed',
        invalid_asset_location: 'pdf_asset_error',
        canvas_unavailable: 'ocr_canvas_unavailable',
        ocr_processing_failed: 'ocr_processing_failed',
        invalid_resource_limit: 'image_dimension_limit_exceeded',
      };
      throw new OfflineScannerError(mapping[error.code] ?? 'pdf_processing_failed');
    }
    throw new OfflineScannerError('pdf_processing_failed');
  }

  assertNotAborted(signal);

  // Kasus 1: Seluruh halaman kosong tanpa teks
  if (extraction.isAllEmpty) {
    return deepFreeze({
      source: SCANNER_PROCESSING_SOURCES.OFFLINE,
      parser: 'pdf',
      structured: false,
      pdfInfo: {
        pageCount: extraction.pageCount,
        textPageCount: 0,
        ocrPageCount: 0,
        emptyPageCount: extraction.emptyPageCount,
        isAllEmpty: true,
        isAllScanned: false,
        isHybrid: false,
        isTextOnly: false,
        averageConfidence: null,
        extractedPageCount: 0,
        scannedPageCount: extraction.pageCount,
        isPartial: false,
      },
      suggestion: createResult({
        description: `PDF ini terdiri dari ${extraction.pageCount} halaman kosong tanpa teks yang dapat dibaca.`,
      }),
      direction: 'file',
      textPreview: null,
    });
  }

  // Kasus 2: Ada teks (teks asli, OCR, atau hybrid)
  const previewText = extraction.combinedText.length > MAX_PDF_PREVIEW_CHARACTERS
    ? extraction.combinedText.slice(0, MAX_PDF_PREVIEW_CHARACTERS)
    : extraction.combinedText;
  const truncated = extraction.combinedText.length > MAX_PDF_PREVIEW_CHARACTERS;

  let description;
  if (extraction.isHybrid) {
    description = (
      `PDF campuran berhasil diproses secara lokal: ${extraction.textPageCount} halaman teks asli dan `
      + `${extraction.ocrPageCount} halaman hasil OCR (keyakinan ~${extraction.averageConfidence ?? 0}%)`
      + `${extraction.emptyPageCount > 0 ? `, ${extraction.emptyPageCount} halaman kosong` : ''}. `
      + 'Teks siap untuk ditinjau dan disimpan setelah konfirmasi.'
    );
  } else if (extraction.isAllScanned) {
    description = (
      `PDF hasil scan (${extraction.pageCount} halaman) berhasil diproses menggunakan OCR lokal `
      + `(keyakinan ~${extraction.averageConfidence ?? 0}%). `
      + 'Teks siap untuk ditinjau dan disimpan setelah konfirmasi.'
    );
  } else {
    description = (
      `${extraction.pageCount === 1 ? 'PDF satu halaman' : `PDF ${extraction.pageCount} halaman`} `
      + 'berhasil diekstrak secara lokal. Teks siap untuk ditinjau dan disimpan setelah konfirmasi.'
    );
  }

  const textPreview = {
    text: previewText,
    fullText: extraction.combinedText,
    truncated,
    totalCharacters: extraction.combinedText.length,
    pageCount: extraction.pageCount,
    textPageCount: extraction.textPageCount,
    ocrPageCount: extraction.ocrPageCount,
    emptyPageCount: extraction.emptyPageCount,
    isTextOnly: extraction.isTextOnly,
    isAllScanned: extraction.isAllScanned,
    isHybrid: extraction.isHybrid,
    averageConfidence: extraction.averageConfidence,
    extractedPageCount: extraction.textPageCount + extraction.ocrPageCount,
    scannedPageCount: extraction.emptyPageCount,
    isPartial: extraction.emptyPageCount > 0 && (extraction.textPageCount > 0 || extraction.ocrPageCount > 0),
    parser: 'pdf',
  };

  const academicCandidate = parseAcademicDocumentText(extraction.combinedText);
  const isStructured = academicCandidate.isAcademicDocument && academicCandidate.courses.length > 0;
  const finalDescription = isStructured
    ? `${academicCandidate.courses.length} mata kuliah dipetakan secara lokal dari dokumen ${academicCandidate.documentType} dan menunggu tinjauan Anda.`
    : description;
  const suggestion = isStructured
    ? createAcademicResult({
        description: finalDescription,
        direction: 'khs',
        extractedData: toCandidateExtractedData(academicCandidate),
      })
    : createResult({ description: finalDescription });

  return deepFreeze({
    source: SCANNER_PROCESSING_SOURCES.OFFLINE,
    parser: 'pdf',
    structured: isStructured,
    academicInfo: academicCandidate,
    pdfInfo: {
      pageCount: extraction.pageCount,
      textPageCount: extraction.textPageCount,
      ocrPageCount: extraction.ocrPageCount,
      emptyPageCount: extraction.emptyPageCount,
      isTextOnly: extraction.isTextOnly,
      isAllScanned: extraction.isAllScanned,
      isHybrid: extraction.isHybrid,
      averageConfidence: extraction.averageConfidence,
      extractedPageCount: extraction.textPageCount + extraction.ocrPageCount,
      scannedPageCount: extraction.emptyPageCount,
      isPartial: extraction.emptyPageCount > 0 && (extraction.textPageCount > 0 || extraction.ocrPageCount > 0),
    },
    suggestion,
    direction: isStructured ? 'khs' : 'file',
    textPreview,
  });
}

function hasPrefix(bytes, expected, offset = 0) {
  return bytes.length >= offset + expected.length
    && expected.every((value, index) => bytes[offset + index] === value);
}

function hasExpectedImageSignature(mimeType, bytes) {
  if (mimeType === 'image/bmp') return hasPrefix(bytes, [0x42, 0x4d]);
  if (mimeType === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/webp') {
    return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
      && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  return false;
}

async function validateImage(file, signal) {
  assertNotAborted(signal);
  let headerBuffer;
  try {
    const slice = file.slice(0, 32);
    headerBuffer = await slice.arrayBuffer();
  } catch {
    throw new OfflineScannerError('file_read_failed');
  }
  assertNotAborted(signal);
  const headerBytes = new Uint8Array(headerBuffer);
  if (!hasExpectedImageSignature(file.type, headerBytes)) {
    throw new OfflineScannerError('invalid_image');
  }

  // Jika createImageBitmap tersedia (di browser / Electron), validasi dekode & batas dimensi piksel
  if (typeof globalThis.createImageBitmap === 'function') {
    let bitmap;
    try {
      bitmap = await globalThis.createImageBitmap(file);
    } catch {
      throw new OfflineScannerError('invalid_image');
    }
    try {
      const width = bitmap.width;
      const height = bitmap.height;
      if (width <= 0 || height <= 0) {
        throw new OfflineScannerError('empty_content');
      }
      const pixels = width * height;
      if (pixels > MAX_IMAGE_PIXELS) {
        throw new OfflineScannerError('image_dimension_limit_exceeded');
      }
      return { width, height, pixels };
    } finally {
      bitmap.close();
    }
  }

  return { width: null, height: null, pixels: null };
}

/**
 * Memproses gambar (JPG, PNG, WebP, BMP) secara Offline menggunakan OCR Tesseract lokal.
 * Tidak ada request jaringan, Gateway, atau API key yang digunakan.
 */
async function processImageOffline(file, options = {}) {
  const signal = options.signal;
  const onProgress = options.onProgress;
  assertNotAborted(signal);

  await validateImage(file, signal);
  assertNotAborted(signal);

  const recognize = options.imageTextRecognizer ?? recognizeImageText;
  let ocrResult;
  try {
    ocrResult = await recognize(file, {
      signal,
      baseUrl: options.baseUrl,
      languages: options.languages ?? ['eng', 'ind'],
      onProgress,
    });
  } catch (error) {
    if (error instanceof OfflineScannerError) throw error;
    if (signal?.aborted) throw new OfflineScannerError('request_cancelled');
    if (error instanceof OfflineDocumentEngineError) {
      const mapping = {
        request_cancelled: 'request_cancelled',
        invalid_asset_location: 'ocr_asset_error',
        ocr_module_invalid: 'ocr_asset_error',
        ocr_engine_unavailable: 'ocr_processing_failed',
        ocr_processing_failed: 'ocr_processing_failed',
        invalid_ocr_languages: 'ocr_processing_failed',
      };
      throw new OfflineScannerError(mapping[error.code] ?? 'ocr_processing_failed');
    }
    throw new OfflineScannerError('ocr_processing_failed');
  }

  assertNotAborted(signal);

  const previewText = ocrResult.text.length > MAX_PREVIEW_CHARACTERS
    ? ocrResult.text.slice(0, MAX_PREVIEW_CHARACTERS)
    : ocrResult.text;
  const truncated = ocrResult.text.length > MAX_PREVIEW_CHARACTERS;

  let description;
  if (!ocrResult.hasText) {
    description = 'Gambar berhasil dipindai dengan OCR lokal, namun tidak ada teks yang terbaca. Pastikan gambar memiliki kontras yang cukup dan tulisan yang jelas.';
  } else if (Number.isFinite(ocrResult.confidence) && ocrResult.confidence >= 70) {
    description = `Teks berhasil diekstrak melalui OCR lokal (tingkat keyakinan ~${Math.round(ocrResult.confidence)}%). Silakan tinjau teks di bawah sebelum disimpan.`;
  } else if (Number.isFinite(ocrResult.confidence)) {
    description = `Teks berhasil diekstrak melalui OCR lokal dengan tingkat keyakinan rendah (~${Math.round(ocrResult.confidence)}%). Disarankan memeriksa ketepatan teks sebelum disimpan.`;
  } else {
    description = 'Teks berhasil diekstrak melalui OCR lokal. Silakan tinjau teks di bawah sebelum disimpan.';
  }

  const textPreview = {
    text: previewText,
    fullText: ocrResult.text,
    truncated,
    totalCharacters: ocrResult.text.length,
    confidence: ocrResult.confidence,
    durationMs: ocrResult.durationMs,
    hasText: ocrResult.hasText,
    parser: 'ocr',
  };

  const academicCandidate = ocrResult.hasText ? parseAcademicDocumentText(ocrResult.text) : null;
  const isStructured = Boolean(academicCandidate?.isAcademicDocument && academicCandidate?.courses.length > 0);
  const finalDescription = isStructured
    ? `${academicCandidate.courses.length} mata kuliah dipetakan secara lokal dari OCR ${academicCandidate.documentType} dan menunggu tinjauan Anda.`
    : description;
  const suggestion = isStructured
    ? createAcademicResult({
        description: finalDescription,
        direction: 'khs',
        extractedData: toCandidateExtractedData(academicCandidate),
      })
    : createResult({ description: finalDescription });

  return deepFreeze({
    source: SCANNER_PROCESSING_SOURCES.OFFLINE,
    parser: 'ocr',
    structured: isStructured,
    academicInfo: academicCandidate,
    suggestion,
    direction: isStructured ? 'khs' : 'file',
    textPreview,
    confidence: ocrResult.confidence,
  });
}

export async function processOfflineScannerFile(file, options = {}) {
  const scanType = options.scanType ?? 'auto';
  const signal = options.signal;
  if (!['auto', 'khs', 'calendar'].includes(scanType)) throw new OfflineScannerError('invalid_scan_type');
  if (
    !file
    || typeof file.name !== 'string'
    || !Number.isSafeInteger(file.size)
    || file.size < 1
    || file.size > AI_LIMITS.DOCUMENT_BYTES
    || !isOfflineScannerMimeType(file.type)
    || !isAIDocumentNameMimeMatch(file.name, file.type)
  ) throw new OfflineScannerError('unsupported_file');

  assertNotAborted(signal);

  // Dispatch ke handler khusus PDF jika tipe file adalah PDF.
  if (file.type === OFFLINE_SCANNER_PDF_MIME) {
    return processPdfOffline(file, {
      signal,
      baseUrl: options.baseUrl,
      onProgress: options.onProgress,
      pdfDocumentProcessor: options.pdfDocumentProcessor,
    });
  }

  // Dispatch ke handler khusus Gambar jika tipe file adalah image/*
  if (isImageOfflineScannerMimeType(file.type)) {
    return processImageOffline(file, {
      signal,
      baseUrl: options.baseUrl,
      languages: options.languages,
      onProgress: options.onProgress,
      imageTextRecognizer: options.imageTextRecognizer,
    });
  }

  const text = await readUtf8(file, signal);
  assertNotAborted(signal);
  const academicCandidate = parseAcademicDocumentText(text);
  const isStructured = academicCandidate.isAcademicDocument && academicCandidate.courses.length > 0;
  const parsed = file.type === 'text/csv'
    ? parseCsv(text, scanType)
    : isStructured
      ? {
          structured: true,
          academicInfo: academicCandidate,
          result: createAcademicResult({
            description: `${academicCandidate.courses.length} mata kuliah dipetakan secara lokal dari teks ${academicCandidate.documentType} dan menunggu tinjauan Anda.`,
            direction: 'khs',
            extractedData: toCandidateExtractedData(academicCandidate),
          }),
        }
      : {
          structured: false,
          academicInfo: academicCandidate,
          result: createResult({
            description: 'Teks berhasil diekstrak secara lokal. Tidak ada data akademik yang dipetakan otomatis.',
          }),
        };
  assertNotAborted(signal);

  return deepFreeze({
    source: SCANNER_PROCESSING_SOURCES.OFFLINE,
    parser: file.type === 'text/csv' ? 'csv' : 'text',
    structured: parsed.structured,
    academicInfo: parsed.academicInfo ?? null,
    suggestion: parsed.result,
    direction: parsed.result.direction,
    textPreview: buildPreview(text),
  });
}
