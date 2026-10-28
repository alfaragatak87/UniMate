const { createAIQuotaFileStore } = require('./quotaFileStore.cjs');
const { resolveAIQuotaPaths } = require('./quotaPaths.cjs');

const quotaGuardModule = import('../../gateway/ai/freeTierQuotaGuard.mjs');

async function createElectronQuotaRuntime(options = {}) {
  const { app, userDataPath, now, createStore = createAIQuotaFileStore, createGuard } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.isReady !== 'function'
    || typeof app.getPath !== 'function'
    || typeof createStore !== 'function'
    || (createGuard !== undefined && typeof createGuard !== 'function')
  ) {
    throw new TypeError('Runtime Electron kuota AI tidak valid');
  }
  if (app.isReady() !== true) throw new TypeError('Runtime kuota AI hanya tersedia setelah Electron siap');
  const paths = resolveAIQuotaPaths({ userDataPath: userDataPath ?? app.getPath('userData') });
  const store = createStore({ filePath: paths.filePath });
  const guardFactory = createGuard ?? (await quotaGuardModule).createAIFreeTierQuotaGuard;
  const guard = guardFactory({ store, now });
  if (
    typeof guard?.getStatus !== 'function'
    || typeof guard?.reserve !== 'function'
    || typeof guard?.settle !== 'function'
    || typeof guard?.markUnknown !== 'function'
  ) {
    throw new TypeError('Guard kuota AI tidak valid');
  }
  return Object.freeze({ guard });
}

module.exports = { createElectronQuotaRuntime };
