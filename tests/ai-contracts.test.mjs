import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_CAPABILITIES,
  AI_CONTRACT_VERSION,
  AI_LIMITS,
} from '../shared/ai/contracts.mjs';
import {
  AI_REQUEST_SCHEMA,
  AI_RESPONSE_SCHEMA,
  DOCUMENT_SCAN_RESULT_SCHEMA,
} from '../shared/ai/schemas.mjs';
import {
  AIContractValidationError,
  assertValidAIRequest,
  assertValidAIResponse,
  validateAIRequest,
  validateAIResponse,
  validateCapabilityResult,
} from '../shared/ai/validation.mjs';
import {
  SYNTHETIC_ANALYTICS_REQUEST,
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
  SYNTHETIC_DOCUMENT_RESULT,
  SYNTHETIC_ERROR_RESPONSE,
  SYNTHETIC_GEMINI_RESPONSE,
  SYNTHETIC_PRIMARY_RESPONSE,
} from './fixtures/aiFixtures.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('schema publik menggunakan kontrak Multi-AI versi 2', () => {
  assert.equal(AI_REQUEST_SCHEMA.properties.schemaVersion.const, AI_CONTRACT_VERSION);
  assert.equal(AI_RESPONSE_SCHEMA.properties.schemaVersion.const, AI_CONTRACT_VERSION);
  assert.equal(DOCUMENT_SCAN_RESULT_SCHEMA.additionalProperties, false);
});

test('menerima request chat sintetis', () => {
  assert.deepEqual(validateAIRequest(SYNTHETIC_CHAT_REQUEST), { valid: true, errors: [] });
});

test('menerima request analytics sintetis', () => {
  assert.deepEqual(validateAIRequest(SYNTHETIC_ANALYTICS_REQUEST), { valid: true, errors: [] });
});

test('menerima request document scan sintetis', () => {
  assert.deepEqual(validateAIRequest(SYNTHETIC_DOCUMENT_REQUEST), { valid: true, errors: [] });
});

test('menolak versi kontrak yang tidak didukung', () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  request.schemaVersion = 1;
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak capability yang tidak dikenal', () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  request.capability = 'unknown_capability';
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak sensitivitas yang tidak sesuai capability', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.sensitivity = 'normal';
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak field tambahan pada request', () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  request.apiKey = 'nilai-sintetis-yang-tidak-boleh-diterima';
  const validation = validateAIRequest(request);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(error => error.path === '$.apiKey'), true);
});

test('menolak analytics lebih dari 50 baris', () => {
  const request = clone(SYNTHETIC_ANALYTICS_REQUEST);
  request.input.rows = Array.from({ length: AI_LIMITS.ANALYTICS_ROWS + 1 }, (_, index) => ({ minggu: index + 1, nilai: 70 }));
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak base64 dokumen yang tidak valid', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file.base64 = 'bukan base64';
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak signature dokumen yang tidak sesuai MIME', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file.size = 4;
  request.input.file.base64 = 'TVqQAA==';
  assert.equal(validateAIRequest(request).valid, false);
});

test('assert request melempar error terstruktur', () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  delete request.selection;
  assert.throws(() => assertValidAIRequest(request), AIContractValidationError);
});

test('menerima response Gemini primary tanpa fallback', () => {
  assert.deepEqual(validateAIResponse(SYNTHETIC_PRIMARY_RESPONSE), { valid: true, errors: [] });
  assert.equal(assertValidAIResponse(SYNTHETIC_PRIMARY_RESPONSE), SYNTHETIC_PRIMARY_RESPONSE);
});

test('menerima response Gemini document tanpa fallback', () => {
  assert.deepEqual(validateAIResponse(SYNTHETIC_GEMINI_RESPONSE), { valid: true, errors: [] });
});

test('menerima response error terstruktur', () => {
  assert.deepEqual(validateAIResponse(SYNTHETIC_ERROR_RESPONSE), { valid: true, errors: [] });
});

test('menolak metadata provider berbayar atau fallback yang tidak konsisten', () => {
  const response = clone(SYNTHETIC_GEMINI_RESPONSE);
  response.meta.provider = 'openai';
  assert.equal(validateAIResponse(response).valid, false);
  response.meta.provider = 'gemini';
  response.meta.fallbackUsed = true;
  response.meta.attemptCount = 2;
  response.meta.fallbackReason = 'primary_timeout';
  assert.equal(validateAIResponse(response).valid, false);
});

test('menolak response sukses dengan field error', () => {
  const response = clone(SYNTHETIC_PRIMARY_RESPONSE);
  response.error = clone(SYNTHETIC_ERROR_RESPONSE.error);
  assert.equal(validateAIResponse(response).valid, false);
});

test('menolak OpenAI dan fallback otomatis pada selection', () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  request.selection.provider = 'openai';
  request.selection.allowModelFallback = true;
  assert.equal(validateAIRequest(request).valid, false);
});

test('menolak dokumen sensitif tanpa consent Free Tier', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.selection.freeTierDataConsent = false;
  assert.equal(validateAIRequest(request).valid, false);
});

test('menerima hasil scanner lengkap', () => {
  assert.deepEqual(validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, SYNTHETIC_DOCUMENT_RESULT), { valid: true, errors: [] });
});

test('menolak hasil scanner yang kehilangan field wajib', () => {
  const result = clone(SYNTHETIC_DOCUMENT_RESULT);
  delete result.extracted_data.courses;
  assert.equal(validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, result).valid, false);
});
