const { randomBytes } = require('node:crypto');

const { createInternalGatewayClient } = require('./internalGatewayClient.cjs');

const gatewayModule = import('../../gateway/createGateway.mjs');
const routerModule = import('../../gateway/ai/router.mjs');
const budgetedRouterModule = import('../../gateway/ai/budgetedRouter.mjs');
const providerModule = import('../../gateway/ai/providers/credentialBackedProvider.mjs');
const aiContractsModule = import('../../shared/ai/contracts.mjs');

const RUNTIME_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  STOPPED: 'stopped',
  UNAVAILABLE: 'unavailable',
});

class ElectronGatewayRuntimeError extends Error {
  constructor(code) {
    super(code === 'not_running' ? 'Gateway AI lokal belum berjalan.' : 'Gateway AI lokal tidak tersedia.');
    this.name = 'ElectronGatewayRuntimeError';
    this.code = code === 'not_running' ? code : 'gateway_unavailable';
  }
}

function createRuntimeToken(randomBytesFn) {
  const value = randomBytesFn(32);
  if (!Buffer.isBuffer(value) || value.length < 32) throw new TypeError('Sumber token gateway tidak valid');
  return value.toString('base64url');
}

function createElectronGatewayRuntime(options = {}) {
  const {
    credentialService,
    providerExecutors,
    allowedOrigin = 'http://localhost:3000',
    randomBytesFn = randomBytes,
    gatewayOptions = {},
    gatewayFactory,
    budgetGuard,
    quotaGuard,
  } = options;
  if (typeof credentialService?.withCredential !== 'function') {
    throw new TypeError('Credential service gateway tidak valid');
  }
  if (
    providerExecutors === null
    || typeof providerExecutors !== 'object'
    || providerExecutors.gemini === null
    || typeof providerExecutors.gemini !== 'object'
    || Array.isArray(providerExecutors.gemini)
    || Object.keys(providerExecutors.gemini).length < 1
    || Object.values(providerExecutors.gemini).some(execute => typeof execute !== 'function')
  ) {
    throw new TypeError('Executor provider gateway tidak valid');
  }
  if (typeof randomBytesFn !== 'function') throw new TypeError('Sumber token gateway tidak valid');
  if (gatewayFactory !== undefined && typeof gatewayFactory !== 'function') {
    throw new TypeError('Factory gateway tidak valid');
  }

  let state = RUNTIME_STATES.IDLE;
  let gateway = null;
  let client = null;
  let startPromise = null;

  function getStatus() {
    return Object.freeze({
      state,
      available: state === RUNTIME_STATES.RUNNING,
    });
  }

  async function start() {
    if (startPromise !== null) return startPromise;
    if (state !== RUNTIME_STATES.IDLE) throw new ElectronGatewayRuntimeError('gateway_unavailable');
    startPromise = (async () => {
      let token = null;
      try {
        const [{ createGateway }, { createAIRouter }, { createBudgetedAIRouter }, { createCredentialBackedProvider }, { AI_PROVIDERS }] = await Promise.all([
          gatewayModule,
          routerModule,
          budgetedRouterModule,
          providerModule,
          aiContractsModule,
        ]);
        token = createRuntimeToken(randomBytesFn);
        const providers = {};
        for (const [modelId, execute] of Object.entries(providerExecutors.gemini)) {
          providers[modelId] = createCredentialBackedProvider({
            provider: AI_PROVIDERS.GEMINI,
            modelId,
            credentialService,
            execute,
          });
        }
        const providerRouter = createAIRouter({ providers });
        const router = createBudgetedAIRouter({ router: providerRouter, budgetGuard, quotaGuard });
        gateway = (gatewayFactory ?? createGateway)({
          ...gatewayOptions,
          router,
          authClients: [{ id: 'electron-internal', type: 'electron_main', token }],
          allowedOrigins: [allowedOrigin],
          providerMode: 'credential-backed',
        });
        const address = await gateway.start();
        if (address.host !== '127.0.0.1') throw new Error('invalid gateway address');
        client = createInternalGatewayClient({ address, token, origin: allowedOrigin });
        state = RUNTIME_STATES.RUNNING;
        return getStatus();
      } catch {
        client?.close();
        client = null;
        try {
          await gateway?.stop();
        } catch {}
        gateway = null;
        state = RUNTIME_STATES.UNAVAILABLE;
        throw new ElectronGatewayRuntimeError('gateway_unavailable');
      } finally {
        token = null;
      }
    })();
    return startPromise;
  }

  return Object.freeze({
    start,

    async requestAI(request, options = {}) {
      if (state !== RUNTIME_STATES.RUNNING || client === null) {
        throw new ElectronGatewayRuntimeError('not_running');
      }
      return client.requestAI(request, options);
    },

    async stop() {
      client?.close();
      client = null;
      try {
        await gateway?.stop();
      } finally {
        gateway = null;
        state = RUNTIME_STATES.STOPPED;
      }
    },

    getStatus,
  });
}

module.exports = {
  ElectronGatewayRuntimeError,
  RUNTIME_STATES,
  createElectronGatewayRuntime,
};
