import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createGateway } from '../../gateway/createGateway.mjs';
import { createAIBudgetGuard } from '../../gateway/ai/budgetGuard.mjs';
import { createAIFreeTierQuotaGuard } from '../../gateway/ai/freeTierQuotaGuard.mjs';
import { AI_CONTRACT_VERSION } from '../../shared/ai/contracts.mjs';
import { AI_BACKEND_MODELS } from '../../shared/ai/modelCatalog.mjs';
import { createFrontendAIClient } from '../../src/services/aiClient.js';
import { createAIRuntimeStatusClient } from '../../src/services/aiRuntimeStatusClient.js';
import { createAIBudgetClient } from '../../src/services/budgetClient.js';
import { createCredentialClient } from '../../src/services/credentialClient.js';
import { SYNTHETIC_RESULTS_BY_CAPABILITY } from './aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_OPENAI_CREDENTIAL,
  createServiceForPath,
} from './credentialFixtures.mjs';

const require = createRequire(import.meta.url);
const { createAIBudgetController } = require('../../electron/ai/budgetController.cjs');
const { createAIBudgetFileStore } = require('../../electron/ai/budgetFileStore.cjs');
const { resolveAIBudgetPaths } = require('../../electron/ai/budgetPaths.cjs');
const { createAIGatewayStartup } = require('../../electron/ai/gatewayStartup.cjs');
const { createAIQuotaFileStore } = require('../../electron/ai/quotaFileStore.cjs');
const { resolveAIQuotaPaths } = require('../../electron/ai/quotaPaths.cjs');
const { createCredentialController } = require('../../electron/credentials/credentialController.cjs');
const { resolveCredentialPaths } = require('../../electron/credentials/credentialPaths.cjs');
const { registerAIHandlers, AI_IPC_CHANNELS } = require('../../electron/ipc/aiHandlers.cjs');
const { registerAIBudgetHandlers } = require('../../electron/ipc/budgetHandlers.cjs');
const { createAIBudgetPreloadBridge } = require('../../electron/ipc/budgetPreloadBridge.cjs');
const { registerCredentialHandlers } = require('../../electron/ipc/credentialHandlers.cjs');
const { createCredentialPreloadBridge } = require('../../electron/ipc/credentialPreloadBridge.cjs');
const { createIpcSenderPolicy } = require('../../electron/security/ipcSenderPolicy.cjs');

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function createIpcMainMock() {
  const handlers = new Map();
  return Object.freeze({
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error('duplicate synthetic IPC handler');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, event, request) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('synthetic IPC handler missing');
      return handler(event, request);
    },
  });
}

function createTrustedSender() {
  const mainFrame = { parent: null, url: 'http://localhost:3000/#/settings' };
  const webContents = { mainFrame, isDestroyed: () => false };
  return Object.freeze({
    webContents,
    event: Object.freeze({ sender: webContents, senderFrame: mainFrame }),
  });
}

function capabilityFromRequest(options) {
  const outputTokens = options.body.max_output_tokens ?? options.body.generationConfig?.maxOutputTokens;
  if (outputTokens === 2048) return 'chat';
  if (outputTokens === 3072) return 'analytics';
  return 'document_scan';
}

function successBody(result) {
  const text = JSON.stringify(result);
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] };
}

