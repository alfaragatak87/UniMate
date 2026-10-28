import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_PROVIDERS,
} from '../shared/credentials/contracts.mjs';
import {
  CREDENTIAL_CONFIGURATION_MODES,
  CREDENTIAL_TRANSPORT_OPERATIONS,
  CREDENTIAL_TRANSPORT_VERSION,
} from '../shared/credentials/transportContracts.mjs';
import controllerModule from '../electron/credentials/credentialController.cjs';
import handlerModule from '../electron/ipc/credentialHandlers.cjs';
import policyModule from '../electron/security/ipcSenderPolicy.cjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_REPLACEMENT,
} from './fixtures/credentialFixtures.mjs';

const { createCredentialController } = controllerModule;
const { CREDENTIAL_IPC_CHANNELS, registerCredentialHandlers } = handlerModule;
const { IpcSenderPolicyError, createIpcSenderPolicy } = policyModule;

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error('duplicate handler');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, event, request) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('handler missing');
      return handler(event, request);
    },
  };
}

function createTrustedSender(url = 'http://localhost:3000/#/settings') {
  const mainFrame = { parent: null, url };
  const webContents = { mainFrame, isDestroyed: () => false };
  return {
    webContents,
    event: { sender: webContents, senderFrame: mainFrame },
  };
}

function createPolicy(trusted, options = {}) {
  return createIpcSenderPolicy({
    getTrustedWebContents: () => trusted.webContents,
    isPackaged: () => options.isPackaged === true,
    developmentOrigin: 'http://localhost:3000',
    packagedEntryPath: options.packagedEntryPath ?? path.resolve('dist/index.html'),
  });
}

function createMemoryCredentialService() {
  const credentials = new Map();
  return Object.freeze({
    credentials,
    async getStatus() {
      return {
        schemaVersion: CREDENTIAL_CONTRACT_VERSION,
        storage: credentials.size === 0 ? 'missing' : 'ready',
        providers: {
          openai: credentials.has('openai') ? 'configured' : 'missing',
          gemini: credentials.has('gemini') ? 'configured' : 'missing',
        },
      };
    },
    async configure(request) {
      const replaced = credentials.has(request.provider);
      credentials.set(request.provider, request.credential);
      return { provider: request.provider, configured: true, replaced };
    },
    async remove(request) {
      const removed = credentials.delete(request.provider);
      return { provider: request.provider, configured: false, removed };
    },
  });
}

function statusRequest() {
  return { schemaVersion: CREDENTIAL_TRANSPORT_VERSION, operation: CREDENTIAL_TRANSPORT_OPERATIONS.STATUS };
}

function configureRequest(mode, credential, provider = CREDENTIAL_PROVIDERS.OPENAI) {
  return {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE,
    provider,
    mode,
    credential,
  };
}

function removeRequest() {
  return {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
  };
}

test('policy IPC menerima hanya WebContents utama dan URL development yang tepat', () => {
  const trusted = createTrustedSender();
  const policy = createPolicy(trusted);
  assert.equal(policy.assertTrusted(trusted.event), true);

  const childFrame = { parent: trusted.webContents.mainFrame, url: 'http://localhost:3000/' };
  const rejectedEvents = [
    { sender: trusted.webContents, senderFrame: childFrame },
    { sender: trusted.webContents, senderFrame: { parent: null, url: 'http://127.0.0.1:3000/' } },
    createTrustedSender('http://localhost:3000/?redirect=evil').event,
    createTrustedSender('https://evil.example/').event,
  ];
  for (const event of rejectedEvents) {
    assert.throws(() => policy.assertTrusted(event), error => error instanceof IpcSenderPolicyError);
  }
});

test('policy IPC packaged hanya menerima file index utama', () => {
  const entryPath = path.resolve('dist/index.html');
  const trusted = createTrustedSender(pathToFileURL(entryPath).href + '#/dashboard');
  const policy = createPolicy(trusted, { isPackaged: true, packagedEntryPath: entryPath });
  assert.equal(policy.assertTrusted(trusted.event), true);
  trusted.webContents.mainFrame.url = pathToFileURL(path.resolve('dist/other.html')).href;
  assert.throws(() => policy.assertTrusted(trusted.event), error => error.code === 'ipc_sender_rejected');
});

test('IPC credential default hanya memasang status dan tidak mengekspos mutasi', async () => {
  const trusted = createTrustedSender();
  const ipcMain = createIpcMainMock();
  const service = createMemoryCredentialService();
  const controller = createCredentialController({ credentialService: service, confirmMutation: async () => true });
  const registration = registerCredentialHandlers({
    ipcMain,
    senderPolicy: createPolicy(trusted),
    credentialController: controller,
  });
  assert.equal(ipcMain.handlers.has(CREDENTIAL_IPC_CHANNELS.STATUS), true);
  assert.equal(ipcMain.handlers.has(CREDENTIAL_IPC_CHANNELS.MUTATE), false);
  const result = await ipcMain.invoke(CREDENTIAL_IPC_CHANNELS.STATUS, trusted.event, statusRequest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.response.status.providers, { openai: 'missing', gemini: 'missing' });
  registration.dispose();
  assert.equal(ipcMain.handlers.size, 0);
});

