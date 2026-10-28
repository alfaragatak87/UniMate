const { createElectronPreferenceRuntime } = require('./preferenceRuntime.cjs');

const AI_PREFERENCE_STARTUP_STATES = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

function createAIPreferenceStartup(options = {}) {
  const { app, getQuotaRuntime = () => null, createRuntime = createElectronPreferenceRuntime } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.whenReady !== 'function'
    || typeof getQuotaRuntime !== 'function'
    || typeof createRuntime !== 'function'
  ) throw new TypeError('Startup preferensi AI Electron tidak valid');
  let state = AI_PREFERENCE_STARTUP_STATES.IDLE;
  let runtime = null;
  let initializationPromise = null;

  function initialize() {
    if (initializationPromise !== null) return initializationPromise;
    initializationPromise = (async () => {
      try {
        await app.whenReady();
        runtime = createRuntime({ app, quotaGuard: getQuotaRuntime()?.guard ?? null });
        if (typeof runtime?.controller?.execute !== 'function') throw new Error('invalid runtime');
        state = AI_PREFERENCE_STARTUP_STATES.READY;
      } catch {
        runtime = null;
        state = AI_PREFERENCE_STARTUP_STATES.UNAVAILABLE;
      }
      return Object.freeze({ state, available: state === AI_PREFERENCE_STARTUP_STATES.READY });
    })();
    return initializationPromise;
  }

  return Object.freeze({
    initialize,
    getStatus: () => Object.freeze({ state, available: state === AI_PREFERENCE_STARTUP_STATES.READY }),
    getRuntimeForMainProcess: () => runtime,
  });
}

module.exports = { AI_PREFERENCE_STARTUP_STATES, createAIPreferenceStartup };
