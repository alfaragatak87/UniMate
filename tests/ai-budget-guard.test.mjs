import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AI_ERROR_CODES,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import {
  AI_BACKEND_MODELS,
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_CATALOG,
} from '../shared/ai/modelCatalog.mjs';
import { createBudgetedAIRouter } from '../gateway/ai/budgetedRouter.mjs';
import { createAIBudgetGuard, estimateAIBudget } from '../gateway/ai/budgetGuard.mjs';
import budgetStoreModule from '../electron/ai/budgetFileStore.cjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_CHAT_RESULT,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';

const { createAIBudgetFileStore } = budgetStoreModule;

async function createHarness(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-budget-test-'));
  const filePath = path.join(directory, 'ai-budget.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = options.now ?? (() => Date.UTC(2026, 9, 21, 4, 0, 0));
  const store = createAIBudgetFileStore({ filePath });
  const guard = createAIBudgetGuard({ store, now });
  return { filePath, store, guard, now };
}

async function configure(guard, dailyLimitMicrousd = 1_000_000, monthlyLimitMicrousd = 5_000_000) {
  return guard.configurePolicy({
    schemaVersion: 1,
    approved: true,
    consentVersion: 1,
    dailyLimitMicrousd,
    monthlyLimitMicrousd,
  });
}

function successResponse(request) {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    capability: request.capability,
    success: true,
    meta: {
      provider: request.selection.provider,
      modelId: request.selection.modelId,
      selectionMode: request.selection.mode,
      complexity: request.selection.complexity,
      accessMode: request.selection.accessMode,
      fallbackUsed: false,
      fallbackReason: null,
      attemptCount: 1,
    },
    result: SYNTHETIC_CHAT_RESULT,
  };
}

function cancelledResponse(request) {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    capability: request.capability,
    success: false,
    error: {
      code: AI_ERROR_CODES.REQUEST_CANCELLED,
      message: 'Permintaan dibatalkan.',
      primaryReason: null,
      fallbackReason: null,
    },
  };
}

