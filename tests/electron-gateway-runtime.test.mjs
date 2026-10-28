import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_PROVIDERS } from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import { createGateway } from '../gateway/createGateway.mjs';
import { createMockProvider } from '../gateway/ai/providers/mockProvider.mjs';
import runtimeModule from '../electron/ai/gatewayRuntime.cjs';
import handlerModule from '../electron/ipc/aiHandlers.cjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_RESULTS_BY_CAPABILITY,
} from './fixtures/aiFixtures.mjs';
import { createPermissiveBudgetGuard } from './fixtures/gatewayFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_GEMINI_MUTATION,
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_MUTATION,
  createCredentialHarness,
} from './fixtures/credentialFixtures.mjs';

const { createElectronGatewayRuntime } = runtimeModule;
const { AI_IPC_CHANNELS, registerAIHandlers } = handlerModule;

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error('duplicate handler');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, event, request) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('handler missing');
      return handler(event, request);
    },
  };
}

function createExecutor(provider, modelId, expectedCredential, callCounts) {
  const mock = createMockProvider({ provider, modelId, responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
  return async ({ request, credential }) => {
    assert.equal(credential, expectedCredential);
    callCounts[provider] += 1;
    return mock.generate(request);
  };
}

test('IPC AI memakai credential-backed Gateway M2 dan membersihkan seluruh resource', async (t) => {
  const credentialHarness = await createCredentialHarness(t);
  await credentialHarness.service.configure(SYNTHETIC_OPENAI_MUTATION);
  await credentialHarness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  const callCounts = { openai: 0, gemini: 0 };
  let gateway;
  let gatewayProviderMode;
  const runtime = createElectronGatewayRuntime({
    credentialService: credentialHarness.service,
    providerExecutors: {
      openai: {},
      gemini: {
        [AI_DEFAULT_MODEL_ID]: createExecutor(
          AI_PROVIDERS.GEMINI,
          AI_DEFAULT_MODEL_ID,
          SYNTHETIC_GEMINI_CREDENTIAL,
          callCounts,
        ),
      },
    },
    randomBytesFn: () => Buffer.alloc(32, 9),
    budgetGuard: createPermissiveBudgetGuard(),
    quotaGuard: createPermissiveBudgetGuard(),
    gatewayFactory: options => {
      gatewayProviderMode = options.providerMode;
      gateway = createGateway(options);
      return gateway;
    },
  });
  const ipcMain = createIpcMainMock();
  const senderPolicy = { assertTrusted: () => true };
  const registration = registerAIHandlers({ ipcMain, senderPolicy, gatewayRuntime: runtime });
  t.after(async () => {
    registration.dispose();
    await runtime.stop();
  });

  await runtime.start();
  assert.equal(gatewayProviderMode, 'credential-backed');
  assert.equal(gateway.getAddress().host, '127.0.0.1');
  const result = await ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, {}, SYNTHETIC_CHAT_REQUEST);
  assert.equal(result.ok, true);
  assert.equal(result.response.success, true);
  assert.deepEqual(callCounts, { openai: 0, gemini: 1 });
  assert.equal(gateway.getResourceState().sessions, 1);
  const serialized = JSON.stringify(result);
  for (const forbidden of [SYNTHETIC_OPENAI_CREDENTIAL, SYNTHETIC_GEMINI_CREDENTIAL, 'csrfToken', 'cookie', 'Bearer']) {
    assert.equal(serialized.includes(forbidden), false);
  }

  registration.dispose();
  await runtime.stop();
  assert.deepEqual(gateway.getResourceState(), {
    listening: false,
    sockets: 0,
    sessions: 0,
    replayEntries: 0,
    rateBuckets: 0,
    activeRequests: 0,
  });
  assert.equal(ipcMain.handlers.size, 0);
});

test('IPC AI menolak sender dan payload invalid sebelum runtime', async () => {
  const ipcMain = createIpcMainMock();
  let runtimeCalls = 0;
  let allowSender = false;
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: () => { if (!allowSender) throw new Error('rejected'); } },
    gatewayRuntime: { requestAI: async () => { runtimeCalls += 1; } },
  });
  const senderRejected = await ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, {}, SYNTHETIC_CHAT_REQUEST);
  allowSender = true;
  const payloadRejected = await ipcMain.invoke(
    AI_IPC_CHANNELS.REQUEST,
    {},
    { ...SYNTHETIC_CHAT_REQUEST, token: SYNTHETIC_OPENAI_CREDENTIAL },
  );
  assert.equal(senderRejected.error.code, 'ipc_sender_rejected');
  assert.equal(payloadRejected.error.code, 'invalid_request');
  assert.equal(runtimeCalls, 0);
  assert.equal(JSON.stringify({ senderRejected, payloadRejected }).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  registration.dispose();
});

test('kegagalan runtime dikembalikan sebagai error aman tanpa raw exception', async () => {
  const ipcMain = createIpcMainMock();
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: () => true },
    gatewayRuntime: {
      requestAI: async () => {
        throw new Error(`${SYNTHETIC_OPENAI_CREDENTIAL} C:\\Users\\private-user`);
      },
    },
  });
  const result = await ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, {}, SYNTHETIC_CHAT_REQUEST);
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'gateway_unavailable', message: 'Gateway AI lokal tidak tersedia.' },
  });
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  registration.dispose();
});
