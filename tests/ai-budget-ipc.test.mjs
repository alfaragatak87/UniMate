import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_BUDGET_TRANSPORT_OPERATIONS,
  AI_BUDGET_TRANSPORT_VERSION,
} from '../shared/ai/budgetTransportContracts.mjs';
import budgetControllerModule from '../electron/ai/budgetController.cjs';
import budgetHandlersModule from '../electron/ipc/budgetHandlers.cjs';
import budgetPreloadModule from '../electron/ipc/budgetPreloadBridge.cjs';

const { createAIBudgetController } = budgetControllerModule;
const { AI_BUDGET_IPC_CHANNELS, registerAIBudgetHandlers } = budgetHandlersModule;
const { createAIBudgetPreloadBridge } = budgetPreloadModule;

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
    invoke(channel, event, request) { return handlers.get(channel)(event, request); },
  };
}

function createGuard() {
  let policy = null;
  return Object.freeze({
    async getStatus() {
      return {
        configured: policy !== null,
        approved: policy !== null,
        dailyLimitMicrousd: policy?.dailyLimitMicrousd ?? null,
        monthlyLimitMicrousd: policy?.monthlyLimitMicrousd ?? null,
        dailyUsedMicrousd: 0,
        monthlyUsedMicrousd: 0,
        pendingReservations: 0,
        periodTimezone: 'UTC',
      };
    },
    async configurePolicy(request) {
      policy = structuredClone(request);
      return { configured: true, consentVersion: request.consentVersion };
    },
  });
}

function statusRequest() {
  return { schemaVersion: AI_BUDGET_TRANSPORT_VERSION, operation: AI_BUDGET_TRANSPORT_OPERATIONS.STATUS };
}

function configureRequest(overrides = {}) {
  return {
    schemaVersion: AI_BUDGET_TRANSPORT_VERSION,
    operation: AI_BUDGET_TRANSPORT_OPERATIONS.CONFIGURE,
    approved: true,
    consentVersion: 1,
    dailyLimitMicrousd: 1_000_000,
    monthlyLimitMicrousd: 5_000_000,
    ...overrides,
  };
}

test('IPC budget production hanya membuka status dan menyaring sender', async () => {
  const ipcMain = createIpcMainMock();
  const controller = createAIBudgetController({ budgetGuard: createGuard(), confirmMutation: async () => true });
  const registration = registerAIBudgetHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: event => { if (event.trusted !== true) throw new Error('private'); } },
    budgetController: controller,
  });
  assert.deepEqual([...ipcMain.handlers.keys()], [AI_BUDGET_IPC_CHANNELS.STATUS]);
  const accepted = await ipcMain.invoke(AI_BUDGET_IPC_CHANNELS.STATUS, { trusted: true }, statusRequest());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.response.status.accountingBasis, 'conservative_estimate');
  assert.equal(accepted.response.status.billingGuarantee, false);
  const rejected = await ipcMain.invoke(AI_BUDGET_IPC_CHANNELS.STATUS, { trusted: false }, statusRequest());
  assert.deepEqual(rejected, {
    ok: false,
    error: { code: 'ipc_sender_rejected', message: 'Pengirim IPC tidak diizinkan.' },
  });
  registration.dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('konfigurasi budget memerlukan konfirmasi dan membedakan configure dengan replace', async () => {
  const actions = [];
  const controller = createAIBudgetController({
    budgetGuard: createGuard(),
    confirmMutation: async request => {
      actions.push(request.action);
      return true;
    },
  });
  const first = await controller.execute(configureRequest());
  const second = await controller.execute(configureRequest({ dailyLimitMicrousd: 2_000_000 }));
  assert.deepEqual(actions, ['configure', 'replace']);
  assert.deepEqual([first.operation, second.operation], ['configure', 'replace']);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
});

test('pembatalan dan payload invalid tidak mengubah policy budget', async () => {
  let configureCalls = 0;
  const guard = createGuard();
  const wrappedGuard = {
    getStatus: () => guard.getStatus(),
    configurePolicy: async request => {
      configureCalls += 1;
      return guard.configurePolicy(request);
    },
  };
  const controller = createAIBudgetController({ budgetGuard: wrappedGuard, confirmMutation: async () => false });
  const cancelled = await controller.execute(configureRequest());
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(cancelled.changed, false);
  assert.equal(configureCalls, 0);
  await assert.rejects(
    controller.execute(configureRequest({ extra: 'unsafe' })),
    error => error.code === 'invalid_request' && !error.message.includes('unsafe'),
  );
  assert.equal(configureCalls, 0);
});

test('mutasi IPC aktif hanya pada harness dan error disanitasi', async () => {
  const ipcMain = createIpcMainMock();
  const controller = createAIBudgetController({
    budgetGuard: {
      getStatus: async () => ({
        configured: false,
        approved: false,
        dailyLimitMicrousd: null,
        monthlyLimitMicrousd: null,
        dailyUsedMicrousd: 0,
        monthlyUsedMicrousd: 0,
        pendingReservations: 0,
        periodTimezone: 'UTC',
      }),
      configurePolicy: async () => { throw new Error('C:\\private-profile synthetic-secret'); },
    },
    confirmMutation: async () => true,
  });
  registerAIBudgetHandlers({
    ipcMain,
    senderPolicy: { assertTrusted: () => true },
    budgetController: controller,
    mutationsEnabled: true,
  });
  const result = await ipcMain.invoke(AI_BUDGET_IPC_CHANNELS.CONFIGURE, {}, configureRequest());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'storage_unavailable');
  assert.equal(JSON.stringify(result).includes('private-profile'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});

test('bridge preload production tidak mengekspos mutasi budget', async () => {
  const requests = [];
  const bridge = createAIBudgetPreloadBridge({
    ipcRenderer: { invoke: async (...args) => { requests.push(args); return { ok: true }; } },
  });
  assert.equal(bridge.aiBudgetMutationsEnabled, false);
  assert.equal(Object.hasOwn(bridge, 'configureAIBudget'), false);
  await bridge.getAIBudgetStatus();
  assert.deepEqual(requests, [[AI_BUDGET_IPC_CHANNELS.STATUS, statusRequest()]]);
});
