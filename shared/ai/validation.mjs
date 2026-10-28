import {
  AI_ACCESS_MODE_VALUES,
  AI_ACCESS_MODES,
  AI_ALLOWED_SENSITIVITIES,
  AI_CAPABILITIES,
  AI_CAPABILITY_VALUES,
  AI_COMPLEXITY_LEVEL_VALUES,
  AI_CONTRACT_VERSION,
  AI_DIRECTION_VALUES,
  AI_DOCUMENT_MIME_TYPES,
  AI_ERROR_CODE_VALUES,
  AI_LIMITS,
  AI_PROVIDERS,
  AI_PROVIDER_VALUES,
  AI_REQUEST_ID_PATTERN,
  AI_SCAN_TYPE_VALUES,
  AI_SELECTION_MODE_VALUES,
  AI_SELECTION_MODES,
  AI_SENSITIVITIES,
  AI_SENSITIVITY_VALUES,
} from './contracts.mjs';
import {
  getAIModel,
  isAIModelSelectable,
} from './modelCatalog.mjs';
import { recommendAIModel } from './modelRecommendation.mjs';
import { validateAIDocumentPayload } from './documentValidation.mjs';

const DAY_VALUES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const EXAM_VALUES = ['UTS', 'UAS'];
const TASK_TYPE_VALUES = ['Individu', 'Kelompok'];
const PROJECT_TYPE_VALUES = ['Tugas Harian', 'Projek Akhir', 'Kuis'];
const DOCUMENT_TYPE_VALUES = ['KRS', 'KHS', 'KRU', 'Jadwal', 'Tugas', 'Lainnya'];

export class AIContractValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'AIContractValidationError';
    this.code = 'invalid_contract';
    this.errors = errors;
  }
}

export function validateAIRequestId(value) {
  return typeof value === 'string' && AI_REQUEST_ID_PATTERN.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function requireObject(value, path, errors) {
  if (!isPlainObject(value)) {
    addError(errors, path, 'harus berupa object');
    return false;
  }
  return true;
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) addError(errors, `${path}.${key}`, 'field tidak dikenali');
  }
}

function requireKeys(value, requiredKeys, path, errors) {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) addError(errors, `${path}.${key}`, 'field wajib');
  }
}

function validateString(value, path, errors, options = {}) {
  const { nullable = false, min = 0, max = Infinity } = options;
  if (nullable && value === null) return;
  if (typeof value !== 'string') {
    addError(errors, path, nullable ? 'harus berupa string atau null' : 'harus berupa string');
    return;
  }
  if (value.length < min) addError(errors, path, `panjang minimal ${min}`);
  if (value.length > max) addError(errors, path, `panjang maksimal ${max}`);
}

function validateNullableStringOrNumber(value, path, errors) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
    addError(errors, path, 'harus berupa string, number, atau null');
  }
}

function validateEnum(value, allowedValues, path, errors, nullable = false) {
  if (nullable && value === null) return;
  if (!allowedValues.includes(value)) addError(errors, path, `nilai tidak didukung: ${String(value)}`);
}

function validateBoolean(value, path, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'boolean') addError(errors, path, nullable ? 'harus berupa boolean atau null' : 'harus berupa boolean');
}

function validatePositiveInteger(value, path, errors, maximum = Infinity) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    addError(errors, path, `harus berupa integer antara 1 dan ${maximum}`);
  }
}

function validateBase64(value, path, errors) {
  validateString(value, path, errors, { min: 4 });
  if (typeof value !== 'string') return;
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    addError(errors, path, 'harus berupa base64 standar');
  }
}

