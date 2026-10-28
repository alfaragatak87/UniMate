import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  AI_DEFAULT_PREFERENCES,
  AI_PREFERENCE_OPERATIONS,
  AI_PREFERENCE_TRANSPORT_VERSION,
} from '../shared/ai/preferenceTransportContracts.mjs';
import {
  AIPreferenceClientError,
  createAIPreferenceClient,
} from '../src/services/aiPreferenceClient.js';

const require = createRequire(import.meta.url);
const { AI_PREFERENCE_IPC_CHANNELS, registerAIPreferenceHandlers } = require('../electron/ipc/preferenceHandlers.cjs');
const { createAIPreferencePreloadBridge } = require('../electron/ipc/preferencePreloadBridge.cjs');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: channel => handlers.delete(channel),
  };
}

function safeStatus() {
  return {
    schemaVersion: AI_PREFERENCE_TRANSPORT_VERSION,
    operation: AI_PREFERENCE_OPERATIONS.STATUS,
    storage: 'missing',
    preferences: AI_DEFAULT_PREFERENCES,
    policy: { primaryProvider: 'gemini', openaiEnabled: false, automaticProviderFallback: false },
    quota: null,
  };
}

test('IPC preference memvalidasi sender, operasi, field tambahan, dan sanitasi error', async () => {
  const ipcMain = createIpcMain();
  const trustedSender = {};
  const calls = [];
  const registration = registerAIPreferenceHandlers({
    ipcMain,
    senderPolicy: {
      assertTrusted: event => {
        if (event.sender !== trustedSender) throw new Error('private-path synthetic-secret');
      },
    },
    preferenceController: {
      execute: async request => {
        calls.push(request.operation);
        if (request.operation === 'status') return safeStatus();
        return { schemaVersion: 1, operation: 'update', changed: true };
      },
    },
  });
  const status = await ipcMain.handlers.get(AI_PREFERENCE_IPC_CHANNELS.STATUS)(
    { sender: trustedSender },
    { schemaVersion: 1, operation: 'status' },
  );
  const invalid = await ipcMain.handlers.get(AI_PREFERENCE_IPC_CHANNELS.UPDATE)(
    { sender: trustedSender },
    { schemaVersion: 1, operation: 'update', preferences: AI_DEFAULT_PREFERENCES, secret: 'synthetic-secret' },
  );
  const rejected = await ipcMain.handlers.get(AI_PREFERENCE_IPC_CHANNELS.STATUS)(
    { sender: {} },
    { schemaVersion: 1, operation: 'status' },
  );
  assert.equal(status.ok, true);
  assert.equal(invalid.error.code, 'invalid_request');
  assert.equal(rejected.error.code, 'ipc_sender_rejected');
  assert.equal(JSON.stringify({ status, invalid, rejected }).includes('synthetic-secret'), false);
  assert.deepEqual(calls, ['status']);
  registration.dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('preload preference hanya mengekspos status dan update terstruktur', async () => {
  const calls = [];
  const bridge = createAIPreferencePreloadBridge({
    ipcRenderer: {
      invoke: async (channel, request) => {
        calls.push({ channel, request });
        return { ok: true };
      },
    },
  });
  await bridge.getAIPreferenceStatus();
  await bridge.updateAIPreferences({
    schemaVersion: 1,
    operation: 'update',
    preferences: AI_DEFAULT_PREFERENCES,
  });
  assert.deepEqual(Object.keys(bridge), ['getAIPreferenceStatus', 'updateAIPreferences']);
  assert.deepEqual(calls.map(call => call.channel), [
    AI_PREFERENCE_IPC_CHANNELS.STATUS,
    AI_PREFERENCE_IPC_CHANNELS.UPDATE,
  ]);
  assert.equal(JSON.stringify(calls).includes('credential'), false);
});

test('client preference memvalidasi response dan gagal aman tanpa bridge', async () => {
  const client = createAIPreferenceClient({
    statusTransport: async () => ({ ok: true, response: safeStatus() }),
    updateTransport: async request => ({
      ok: true,
      response: { schemaVersion: request.schemaVersion, operation: 'update', changed: true },
    }),
  });
  assert.deepEqual(await client.getStatus(), safeStatus());
  assert.equal((await client.update(AI_DEFAULT_PREFERENCES)).changed, true);

  const invalid = createAIPreferenceClient({
    statusTransport: async () => ({ ok: true, response: { ...safeStatus(), secret: 'synthetic-secret' } }),
    updateTransport: async () => ({ ok: false }),
  });
  await assert.rejects(
    invalid.getStatus(),
    error => error instanceof AIPreferenceClientError
      && error.code === 'operation_failed'
      && !error.message.includes('synthetic-secret'),
  );
});