test('IPC mutasi menggunakan konfirmasi configure, replace, dan remove dari controller', async () => {
  const trusted = createTrustedSender();
  const ipcMain = createIpcMainMock();
  const service = createMemoryCredentialService();
  const confirmations = [];
  const controller = createCredentialController({
    credentialService: service,
    confirmMutation: async value => {
      confirmations.push(value);
      return true;
    },
  });
  const registration = registerCredentialHandlers({
    ipcMain,
    senderPolicy: createPolicy(trusted),
    credentialController: controller,
    mutationsEnabled: true,
  });

  const configured = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.MUTATE,
    trusted.event,
    configureRequest(CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
  );
  const replaced = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.MUTATE,
    trusted.event,
    configureRequest(CREDENTIAL_CONFIGURATION_MODES.REPLACE, SYNTHETIC_OPENAI_REPLACEMENT),
  );
  const removed = await ipcMain.invoke(CREDENTIAL_IPC_CHANNELS.MUTATE, trusted.event, removeRequest());
  assert.deepEqual(confirmations.map(value => value.action), ['configure', 'replace', 'remove']);
  assert.deepEqual([configured.response.operation, replaced.response.operation, removed.response.operation], [
    'configure', 'replace', 'remove',
  ]);
  const serialized = JSON.stringify({ configured, replaced, removed, confirmations });
  assert.equal(serialized.includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  assert.equal(serialized.includes(SYNTHETIC_OPENAI_REPLACEMENT), false);
  assert.equal(serialized.includes('ciphertext'), false);
  registration.dispose();
});

test('IPC production membatasi mutasi credential hanya untuk Gemini', async () => {
  const trusted = createTrustedSender();
  const ipcMain = createIpcMainMock();
  const service = createMemoryCredentialService();
  const confirmations = [];
  const controller = createCredentialController({
    credentialService: service,
    confirmMutation: async value => {
      confirmations.push(value);
      return true;
    },
  });
  const registration = registerCredentialHandlers({
    ipcMain,
    senderPolicy: createPolicy(trusted),
    credentialController: controller,
    mutationsEnabled: true,
    allowedMutationProviders: [CREDENTIAL_PROVIDERS.GEMINI],
  });

  const rejectedOpenAI = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.MUTATE,
    trusted.event,
    configureRequest(CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
  );
  const configuredGemini = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.MUTATE,
    trusted.event,
    configureRequest(
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_GEMINI_CREDENTIAL,
      CREDENTIAL_PROVIDERS.GEMINI,
    ),
  );

  assert.equal(rejectedOpenAI.ok, false);
  assert.equal(rejectedOpenAI.error.code, 'mutation_disabled');
  assert.equal(configuredGemini.ok, true);
  assert.deepEqual(confirmations, [{ action: 'configure', provider: CREDENTIAL_PROVIDERS.GEMINI }]);
  assert.equal(service.credentials.has(CREDENTIAL_PROVIDERS.OPENAI), false);
  assert.equal(service.credentials.has(CREDENTIAL_PROVIDERS.GEMINI), true);
  const serialized = JSON.stringify({ rejectedOpenAI, configuredGemini, confirmations });
  assert.equal(serialized.includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  assert.equal(serialized.includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
  assert.equal(serialized.includes('ciphertext'), false);
  registration.dispose();
});

test('IPC credential menolak sender dan payload invalid tanpa memanggil controller', async () => {
  const trusted = createTrustedSender();
  const ipcMain = createIpcMainMock();
  let calls = 0;
  const registration = registerCredentialHandlers({
    ipcMain,
    senderPolicy: createPolicy(trusted),
    credentialController: { execute: async () => { calls += 1; } },
  });
  const evil = createTrustedSender('https://evil.example/');
  const rejectedSender = await ipcMain.invoke(CREDENTIAL_IPC_CHANNELS.STATUS, evil.event, statusRequest());
  const rejectedPayload = await ipcMain.invoke(
    CREDENTIAL_IPC_CHANNELS.STATUS,
    trusted.event,
    { ...statusRequest(), credential: SYNTHETIC_OPENAI_CREDENTIAL },
  );
  assert.equal(rejectedSender.error.code, 'ipc_sender_rejected');
  assert.equal(rejectedPayload.error.code, 'invalid_request');
  assert.equal(calls, 0);
  assert.equal(JSON.stringify({ rejectedSender, rejectedPayload }).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
  registration.dispose();
});