function validateSelection(request, errors) {
  const value = request.selection;
  const path = '$.selection';
  if (!requireObject(value, path, errors)) return;
  const keys = [
    'mode', 'complexity', 'provider', 'modelId', 'accessMode',
    'allowModelFallback', 'freeTierDataConsent', 'consentVersion',
  ];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateEnum(value.mode, AI_SELECTION_MODE_VALUES, `${path}.mode`, errors);
  validateEnum(value.complexity, AI_COMPLEXITY_LEVEL_VALUES, `${path}.complexity`, errors);
  validateEnum(value.provider, AI_PROVIDER_VALUES, `${path}.provider`, errors);
  validateString(value.modelId, `${path}.modelId`, errors, { min: 1, max: 128 });
  validateEnum(value.accessMode, AI_ACCESS_MODE_VALUES, `${path}.accessMode`, errors);
  validateBoolean(value.allowModelFallback, `${path}.allowModelFallback`, errors);
  validateBoolean(value.freeTierDataConsent, `${path}.freeTierDataConsent`, errors);
  validatePositiveInteger(value.consentVersion, `${path}.consentVersion`, errors, Number.MAX_SAFE_INTEGER);

  if (value.provider !== AI_PROVIDERS.GEMINI) addError(errors, `${path}.provider`, 'provider belum diaktifkan');
  if (value.accessMode !== AI_ACCESS_MODES.FREE_ONLY) addError(errors, `${path}.accessMode`, 'hanya Free Tier yang diizinkan');
  if (value.allowModelFallback !== false) addError(errors, `${path}.allowModelFallback`, 'fallback model otomatis belum diaktifkan');
  if (
    [AI_SENSITIVITIES.PERSONAL_DATA, AI_SENSITIVITIES.ACADEMIC_DOCUMENT].includes(request.sensitivity)
    && value.freeTierDataConsent !== true
  ) {
    addError(errors, `${path}.freeTierDataConsent`, 'persetujuan Free Tier diperlukan untuk data sensitif');
  }
  const mimeType = request.capability === AI_CAPABILITIES.DOCUMENT_SCAN
    ? request.input?.file?.mimeType
    : null;
  if (!isAIModelSelectable(value.modelId, request.capability, mimeType)) {
    addError(errors, `${path}.modelId`, 'model tidak tersedia untuk capability atau input');
    return;
  }
  if (value.mode === AI_SELECTION_MODES.AUTOMATIC) {
    try {
      const recommendation = recommendAIModel({
        capability: request.capability,
        input: request.input,
        mode: value.mode,
      });
      if (recommendation.modelId !== value.modelId) addError(errors, `${path}.modelId`, 'tidak sesuai rekomendasi backend');
      if (recommendation.complexity !== value.complexity) addError(errors, `${path}.complexity`, 'tidak sesuai rekomendasi backend');
    } catch {
      addError(errors, path, 'rekomendasi backend tidak tersedia');
    }
  }
}

function validateChatInput(value, errors) {
  const path = '$.input';
  if (!requireObject(value, path, errors)) return;
  const keys = ['message', 'locale'];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateString(value.message, `${path}.message`, errors, { min: 1, max: AI_LIMITS.CHAT_MESSAGE_CHARACTERS });
  validateString(value.locale, `${path}.locale`, errors, { min: 2, max: 32 });
}

function validateAnalyticsCell(value, path, errors) {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    addError(errors, path, 'harus berupa string, number, boolean, atau null');
  }
}

function validateAnalyticsInput(value, errors) {
  const path = '$.input';
  if (!requireObject(value, path, errors)) return;
  const keys = ['rows', 'xAxis', 'yAxes'];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);

  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > AI_LIMITS.ANALYTICS_ROWS) {
    addError(errors, `${path}.rows`, `harus berupa array berisi 1-${AI_LIMITS.ANALYTICS_ROWS} baris`);
  } else {
    value.rows.forEach((row, rowIndex) => {
      if (!isPlainObject(row)) {
        addError(errors, `${path}.rows[${rowIndex}]`, 'harus berupa object');
        return;
      }
      for (const [key, cell] of Object.entries(row)) {
        validateAnalyticsCell(cell, `${path}.rows[${rowIndex}].${key}`, errors);
      }
    });
  }

  validateString(value.xAxis, `${path}.xAxis`, errors, { min: 1 });
  if (!Array.isArray(value.yAxes) || value.yAxes.length < 1 || value.yAxes.length > AI_LIMITS.ANALYTICS_AXES) {
    addError(errors, `${path}.yAxes`, `harus berupa array berisi 1-${AI_LIMITS.ANALYTICS_AXES} sumbu`);
  } else {
    value.yAxes.forEach((axis, index) => validateString(axis, `${path}.yAxes[${index}]`, errors, { min: 1 }));
    if (new Set(value.yAxes).size !== value.yAxes.length) addError(errors, `${path}.yAxes`, 'tidak boleh berisi duplikasi');
  }
}

function validateDocumentScanInput(value, errors) {
  const path = '$.input';
  if (!requireObject(value, path, errors)) return;
  const keys = ['scanType', 'file', 'userContext'];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateEnum(value.scanType, AI_SCAN_TYPE_VALUES, `${path}.scanType`, errors);
  validateString(value.userContext, `${path}.userContext`, errors, { max: AI_LIMITS.DOCUMENT_CONTEXT_CHARACTERS });

  const filePath = `${path}.file`;
  if (!requireObject(value.file, filePath, errors)) return;
  const fileKeys = ['name', 'mimeType', 'size', 'base64'];
  rejectUnknownKeys(value.file, fileKeys, filePath, errors);
  requireKeys(value.file, fileKeys, filePath, errors);
  validateString(value.file.name, `${filePath}.name`, errors, { min: 1, max: 255 });
  validateEnum(value.file.mimeType, AI_DOCUMENT_MIME_TYPES, `${filePath}.mimeType`, errors);
  validatePositiveInteger(value.file.size, `${filePath}.size`, errors, AI_LIMITS.DOCUMENT_BYTES);
  validateBase64(value.file.base64, `${filePath}.base64`, errors);
  if (!validateAIDocumentPayload(value.file).valid) {
    addError(errors, filePath, 'nama, MIME, ukuran, atau signature konten dokumen tidak sesuai');
  }
}

