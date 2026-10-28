import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { createAIScannerReview } from '../src/services/aiScannerReview.js';
import { createDefaultAISelection } from '../src/services/aiClient.js';
import { CREDENTIAL_CONFIGURATION_MODES } from '../shared/credentials/transportContracts.mjs';
import { SYNTHETIC_DOCUMENT_REQUEST } from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
} from './fixtures/credentialFixtures.mjs';
import {
  createMultiAISyntheticHarness,
  waitForSynthetic,
} from './fixtures/multiAISyntheticHarness.mjs';

const ENABLED_CAPABILITIES = Object.freeze(['chat', 'document_scan']);

function requestIds(count, prefix) {
  return Array.from({ length: count }, (_, index) => (
    `${prefix}000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  ));
}

function selection(consent = true) {
  return createDefaultAISelection({ freeTierDataConsent: consent });
}

function scanInput(overrides = {}) {
  return {
    scanType: SYNTHETIC_DOCUMENT_REQUEST.input.scanType,
    file: structuredClone(SYNTHETIC_DOCUMENT_REQUEST.input.file),
    userContext: SYNTHETIC_DOCUMENT_REQUEST.input.userContext,
    selection: selection(),
    ...overrides,
  };
}

async function configureGemini(harness) {
  await harness.credentialClient.configure(
    'gemini',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_GEMINI_CREDENTIAL,
  );
}

test('Scanner production memakai Gemini backend dan hanya menghasilkan review', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  await harness.startAI({ enabledCapabilities: ENABLED_CAPABILITIES });
  const academicData = { semesters: [{ id: 1, name: 'Data Lama' }], tasks: [{ id: 2, title: 'Tugas Lama' }] };
  const snapshot = structuredClone(academicData);
  const client = harness.createAIClient(requestIds(1, 'a1'));

  const response = await client.scanDocument(scanInput());
  const review = createAIScannerReview(response, 'auto');

  assert.equal(response.success, true);
  assert.equal(review.direction, 'khs');
  assert.deepEqual(academicData, snapshot);
  assert.deepEqual(harness.control.calls.map(call => call.capability), ['document_scan']);
  assert.equal(harness.control.calls[0].provider, 'gemini');
  assert.equal(harness.control.calls[0].credentialMatched, true);
  assert.equal(JSON.stringify({ response, review }).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
});

test('Scanner menolak consent kosong dan signature palsu sebelum provider', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  await harness.startAI({ enabledCapabilities: ENABLED_CAPABILITIES });
  const client = harness.createAIClient(requestIds(2, 'a2'));

  await assert.rejects(
    client.scanDocument(scanInput({ selection: selection(false) })),
    error => error.code === 'invalid_request',
  );
  const invalidFile = { name: 'dokumen.pdf', mimeType: 'application/pdf', size: 4, base64: 'TVqQAA==' };
  await assert.rejects(
    client.scanDocument(scanInput({ file: invalidFile })),
    error => error.code === 'invalid_request',
  );
  assert.equal(harness.control.calls.length, 0);
});

test('Scanner menyelesaikan error provider satu kali dan dapat dibatalkan', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  await harness.startAI({ enabledCapabilities: ENABLED_CAPABILITIES });
  const client = harness.createAIClient(requestIds(4, 'a3'));
  const cases = Object.freeze([
    ['timeout', 'provider_timeout'],
    ['invalid_response', 'invalid_response'],
    ['rate_limited', 'rate_limited'],
  ]);

  for (const [behavior, expectedCode] of cases) {
    harness.control.behavior.gemini = behavior;
    const response = await client.scanDocument(scanInput());
    assert.equal(response.success, false);
    assert.equal(response.error.code, expectedCode);
  }

  harness.control.behavior.gemini = 'hang';
  const operation = client.startDocumentScan(scanInput());
  await waitForSynthetic(() => harness.control.calls.length === 4);
  assert.equal(await client.cancel(operation.requestId), true);
  await assert.rejects(operation.result, error => error.code === 'request_cancelled');
  await waitForSynthetic(() => harness.gateway.getResourceState().activeRequests === 0);

  const quotaState = JSON.parse(await fs.readFile(harness.quotaPath, 'utf8'));
  assert.equal(quotaState.entries.some(entry => (
    entry.requestId === operation.requestId
    && entry.status === 'settled'
    && entry.outcome === 'cancelled'
  )), true);
  assert.equal(harness.control.calls.every(call => call.provider === 'gemini'), true);
  assert.equal(harness.control.calls.some(call => call.provider === 'openai'), false);
});

test('quota lokal Scanner menolak request sebelum provider', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  for (let index = 1; index <= 15; index += 1) {
    const request = structuredClone(SYNTHETIC_DOCUMENT_REQUEST);
    request.requestId = `a4${String(index).padStart(6, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const reservation = await harness.quotaGuard.reserve(request);
    await harness.quotaGuard.settle(reservation, { success: true });
  }
  await harness.startAI({ enabledCapabilities: ENABLED_CAPABILITIES });
  const client = harness.createAIClient(requestIds(1, 'a5'));

  const response = await client.scanDocument(scanInput());
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'quota_exceeded');
  assert.equal(harness.control.calls.length, 0);
});
