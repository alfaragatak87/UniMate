import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  AI_DEFAULT_PREFERENCES,
  AI_PREFERENCE_OPERATIONS,
  AI_PREFERENCE_TRANSPORT_VERSION,
} from '../shared/ai/preferenceTransportContracts.mjs';

const require = createRequire(import.meta.url);
const { createAIPreferenceController } = require('../electron/ai/preferenceController.cjs');
const { createAIPreferenceFileStore } = require('../electron/ai/preferenceFileStore.cjs');

function clone(value) {
  return structuredClone(value);
}

function statusRequest() {
  return { schemaVersion: AI_PREFERENCE_TRANSPORT_VERSION, operation: AI_PREFERENCE_OPERATIONS.STATUS };
}

function updateRequest(overrides = {}) {
  return {
    schemaVersion: AI_PREFERENCE_TRANSPORT_VERSION,
    operation: AI_PREFERENCE_OPERATIONS.UPDATE,
    preferences: { ...AI_DEFAULT_PREFERENCES, ...overrides },
  };
}

test('status awal memakai default tanpa menulis penyimpanan', async () => {
  let writes = 0;
  const controller = createAIPreferenceController({
    store: {
      read: async () => ({ status: 'missing', state: null }),
      write: async () => { writes += 1; },
    },
    quotaGuard: {
      getStatus: async modelId => ({
        modelId,
        verifiedAt: '2026-10-21',
        realtime: false,
        periodTimezone: 'America/Los_Angeles',
        limits: { requestsPerMinute: 15, inputTokensPerMinute: 250_000, requestsPerDay: 500 },
        locallyObserved: { requestsThisMinute: 0, inputTokensThisMinute: 0, requestsToday: 0 },
      }),
    },
  });
  const response = await controller.execute(statusRequest());
  assert.equal(response.storage, 'missing');
  assert.deepEqual(response.preferences, AI_DEFAULT_PREFERENCES);
  assert.equal(response.policy.primaryProvider, 'gemini');
  assert.equal(response.policy.openaiEnabled, false);
  assert.equal(response.quota.realtime, false);
  assert.equal(writes, 0);
});

test('preferensi tersimpan atomik dan dapat dibaca setelah restart service', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-preference-test-'));
  const filePath = path.join(directory, 'preferences.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = createAIPreferenceController({
    store: createAIPreferenceFileStore({ filePath }),
    now: () => 1_800_000_000_000,
  });
  await first.execute(updateRequest({ mode: 'manual', complexity: 'heavy' }));
  const second = createAIPreferenceController({
    store: createAIPreferenceFileStore({ filePath }),
    now: () => 1_800_000_001_000,
  });
  const response = await second.execute(statusRequest());
  assert.equal(response.storage, 'ready');
  assert.equal(response.preferences.mode, 'manual');
  assert.equal(response.preferences.complexity, 'heavy');
  const entries = await fs.readdir(directory);
  assert.deepEqual(entries, ['preferences.json']);
});

test('file preferensi rusak tidak ditimpa oleh update', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-preference-corrupt-'));
  const filePath = path.join(directory, 'preferences.json');
  const corrupt = '{synthetic-corrupt-preference';
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(filePath, corrupt, 'utf8');
  const controller = createAIPreferenceController({
    store: createAIPreferenceFileStore({ filePath }),
    now: () => 1_800_000_000_000,
  });
  assert.equal((await controller.execute(statusRequest())).storage, 'corrupt');
  await assert.rejects(controller.execute(updateRequest()), error => error.code === 'storage_corrupt');
  assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);
});

test('mutasi preferensi diserialisasi untuk mencegah lost update', async () => {
  let state = null;
  let activeWrites = 0;
  let maximumWrites = 0;
  const controller = createAIPreferenceController({
    store: {
      read: async () => state === null
        ? { status: 'missing', state: null }
        : { status: 'ready', state: clone(state) },
      write: async value => {
        activeWrites += 1;
        maximumWrites = Math.max(maximumWrites, activeWrites);
        await new Promise(resolve => setTimeout(resolve, 5));
        state = clone(value);
        activeWrites -= 1;
      },
    },
    now: (() => {
      let value = 1_800_000_000_000;
      return () => value++;
    })(),
  });
  await Promise.all([
    controller.execute(updateRequest({ mode: 'manual', complexity: 'light' })),
    controller.execute(updateRequest({ mode: 'manual', complexity: 'heavy' })),
  ]);
  assert.equal(maximumWrites, 1);
  assert.equal((await controller.execute(statusRequest())).preferences.complexity, 'heavy');
});

test('payload tidak valid dan model parsial ditolak tanpa penulisan', async () => {
  let writes = 0;
  const controller = createAIPreferenceController({
    store: {
      read: async () => ({ status: 'missing', state: null }),
      write: async () => { writes += 1; },
    },
  });
  await assert.rejects(
    controller.execute({ ...updateRequest(), secret: 'synthetic-secret' }),
    error => error.code === 'invalid_request',
  );
  await assert.rejects(
    controller.execute(updateRequest({ modelId: 'gemini-3.1-flash-lite' })),
    error => error.code === 'invalid_request',
  );
  assert.equal(writes, 0);
});
