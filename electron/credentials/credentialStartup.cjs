const { createElectronCredentialRuntime } = require('./credentialRuntime.cjs');

const CREDENTIAL_STARTUP_STATES = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

function createCredentialStartup(options = {}) {
  const {
    app,
    safeStorage,
    createRuntime = createElectronCredentialRuntime,
  } = options;

  if (
    app === null
    || typeof app !== 'object'
    || typeof app.whenReady !== 'function'
    || typeof createRuntime !== 'function'
  ) {
    throw new TypeError('Startup credential Electron tidak valid');
  }

  let state = CREDENTIAL_STARTUP_STATES.IDLE;
  let runtime = null;
  let initializationPromise = null;

  function getStatus() {
    return Object.freeze({
      state,
      available: state === CREDENTIAL_STARTUP_STATES.READY,
    });
  }

  function initialize() {
    if (initializationPromise !== null) return initializationPromise;

    initializationPromise = (async () => {
      try {
        await app.whenReady();
        runtime = createRuntime({ app, safeStorage });
        if (runtime === null || typeof runtime !== 'object' || runtime.service === undefined) {
          throw new Error('invalid runtime');
        }
        state = CREDENTIAL_STARTUP_STATES.READY;
      } catch {
        runtime = null;
        state = CREDENTIAL_STARTUP_STATES.UNAVAILABLE;
      }
      return getStatus();
    })();

    return initializationPromise;
  }

  return Object.freeze({
    initialize,
    getStatus,
    getRuntimeForMainProcess() {
      return runtime;
    },
  });
}

module.exports = {
  CREDENTIAL_STARTUP_STATES,
  createCredentialStartup,
};
