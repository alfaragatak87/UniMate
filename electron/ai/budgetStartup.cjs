const { createElectronBudgetRuntime } = require('./budgetRuntime.cjs');

const AI_BUDGET_STARTUP_STATES = Object.freeze({
  IDLE: 'idle',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

function createAIBudgetStartup(options = {}) {
  const { app, createRuntime = createElectronBudgetRuntime } = options;
  if (
    app === null
    || typeof app !== 'object'
    || typeof app.whenReady !== 'function'
    || typeof createRuntime !== 'function'
  ) {
    throw new TypeError('Startup budget AI Electron tidak valid');
  }

  let state = AI_BUDGET_STARTUP_STATES.IDLE;
  let runtime = null;
  let initializationPromise = null;

  function getStatus() {
    return Object.freeze({ state, available: state === AI_BUDGET_STARTUP_STATES.READY });
  }

  function initialize() {
    if (initializationPromise !== null) return initializationPromise;
    initializationPromise = (async () => {
      try {
        await app.whenReady();
        runtime = await createRuntime({ app });
        if (typeof runtime?.guard?.getStatus !== 'function') throw new Error('invalid runtime');
        state = AI_BUDGET_STARTUP_STATES.READY;
      } catch {
        runtime = null;
        state = AI_BUDGET_STARTUP_STATES.UNAVAILABLE;
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
  AI_BUDGET_STARTUP_STATES,
  createAIBudgetStartup,
};
