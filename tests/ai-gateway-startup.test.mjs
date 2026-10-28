import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { createGateway } from '../gateway/createGateway.mjs';
import { AI_BACKEND_MODELS } from '../shared/ai/modelCatalog.mjs';
import startupModule from '../electron/ai/gatewayStartup.cjs';
import {
  SYNTHETIC_ANALYTICS_REQUEST,
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
  SYNTHETIC_RESULTS_BY_CAPABILITY,
} from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_MUTATION,
  SYNTHETIC_GEMINI_CREDENTIAL,
  createCredentialHarness,
} from './fixtures/credentialFixtures.mjs';
import { createPermissiveBudgetGuard } from './fixtures/gatewayFixtures.mjs';

const { createAIGatewayStartup } = startupModule;

function successBody(url, result) {
  const text = JSON.stringify(result);
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] };
}

test('feature gate default nonaktif tidak mengakses credential atau provider', async () => {
  const calls = { credential: 0, executors: 0, runtime: 0 };
  const startup = createAIGatewayStartup({
    getCredentialRuntime: () => { calls.credential += 1; },
    createExecutors: async () => { calls.executors += 1; },
    createRuntime: () => { calls.runtime += 1; },
  });

  assert.deepEqual(await startup.initialize(), { enabled: false, state: 'disabled', available: false });
  assert.deepEqual(calls, { credential: 0, executors: 0, runtime: 0 });
  await assert.rejects(startup.requestAI(SYNTHETIC_CHAT_REQUEST), error => (
    error.code === 'gateway_unavailable'
    && !error.message.includes(SYNTHETIC_GEMINI_CREDENTIAL)
  ));
  assert.deepEqual(await startup.stop(), { enabled: false, state: 'disabled', available: false });
});

test('startup terintegrasi menjalankan tiga capability melalui Gemini tanpa fallback berbayar', async (t) => {
  const credentialHarness = await createCredentialHarness(t);
  await credentialHarness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const calls = [];
  let forceGeminiFailure = false;
  let gateway;
  const transport = Object.freeze({
    async send(options) {
      if (options.url.includes('api.openai.com')) throw new Error('OpenAI tidak boleh dipanggil');
      calls.push(Object.freeze({
        provider: 'gemini',
        credentialMatched: options.headers['x-goog-api-key'] === SYNTHETIC_GEMINI_CREDENTIAL,
      }));
      if (forceGeminiFailure) {
        return { ok: false, status: 504, body: { error: { code: 'synthetic_timeout' } } };
      }
      const capability = options.body.max_output_tokens === 2048 || options.body.generationConfig?.maxOutputTokens === 2048
        ? 'chat'
        : options.body.max_output_tokens === 3072 || options.body.generationConfig?.maxOutputTokens === 3072
          ? 'analytics'
          : 'document_scan';
      return { ok: true, status: 200, body: successBody(options.url, SYNTHETIC_RESULTS_BY_CAPABILITY[capability]) };
    },
  });
  const startup = createAIGatewayStartup({
    enabled: true,
    getCredentialRuntime: () => ({ service: credentialHarness.service }),
    models: AI_BACKEND_MODELS,
    transport,
      runtimeOptions: {
        randomBytesFn: () => Buffer.alloc(32, 11),
        quotaGuard: createPermissiveBudgetGuard(),
      gatewayFactory: options => {
        gateway = createGateway(options);
        return gateway;
      },
    },
  });
  t.after(() => startup.stop());

  assert.deepEqual(await startup.initialize(), { enabled: true, state: 'running', available: true });
  const primaryResponses = [];
  for (const request of [SYNTHETIC_CHAT_REQUEST, SYNTHETIC_ANALYTICS_REQUEST, SYNTHETIC_DOCUMENT_REQUEST]) {
    primaryResponses.push(await startup.requestAI(request));
  }
  assert.deepEqual(primaryResponses.map(response => response.meta.provider), ['gemini', 'gemini', 'gemini']);
  assert.deepEqual(primaryResponses.map(response => response.capability), ['chat', 'analytics', 'document_scan']);

  forceGeminiFailure = true;
  const failedResponse = await startup.requestAI({
    ...SYNTHETIC_CHAT_REQUEST,
    requestId: '55555555-5555-4555-8555-555555555555',
  });
  assert.equal(failedResponse.success, false);
  assert.equal(failedResponse.error.code, 'provider_timeout');
  assert.deepEqual(calls.map(call => call.provider), ['gemini', 'gemini', 'gemini', 'gemini']);
  assert.equal(calls.every(call => call.credentialMatched), true);
  assert.equal(JSON.stringify({ primaryResponses, failedResponse, calls }).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);

  await startup.stop();
  assert.deepEqual(startup.getStatus(), { enabled: true, state: 'stopped', available: false });
  assert.deepEqual(gateway.getResourceState(), {
    listening: false,
    sockets: 0,
    sessions: 0,
    replayEntries: 0,
    rateBuckets: 0,
    activeRequests: 0,
  });
});

test('kegagalan startup fail-closed dan tidak menghentikan aplikasi non-AI', async () => {
  const startup = createAIGatewayStartup({
    enabled: true,
    getCredentialRuntime: () => null,
    models: AI_BACKEND_MODELS,
    transport: { send: async () => { throw new Error('tidak boleh dipanggil'); } },
  });

  assert.deepEqual(await startup.initialize(), { enabled: true, state: 'unavailable', available: false });
  await assert.rejects(startup.requestAI(SYNTHETIC_CHAT_REQUEST), error => (
    error.code === 'gateway_unavailable'
    && error.message === 'Gateway AI lokal tidak tersedia.'
  ));
});

test('gate capability backend mengizinkan Chat tanpa membuka Analytics atau Scanner', async (t) => {
  const requests = [];
  const startup = createAIGatewayStartup({
    enabled: true,
    enabledCapabilities: ['chat'],
    getCredentialRuntime: () => ({ service: { withCredential: async () => null } }),
    createExecutors: async () => ({}),
    createRuntime: () => ({
      async start() {},
      async requestAI(request) {
        requests.push(request.capability);
        return { accepted: request.capability };
      },
      async stop() {},
    }),
  });
  t.after(() => startup.stop());

  await startup.initialize();
  assert.deepEqual(await startup.requestAI(SYNTHETIC_CHAT_REQUEST), { accepted: 'chat' });
  for (const request of [SYNTHETIC_ANALYTICS_REQUEST, SYNTHETIC_DOCUMENT_REQUEST]) {
    await assert.rejects(
      startup.requestAI(request),
      error => error.code === 'capability_disabled' && !error.message.includes(request.requestId),
    );
  }
  assert.deepEqual(requests, ['chat']);
});

test('konfigurasi gate capability menolak nilai asing dan duplikat', () => {
  for (const enabledCapabilities of [['chat', 'chat'], ['chat', 'unknown'], 'chat']) {
    assert.throws(() => createAIGatewayStartup({
      enabled: true,
      enabledCapabilities,
      getCredentialRuntime: () => null,
    }), /Gateway AI tidak valid/u);
  }
});

test('startup production aktif untuk Chat dan Scanner tanpa dapat diubah renderer', async () => {
  const [mainSource, preloadSource] = await Promise.all([
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /createAIGatewayStartup\(\{[\s\S]*?enabled:\s*true/u);
  assert.match(mainSource, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.equal(preloadSource.includes('gatewayStartup'), false);
  assert.equal(preloadSource.includes('providerExecutors'), false);
  assert.equal(preloadSource.includes('providerHttpTransport'), false);
});
