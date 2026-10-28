import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_PROVIDER_ERROR_CODES, AI_PROVIDERS } from '../shared/ai/contracts.mjs';
import runtimeModule from '../electron/ai/gatewayRuntime.cjs';
import handlerModule from '../electron/ipc/aiHandlers.cjs';
import { createFrontendAIClient } from '../src/services/aiClient.js';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_CHAT_RESULT,
  SYNTHETIC_PRIMARY_RESPONSE,
} from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_MUTATION,
  SYNTHETIC_OPENAI_MUTATION,
  createCredentialHarness,
} from './fixtures/credentialFixtures.mjs';
import { createPermissiveBudgetGuard } from './fixtures/gatewayFixtures.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';

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

function createEvent(sender = {}) {
  return { sender };
}

function cancelRequest(requestId = SYNTHETIC_CHAT_REQUEST.requestId) {
  return { schemaVersion: 2, requestId };
}

test('IPC cancel sebelum request aman dan payload invalid ditolak', async () => {
  const ipcMain = createIpcMainMock();
  const sender = {};
  let runtimeCalls = 0;
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: event => { if (event.sender !== sender) throw new Error('rejected'); } },
    gatewayRuntime: { requestAI: async () => { runtimeCalls += 1; } },
  });

  const noActive = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, createEvent(sender), cancelRequest());
  const invalid = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, createEvent(sender), {
    ...cancelRequest(),
    credential: 'synthetic-forbidden-value',
  });
  const rejected = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, createEvent({}), cancelRequest());

  assert.deepEqual(noActive.response, { requestId: SYNTHETIC_CHAT_REQUEST.requestId, cancelled: false });
  assert.equal(invalid.error.code, 'invalid_request');
  assert.equal(rejected.error.code, 'ipc_sender_rejected');
  assert.equal(runtimeCalls, 0);
  registration.dispose();
});

test('IPC cancel mengabort request aktif dan mencegah requestId diproses bersamaan', async () => {
  const ipcMain = createIpcMainMock();
  const sender = {};
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: event => { if (event.sender !== sender) throw new Error('rejected'); } },
    gatewayRuntime: {
      requestAI: async (_request, { signal }) => new Promise((resolve, reject) => {
        enteredResolve();
        signal.addEventListener('abort', () => {
          const error = new Error('raw cancellation detail');
          error.code = 'request_cancelled';
          reject(error);
        }, { once: true });
      }),
    },
  });
  const event = createEvent(sender);
  const pending = ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, event, SYNTHETIC_CHAT_REQUEST);
  await entered;
  const duplicate = await ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, event, SYNTHETIC_CHAT_REQUEST);
  const cancelled = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, event, cancelRequest());
  const result = await pending;
  const after = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, event, cancelRequest());

  assert.equal(duplicate.error.code, 'request_rejected');
  assert.deepEqual(cancelled.response, { requestId: SYNTHETIC_CHAT_REQUEST.requestId, cancelled: true });
  assert.equal(result.error.code, 'request_cancelled');
  assert.equal(result.error.message, 'Permintaan AI dibatalkan.');
  assert.equal(JSON.stringify(result).includes('raw cancellation detail'), false);
  assert.equal(after.response.cancelled, false);
  registration.dispose();
});

test('cancel setelah request selesai tidak mengubah hasil', async () => {
  const ipcMain = createIpcMainMock();
  const sender = {};
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: event => { if (event.sender !== sender) throw new Error('rejected'); } },
    gatewayRuntime: { requestAI: async () => SYNTHETIC_PRIMARY_RESPONSE },
  });
  const event = createEvent(sender);

  const completed = await ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, event, SYNTHETIC_CHAT_REQUEST);
  const cancelled = await ipcMain.invoke(AI_IPC_CHANNELS.CANCEL, event, cancelRequest());
  assert.equal(completed.ok, true);
  assert.equal(cancelled.response.cancelled, false);
  registration.dispose();
});

test('dispose handler mengabort request aktif dan membersihkan channel', async () => {
  const ipcMain = createIpcMainMock();
  const sender = {};
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: () => true },
    gatewayRuntime: {
      requestAI: async (_request, { signal }) => new Promise((resolve, reject) => {
        enteredResolve();
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled');
          error.code = 'request_cancelled';
          reject(error);
        }, { once: true });
      }),
    },
  });
  const pending = ipcMain.invoke(AI_IPC_CHANNELS.REQUEST, createEvent(sender), SYNTHETIC_CHAT_REQUEST);
  await entered;
  registration.dispose();
  const result = await pending;

  assert.equal(result.error.code, 'request_cancelled');
  assert.equal(ipcMain.handlers.size, 0);
});

test('AbortSignal mencapai Gemini dan tidak memicu provider kedua', async (t) => {
  const harness = await createCredentialHarness(t);
  await harness.service.configure(SYNTHETIC_GEMINI_MUTATION);
  let geminiCalls = 0;
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const runtime = createElectronGatewayRuntime({
    credentialService: harness.service,
    providerExecutors: {
      openai: {},
      gemini: {
        [AI_DEFAULT_MODEL_ID]: async ({ signal }) => new Promise((resolve, reject) => {
          geminiCalls += 1;
          enteredResolve();
          signal.addEventListener('abort', () => {
            const error = new Error('provider aborted');
            error.code = AI_PROVIDER_ERROR_CODES.CANCELLED;
            reject(error);
          }, { once: true });
        }),
      },
    },
    randomBytesFn: () => Buffer.alloc(32, 13),
    quotaGuard: createPermissiveBudgetGuard(),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const controller = new AbortController();
  const pending = runtime.requestAI(SYNTHETIC_CHAT_REQUEST, { signal: controller.signal });
  await entered;
  controller.abort();

  await assert.rejects(pending, error => error.code === 'request_cancelled');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(geminiCalls, 1);
  await runtime.stop();
});

test('client frontend menyediakan cancellation tervalidasi', async () => {
  const calls = [];
  const client = createFrontendAIClient({
    transport: async () => ({ ok: true, response: SYNTHETIC_PRIMARY_RESPONSE }),
    cancelTransport: async requestId => {
      calls.push(requestId);
      return { ok: true, response: { requestId, cancelled: true } };
    },
    createRequestId: () => SYNTHETIC_CHAT_REQUEST.requestId,
  });

  assert.equal(await client.cancel(SYNTHETIC_CHAT_REQUEST.requestId), true);
  assert.deepEqual(calls, [SYNTHETIC_CHAT_REQUEST.requestId]);
  await assert.rejects(client.cancel(null), error => error.code === 'invalid_request');
});
