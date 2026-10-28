import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_ERROR_CODES,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import { MOCK_PROVIDER_SCENARIOS } from '../gateway/ai/providers/mockProvider.mjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';
import {
  aiHeaders,
  clone,
  openSyntheticSession,
  requestGateway,
  startSyntheticGateway,
} from './fixtures/gatewayFixtures.mjs';

async function prepare(t, options = {}) {
  const harness = await startSyntheticGateway(options);
  t.after(() => harness.gateway.stop());
  const session = await openSyntheticSession(harness);
  assert.equal(session.response.statusCode, 201);
  return { harness, session };
}

async function sendAI(harness, session, body) {
  return requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body,
  });
}

test('Gemini mock menjadi provider utama tanpa fallback', async (t) => {
  const { harness, session } = await prepare(t);
  const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.meta.provider, AI_PROVIDERS.GEMINI);
  assert.equal(response.body.meta.modelId, AI_DEFAULT_MODEL_ID);
  assert.equal(response.body.meta.fallbackUsed, false);
  assert.equal(response.body.meta.attemptCount, 1);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
  assert.equal(harness.fallbackProvider, null);
});

test('timeout Gemini berhenti setelah satu percobaan tanpa fallback', async (t) => {
  const { harness, session } = await prepare(t, {
    primaryScenario: MOCK_PROVIDER_SCENARIOS.TIMEOUT,
  });
  const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(response.statusCode, 504);
  assert.equal(response.body.error.code, AI_ERROR_CODES.PROVIDER_TIMEOUT);
  assert.equal(response.body.error.fallbackReason, null);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('dokumen tanpa consent Free Tier ditolak sebelum provider', async (t) => {
  const { harness, session } = await prepare(t);
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.selection.freeTierDataConsent = false;
  const response = await sendAI(harness, session, request);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, AI_ERROR_CODES.INVALID_REQUEST);
  assert.equal(harness.primaryProvider.getCallCount(), 0);
});

test('rate limit provider tidak memicu model atau provider kedua', async (t) => {
  const { harness, session } = await prepare(t, {
    primaryScenario: MOCK_PROVIDER_SCENARIOS.RATE_LIMITED,
  });
  const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(response.statusCode, 429);
  assert.equal(response.body.error.code, AI_ERROR_CODES.RATE_LIMITED);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('respons Gemini tidak valid ditolak tanpa fallback', async (t) => {
  const { harness, session } = await prepare(t, {
    primaryScenario: MOCK_PROVIDER_SCENARIOS.INVALID_RESPONSE,
  });
  const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error.code, AI_ERROR_CODES.INVALID_RESPONSE);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('payload tidak valid ditolak sebelum provider dipanggil', async (t) => {
  const { harness, session } = await prepare(t);
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  request.input.message = '';
  const response = await sendAI(harness, session, request);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'invalid_request');
  assert.equal(harness.primaryProvider.getCallCount(), 0);
});

test('pembatalan provider tidak memicu request kedua', async (t) => {
  const { harness, session } = await prepare(t, {
    primaryScenario: MOCK_PROVIDER_SCENARIOS.CANCELLED,
  });
  const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, AI_ERROR_CODES.REQUEST_CANCELLED);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('gateway mock tidak memakai global fetch atau provider eksternal', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Koneksi provider eksternal tidak boleh terjadi');
  };

  try {
    const { harness, session } = await prepare(t);
    const response = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);
    assert.equal(response.statusCode, 200);
    assert.equal(harness.primaryProvider.getCallCount(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