export function validateAIRequest(value) {
  const errors = [];
  if (!requireObject(value, '$', errors)) return { valid: false, errors };

  const keys = ['schemaVersion', 'requestId', 'capability', 'sensitivity', 'selection', 'input'];
  rejectUnknownKeys(value, keys, '$', errors);
  requireKeys(value, keys, '$', errors);

  if (value.schemaVersion !== AI_CONTRACT_VERSION) addError(errors, '$.schemaVersion', `harus bernilai ${AI_CONTRACT_VERSION}`);
  if (typeof value.requestId !== 'string' || !AI_REQUEST_ID_PATTERN.test(value.requestId)) addError(errors, '$.requestId', 'harus berupa UUID');
  validateEnum(value.capability, AI_CAPABILITY_VALUES, '$.capability', errors);
  validateEnum(value.sensitivity, AI_SENSITIVITY_VALUES, '$.sensitivity', errors);

  if (AI_CAPABILITY_VALUES.includes(value.capability)) {
    const allowedSensitivities = AI_ALLOWED_SENSITIVITIES[value.capability];
    if (!allowedSensitivities.includes(value.sensitivity)) addError(errors, '$.sensitivity', 'tidak sesuai dengan capability');
  }

  if (value.capability === AI_CAPABILITIES.CHAT) validateChatInput(value.input, errors);
  if (value.capability === AI_CAPABILITIES.ANALYTICS) validateAnalyticsInput(value.input, errors);
  if (value.capability === AI_CAPABILITIES.DOCUMENT_SCAN) validateDocumentScanInput(value.input, errors);
  validateSelection(value, errors);

  return { valid: errors.length === 0, errors };
}

function validateChatResult(value, errors) {
  const path = '$.result';
  if (!requireObject(value, path, errors)) return;
  rejectUnknownKeys(value, ['message'], path, errors);
  requireKeys(value, ['message'], path, errors);
  validateString(value.message, `${path}.message`, errors, { min: 1 });
}

function validateAnalyticsResult(value, errors) {
  const path = '$.result';
  if (!requireObject(value, path, errors)) return;
  rejectUnknownKeys(value, ['markdown', 'points'], path, errors);
  requireKeys(value, ['markdown', 'points'], path, errors);
  validateString(value.markdown, `${path}.markdown`, errors, { min: 1 });
  if (!Array.isArray(value.points)) {
    addError(errors, `${path}.points`, 'harus berupa array');
    return;
  }
  value.points.forEach((point, index) => {
    const pointPath = `${path}.points[${index}]`;
    if (!requireObject(point, pointPath, errors)) return;
    rejectUnknownKeys(point, ['title', 'detail'], pointPath, errors);
    requireKeys(point, ['title', 'detail'], pointPath, errors);
    validateString(point.title, `${pointPath}.title`, errors, { min: 1 });
    validateString(point.detail, `${pointPath}.detail`, errors, { min: 1 });
  });
}

function validateCourse(course, path, errors) {
  if (!requireObject(course, path, errors)) return;
  const keys = ['name', 'sks', 'grade', 'day', 'timeStart', 'timeEnd', 'room', 'lecturer', 'mode', 'kehadiran_ujian'];
  rejectUnknownKeys(course, keys, path, errors);
  requireKeys(course, keys, path, errors);
  validateString(course.name, `${path}.name`, errors, { min: 1 });
  validateNullableStringOrNumber(course.sks, `${path}.sks`, errors);
  validateString(course.grade, `${path}.grade`, errors, { nullable: true });
  validateEnum(course.day, DAY_VALUES, `${path}.day`, errors, true);
  validateString(course.timeStart, `${path}.timeStart`, errors, { nullable: true });
  validateString(course.timeEnd, `${path}.timeEnd`, errors, { nullable: true });
  validateString(course.room, `${path}.room`, errors, { nullable: true });
  validateString(course.lecturer, `${path}.lecturer`, errors, { nullable: true });
  validateEnum(course.mode, ['Online', 'Offline'], `${path}.mode`, errors, true);
  validateEnum(course.kehadiran_ujian, ['Hadir', 'Belum'], `${path}.kehadiran_ujian`, errors, true);
}

