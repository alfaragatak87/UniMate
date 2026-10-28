import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  AI_ACCESS_MODES,
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_CONTRACT_VERSION,
  AI_PROVIDERS,
  AI_SELECTION_MODES,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import {
  AIScannerReviewError,
  createAIScannerReview,
} from '../src/services/aiScannerReview.js';
import { SYNTHETIC_DOCUMENT_RESULT } from './fixtures/aiFixtures.mjs';

function createResponse(overrides = {}) {
  return {
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: 'b3333333-3333-4333-8333-333333333333',
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
    result: structuredClone(SYNTHETIC_DOCUMENT_RESULT),
    ...overrides,
  };
}

test('hasil scanner valid hanya membentuk review tanpa mengubah data akademik', () => {
  const academicData = {
    semesters: [{ id: 1, name: 'Semester Lama', courses: [{ name: 'Data Lama' }] }],
    tasks: [{ id: 2, title: 'Tugas Lama' }],
  };
  const snapshot = structuredClone(academicData);
  const response = createResponse();
  const responseSnapshot = structuredClone(response);
  const review = createAIScannerReview(response, 'auto');

  assert.deepEqual(academicData, snapshot);
  assert.deepEqual(response, responseSnapshot);
  assert.equal(review.direction, 'khs');
  assert.equal(review.suggestion.extracted_data.courses[0].name, 'Mata Kuliah Sintetis');
  assert.equal(Object.isFrozen(review.suggestion.extracted_data), true);
});

test('hasil scanner rusak, capability salah, dan mode salah ditolak', () => {
  assert.throws(
    () => createAIScannerReview(createResponse({ capability: AI_CAPABILITIES.CHAT }), 'auto'),
    AIScannerReviewError,
  );
  assert.throws(
    () => createAIScannerReview({ ...createResponse(), debug: 'field-tambahan' }, 'auto'),
    AIScannerReviewError,
  );
  assert.throws(() => createAIScannerReview(createResponse(), 'unknown-mode'), AIScannerReviewError);
});

test('handler scan tidak menulis data dan penyimpanan hanya tersedia pada aksi konfirmasi', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  const scanStart = source.indexOf('const handleScan = async');
  const saveStart = source.indexOf('const saveKHS =');
  const scanSource = source.slice(scanStart, saveStart);

  assert.equal(scanStart >= 0 && saveStart > scanStart, true);
  assert.equal(scanSource.includes('setSemesters('), false);
  assert.equal(scanSource.includes('setTasks('), false);
  assert.match(scanSource, /createAIScannerReview\(response, scanType\)/u);
  assert.match(scanSource, /AI_DOCUMENT_MIME_TYPES\.includes\(fileToUpload\.type\)/u);
  assert.match(scanSource, /selection\.freeTierDataConsent/u);
  assert.match(source, /onClick=\{saveManual\}/u);
  assert.match(source, /onClick=\{closeReview\}/u);
});
