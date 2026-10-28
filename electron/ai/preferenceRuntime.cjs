const { createAIPreferenceController } = require('./preferenceController.cjs');
const { createAIPreferenceFileStore } = require('./preferenceFileStore.cjs');
const { resolveAIPreferencePaths } = require('./preferencePaths.cjs');

function createElectronPreferenceRuntime(options = {}) {
  const {
    app,
    userDataPath,
    quotaGuard = null,
    now,
    createStore = createAIPreferenceFileStore,
    createController = createAIPreferenceController,
  } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.isReady !== 'function'
    || typeof app.getPath !== 'function'
    || typeof createStore !== 'function'
    || typeof createController !== 'function'
  ) throw new TypeError('Runtime Electron preferensi AI tidak valid');
  if (app.isReady() !== true) throw new TypeError('Runtime preferensi AI hanya tersedia setelah Electron siap');
  const paths = resolveAIPreferencePaths({ userDataPath: userDataPath ?? app.getPath('userData') });
  const store = createStore({ filePath: paths.filePath });
  const controller = createController({ store, quotaGuard, now });
  if (typeof controller?.execute !== 'function') throw new TypeError('Controller preferensi AI tidak valid');
  return Object.freeze({ controller });
}

module.exports = { createElectronPreferenceRuntime };
