import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  AI_RUNTIME_MODEL_STATUS,
  AI_RUNTIME_PROFILE_SCOPE,
  AI_RUNTIME_STATUS_OPERATION,
  AI_RUNTIME_STATUS_VERSION,
  AI_RUNTIME_TARGET,
} from '../shared/ai/runtimeStatusContracts.mjs';
import {
  createAIRuntimeStatusResponse,
  validateAIRuntimeStatusRequest,
  validateAIRuntimeStatusResponse,
} from '../shared/ai/runtimeStatusValidation.mjs';
import {
  AIRuntimeStatusClientError,
  createAIRuntimeStatusClient,
} from '../src/services/aiRuntimeStatusClient.js';

const require = createRequire(import.meta.url);
const { AI_IPC_CHANNELS, registerAIHandlers } = require('../electron/ipc/aiHandlers.cjs');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: channel => handlers.delete(channel),
  };
}

test('kontrak status runtime ketat dan hanya memuat metadata aman', () => {
  const request = { schemaVersion: AI_RUNTIME_STATUS_VERSION, operation: AI_RUNTIME_STATUS_OPERATION };
  const response = createAIRuntimeStatusResponse({ enabled: true, state: 'running', available: true });

  assert.equal(validateAIRuntimeStatusRequest(request), true);
  assert.equal(validateAIRuntimeStatusRequest({ ...request, extra: true }), false);
  assert.equal(validateAIRuntimeStatusResponse(response), true);
  assert.equal(response.target, AI_RUNTIME_TARGET);
  assert.equal(response.profileScope, AI_RUNTIME_PROFILE_SCOPE);
  assert.equal(response.productionEnabled, true);
  assert.equal(response.rendererActivationAllowed, false);
  assert.deepEqual(response.models, AI_RUNTIME_MODEL_STATUS);
  assert.deepEqual(response.routing, {
    primary: 'gemini',
    fallback: null,
    maxFallbackAttempts: 0,
    accessMode: 'free_only',
  });
  assert.equal(validateAIRuntimeStatusResponse({ ...response, rendererActivationAllowed: true }), false);
  assert.equal(validateAIRuntimeStatusResponse({ ...response, secret: 'synthetic-secret' }), false);
});

test('client status runtime memvalidasi envelope dan gagal secara tersanitasi', async () => {
  const requests = [];
  const response = createAIRuntimeStatusResponse({ enabled: false, state: 'disabled' });
  const client = createAIRuntimeStatusClient({
    transport: async request => {
      requests.push(request);
      return { ok: true, response };
    },
  });
  assert.deepEqual(await client.getStatus(), response);
  assert.deepEqual(requests, [{ schemaVersion: 2, operation: 'status' }]);

  const invalid = createAIRuntimeStatusClient({
    transport: async () => ({ ok: true, response: { ...response, credential: 'synthetic-secret' } }),
  });
  await assert.rejects(
    invalid.getStatus(),
    error => error instanceof AIRuntimeStatusClientError
      && error.code === 'runtime_status_unavailable'
      && !error.message.includes('synthetic-secret'),
  );
});

test('IPC status menolak sender dan payload invalid serta membersihkan handler', async () => {
  const ipcMain = createIpcMain();
  let trusted = true;
  const registration = registerAIHandlers({
    ipcMain,
    senderPolicy: {
      assertTrusted() {
        if (!trusted) throw new Error('private path and synthetic-secret');
      },
    },
    gatewayRuntime: {
      getStatus: () => ({ enabled: false, state: 'disabled', available: false }),
      requestAI: async () => { throw new Error('not used'); },
    },
  });
  const handler = ipcMain.handlers.get(AI_IPC_CHANNELS.STATUS);
  const valid = await handler({}, { schemaVersion: 2, operation: 'status' });
  assert.equal(valid.ok, true);
  assert.equal(valid.response.productionEnabled, false);
  assert.equal(JSON.stringify(valid).includes('synthetic-secret'), false);

  const invalid = await handler({}, { schemaVersion: 2, operation: 'status', extra: true });
  assert.equal(invalid.error.code, 'invalid_request');
  trusted = false;
  const rejected = await handler({}, { schemaVersion: 2, operation: 'status' });
  assert.equal(rejected.error.code, 'ipc_sender_rejected');

  registration.dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('preload hanya menyediakan pembacaan status tanpa jalur aktivasi renderer', async () => {
  const source = await fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(source, /getAIRuntimeStatus/u);
  assert.match(source, /unimate:ai:status/u);
  assert.equal(source.includes('enableAIProduction'), false);
  assert.equal(source.includes('setAIProductionEnabled'), false);
  assert.equal(source.includes('gatewayToken'), false);
  assert.equal(source.includes('csrfToken'), false);
});
