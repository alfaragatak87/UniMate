const { createElectronQuotaRuntime } = require('./quotaRuntime.cjs');

const AI_QUOTA_STARTUP_STATES = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

function createAIQuotaStartup(options = {}) {
  const { app, createRuntime = createElectronQuotaRuntime } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.whenReady !== 'function'
    || typeof createRuntime !== 'function'
  ) {
    throw new TypeError('Startup kuota AI Electron tidak valid');
  }
  let state = AI_QUOTA_STARTUP_STATES.IDLE;
  let runtime = null;
  let initializationPromise = null;

  function initialize() {
    if (initializationPromise !== null) return initializationPromise;
    initializationPromise = (async () => {
      try {
        await app.whenReady();
        runtime = await createRuntime({ app });
        if (typeof runtime?.guard?.getStatus !== 'function') throw new Error('invalid runtime');
        state = AI_QUOTA_STARTUP_STATES.READY;
      } catch {
        runtime = null;
        state = AI_QUOTA_STARTUP_STATES.UNAVAILABLE;
      }
      return Object.freeze({ state, available: state === AI_QUOTA_STARTUP_STATES.READY });
    })();
    return initializationPromise;
  }

  return Object.freeze({
    initialize,
    getStatus: () => Object.freeze({ state, available: state === AI_QUOTA_STARTUP_STATES.READY }),
    getRuntimeForMainProcess: () => runtime,
  });
}

module.exports = { AI_QUOTA_STARTUP_STATES, createAIQuotaStartup };
