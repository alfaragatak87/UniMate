import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AI_FREE_TIER_QUOTA_ENTRY_STATUS,
  AI_FREE_TIER_QUOTA_SCHEMA_VERSION,
} from '../shared/ai/freeTierQuotaContracts.mjs';
import {
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_CATALOG_VERSION,
} from '../shared/ai/modelCatalog.mjs';
import {
  createAIFreeTierQuotaGuard,
  estimateFreeTierInputTokens,
} from '../gateway/ai/freeTierQuotaGuard.mjs';
import quotaStoreModule from '../electron/ai/quotaFileStore.cjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';

const { createAIQuotaFileStore } = quotaStoreModule;
const FIXED_TIME = Date.parse('2026-10-21T12:00:00.000Z');

function clone(value) {
  return structuredClone(value);
}

function requestWithId(index, source = SYNTHETIC_CHAT_REQUEST) {
  const request = clone(source);
  request.requestId = `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return request;
}

function createMemoryStore(initial = null) {
  let state = initial === null ? null : clone(initial);
  let writes = 0;
  return {
    read: async () => state === null
      ? { status: 'missing', state: null }
      : { status: 'ready', state: clone(state) },
    write: async value => {
      writes += 1;
      state = clone(value);
    },
    snapshot: () => (state === null ? null : clone(state)),
    writes: () => writes,
  };
}

function quotaState(entries) {
  return {
    schemaVersion: AI_FREE_TIER_QUOTA_SCHEMA_VERSION,
    modelCatalogVersion: AI_MODEL_CATALOG_VERSION,
    entries,
  };
}

function settledEntry(index, createdAt, dayKey) {
  return {
    requestId: `91000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    modelId: AI_DEFAULT_MODEL_ID,
    createdAt,
    dayKey,
    inputTokens: 1,
    outputTokenLimit: 2048,
    status: AI_FREE_TIER_QUOTA_ENTRY_STATUS.SETTLED,
    outcome: 'success',
  };
}

test('status kuota missing tidak menulis file dan tidak mengklaim realtime', async () => {
  const store = createMemoryStore();
  const guard = createAIFreeTierQuotaGuard({ store, now: () => FIXED_TIME });
  const status = await guard.getStatus(AI_DEFAULT_MODEL_ID);
  assert.equal(status.realtime, false);
  assert.equal(status.periodTimezone, 'America/Los_Angeles');
  assert.deepEqual(status.locallyObserved, {
    requestsThisMinute: 0,
    inputTokensThisMinute: 0,
    requestsToday: 0,
  });
  assert.equal(store.writes(), 0);
});

test('reservasi concurrent mematuhi batas RPM tanpa race condition', async () => {
  const store = createMemoryStore();
  const guard = createAIFreeTierQuotaGuard({ store, now: () => FIXED_TIME });
  const results = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) => guard.reserve(requestWithId(index + 1))),
  );
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 15);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'quota_exceeded').length, 1);
  assert.equal(store.snapshot().entries.length, 15);
});

test('batas TPM menolak dokumen besar sebelum provider dipanggil', async () => {
  const store = createMemoryStore();
  const guard = createAIFreeTierQuotaGuard({ store, now: () => FIXED_TIME });
  const request = requestWithId(100, SYNTHETIC_DOCUMENT_REQUEST);
  const document = Buffer.alloc(500_000, 0x20);
  document.write('%PDF-1.7\n', 0, 'ascii');
  request.input.file.size = document.length;
  request.input.file.base64 = document.toString('base64');
  assert.ok(estimateFreeTierInputTokens(request) > 250_000);
  await assert.rejects(guard.reserve(request), error => error.code === 'quota_exceeded');
  assert.equal(store.writes(), 0);
});

test('batas RPD menggunakan ledger lokal hari Pacific', async () => {
  const entries = Array.from({ length: 500 }, (_, index) => (
    settledEntry(index + 1, FIXED_TIME - 120_000, '2026-10-21')
  ));
  const store = createMemoryStore(quotaState(entries));
  const guard = createAIFreeTierQuotaGuard({ store, now: () => FIXED_TIME });
  const status = await guard.getStatus(AI_DEFAULT_MODEL_ID);
  assert.equal(status.locallyObserved.requestsThisMinute, 0);
  assert.equal(status.locallyObserved.requestsToday, 500);
  await assert.rejects(guard.reserve(requestWithId(700)), error => error.code === 'quota_exceeded');
});

test('pergantian hari Pacific mereset hitungan harian tanpa menghapus ledger', async () => {
  const beforeMidnight = Date.parse('2026-10-21T06:59:00.000Z');
  const afterMidnight = Date.parse('2026-10-21T07:01:00.000Z');
  const store = createMemoryStore(quotaState([
    settledEntry(1, beforeMidnight, '2026-10-20'),
  ]));
  const guard = createAIFreeTierQuotaGuard({ store, now: () => afterMidnight });
  const status = await guard.getStatus(AI_DEFAULT_MODEL_ID);
  assert.equal(status.locallyObserved.requestsToday, 0);
  assert.equal(store.snapshot().entries.length, 1);
});

test('ledger persisten setelah restart dan tidak menyimpan prompt, dokumen, atau credential', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-quota-test-'));
  const filePath = path.join(directory, 'quota.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const guard = createAIFreeTierQuotaGuard({
    store: createAIQuotaFileStore({ filePath }),
    now: () => FIXED_TIME,
  });
  const reservation = await guard.reserve(SYNTHETIC_DOCUMENT_REQUEST);
  await guard.settle(reservation, { success: true });
  const restarted = createAIFreeTierQuotaGuard({
    store: createAIQuotaFileStore({ filePath }),
    now: () => FIXED_TIME,
  });
  assert.equal((await restarted.getStatus(AI_DEFAULT_MODEL_ID)).locallyObserved.requestsToday, 1);
  const serialized = await fs.readFile(filePath, 'utf8');
  for (const forbidden of [
    SYNTHETIC_DOCUMENT_REQUEST.input.file.base64,
    SYNTHETIC_DOCUMENT_REQUEST.input.userContext,
    'AIza-synthetic',
    'sk-synthetic',
  ]) assert.equal(serialized.includes(forbidden), false);
});

test('ledger rusak fail-closed dan tidak ditimpa otomatis', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-quota-corrupt-'));
  const filePath = path.join(directory, 'quota.json');
  const corrupt = '{synthetic-corrupt-quota';
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(filePath, corrupt, 'utf8');
  const guard = createAIFreeTierQuotaGuard({
    store: createAIQuotaFileStore({ filePath }),
    now: () => FIXED_TIME,
  });
  await assert.rejects(guard.reserve(SYNTHETIC_CHAT_REQUEST), error => error.code === 'quota_unavailable');
  assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);
});

test('model dengan snapshot kuota tidak lengkap selalu fail-closed', async () => {
  const guard = createAIFreeTierQuotaGuard({ store: createMemoryStore(), now: () => FIXED_TIME });
  await assert.rejects(
    guard.getStatus('gemini-3.1-flash-lite'),
    error => error.code === 'quota_unavailable',
  );
});
