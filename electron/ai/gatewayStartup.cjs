const { createElectronGatewayRuntime } = require('./gatewayRuntime.cjs');
const { createProviderExecutors } = require('./providerExecutors.cjs');

const AI_GATEWAY_STARTUP_STATES = Object.freeze({
  DISABLED: 'disabled',
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  UNAVAILABLE: 'unavailable',
  STOPPED: 'stopped',
});

const AI_GATEWAY_CAPABILITIES = Object.freeze(['chat', 'analytics', 'document_scan']);

class AIGatewayStartupError extends Error {
  constructor(code = 'gateway_unavailable') {
    const safeCode = ['request_cancelled', 'capability_disabled'].includes(code) ? code : 'gateway_unavailable';
    const message = safeCode === 'request_cancelled'
      ? 'Permintaan AI dibatalkan.'
      : safeCode === 'capability_disabled'
        ? 'Capability AI belum diaktifkan.'
        : 'Gateway AI lokal tidak tersedia.';
    super(message);
    this.name = 'AIGatewayStartupError';
    this.code = safeCode;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createAIGatewayStartup(options = {}) {
  const {
    enabled = false,
    enabledCapabilities = null,
    getCredentialRuntime,
    getBudgetRuntime = () => null,
    getQuotaRuntime = () => null,
    models,
    transport,
    providerOptions = {},
    runtimeOptions = {},
    createExecutors = createProviderExecutors,
    createRuntime = createElectronGatewayRuntime,
  } = options;
  if (
    typeof enabled !== 'boolean'
    || (enabledCapabilities !== null && !Array.isArray(enabledCapabilities))
    || typeof getCredentialRuntime !== 'function'
    || typeof getBudgetRuntime !== 'function'
    || typeof getQuotaRuntime !== 'function'
    || typeof createExecutors !== 'function'
    || typeof createRuntime !== 'function'
    || !isPlainObject(providerOptions)
    || !isPlainObject(runtimeOptions)
  ) {
    throw new TypeError('Startup Gateway AI tidak valid');
  }
  const capabilities = enabledCapabilities === null ? AI_GATEWAY_CAPABILITIES : enabledCapabilities;
  if (
    capabilities.some(capability => !AI_GATEWAY_CAPABILITIES.includes(capability))
    || new Set(capabilities).size !== capabilities.length
  ) throw new TypeError('Capability Gateway AI tidak valid');
  const allowedCapabilities = Object.freeze([...capabilities]);

  let state = enabled ? AI_GATEWAY_STARTUP_STATES.IDLE : AI_GATEWAY_STARTUP_STATES.DISABLED;
  let runtime = null;
  let initializationPromise = null;

  function getStatus() {
    return Object.freeze({
      enabled,
      state,
      available: state === AI_GATEWAY_STARTUP_STATES.RUNNING,
    });
  }

  function initialize() {
    if (!enabled) return Promise.resolve(getStatus());
    if (initializationPromise !== null) return initializationPromise;
    state = AI_GATEWAY_STARTUP_STATES.STARTING;

    initializationPromise = (async () => {
      let candidateRuntime = null;
      try {
        const credentialRuntime = getCredentialRuntime();
        if (typeof credentialRuntime?.service?.withCredential !== 'function') throw new Error('credential unavailable');
        const budgetRuntime = getBudgetRuntime();
        const quotaRuntime = getQuotaRuntime();
        const budgetGuard = budgetRuntime?.guard ?? runtimeOptions.budgetGuard;
        const quotaGuard = quotaRuntime?.guard ?? runtimeOptions.quotaGuard;
        const providerExecutors = await createExecutors({
          models,
          transport,
          ...providerOptions,
        });
        candidateRuntime = createRuntime({
          ...runtimeOptions,
          credentialService: credentialRuntime.service,
          providerExecutors,
          budgetGuard,
          quotaGuard,
        });
        if (
          typeof candidateRuntime?.start !== 'function'
          || typeof candidateRuntime?.requestAI !== 'function'
          || typeof candidateRuntime?.stop !== 'function'
        ) {
          throw new Error('runtime invalid');
        }
        await candidateRuntime.start();
        runtime = candidateRuntime;
        state = AI_GATEWAY_STARTUP_STATES.RUNNING;
      } catch {
        try {
          await candidateRuntime?.stop();
        } catch {}
        runtime = null;
        state = AI_GATEWAY_STARTUP_STATES.UNAVAILABLE;
      }
      return getStatus();
    })();

    return initializationPromise;
  }

  return Object.freeze({
    initialize,

    async requestAI(request, options = {}) {
      if (state !== AI_GATEWAY_STARTUP_STATES.RUNNING || runtime === null) {
        throw new AIGatewayStartupError();
      }
      if (!allowedCapabilities.includes(request?.capability)) {
        throw new AIGatewayStartupError('capability_disabled');
      }
      try {
        return await runtime.requestAI(request, options);
      } catch (error) {
        throw new AIGatewayStartupError(error?.code);
      }
    },

    async stop() {
      if (!enabled) return getStatus();
      if (state === AI_GATEWAY_STARTUP_STATES.STARTING && initializationPromise !== null) {
        await initializationPromise;
      }
      const activeRuntime = runtime;
      runtime = null;
      try {
        await activeRuntime?.stop();
      } catch {}
      state = AI_GATEWAY_STARTUP_STATES.STOPPED;
      return getStatus();
    },

    getStatus,
  });
}

module.exports = {
  AI_GATEWAY_CAPABILITIES,
  AIGatewayStartupError,
  AI_GATEWAY_STARTUP_STATES,
  createAIGatewayStartup,
};