function createSyntheticProviderTransport(control) {
  return Object.freeze({
    async send(options) {
      if (options.url.includes('api.openai.com')) {
        control.calls.push(Object.freeze({
          provider: 'openai',
          capability: capabilityFromRequest(options),
          model: options.body.model,
          credentialMatched: false,
        }));
        const error = new Error('synthetic OpenAI transport disabled');
        error.code = 'provider_unavailable';
        throw error;
      }
      const provider = 'gemini';
      const capability = capabilityFromRequest(options);
      const expectedCredential = control.expectedCredentials.gemini;
      const credentialMatched = options.headers['x-goog-api-key'] === expectedCredential;
      control.calls.push(Object.freeze({
        provider,
        capability,
        model: decodeURIComponent(options.url.match(/models\/([^:]+):/u)?.[1] ?? ''),
        credentialMatched,
      }));

      const behavior = control.behavior[provider];
      if (behavior === 'hang') {
        return new Promise((resolve, reject) => {
          const cancel = () => {
            const error = new Error('synthetic provider cancellation');
            error.code = 'provider_cancelled';
            reject(error);
          };
          if (options.signal?.aborted) cancel();
          else options.signal?.addEventListener('abort', cancel, { once: true });
        });
      }
      if (behavior === 'timeout') {
        return { ok: false, status: 504, body: { error: { code: 'synthetic_timeout' } } };
      }
      if (behavior === 'rate_limited') {
        return { ok: false, status: 429, body: { error: { code: 'synthetic_rate_limit' } } };
      }
      if (behavior === 'auth_failed') {
        return { ok: false, status: 401, body: { error: { code: 'synthetic_auth_failure' } } };
      }
      if (behavior === 'invalid_response') {
        return { ok: true, status: 200, body: { candidates: [] } };
      }
      if (behavior === 'network_error') {
        const error = new Error('synthetic network failure');
        error.code = 'synthetic_network_failure';
        throw error;
      }
      return {
        ok: true,
        status: 200,
        body: successBody(SYNTHETIC_RESULTS_BY_CAPABILITY[capability]),
      };
    },
  });
}

export async function waitForSynthetic(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('synthetic wait timeout');
}

