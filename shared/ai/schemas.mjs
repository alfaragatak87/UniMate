import {
  AI_ACCESS_MODE_VALUES,
  AI_CAPABILITIES,
  AI_CAPABILITY_VALUES,
  AI_COMPLEXITY_LEVEL_VALUES,
  AI_CONTRACT_VERSION,
  AI_DIRECTION_VALUES,
  AI_DOCUMENT_MIME_TYPES,
  AI_ERROR_CODE_VALUES,
  AI_FALLBACK_REASON_VALUES,
  AI_LIMITS,
  AI_PROVIDER_VALUES,
  AI_SCAN_TYPE_VALUES,
  AI_SELECTION_MODE_VALUES,
  AI_SENSITIVITY_VALUES,
} from './contracts.mjs';
import { AI_SELECTABLE_MODEL_IDS } from './modelCatalog.mjs';

const nullableString = Object.freeze({ type: ['string', 'null'] });
const nullableStringOrNumber = Object.freeze({ type: ['string', 'number', 'null'] });

export const CHAT_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['message', 'locale'],
  properties: {
    message: { type: 'string', minLength: 1, maxLength: AI_LIMITS.CHAT_MESSAGE_CHARACTERS },
    locale: { type: 'string', minLength: 2, maxLength: 32 },
  },
});

export const ANALYTICS_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'xAxis', 'yAxes'],
  properties: {
    rows: {
      type: 'array',
      minItems: 1,
      maxItems: AI_LIMITS.ANALYTICS_ROWS,
      items: { type: 'object' },
    },
    xAxis: { type: 'string', minLength: 1 },
    yAxes: {
      type: 'array',
      minItems: 1,
      maxItems: AI_LIMITS.ANALYTICS_AXES,
      items: { type: 'string', minLength: 1 },
    },
  },
});

export const DOCUMENT_SCAN_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['scanType', 'file', 'userContext'],
  properties: {
    scanType: { type: 'string', enum: AI_SCAN_TYPE_VALUES },
    file: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'mimeType', 'size', 'base64'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 255 },
        mimeType: { type: 'string', enum: AI_DOCUMENT_MIME_TYPES },
        size: { type: 'integer', minimum: 1, maximum: AI_LIMITS.DOCUMENT_BYTES },
        base64: { type: 'string', minLength: 4 },
      },
    },
    userContext: { type: 'string', maxLength: AI_LIMITS.DOCUMENT_CONTEXT_CHARACTERS },
  },
});

export const AI_REQUEST_SCHEMA = Object.freeze({
  $id: 'unimate.ai.request.v2',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'requestId', 'capability', 'sensitivity', 'selection', 'input'],
  properties: {
    schemaVersion: { const: AI_CONTRACT_VERSION },
    requestId: { type: 'string', format: 'uuid' },
    capability: { type: 'string', enum: AI_CAPABILITY_VALUES },
    sensitivity: { type: 'string', enum: AI_SENSITIVITY_VALUES },
    selection: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode', 'complexity', 'provider', 'modelId', 'accessMode',
        'allowModelFallback', 'freeTierDataConsent', 'consentVersion',
      ],
      properties: {
        mode: { type: 'string', enum: AI_SELECTION_MODE_VALUES },
        complexity: { type: 'string', enum: AI_COMPLEXITY_LEVEL_VALUES },
        provider: { const: 'gemini' },
        modelId: { type: 'string', enum: AI_SELECTABLE_MODEL_IDS },
        accessMode: { type: 'string', enum: AI_ACCESS_MODE_VALUES },
        allowModelFallback: { const: false },
        freeTierDataConsent: { type: 'boolean' },
        consentVersion: { type: 'integer', minimum: 1 },
      },
    },
    input: {
      oneOf: [CHAT_INPUT_SCHEMA, ANALYTICS_INPUT_SCHEMA, DOCUMENT_SCAN_INPUT_SCHEMA],
    },
  },
});

export const CHAT_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1 },
  },
});

export const ANALYTICS_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['markdown', 'points'],
  properties: {
    markdown: { type: 'string', minLength: 1 },
    points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string', minLength: 1 },
          detail: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

export const SCANNER_COURSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'name', 'sks', 'grade', 'day', 'timeStart', 'timeEnd', 'room',
    'lecturer', 'mode', 'kehadiran_ujian',
  ],
  properties: {
    name: { type: 'string', minLength: 1 },
    sks: nullableStringOrNumber,
    grade: nullableString,
    day: { type: ['string', 'null'] },
    timeStart: nullableString,
    timeEnd: nullableString,
    room: nullableString,
    lecturer: nullableString,
    mode: { enum: ['Online', 'Offline', null] },
    kehadiran_ujian: { enum: ['Hadir', 'Belum', null] },
  },
});