function validateTask(task, path, errors) {
  if (!requireObject(task, path, errors)) return;
  const keys = [
    'title', 'deadline', 'course_name', 'exam_type', 'task_type', 'project_type',
    'task_number', 'meeting_number', 'is_completed', 'semester', 'document_type',
  ];
  rejectUnknownKeys(task, keys, path, errors);
  requireKeys(task, keys, path, errors);
  validateString(task.title, `${path}.title`, errors, { min: 1 });
  validateString(task.deadline, `${path}.deadline`, errors, { nullable: true });
  validateString(task.course_name, `${path}.course_name`, errors, { nullable: true });
  validateEnum(task.exam_type, EXAM_VALUES, `${path}.exam_type`, errors, true);
  validateEnum(task.task_type, TASK_TYPE_VALUES, `${path}.task_type`, errors, true);
  validateEnum(task.project_type, PROJECT_TYPE_VALUES, `${path}.project_type`, errors, true);
  validateNullableStringOrNumber(task.task_number, `${path}.task_number`, errors);
  validateNullableStringOrNumber(task.meeting_number, `${path}.meeting_number`, errors);
  validateBoolean(task.is_completed, `${path}.is_completed`, errors);
  validateNullableStringOrNumber(task.semester, `${path}.semester`, errors);
  validateEnum(task.document_type, DOCUMENT_TYPE_VALUES, `${path}.document_type`, errors, true);
}

function validateDocumentScanResult(value, errors) {
  const path = '$.result';
  if (!requireObject(value, path, errors)) return;
  const keys = ['description', 'direction', 'extracted_data'];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateString(value.description, `${path}.description`, errors, { min: 1 });
  validateEnum(value.direction, AI_DIRECTION_VALUES, `${path}.direction`, errors);

  const dataPath = `${path}.extracted_data`;
  if (!requireObject(value.extracted_data, dataPath, errors)) return;
  const dataKeys = [
    'semester_name', 'status', 'gpa', 'courses', 'tasks', 'title', 'deadline',
    'course_name', 'exam_type', 'task_type', 'project_type', 'task_number',
    'meeting_number', 'is_completed', 'semester', 'document_type',
  ];
  rejectUnknownKeys(value.extracted_data, dataKeys, dataPath, errors);
  requireKeys(value.extracted_data, dataKeys, dataPath, errors);

  const data = value.extracted_data;
  validateString(data.semester_name, `${dataPath}.semester_name`, errors, { nullable: true });
  validateEnum(data.status, ['past', 'current', 'future'], `${dataPath}.status`, errors, true);
  validateNullableStringOrNumber(data.gpa, `${dataPath}.gpa`, errors);
  if (!Array.isArray(data.courses)) addError(errors, `${dataPath}.courses`, 'harus berupa array');
  else data.courses.forEach((course, index) => validateCourse(course, `${dataPath}.courses[${index}]`, errors));
  if (!Array.isArray(data.tasks)) addError(errors, `${dataPath}.tasks`, 'harus berupa array');
  else data.tasks.forEach((task, index) => validateTask(task, `${dataPath}.tasks[${index}]`, errors));
  validateString(data.title, `${dataPath}.title`, errors, { nullable: true });
  validateString(data.deadline, `${dataPath}.deadline`, errors, { nullable: true });
  validateString(data.course_name, `${dataPath}.course_name`, errors, { nullable: true });
  validateEnum(data.exam_type, EXAM_VALUES, `${dataPath}.exam_type`, errors, true);
  validateEnum(data.task_type, TASK_TYPE_VALUES, `${dataPath}.task_type`, errors, true);
  validateEnum(data.project_type, PROJECT_TYPE_VALUES, `${dataPath}.project_type`, errors, true);
  validateNullableStringOrNumber(data.task_number, `${dataPath}.task_number`, errors);
  validateNullableStringOrNumber(data.meeting_number, `${dataPath}.meeting_number`, errors);
  validateBoolean(data.is_completed, `${dataPath}.is_completed`, errors, true);
  validateNullableStringOrNumber(data.semester, `${dataPath}.semester`, errors);
  validateEnum(data.document_type, DOCUMENT_TYPE_VALUES, `${dataPath}.document_type`, errors, true);
}