export async function createMultiAISyntheticHarness(t) {
  const rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-m7-e2e-'));
  const profilePath = path.join(rootPath, 'profile');
  const credentialPath = resolveCredentialPaths({ userDataPath: profilePath }).filePath;
  const budgetPath = resolveAIBudgetPaths({ userDataPath: profilePath }).filePath;
  const quotaPath = resolveAIQuotaPaths({ userDataPath: profilePath }).filePath;
  const clock = () => Date.UTC(2026, 9, 21, 4, 0, 0);
  let credentialRuntime = createServiceForPath(credentialPath);
  let budgetGuard = createAIBudgetGuard({
    store: createAIBudgetFileStore({ filePath: budgetPath }),
    now: clock,
  });
  let quotaGuard = createAIFreeTierQuotaGuard({
    store: createAIQuotaFileStore({ filePath: quotaPath }),
    now: clock,
  });
  const ipcMain = createIpcMainMock();
  const trusted = createTrustedSender();
  const senderPolicy = createIpcSenderPolicy({
    getTrustedWebContents: () => trusted.webContents,
    isPackaged: () => false,
    developmentOrigin: 'http://localhost:3000',
    packagedEntryPath: path.join(rootPath, 'dist', 'index.html'),
  });
  const ipcRenderer = Object.freeze({
    invoke: (channel, request) => ipcMain.invoke(channel, trusted.event, request),
  });
  const confirmations = [];
  let credentialRegistration = null;
  let budgetRegistration = null;
  let aiRegistration = null;
  let gatewayStartup = null;
  let gateway = null;

  const control = {
    behavior: { openai: 'success', gemini: 'success' },
    expectedCredentials: {
      openai: SYNTHETIC_OPENAI_CREDENTIAL,
      gemini: SYNTHETIC_GEMINI_CREDENTIAL,
    },
    calls: [],
  };

  function installSettingsTransports() {
    credentialRegistration?.dispose();
    budgetRegistration?.dispose();
    credentialRegistration = registerCredentialHandlers({
      ipcMain,
      senderPolicy,
      credentialController: createCredentialController({
        credentialService: credentialRuntime.service,
        confirmMutation: async request => {
          confirmations.push(Object.freeze({ domain: 'credential', action: request.action, provider: request.provider }));
          return true;
        },
      }),
      mutationsEnabled: true,
    });
    budgetRegistration = registerAIBudgetHandlers({
      ipcMain,
      senderPolicy,
      budgetController: createAIBudgetController({
        budgetGuard,
        confirmMutation: async request => {
          confirmations.push(Object.freeze({ domain: 'budget', action: request.action }));
          return true;
        },
      }),
      mutationsEnabled: true,
    });
  }

  function createSettingsClients() {
    const credentialBridge = createCredentialPreloadBridge({ ipcRenderer, mutationsEnabled: true });
    const budgetBridge = createAIBudgetPreloadBridge({ ipcRenderer, mutationsEnabled: true });
    return Object.freeze({
      credentialClient: createCredentialClient({
        statusTransport: request => credentialBridge.getCredentialStatus(request),
        mutationTransport: request => credentialBridge.mutateCredential(request),
      }),
      budgetClient: createAIBudgetClient({
        statusTransport: request => budgetBridge.getAIBudgetStatus(request),
        mutationTransport: request => budgetBridge.configureAIBudget(request),
      }),
    });
  }

  installSettingsTransports();
  let settingsClients = createSettingsClients();

  async function startAI(runtimeOptions = {}) {
    if (gatewayStartup !== null) throw new Error('synthetic gateway already started');
    const transport = createSyntheticProviderTransport(control);
    gatewayStartup = createAIGatewayStartup({
      enabled: true,
      enabledCapabilities: runtimeOptions.enabledCapabilities ?? null,
      getCredentialRuntime: () => ({ service: credentialRuntime.service }),
      getBudgetRuntime: () => ({ guard: budgetGuard }),
      getQuotaRuntime: () => ({ guard: quotaGuard }),
      models: AI_BACKEND_MODELS,
      transport,
      runtimeOptions: {
        randomBytesFn: () => Buffer.alloc(32, 19),
        gatewayOptions: runtimeOptions.gatewayOptions ?? {},
        gatewayFactory: gatewayOptions => {
          gateway = createGateway(gatewayOptions);
          return gateway;
        },
      },
    });
    const status = await gatewayStartup.initialize();
    if (status.available !== true) throw new Error('synthetic gateway unavailable');
    aiRegistration = registerAIHandlers({ ipcMain, senderPolicy, gatewayRuntime: gatewayStartup });
    return status;
  }

  function createAIClient(requestIds) {
    const queue = [...requestIds];
    return createFrontendAIClient({
      createRequestId: () => {
        const requestId = queue.shift();
        if (!requestId) throw new Error('synthetic request id unavailable');
        return requestId;
      },
      transport: request => ipcRenderer.invoke(AI_IPC_CHANNELS.REQUEST, request),
      cancelTransport: requestId => ipcRenderer.invoke(AI_IPC_CHANNELS.CANCEL, {
        schemaVersion: AI_CONTRACT_VERSION,
        requestId,
      }),
    });
  }

  function createRuntimeStatusClient() {
    return createAIRuntimeStatusClient({
      transport: request => ipcRenderer.invoke(AI_IPC_CHANNELS.STATUS, request),
    });
  }

  async function stopAI() {
    aiRegistration?.dispose();
    aiRegistration = null;
    if (gatewayStartup !== null) await gatewayStartup.stop();
    gatewayStartup = null;
  }

  async function restartPersistentBackends() {
    if (gatewayStartup !== null) throw new Error('stop synthetic gateway before backend restart');
    credentialRuntime = createServiceForPath(credentialPath);
    budgetGuard = createAIBudgetGuard({
      store: createAIBudgetFileStore({ filePath: budgetPath }),
      now: clock,
    });
    quotaGuard = createAIFreeTierQuotaGuard({
      store: createAIQuotaFileStore({ filePath: quotaPath }),
      now: clock,
    });
    installSettingsTransports();
    settingsClients = createSettingsClients();
  }

  t.after(async () => {
    await stopAI();
    credentialRegistration?.dispose();
    budgetRegistration?.dispose();
    await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  });

  return {
    rootPath,
    profilePath,
    credentialPath,
    budgetPath,
    quotaPath,
    confirmations,
    control,
    get credentialClient() { return settingsClients.credentialClient; },
    get budgetClient() { return settingsClients.budgetClient; },
    get credentialService() { return credentialRuntime.service; },
    get budgetGuard() { return budgetGuard; },
    get quotaGuard() { return quotaGuard; },
    get gateway() { return gateway; },
    createAIClient,
    createRuntimeStatusClient,
    startAI,
    stopAI,
    restartPersistentBackends,
  };
}