export const SCANNER_TASK_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'title', 'deadline', 'course_name', 'exam_type', 'task_type',
    'project_type', 'task_number', 'meeting_number', 'is_completed',
    'semester', 'document_type',
  ],
  properties: {
    title: { type: 'string', minLength: 1 },
    deadline: nullableString,
    course_name: nullableString,
    exam_type: { enum: ['UTS', 'UAS', null] },
    task_type: { enum: ['Individu', 'Kelompok', null] },
    project_type: { enum: ['Tugas Harian', 'Projek Akhir', 'Kuis', null] },
    task_number: nullableStringOrNumber,
    meeting_number: nullableStringOrNumber,
    is_completed: { type: 'boolean' },
    semester: nullableStringOrNumber,
    document_type: { enum: ['KRS', 'KHS', 'KRU', 'Jadwal', 'Tugas', 'Lainnya', null] },
  },
});

export const DOCUMENT_SCAN_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['description', 'direction', 'extracted_data'],
  properties: {
    description: { type: 'string', minLength: 1 },
    direction: { type: 'string', enum: AI_DIRECTION_VALUES },
    extracted_data: {
      type: 'object',
      additionalProperties: false,
      required: [
        'semester_name', 'status', 'gpa', 'courses', 'tasks', 'title',
        'deadline', 'course_name', 'exam_type', 'task_type', 'project_type',
        'task_number', 'meeting_number', 'is_completed', 'semester',
        'document_type',
      ],
      properties: {
        semester_name: nullableString,
        status: { enum: ['past', 'current', 'future', null] },
        gpa: nullableStringOrNumber,
        courses: { type: 'array', items: SCANNER_COURSE_SCHEMA },
        tasks: { type: 'array', items: SCANNER_TASK_SCHEMA },
        title: nullableString,
        deadline: nullableString,
        course_name: nullableString,
        exam_type: { enum: ['UTS', 'UAS', null] },
        task_type: { enum: ['Individu', 'Kelompok', null] },
        project_type: { enum: ['Tugas Harian', 'Projek Akhir', 'Kuis', null] },
        task_number: nullableStringOrNumber,
        meeting_number: nullableStringOrNumber,
        is_completed: { type: ['boolean', 'null'] },
        semester: nullableStringOrNumber,
        document_type: { enum: ['KRS', 'KHS', 'KRU', 'Jadwal', 'Tugas', 'Lainnya', null] },
      },
    },
  },
});

export const AI_RESULT_SCHEMAS = Object.freeze({
  [AI_CAPABILITIES.CHAT]: CHAT_RESULT_SCHEMA,
  [AI_CAPABILITIES.ANALYTICS]: ANALYTICS_RESULT_SCHEMA,
  [AI_CAPABILITIES.DOCUMENT_SCAN]: DOCUMENT_SCAN_RESULT_SCHEMA,
});

export const AI_RESPONSE_SCHEMA = Object.freeze({
  $id: 'unimate.ai.response.v2',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'requestId', 'capability', 'success'],
  properties: {
    schemaVersion: { const: AI_CONTRACT_VERSION },
    requestId: { type: 'string', format: 'uuid' },
    capability: { type: 'string', enum: AI_CAPABILITY_VALUES },
    success: { type: 'boolean' },
    meta: {
      type: 'object',
      additionalProperties: false,
      required: [
        'provider', 'modelId', 'selectionMode', 'complexity', 'accessMode',
        'fallbackUsed', 'fallbackReason', 'attemptCount',
      ],
      properties: {
        provider: { type: 'string', enum: AI_PROVIDER_VALUES },
        modelId: { type: 'string', enum: AI_SELECTABLE_MODEL_IDS },
        selectionMode: { type: 'string', enum: AI_SELECTION_MODE_VALUES },
        complexity: { type: 'string', enum: AI_COMPLEXITY_LEVEL_VALUES },
        accessMode: { type: 'string', enum: AI_ACCESS_MODE_VALUES },
        fallbackUsed: { type: 'boolean' },
        fallbackReason: { enum: [...AI_FALLBACK_REASON_VALUES, null] },
        attemptCount: { type: 'integer', minimum: 1, maximum: 2 },
      },
    },
    result: {
      oneOf: Object.values(AI_RESULT_SCHEMAS),
    },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'primaryReason', 'fallbackReason'],
      properties: {
        code: { type: 'string', enum: AI_ERROR_CODE_VALUES },
        message: { type: 'string', minLength: 1 },
        primaryReason: { type: ['string', 'null'] },
        fallbackReason: { type: ['string', 'null'] },
      },
    },
  },
});
