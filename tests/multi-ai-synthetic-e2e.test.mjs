import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  AI_COMPLEXITY_LEVELS,
} from '../shared/ai/contracts.mjs';
import {
  AI_BACKEND_MODELS,
  AI_DEFAULT_MODEL_ID,
} from '../shared/ai/modelCatalog.mjs';
import {
  CREDENTIAL_CONFIGURATION_MODES,
} from '../shared/credentials/transportContracts.mjs';
import { createAIScannerReview } from '../src/services/aiScannerReview.js';
import { createDefaultAISelection } from '../src/services/aiClient.js';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_REPLACEMENT,
} from './fixtures/credentialFixtures.mjs';
import {
  createMultiAISyntheticHarness,
  waitForSynthetic,
} from './fixtures/multiAISyntheticHarness.mjs';

const REQUEST_IDS = Object.freeze({
  CHAT_PRIMARY: '71111111-1111-4111-8111-111111111111',
  ANALYTICS_PRIMARY: '72222222-2222-4222-8222-222222222222',
  DOCUMENT_PRIMARY: '73333333-3333-4333-8333-333333333333',
  PROVIDER_FAILED: '74444444-4444-4444-8444-444444444444',
  NO_CONSENT: '75555555-5555-4555-8555-555555555555',
  CANCELLED: '78888888-8888-4888-8888-888888888888',
  QUOTA_EXCEEDED: '79999999-9999-4999-8999-999999999999',
  RATE_FIRST: '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  RATE_SECOND: '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  BEFORE_RESTART: '7ccccccc-cccc-4ccc-8ccc-cccccccccccc',
  AFTER_RESTART: '7ddddddd-dddd-4ddd-8ddd-dddddddddddd',
});

function selection({ consent = false, complexity = AI_COMPLEXITY_LEVELS.LIGHT } = {}) {
  return createDefaultAISelection({
    complexity,
    freeTierDataConsent: consent,
  });
}

async function configureCredentialsAndBudget(harness, limits = {}) {
  await harness.credentialClient.configure(
    'openai',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_OPENAI_CREDENTIAL,
  );
  await harness.credentialClient.configure(
    'gemini',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_GEMINI_CREDENTIAL,
  );
  await harness.budgetClient.configure({
    consentVersion: 1,
    dailyLimitMicrousd: limits.daily ?? 2_000_000,
    monthlyLimitMicrousd: limits.monthly ?? 10_000_000,
  });
}

function assertNoSensitiveValue(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    SYNTHETIC_OPENAI_CREDENTIAL,
    SYNTHETIC_OPENAI_REPLACEMENT,
    SYNTHETIC_GEMINI_CREDENTIAL,
    'ciphertext',
    'csrfToken',
    'sessionCookie',
    'gatewayToken',
  ]) assert.equal(serialized.includes(forbidden), false, `sensitive_value_${forbidden}`);
}

