import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  AI_BUDGET_MUTATION_OUTCOMES,
  AI_BUDGET_RESPONSE_OPERATIONS,
  AI_BUDGET_TRANSPORT_VERSION,
} from '../shared/ai/budgetTransportContracts.mjs';
import {
  AIBudgetClientError,
  createAIBudgetClient,
} from '../src/services/budgetClient.js';

function statusResponse() {
  return {
    schemaVersion: AI_BUDGET_TRANSPORT_VERSION,
    operation: AI_BUDGET_RESPONSE_OPERATIONS.STATUS,
    status: {
      configured: false,
      approved: false,
      dailyLimitMicrousd: null,
      monthlyLimitMicrousd: null,
      dailyUsedMicrousd: 0,
      monthlyUsedMicrousd: 0,
      pendingReservations: 0,
      periodTimezone: 'UTC',
      accountingBasis: 'conservative_estimate',
      billingGuarantee: false,
    },
  };
}

test('client Settings budget memakai transport tervalidasi', async () => {
  const requests = [];
  const client = createAIBudgetClient({
    statusTransport: async request => {
      requests.push(request);
      return { ok: true, response: statusResponse() };
    },
    mutationTransport: async request => {
      requests.push(request);
      return {
        ok: true,
        response: {
          schemaVersion: 1,
          operation: 'configure',
          outcome: AI_BUDGET_MUTATION_OUTCOMES.COMPLETED,
          changed: true,
        },
      };
    },
  });
  const status = await client.getStatus();
  const configured = await client.configure({
    consentVersion: 1,
    dailyLimitMicrousd: 1_000_000,
    monthlyLimitMicrousd: 5_000_000,
  });
  assert.equal(status.billingGuarantee, false);
  assert.equal(configured.changed, true);
  assert.deepEqual(requests.map(request => request.operation), ['status', 'configure']);
});

test('client Web/PWA dan production tanpa backend mutasi tetap fail-closed', async () => {
  const client = createAIBudgetClient({
    statusTransport: async () => { throw new Error('backend unavailable'); },
  });
  assert.equal(client.canMutate(), false);
  assert.throws(
    () => client.configure({ consentVersion: 1, dailyLimitMicrousd: 1, monthlyLimitMicrousd: 1 }),
    error => error instanceof AIBudgetClientError && error.code === 'mutation_disabled',
  );
  await assert.rejects(client.getStatus(), error => error.code === 'operation_failed');
});

test('Chat dan Scanner aktif tetapi budget berbayar dan identitas profil tetap terkunci', async () => {
  const [mainSource, preloadSource] = await Promise.all([
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /createAIGatewayStartup\(\{[\s\S]*?enabled:\s*true/u);
  assert.match(mainSource, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.match(mainSource, /registerAIBudgetHandlers\(\{[\s\S]*?mutationsEnabled:\s*false/u);
  assert.equal(mainSource.includes("app.setPath('userData'"), false);
  assert.equal(mainSource.includes('app.setPath("userData"'), false);
  assert.match(preloadSource, /createAIBudgetPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*false/u);
  assert.equal(preloadSource.includes('configureAIBudget:'), false);
  assert.equal(preloadSource.includes('dailyLimitMicrousd'), false);
});
