import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_CAPABILITIES,
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import { createOpenAIProviderAdapter } from '../gateway/ai/providers/openAIProviderAdapter.mjs';
import { createGeminiProviderAdapter } from '../gateway/ai/providers/geminiProviderAdapter.mjs';
import executorsModule from '../electron/ai/providerExecutors.cjs';
import {
  AI_BACKEND_MODELS,
  AI_DEFAULT_MODEL_ID,
} from '../shared/ai/modelCatalog.mjs';
import {
  SYNTHETIC_ANALYTICS_REQUEST,
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
  SYNTHETIC_RESULTS_BY_CAPABILITY,
} from './fixtures/aiFixtures.mjs';

const { createProviderExecutors } = executorsModule;
const SYNTHETIC_CREDENTIAL = 'synthetic-provider-credential-not-real';
const REQUESTS = Object.freeze([
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_ANALYTICS_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
]);

function outputTokens() {
  return {
    [AI_CAPABILITIES.CHAT]: 512,
    [AI_CAPABILITIES.ANALYTICS]: 768,
    [AI_CAPABILITIES.DOCUMENT_SCAN]: 1024,
  };
}

function createGeminiTransport(overrides = {}) {
  const calls = [];
  return {
    calls,
    async send(options) {
      calls.push(structuredClone({ ...options, signal: undefined }));
      if (overrides.response) return overrides.response;
      const result = SYNTHETIC_RESULTS_BY_CAPABILITY[overrides.capability ?? AI_CAPABILITIES.CHAT];
      return {
        ok: true,
        status: 200,
        body: {
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }],
        },
      };
    },
  };
}

function createGeminiAdapter(transport) {
  return createGeminiProviderAdapter({
    model: AI_DEFAULT_MODEL_ID,
    transport,
    timeoutMs: 5_000,
    outputTokens: outputTokens(),
  });
}

test('Gemini membentuk payload Chat, Analytics, dan Scanner tanpa membocorkan credential', async () => {
  for (const request of REQUESTS) {
    const transport = createGeminiTransport({ capability: request.capability });
    const result = await createGeminiAdapter(transport).execute({ request, credential: SYNTHETIC_CREDENTIAL });
    assert.equal(result.provider, AI_PROVIDERS.GEMINI);
    assert.equal(result.modelId, AI_DEFAULT_MODEL_ID);
    assert.deepEqual(result.result, SYNTHETIC_RESULTS_BY_CAPABILITY[request.capability]);
    assert.equal(transport.calls.length, 1);
    const call = transport.calls[0];
    assert.equal(JSON.stringify(call.body).includes(SYNTHETIC_CREDENTIAL), false);
    assert.equal(call.url.includes(SYNTHETIC_CREDENTIAL), false);
    assert.equal(call.headers['x-goog-api-key'].includes(SYNTHETIC_CREDENTIAL), true);
    if (request.capability === AI_CAPABILITIES.DOCUMENT_SCAN) {
      assert.equal(JSON.stringify(call.body).includes(request.input.file.base64), true);
      assert.equal(request.selection.freeTierDataConsent, true);
    }
  }
});

test('adapter OpenAI masa depan tidak menerima request Free Tier Gemini', async () => {
  let transportCalls = 0;
  const adapter = createOpenAIProviderAdapter({
    model: 'openai-future-model',
    transport: { send: async () => { transportCalls += 1; } },
    outputTokens: outputTokens(),
  });
  await assert.rejects(
    adapter.execute({ request: SYNTHETIC_CHAT_REQUEST, credential: SYNTHETIC_CREDENTIAL }),
    error => error.code === AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
  );
  assert.equal(transportCalls, 0);
});

test('adapter mewajibkan model eksplisit dan batas output tervalidasi', () => {
  const transport = createGeminiTransport();
  assert.throws(() => createOpenAIProviderAdapter({ transport }), /Model provider wajib/u);
  assert.throws(() => createGeminiProviderAdapter({ model: '../unsafe', transport }), /Model provider wajib/u);
  assert.throws(() => createGeminiProviderAdapter({
    model: AI_DEFAULT_MODEL_ID,
    transport,
    outputTokens: { ...outputTokens(), chat: 0 },
  }), /Batas output provider/u);
});

test('error HTTP Gemini diklasifikasikan aman dan tidak memicu retry tersembunyi', async () => {
  const cases = [
    [401, AI_PROVIDER_ERROR_CODES.AUTH_FAILED, { error: { code: 'invalid_api_key' } }],
    [429, AI_PROVIDER_ERROR_CODES.QUOTA_EXCEEDED, {
      error: {
        status: 'RESOURCE_EXHAUSTED',
        details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
      },
    }],
    [503, AI_PROVIDER_ERROR_CODES.UNAVAILABLE, { error: { code: 'server_error' } }],
  ];
  for (const [status, expectedCode, body] of cases) {
    const transport = createGeminiTransport({ response: { ok: false, status, body } });
    await assert.rejects(
      createGeminiAdapter(transport).execute({
        request: SYNTHETIC_CHAT_REQUEST,
        credential: SYNTHETIC_CREDENTIAL,
      }),
      error => error.code === expectedCode && !error.message.includes(SYNTHETIC_CREDENTIAL),
    );
    assert.equal(transport.calls.length, 1);
  }
});

test('respons malformed ditolak sebelum mencapai router', async () => {
  const transport = createGeminiTransport({
    response: { ok: true, status: 200, body: { candidates: [] } },
  });
  await assert.rejects(
    createGeminiAdapter(transport).execute({
      request: SYNTHETIC_CHAT_REQUEST,
      credential: SYNTHETIC_CREDENTIAL,
    }),
    error => error.code === AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
  );
});

test('factory executor memakai allowlist backend, mengosongkan OpenAI, dan menolak model arbitrer', async () => {
  const transport = createGeminiTransport();
  const defaultExecutors = await createProviderExecutors({ transport, outputTokens: outputTokens() });
  assert.deepEqual(Object.keys(defaultExecutors), ['gemini', 'openai']);
  assert.deepEqual(Object.keys(defaultExecutors.gemini), [AI_DEFAULT_MODEL_ID]);
  assert.deepEqual(Object.keys(defaultExecutors.openai), []);
  await assert.rejects(createProviderExecutors({
    models: { openai: ['openai-configured'], gemini: ['gemini-configured'] },
    transport,
  }), /tidak diizinkan/u);
  const executors = await createProviderExecutors({
    models: AI_BACKEND_MODELS,
    transport,
    outputTokens: outputTokens(),
  });
  assert.deepEqual(Object.keys(executors.gemini), [AI_DEFAULT_MODEL_ID]);
  assert.deepEqual(Object.keys(executors.openai), []);
});