test('katalog model backend memakai allowlist Free Tier dan harga berversi', () => {
  assert.deepEqual(AI_BACKEND_MODELS, {
    gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    openai: [],
  });
  assert.equal(AI_MODEL_CATALOG[AI_DEFAULT_MODEL_ID].provider, AI_PROVIDERS.GEMINI);
  assert.equal(AI_MODEL_CATALOG[AI_DEFAULT_MODEL_ID].selectable, true);
  assert.equal(AI_MODEL_CATALOG['gpt-6-luna'].selectable, false);
  for (const model of Object.values(AI_MODEL_CATALOG)) {
    assert.match(model.pricingSource, /^https:\/\//u);
    assert.ok(model.pricingMicrousdPerMillionTokens.input > 0);
    assert.ok(model.pricingMicrousdPerMillionTokens.output > 0);
  }
});

test('budget USD default fail-closed dan tidak membuat file sebelum konfigurasi', async (t) => {
  const harness = await createHarness(t);
  await assert.rejects(
    harness.guard.reserve(SYNTHETIC_CHAT_REQUEST),
    error => error.code === AI_ERROR_CODES.BUDGET_NOT_CONFIGURED,
  );
  await assert.rejects(fs.access(harness.filePath));
});

test('reservasi budget hanya menghitung model yang dipilih', async (t) => {
  const harness = await createHarness(t);
  await configure(harness.guard);
  const [estimate] = estimateAIBudget(SYNTHETIC_CHAT_REQUEST);
  const reservation = await harness.guard.reserve(SYNTHETIC_CHAT_REQUEST);
  let status = await harness.guard.getStatus();
  assert.equal(status.dailyUsedMicrousd, estimate.microusd);
  assert.equal(status.pendingReservations, 1);
  await harness.guard.settle(reservation, successResponse(SYNTHETIC_CHAT_REQUEST));
  status = await harness.guard.getStatus();
  assert.equal(status.dailyUsedMicrousd, estimate.microusd);
  assert.equal(status.pendingReservations, 0);
});

test('reservasi concurrent diserialisasi dan tidak melampaui limit', async (t) => {
  const harness = await createHarness(t);
  const [estimate] = estimateAIBudget(SYNTHETIC_CHAT_REQUEST);
  await configure(harness.guard, estimate.microusd, estimate.microusd);
  const secondRequest = { ...SYNTHETIC_CHAT_REQUEST, requestId: '77777777-7777-4777-8777-777777777777' };
  const results = await Promise.allSettled([
    harness.guard.reserve(SYNTHETIC_CHAT_REQUEST),
    harness.guard.reserve(secondRequest),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'budget_exceeded').length, 1);
});

test('reservasi pending bertahan setelah restart dan tetap dihitung', async (t) => {
  const harness = await createHarness(t);
  await configure(harness.guard);
  await harness.guard.reserve(SYNTHETIC_CHAT_REQUEST);
  const restarted = createAIBudgetGuard({
    store: createAIBudgetFileStore({ filePath: harness.filePath }),
    now: harness.now,
  });
  const status = await restarted.getStatus();
  assert.equal(status.pendingReservations, 1);
  assert.equal(status.dailyUsedMicrousd, estimateAIBudget(SYNTHETIC_CHAT_REQUEST)[0].microusd);
});

test('file ledger rusak ditolak tanpa ditimpa otomatis', async (t) => {
  const harness = await createHarness(t);
  const corrupt = '{synthetic-corrupt-budget';
  await fs.writeFile(harness.filePath, corrupt, 'utf8');
  await assert.rejects(configure(harness.guard), error => error.code === 'budget_unavailable');
  assert.equal(await fs.readFile(harness.filePath, 'utf8'), corrupt);
});

test('ledger budget hanya menyimpan metadata tanpa prompt, dokumen, atau credential', async (t) => {
  const harness = await createHarness(t);
  await configure(harness.guard, 2_000_000, 5_000_000);
  await harness.guard.reserve(SYNTHETIC_DOCUMENT_REQUEST);
  const serialized = await fs.readFile(harness.filePath, 'utf8');
  for (const forbidden of [
    SYNTHETIC_DOCUMENT_REQUEST.input.file.base64,
    SYNTHETIC_DOCUMENT_REQUEST.input.userContext,
    'sk-synthetic',
    'AIza-synthetic',
  ]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(serialized.includes(SYNTHETIC_DOCUMENT_REQUEST.requestId), true);
});

test('cancellation diselesaikan sebagai satu estimasi tanpa fallback', async (t) => {
  const harness = await createHarness(t);
  await configure(harness.guard);
  const reservation = await harness.guard.reserve(SYNTHETIC_CHAT_REQUEST);
  await harness.guard.settle(reservation, cancelledResponse(SYNTHETIC_CHAT_REQUEST));
  const status = await harness.guard.getStatus();
  assert.equal(status.dailyUsedMicrousd, estimateAIBudget(SYNTHETIC_CHAT_REQUEST)[0].microusd);
  assert.equal(status.pendingReservations, 0);
});

test('router Free Tier memakai quota guard dan mempertahankan reservasi saat error tidak dikenal', async () => {
  const events = [];
  const quotaGuard = {
    reserve: async request => {
      events.push('reserve');
      return { requestId: request.requestId };
    },
    settle: async () => { events.push('settle'); },
    markUnknown: async () => { events.push('unknown'); },
  };
  const router = createBudgetedAIRouter({
    router: { route: async () => { throw new Error('raw synthetic failure'); } },
    budgetGuard: { reserve: async () => { throw new Error('budget must not run'); } },
    quotaGuard,
  });
  await assert.rejects(router.route(SYNTHETIC_CHAT_REQUEST), /raw synthetic failure/u);
  assert.deepEqual(events, ['reserve', 'unknown']);

  const noQuota = createBudgetedAIRouter({
    router: { route: async request => successResponse(request) },
    budgetGuard: quotaGuard,
  });
  const response = await noQuota.route(SYNTHETIC_CHAT_REQUEST);
  assert.equal(response.error.code, AI_ERROR_CODES.QUOTA_UNAVAILABLE);
});
