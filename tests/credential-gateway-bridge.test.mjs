import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import { createAIRouter } from '../gateway/ai/router.mjs';
import {
  CredentialBackedProviderError,
  createCredentialBackedProvider,
} from '../gateway/ai/providers/credentialBackedProvider.mjs';
import { createMockProvider } from '../gateway/ai/providers/mockProvider.mjs';
import gatewayRuntimeModule from '../electron/ai/gatewayRuntime.cjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_RESULTS_BY_CAPABILITY,
} from './fixtures/aiFixtures.mjs';
import { createPermissiveBudgetGuard } from './fixtures/gatewayFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_GEMINI_MUTATION,
  createCredentialHarness,
} from './fixtures/credentialFixtures.mjs';

const { createElectronGatewayRuntime } = gatewayRuntimeModule;

function createExecutor(calls) {
  const mock = createMockProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    responses: SYNTHETIC_RESULTS_BY_CAPABILITY,
  });
  return async ({ request, credential }) => {
    calls.push({
      provider: AI_PROVIDERS.GEMINI,
      modelId: AI_DEFAULT_MODEL_ID,
      credentialMatches: credential === SYNTHETIC_GEMINI_CREDENTIAL,
    });
    return mock.generate(request);
  };
}

test('provider Gemini credential menjalankan mock tanpa mengembalikan secret', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const calls = [];
  const provider = createCredentialBackedProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    credentialService: harness.service,
    execute: createExecutor(calls),
  });
  const result = await provider.generate(SYNTHETIC_CHAT_REQUEST);
  assert.equal(result.provider, AI_PROVIDERS.GEMINI);
  assert.equal(result.modelId, AI_DEFAULT_MODEL_ID);
  assert.deepEqual(calls, [{
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    credentialMatches: true,
  }]);
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
});

test('credential Gemini hilang gagal tanpa mencoba OpenAI', async (t) => {
  const harness = await createCredentialHarness(t);
  const calls = [];
  const provider = createCredentialBackedProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    credentialService: harness.service,
    execute: createExecutor(calls),
  });
  const router = createAIRouter({ providers: { [AI_DEFAULT_MODEL_ID]: provider } });
  const response = await router.route(SYNTHETIC_CHAT_REQUEST);
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'provider_unavailable');
  assert.equal(response.error.fallbackReason, null);
  assert.equal(calls.length, 0);
});

test('provider credential menolak model yang tidak sesuai sebelum membuka secret', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  assert.throws(() => createCredentialBackedProvider({
    provider: AI_PROVIDERS.OPENAI,
    modelId: AI_DEFAULT_MODEL_ID,
    credentialService: harness.service,
    execute: async () => null,
  }), TypeError);
});

test('hasil executor yang membocorkan credential ditolak dan error disanitasi', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const provider = createCredentialBackedProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    credentialService: harness.service,
    execute: async ({ credential }) => ({
      provider: AI_PROVIDERS.GEMINI,
      modelId: AI_DEFAULT_MODEL_ID,
      result: { message: credential },
    }),
  });
  let captured;
  await assert.rejects(provider.generate(SYNTHETIC_CHAT_REQUEST), error => {
    captured = error;
    return error instanceof CredentialBackedProviderError
      && error.code === AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE;
  });
  assert.equal(JSON.stringify(captured).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
});

test('runtime gateway memakai loopback dan tidak mengekspos token atau session', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const runtime = createElectronGatewayRuntime({
    credentialService: harness.service,
    providerExecutors: {
      openai: {},
      gemini: { [AI_DEFAULT_MODEL_ID]: createExecutor([]) },
    },
    randomBytesFn: () => Buffer.alloc(32, 7),
    quotaGuard: createPermissiveBudgetGuard(),
  });
  t.after(() => runtime.stop());
  assert.deepEqual(await runtime.start(), { state: 'running', available: true });
  const response = await runtime.requestAI(SYNTHETIC_CHAT_REQUEST);
  assert.equal(response.success, true);
  assert.deepEqual(Object.keys(runtime).sort(), ['getStatus', 'requestAI', 'start', 'stop']);
  const serialized = JSON.stringify({ status: runtime.getStatus(), response });
  assert.equal(serialized.includes('csrf'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
  await runtime.stop();
  assert.deepEqual(runtime.getStatus(), { state: 'stopped', available: false });
});
