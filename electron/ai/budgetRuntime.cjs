const { createAIBudgetFileStore } = require('./budgetFileStore.cjs');
const { resolveAIBudgetPaths } = require('./budgetPaths.cjs');

const budgetGuardModule = import('../../gateway/ai/budgetGuard.mjs');

async function createElectronBudgetRuntime(options = {}) {
  const {
    app,
    userDataPath,
    now,
    createStore = createAIBudgetFileStore,
    createGuard,
  } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.isReady !== 'function'
    || typeof app.getPath !== 'function'
    || typeof createStore !== 'function'
    || (createGuard !== undefined && typeof createGuard !== 'function')
  ) {
    throw new TypeError('Runtime Electron budget AI tidak valid');
  }
  if (app.isReady() !== true) throw new TypeError('Runtime budget AI hanya tersedia setelah Electron siap');

  const paths = resolveAIBudgetPaths({ userDataPath: userDataPath ?? app.getPath('userData') });
  const store = createStore({ filePath: paths.filePath });
  const guardFactory = createGuard ?? (await budgetGuardModule).createAIBudgetGuard;
  const guard = guardFactory({ store, now });
  if (
    typeof guard?.configurePolicy !== 'function'
    || typeof guard?.getStatus !== 'function'
    || typeof guard?.reserve !== 'function'
    || typeof guard?.settle !== 'function'
    || typeof guard?.markUnknown !== 'function'
  ) {
    throw new TypeError('Guard budget AI tidak valid');
  }
  return Object.freeze({ guard });
}

module.exports = {
  createElectronBudgetRuntime,
};
