const TARGET_MODES = Object.freeze(['create', 'replace']);
const CORE_DOCUMENT_KEYS = Object.freeze({
  'dokumen krs': Object.freeze(['krs']),
  'jadwal mingguan': Object.freeze(['mingguan']),
  'jadwal ujian': Object.freeze(['ujian', 'uts', 'uas', 'kru']),
  'dokumen khs': Object.freeze(['khs']),
});

export class AIScannerTargetError extends Error {
  constructor(code) {
    super('Target dokumen Scanner tidak valid.');
    this.name = 'AIScannerTargetError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function validSemesterId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return true;
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && ![...value].some(character => character.codePointAt(0) < 32);
}

function validDocumentType(value) {
  return typeof value === 'string'
    && value.trim().length >= 1
    && value.trim().length <= 160
    && ![...value].some(character => character.codePointAt(0) < 32);
}

function normalizeType(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID')
    : '';
}

function semesterDocuments(semester) {
  const documents = Array.isArray(semester?.documents) ? semester.documents : [];
  if (documents.length > 0 || !semester?.originalFile) return documents;
  return [{ type: semester.documentType || 'Dokumen Semester', file: semester.originalFile }];
}

function slotIsOccupied(documents, documentType) {
  const normalizedTarget = normalizeType(documentType);
  const keys = CORE_DOCUMENT_KEYS[normalizedTarget];
  return documents.some(document => {
    const normalizedDocument = normalizeType(document?.type);
    if (keys) {
      return !normalizedDocument.includes('rekap')
        && keys.some(key => normalizedDocument.includes(key));
    }
    return normalizedDocument === normalizedTarget;
  });
}

export function parseAIScannerDocumentTarget(value) {
  if (!isPlainObject(value) || !TARGET_MODES.includes(value.mode) || !validSemesterId(value.semesterId)) {
    throw new AIScannerTargetError('invalid_target');
  }
  if (value.mode === 'create') {
    if (!hasExactKeys(value, ['mode', 'semesterId', 'documentType']) || !validDocumentType(value.documentType)) {
      throw new AIScannerTargetError('invalid_target');
    }
    return Object.freeze({
      mode: value.mode,
      semesterId: value.semesterId,
      documentType: value.documentType.trim(),
    });
  }
  if (
    !hasExactKeys(value, ['mode', 'semesterId', 'docIndex', 'oldType'])
    || !Number.isSafeInteger(value.docIndex)
    || value.docIndex < 0
    || !validDocumentType(value.oldType)
  ) throw new AIScannerTargetError('invalid_target');
  return Object.freeze({
    mode: value.mode,
    semesterId: value.semesterId,
    docIndex: value.docIndex,
    oldType: value.oldType.trim(),
  });
}

export function resolveAIScannerSemesterById(semesters, semesterId) {
  if (!Array.isArray(semesters) || !validSemesterId(semesterId)) {
    throw new AIScannerTargetError('invalid_target');
  }
  const semesterIndex = semesters.findIndex(semester => Object.is(semester?.id, semesterId));
  if (semesterIndex < 0) throw new AIScannerTargetError('target_not_found');
  return Object.freeze({ semesterIndex, semester: semesters[semesterIndex] });
}

export function resolveAIScannerDocumentTarget(semesters, target) {
  const parsed = parseAIScannerDocumentTarget(target);
  const resolvedSemester = resolveAIScannerSemesterById(semesters, parsed.semesterId);
  const documents = semesterDocuments(resolvedSemester.semester);
  if (parsed.mode === 'create') {
    if (slotIsOccupied(documents, parsed.documentType)) {
      throw new AIScannerTargetError('target_changed');
    }
    return Object.freeze({
      mode: parsed.mode,
      semesterId: parsed.semesterId,
      semesterIndex: resolvedSemester.semesterIndex,
      documentIndex: null,
      documentType: parsed.documentType,
      semester: resolvedSemester.semester,
      documents,
    });
  }
  const document = documents[parsed.docIndex];
  if (!document || document.type !== parsed.oldType) {
    throw new AIScannerTargetError('target_changed');
  }
  return Object.freeze({
    mode: parsed.mode,
    semesterId: parsed.semesterId,
    semesterIndex: resolvedSemester.semesterIndex,
    documentIndex: parsed.docIndex,
    documentType: parsed.oldType,
    semester: resolvedSemester.semester,
    document,
    documents,
  });
}