function quotaSeedRequest(index) {
  const request = structuredClone(SYNTHETIC_CHAT_REQUEST);
  request.requestId = `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return request;
}

test('Settings mengelola credential dan budget persisten melalui IPC terisolasi', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  let status = await harness.credentialClient.getStatus();
  assert.equal(status.storage, 'missing');

  await configureCredentialsAndBudget(harness);
  await harness.credentialClient.configure(
    'openai',
    CREDENTIAL_CONFIGURATION_MODES.REPLACE,
    SYNTHETIC_OPENAI_REPLACEMENT,
  );
  harness.control.expectedCredentials.openai = SYNTHETIC_OPENAI_REPLACEMENT;
  await harness.credentialClient.remove('gemini');
  status = await harness.credentialClient.getStatus();
  assert.deepEqual(status.providers, { openai: 'configured', gemini: 'missing' });
  await harness.credentialClient.configure(
    'gemini',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_GEMINI_CREDENTIAL,
  );

  await harness.restartPersistentBackends();
  status = await harness.credentialClient.getStatus();
  const budgetStatus = await harness.budgetClient.getStatus();
  assert.deepEqual(status.providers, { openai: 'configured', gemini: 'configured' });
  assert.equal(budgetStatus.configured, true);
  assert.equal(budgetStatus.accountingBasis, 'conservative_estimate');
  assert.equal(budgetStatus.billingGuarantee, false);
  assert.deepEqual(harness.confirmations.map(item => `${item.domain}:${item.action}`), [
    'credential:configure',
    'credential:configure',
    'budget:configure',
    'credential:replace',
    'credential:remove',
    'credential:configure',
  ]);
  assertNoSensitiveValue({ status, budgetStatus, confirmations: harness.confirmations });
});

test('credential rusak ditolak tanpa overwrite otomatis', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await harness.credentialClient.configure(
    'openai',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_OPENAI_CREDENTIAL,
  );
  const corrupt = '{synthetic-corrupt-credential';
  await fs.writeFile(harness.credentialPath, corrupt, 'utf8');
  await harness.restartPersistentBackends();
  const status = await harness.credentialClient.getStatus();
  assert.equal(status.storage, 'corrupt');
  await assert.rejects(
    harness.credentialClient.configure(
      'openai',
      CREDENTIAL_CONFIGURATION_MODES.REPLACE,
      SYNTHETIC_OPENAI_REPLACEMENT,
    ),
    error => error.code === 'storage_corrupt',
  );
  assert.equal(await fs.readFile(harness.credentialPath, 'utf8'), corrupt);
});

test('Chat, Analytics, dan Scanner memakai Gemini melalui IPC, Gateway, dan quota guard', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness);
  await harness.startAI();
  assert.equal(harness.gateway.getAddress().host, '127.0.0.1');
  const client = harness.createAIClient([
    REQUEST_IDS.CHAT_PRIMARY,
    REQUEST_IDS.ANALYTICS_PRIMARY,
    REQUEST_IDS.DOCUMENT_PRIMARY,
  ]);
  const academicData = {
    semesters: [{ id: 1, name: 'Data akademik sintetis lama' }],
    tasks: [{ id: 2, title: 'Tugas sintetis lama' }],
  };
  const academicSnapshot = structuredClone(academicData);

  const chat = await client.chat({ message: 'Pesan sintetis Multi-AI', selection: selection() });
  const analytics = await client.analyze({
    rows: [{ minggu: 1, nilai: 80 }],
    xAxis: 'minggu',
    yAxes: ['nilai'],
    selection: selection({ consent: true }),
  });
  const scanner = await client.scanDocument({
    scanType: 'auto',
    file: SYNTHETIC_DOCUMENT_REQUEST.input.file,
    userContext: SYNTHETIC_DOCUMENT_REQUEST.input.userContext,
    selection: selection({ consent: true }),
  });
  const review = createAIScannerReview(scanner, 'auto');

  assert.deepEqual([chat.meta.provider, analytics.meta.provider, scanner.meta.provider], ['gemini', 'gemini', 'gemini']);
  assert.equal(review.suggestion.extracted_data.courses[0].name, 'Mata Kuliah Sintetis');
  assert.deepEqual(academicData, academicSnapshot);
  assert.deepEqual(harness.control.calls.map(call => call.capability), ['chat', 'analytics', 'document_scan']);
  assert.equal(harness.control.calls.every(call => call.credentialMatched), true);
  assert.equal(harness.control.calls.every(call => call.model === AI_DEFAULT_MODEL_ID), true);
  assert.equal(harness.control.calls.some(call => call.provider === 'openai'), false);
  assert.deepEqual(AI_BACKEND_MODELS.openai, []);
  const budgetStatus = await harness.budgetClient.getStatus();
  const quotaStatus = await harness.quotaGuard.getStatus(AI_DEFAULT_MODEL_ID);
  assert.equal(budgetStatus.dailyUsedMicrousd, 0);
  assert.equal(budgetStatus.pendingReservations, 0);
  assert.equal(quotaStatus.locallyObserved.requestsToday, 3);
  assertNoSensitiveValue({ chat, analytics, scanner, review, calls: harness.control.calls, budgetStatus, quotaStatus });

  const gateway = harness.gateway;
  await harness.stopAI();
  assert.deepEqual(gateway.getResourceState(), {
    listening: false,
    sockets: 0,
    sessions: 0,
    replayEntries: 0,
    rateBuckets: 0,
    activeRequests: 0,
  });
});

test('kegagalan Gemini berhenti setelah satu percobaan dan consent sensitif divalidasi', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness);
  await harness.startAI();
  const client = harness.createAIClient([
    REQUEST_IDS.PROVIDER_FAILED,
    REQUEST_IDS.NO_CONSENT,
  ]);

  harness.control.behavior.gemini = 'timeout';
  const failed = await client.chat({ message: 'Provider gagal sintetis', selection: selection() });
  assert.equal(failed.success, false);
  assert.equal(failed.error.code, 'provider_timeout');
  assert.equal(failed.error.fallbackReason, null);
  assert.deepEqual(harness.control.calls.map(call => call.provider), ['gemini']);

  await assert.rejects(
    client.analyze({
      rows: [{ minggu: 1, nilai: 80 }],
      xAxis: 'minggu',
      yAxes: ['nilai'],
      selection: selection({ consent: false }),
    }),
    error => error.code === 'invalid_request',
  );
  assert.equal(harness.control.calls.length, 1);
  assertNoSensitiveValue({ failed, calls: harness.control.calls });
});

test('quota RPM habis menolak request sebelum provider dan data akademik tetap utuh', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness, { daily: 1, monthly: 1 });
  for (let index = 1; index <= 15; index += 1) {
    const request = quotaSeedRequest(index);
    const reservation = await harness.quotaGuard.reserve(request);
    await harness.quotaGuard.settle(reservation, { success: true });
  }
  await harness.startAI();
  const client = harness.createAIClient([REQUEST_IDS.QUOTA_EXCEEDED]);
  const academicData = { semesters: [{ id: 1 }], tasks: [{ id: 2 }] };
  const snapshot = structuredClone(academicData);
  const response = await client.chat({ message: 'Melebihi kuota lokal', selection: selection() });
  assert.equal(response.success, false);
  assert.equal(response.error.code, 'quota_exceeded');
  assert.equal(harness.control.calls.length, 0);
  assert.deepEqual(academicData, snapshot);
});

test('cancellation tidak memulai provider kedua dan ledger diselesaikan', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness);
  harness.control.behavior.gemini = 'hang';
  await harness.startAI();
  const client = harness.createAIClient([REQUEST_IDS.CANCELLED]);
  const pending = client.chat({ message: 'Batalkan permintaan sintetis', selection: selection() });
  await waitForSynthetic(() => harness.control.calls.length === 1);
  assert.equal(await client.cancel(REQUEST_IDS.CANCELLED), true);
  await assert.rejects(pending, error => error.code === 'request_cancelled');
  await waitForSynthetic(() => harness.gateway.getResourceState().activeRequests === 0);
  const state = JSON.parse(await fs.readFile(harness.quotaPath, 'utf8'));
  assert.equal(state.entries.some(entry => (
    entry.requestId === REQUEST_IDS.CANCELLED
    && entry.status === 'settled'
    && entry.outcome === 'cancelled'
  )), true);
  assert.deepEqual(harness.control.calls.map(call => call.provider), ['gemini']);
});

test('rate limit lokal menolak request kedua tanpa dispatch provider', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness);
  await harness.startAI({
    gatewayOptions: {
      rateLimits: { capabilities: { chat: { limit: 1, windowMs: 60_000 } } },
    },
  });
  const client = harness.createAIClient([REQUEST_IDS.RATE_FIRST, REQUEST_IDS.RATE_SECOND]);
  const first = await client.chat({ message: 'Pertama', selection: selection() });
  assert.equal(first.success, true);
  await assert.rejects(
    client.chat({ message: 'Kedua', selection: selection() }),
    error => error.code === 'backend_unavailable' || error.code === 'request_rejected',
  );
  assert.equal(harness.control.calls.length, 1);
});

test('restart backend mempertahankan credential, budget, dan ledger kuota terisolasi', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureCredentialsAndBudget(harness);
  await harness.startAI();
  let client = harness.createAIClient([REQUEST_IDS.BEFORE_RESTART]);
  const beforeRestart = await client.chat({ message: 'Sebelum restart sintetis', selection: selection() });
  assert.equal(beforeRestart.success, true);
  await harness.stopAI();

  await harness.restartPersistentBackends();
  assert.equal((await harness.quotaGuard.getStatus(AI_DEFAULT_MODEL_ID)).locallyObserved.requestsToday, 1);
  await harness.startAI();
  client = harness.createAIClient([REQUEST_IDS.AFTER_RESTART]);
  const afterRestart = await client.chat({ message: 'Sesudah restart sintetis', selection: selection() });
  assert.equal(afterRestart.success, true);
  assert.equal(afterRestart.meta.provider, 'gemini');
  assert.equal(harness.control.calls.every(call => call.credentialMatched), true);
  assert.equal(harness.control.calls.some(call => call.provider === 'openai'), false);
  assert.equal((await harness.quotaGuard.getStatus(AI_DEFAULT_MODEL_ID)).locallyObserved.requestsToday, 2);
  assert.equal((await harness.budgetClient.getStatus()).configured, true);
});
