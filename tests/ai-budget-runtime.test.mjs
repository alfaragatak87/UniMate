import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAIBudgetGuard } from '../gateway/ai/budgetGuard.mjs';
import budgetStoreModule from '../electron/ai/budgetFileStore.cjs';
import budgetRuntimeModule from '../electron/ai/budgetRuntime.cjs';
import budgetStartupModule from '../electron/ai/budgetStartup.cjs';
import budgetPathsModule from '../electron/ai/budgetPaths.cjs';
import { SYNTHETIC_CHAT_REQUEST } from './fixtures/aiFixtures.mjs';

const { createAIBudgetFileStore } = budgetStoreModule;
const { createElectronBudgetRuntime } = budgetRuntimeModule;
const { createAIBudgetStartup } = budgetStartupModule;
const { AI_BUDGET_DIRECTORY_NAME, AI_BUDGET_FILE_NAME } = budgetPathsModule;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

async function createTemporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-m7-budget-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function createApp(userDataPath) {
  let getPathCalls = 0;
  return {
    isReady: () => true,
    whenReady: async () => undefined,
    getPath(name) {
      assert.equal(name, 'userData');
      getPathCalls += 1;
      return userDataPath;
    },
    getPathCalls: () => getPathCalls,
  };
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

test('runtime budget memakai userData yang ada tanpa menulis saat startup', async (t) => {
  const userDataPath = await createTemporaryDirectory(t);
  const app = createApp(userDataPath);
  const runtime = await createElectronBudgetRuntime({ app });
  const ledgerPath = path.join(userDataPath, AI_BUDGET_DIRECTORY_NAME, AI_BUDGET_FILE_NAME);

  assert.equal(app.getPathCalls(), 1);
  assert.equal(typeof app.setPath, 'undefined');
  assert.equal(typeof runtime.guard.reserve, 'function');
  await assert.rejects(fs.access(ledgerPath), error => error.code === 'ENOENT');
  assert.deepEqual(await runtime.guard.getStatus(), {
    configured: false,
    approved: false,
    dailyLimitMicrousd: null,
    monthlyLimitMicrousd: null,
    dailyUsedMicrousd: 0,
    monthlyUsedMicrousd: 0,
    pendingReservations: 0,
    periodTimezone: 'UTC',
  });
  await assert.rejects(fs.access(ledgerPath), error => error.code === 'ENOENT');
});

test('policy dan reservasi budget tetap tersedia setelah runtime dibuat ulang', async (t) => {
  const userDataPath = await createTemporaryDirectory(t);
  const app = createApp(userDataPath);
  const now = () => Date.UTC(2026, 9, 21, 4, 0, 0);
  const first = await createElectronBudgetRuntime({ app, now });
  await configure(first.guard);
  await first.guard.reserve(SYNTHETIC_CHAT_REQUEST);

  const restarted = await createElectronBudgetRuntime({ app, now });
  const status = await restarted.guard.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.pendingReservations, 1);
  assert.ok(status.dailyUsedMicrousd > 0);

  const serialized = await fs.readFile(
    path.join(userDataPath, AI_BUDGET_DIRECTORY_NAME, AI_BUDGET_FILE_NAME),
    'utf8',
  );
  for (const forbidden of ['prompt', 'document', 'credential', 'apiKey', 'ciphertext']) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test('startup budget dibuat satu kali dan kegagalannya tidak melempar ke startup aplikasi', async () => {
  let runtimeCalls = 0;
  const app = { whenReady: async () => undefined };
  const runtime = { guard: { getStatus: async () => ({}) } };
  const startup = createAIBudgetStartup({
    app,
    createRuntime: async () => {
      runtimeCalls += 1;
      return runtime;
    },
  });
  const [first, second] = await Promise.all([startup.initialize(), startup.initialize()]);
  assert.deepEqual(first, { state: 'ready', available: true });
  assert.deepEqual(second, first);
  assert.equal(runtimeCalls, 1);
  assert.equal(startup.getRuntimeForMainProcess(), runtime);

  const unavailable = createAIBudgetStartup({
    app,
    createRuntime: async () => { throw new Error('private path and raw failure'); },
  });
  assert.deepEqual(await unavailable.initialize(), { state: 'unavailable', available: false });
  assert.equal(unavailable.getRuntimeForMainProcess(), null);
});

test('ledger rusak dan kegagalan replace tidak menimpa data lama', async (t) => {
  const directory = await createTemporaryDirectory(t);
  const filePath = path.join(directory, 'ledger.json');
  const corrupt = '{synthetic-corrupt-ledger';
  await fs.writeFile(filePath, corrupt, 'utf8');
  const corruptGuard = createAIBudgetGuard({ store: createAIBudgetFileStore({ filePath }) });
  await assert.rejects(configure(corruptGuard), error => error.code === 'budget_unavailable');
  assert.equal(await fs.readFile(filePath, 'utf8'), corrupt);

  await fs.rm(filePath);
  const healthyGuard = createAIBudgetGuard({ store: createAIBudgetFileStore({ filePath }) });
  await configure(healthyGuard);
  const original = await fs.readFile(filePath, 'utf8');
  const failingFs = {
    readFile: (...args) => fs.readFile(...args),
    mkdir: (...args) => fs.mkdir(...args),
    open: (...args) => fs.open(...args),
    rename: async () => { throw Object.assign(new Error('synthetic write failure'), { code: 'EACCES' }); },
    unlink: (...args) => fs.unlink(...args),
  };
  const failingGuard = createAIBudgetGuard({
    store: createAIBudgetFileStore({ filePath, fsApi: failingFs, randomId: () => 'synthetic' }),
  });
  await assert.rejects(configure(failingGuard, 2_000_000, 6_000_000), error => error.code === 'budget_unavailable');
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  await assert.rejects(fs.access(path.join(directory, '.ledger.json.synthetic.tmp')), error => error.code === 'ENOENT');
});