export function validateCapabilityResult(capability, value) {
  const errors = [];
  if (capability === AI_CAPABILITIES.CHAT) validateChatResult(value, errors);
  else if (capability === AI_CAPABILITIES.ANALYTICS) validateAnalyticsResult(value, errors);
  else if (capability === AI_CAPABILITIES.DOCUMENT_SCAN) validateDocumentScanResult(value, errors);
  else addError(errors, '$.capability', 'capability tidak didukung');
  return { valid: errors.length === 0, errors };
}

function validateSuccessMeta(value, capability, errors) {
  const path = '$.meta';
  if (!requireObject(value, path, errors)) return;
  const keys = [
    'provider', 'modelId', 'selectionMode', 'complexity', 'accessMode',
    'fallbackUsed', 'fallbackReason', 'attemptCount',
  ];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateEnum(value.provider, AI_PROVIDER_VALUES, `${path}.provider`, errors);
  validateString(value.modelId, `${path}.modelId`, errors, { min: 1, max: 128 });
  validateEnum(value.selectionMode, AI_SELECTION_MODE_VALUES, `${path}.selectionMode`, errors);
  validateEnum(value.complexity, AI_COMPLEXITY_LEVEL_VALUES, `${path}.complexity`, errors);
  validateEnum(value.accessMode, AI_ACCESS_MODE_VALUES, `${path}.accessMode`, errors);
  validateBoolean(value.fallbackUsed, `${path}.fallbackUsed`, errors);
  validatePositiveInteger(value.attemptCount, `${path}.attemptCount`, errors, 2);
  const model = getAIModel(value.modelId);
  if (value.provider !== AI_PROVIDERS.GEMINI) addError(errors, `${path}.provider`, 'provider aktif harus Gemini');
  if (model?.provider !== value.provider || model?.selectable !== true || !model.capabilities.includes(capability)) {
    addError(errors, `${path}.modelId`, 'model respons tidak diizinkan');
  }
  if (value.accessMode !== AI_ACCESS_MODES.FREE_ONLY) addError(errors, `${path}.accessMode`, 'mode akses respons tidak diizinkan');
  if (value.fallbackUsed !== false) addError(errors, `${path}.fallbackUsed`, 'fallback otomatis belum diaktifkan');
  if (value.fallbackReason !== null) addError(errors, `${path}.fallbackReason`, 'tanpa fallback harus null');
  if (value.attemptCount !== 1) addError(errors, `${path}.attemptCount`, 'harus satu percobaan');
}

function validateError(value, errors) {
  const path = '$.error';
  if (!requireObject(value, path, errors)) return;
  const keys = ['code', 'message', 'primaryReason', 'fallbackReason'];
  rejectUnknownKeys(value, keys, path, errors);
  requireKeys(value, keys, path, errors);
  validateEnum(value.code, AI_ERROR_CODE_VALUES, `${path}.code`, errors);
  validateString(value.message, `${path}.message`, errors, { min: 1 });
  validateString(value.primaryReason, `${path}.primaryReason`, errors, { nullable: true });
  validateString(value.fallbackReason, `${path}.fallbackReason`, errors, { nullable: true });
}

export function validateAIResponse(value) {
  const errors = [];
  if (!requireObject(value, '$', errors)) return { valid: false, errors };

  const commonKeys = ['schemaVersion', 'requestId', 'capability', 'success'];
  const allowedKeys = value.success === true
    ? [...commonKeys, 'meta', 'result']
    : [...commonKeys, 'error'];
  rejectUnknownKeys(value, allowedKeys, '$', errors);
  requireKeys(value, commonKeys, '$', errors);

  if (value.schemaVersion !== AI_CONTRACT_VERSION) addError(errors, '$.schemaVersion', `harus bernilai ${AI_CONTRACT_VERSION}`);
  if (typeof value.requestId !== 'string' || !AI_REQUEST_ID_PATTERN.test(value.requestId)) addError(errors, '$.requestId', 'harus berupa UUID');
  validateEnum(value.capability, AI_CAPABILITY_VALUES, '$.capability', errors);
  validateBoolean(value.success, '$.success', errors);

  if (value.success === true) {
    requireKeys(value, ['meta', 'result'], '$', errors);
    validateSuccessMeta(value.meta, value.capability, errors);
    const resultValidation = validateCapabilityResult(value.capability, value.result);
    errors.push(...resultValidation.errors);
  } else if (value.success === false) {
    requireKeys(value, ['error'], '$', errors);
    validateError(value.error, errors);
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidAIRequest(value) {
  const validation = validateAIRequest(value);
  if (!validation.valid) throw new AIContractValidationError('Request AI tidak valid', validation.errors);
  return value;
}

export function assertValidAIResponse(value) {
  const validation = validateAIResponse(value);
  if (!validation.valid) throw new AIContractValidationError('Response AI tidak valid', validation.errors);
  return value;
}
