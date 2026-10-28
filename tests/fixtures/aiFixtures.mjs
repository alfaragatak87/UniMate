import {
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_CONTRACT_VERSION,
  AI_ERROR_CODES,
  AI_ACCESS_MODES,
  AI_PROVIDERS,
  AI_SELECTION_MODES,
  AI_SENSITIVITIES,
} from '../../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../../shared/ai/modelCatalog.mjs';

function selection(complexity, freeTierDataConsent = true) {
  return Object.freeze({
    mode: AI_SELECTION_MODES.AUTOMATIC,
    complexity,
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    accessMode: AI_ACCESS_MODES.FREE_ONLY,
    allowModelFallback: false,
    freeTierDataConsent,
    consentVersion: 1,
  });
}

export const SYNTHETIC_REQUEST_IDS = Object.freeze({
  CHAT: '11111111-1111-4111-8111-111111111111',
  ANALYTICS: '22222222-2222-4222-8222-222222222222',
  DOCUMENT_SCAN: '33333333-3333-4333-8333-333333333333',
});

export const SYNTHETIC_CHAT_REQUEST = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.CHAT,
  capability: AI_CAPABILITIES.CHAT,
  sensitivity: AI_SENSITIVITIES.NORMAL,
  selection: selection(AI_COMPLEXITY_LEVELS.LIGHT),
  input: {
    message: 'Susun rencana belajar sintetis untuk satu minggu.',
    locale: 'id-ID',
  },
});

export const SYNTHETIC_ANALYTICS_REQUEST = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.ANALYTICS,
  capability: AI_CAPABILITIES.ANALYTICS,
  sensitivity: AI_SENSITIVITIES.PERSONAL_DATA,
  selection: selection(AI_COMPLEXITY_LEVELS.LIGHT),
  input: {
    rows: [
      { minggu: 1, nilai: 70 },
      { minggu: 2, nilai: 76 },
      { minggu: 3, nilai: 82 },
    ],
    xAxis: 'minggu',
    yAxes: ['nilai'],
  },
});

export const SYNTHETIC_DOCUMENT_REQUEST = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.DOCUMENT_SCAN,
  capability: AI_CAPABILITIES.DOCUMENT_SCAN,
  sensitivity: AI_SENSITIVITIES.ACADEMIC_DOCUMENT,
  selection: selection(AI_COMPLEXITY_LEVELS.LIGHT),
  input: {
    scanType: 'auto',
    file: {
      name: 'dokumen-sintetis.pdf',
      mimeType: 'application/pdf',
      size: 33,
      base64: 'JVBERi0xLjcKc3ludGhldGljIGRvY3VtZW50CiUlRU9G',
    },
    userContext: 'Dokumen contoh untuk pengujian tanpa data pribadi.',
  },
});

export const SYNTHETIC_CHAT_RESULT = Object.freeze({
  message: 'Fokuskan satu topik utama setiap hari dan sisakan waktu untuk evaluasi.',
});

export const SYNTHETIC_ANALYTICS_RESULT = Object.freeze({
  markdown: '- Nilai sintetis menunjukkan tren meningkat dari minggu pertama hingga ketiga.',
  points: [
    {
      title: 'Tren meningkat',
      detail: 'Nilai naik secara konsisten pada tiga baris data contoh.',
    },
  ],
});

export const SYNTHETIC_DOCUMENT_RESULT = Object.freeze({
  description: 'Dokumen sintetis menyerupai jadwal kuliah semester berjalan.',
  direction: 'khs',
  extracted_data: {
    semester_name: 'Semester Contoh',
    status: 'current',
    gpa: null,
    courses: [
      {
        name: 'Mata Kuliah Sintetis',
        sks: 3,
        grade: null,
        day: 'Senin',
        timeStart: '08:00',
        timeEnd: '09:40',
        room: 'Ruang Contoh',
        lecturer: 'Dosen Contoh',
        mode: 'Offline',
        kehadiran_ujian: null,
      },
    ],
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
    semester: 1,
    document_type: 'Jadwal',
  },
});

export const SYNTHETIC_RESULTS_BY_CAPABILITY = Object.freeze({
  [AI_CAPABILITIES.CHAT]: SYNTHETIC_CHAT_RESULT,
  [AI_CAPABILITIES.ANALYTICS]: SYNTHETIC_ANALYTICS_RESULT,
  [AI_CAPABILITIES.DOCUMENT_SCAN]: SYNTHETIC_DOCUMENT_RESULT,
});

export const SYNTHETIC_PRIMARY_RESPONSE = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.CHAT,
  capability: AI_CAPABILITIES.CHAT,
  success: true,
  meta: {
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    selectionMode: AI_SELECTION_MODES.AUTOMATIC,
    complexity: AI_COMPLEXITY_LEVELS.LIGHT,
    accessMode: AI_ACCESS_MODES.FREE_ONLY,
    fallbackUsed: false,
    fallbackReason: null,
    attemptCount: 1,
  },
  result: SYNTHETIC_CHAT_RESULT,
});

export const SYNTHETIC_GEMINI_RESPONSE = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.DOCUMENT_SCAN,
  capability: AI_CAPABILITIES.DOCUMENT_SCAN,
  success: true,
  meta: {
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    selectionMode: AI_SELECTION_MODES.AUTOMATIC,
    complexity: AI_COMPLEXITY_LEVELS.LIGHT,
    accessMode: AI_ACCESS_MODES.FREE_ONLY,
    fallbackUsed: false,
    fallbackReason: null,
    attemptCount: 1,
  },
  result: SYNTHETIC_DOCUMENT_RESULT,
});

export const SYNTHETIC_ERROR_RESPONSE = Object.freeze({
  schemaVersion: AI_CONTRACT_VERSION,
  requestId: SYNTHETIC_REQUEST_IDS.ANALYTICS,
  capability: AI_CAPABILITIES.ANALYTICS,
  success: false,
  error: {
    code: AI_ERROR_CODES.PROVIDER_UNAVAILABLE,
    message: 'Provider mock tidak tersedia.',
    primaryReason: 'provider_timeout',
    fallbackReason: null,
  },
});
