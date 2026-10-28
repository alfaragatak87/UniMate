import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  CREDENTIAL_CONFIGURATION_MODES,
  CREDENTIAL_MUTATION_OUTCOMES,
  CREDENTIAL_RESPONSE_OPERATIONS,
  CREDENTIAL_TRANSPORT_OPERATIONS,
  CREDENTIAL_TRANSPORT_VERSION,
} from '../shared/credentials/transportContracts.mjs';
import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_STATES,
  CREDENTIAL_STORAGE_STATES,
} from '../shared/credentials/contracts.mjs';
import {
  CredentialClientError,
  createCredentialClient,
} from '../src/services/credentialClient.js';
import { SYNTHETIC_OPENAI_CREDENTIAL } from './fixtures/credentialFixtures.mjs';

function success(response) {
  return { ok: true, response };
}

function statusResponse() {
  return {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_RESPONSE_OPERATIONS.STATUS,
    status: {
      schemaVersion: CREDENTIAL_CONTRACT_VERSION,
      storage: CREDENTIAL_STORAGE_STATES.READY,
      providers: {
        openai: CREDENTIAL_STATES.MISSING,
        gemini: CREDENTIAL_STATES.CONFIGURED,
      },
    },
  };
}

test('client frontend menjalankan status, configure, replace, dan remove melalui transport tervalidasi', async () => {
  const requests = [];
  const client = createCredentialClient({
    statusTransport: async request => {
      requests.push(structuredClone(request));
      return success(statusResponse());
    },
    mutationTransport: async request => {
      requests.push(structuredClone(request));
      const operation = request.operation === CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE
        ? CREDENTIAL_RESPONSE_OPERATIONS.REMOVE
        : request.mode === CREDENTIAL_CONFIGURATION_MODES.CREATE
          ? CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE
          : CREDENTIAL_RESPONSE_OPERATIONS.REPLACE;
      return success({
        schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
        operation,
        provider: request.provider,
        outcome: CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
        changed: true,
      });
    },
  });

  const status = await client.getStatus();
  await client.configure('openai', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL);
  await client.configure('openai', CREDENTIAL_CONFIGURATION_MODES.REPLACE, SYNTHETIC_OPENAI_CREDENTIAL);
  await client.remove('gemini');

  assert.equal(client.canMutate(), true);
  assert.equal(status.providers.gemini, CREDENTIAL_STATES.CONFIGURED);
  assert.deepEqual(requests.map(request => request.operation), ['status', 'configure', 'configure', 'remove']);
  assert.equal(JSON.stringify({ status }).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
});

test('client production tanpa transport mutasi tetap fail-closed', async () => {
  let statusCalls = 0;
  const client = createCredentialClient({
    statusTransport: async () => {
      statusCalls += 1;
      return success(statusResponse());
    },
  });
  assert.equal(client.canMutate(), false);
  assert.throws(
    () => client.configure('openai', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    error => error instanceof CredentialClientError && error.code === 'mutation_disabled',
  );
  assert.throws(
    () => client.remove('openai'),
    error => error instanceof CredentialClientError && error.code === 'mutation_disabled',
  );
  assert.equal(statusCalls, 0);
});

test('client production hanya mengizinkan mutasi Gemini', async () => {
  const requests = [];
  const client = createCredentialClient({
    statusTransport: async () => success(statusResponse()),
    mutationTransport: async request => {
      requests.push(request);
      return success({
        schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
        operation: CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE,
        provider: request.provider,
        outcome: CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
        changed: true,
      });
    },
    allowedMutationProviders: ['gemini'],
  });
  assert.equal(client.canMutate(), true);
  assert.equal(client.canMutate('gemini'), true);
  assert.equal(client.canMutate('openai'), false);
  assert.throws(
    () => client.configure('openai', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    error => error.code === 'mutation_disabled',
  );
  await client.configure('gemini', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL);
  assert.deepEqual(requests.map(request => request.provider), ['gemini']);
});

test('payload invalid dan error transport tidak memantulkan credential', async () => {
  let mutationCalls = 0;
  const client = createCredentialClient({
    statusTransport: async () => success(statusResponse()),
    mutationTransport: async () => {
      mutationCalls += 1;
      throw new Error(`${SYNTHETIC_OPENAI_CREDENTIAL} C:\\private-profile`);
    },
  });
  assert.throws(
    () => client.configure('unknown', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    error => error.code === 'invalid_request' && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
  await assert.rejects(
    client.configure('openai', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    error => error.code === 'operation_failed' && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
  assert.equal(mutationCalls, 1);
});

test('Settings membuka mutasi Gemini sementara OpenAI tetap terkunci', async () => {
  const [settingsSource, preloadSource, preloadBridgeSource, mainSource] = await Promise.all([
    fs.readFile(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/ipc/credentialPreloadBridge.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  ]);
  assert.match(settingsSource, /type="password"/u);
  assert.match(settingsSource, /providerMutationAvailable = client\.canMutate\(provider\.id\)/u);
  assert.match(settingsSource, /disabled=\{!providerMutationAvailable/u);
  assert.match(settingsSource, /finally\s*\{[\s\S]*clearDraft\(provider\)/u);
  assert.match(settingsSource, /onClick=\{\(\) => clearDraft\(provider\.id\)\}/u);
  assert.equal(settingsSource.includes('localStorage'), false);
  assert.equal(settingsSource.includes('gemini_api_key'), false);
  assert.equal(preloadSource.includes('credentials:mutate'), false);
  assert.match(preloadSource, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.match(preloadBridgeSource, /credentialMutationsEnabled:\s*mutationsEnabled/u);
  assert.match(preloadBridgeSource, /unimate:credentials:mutate/u);
  assert.match(mainSource, /allowedMutationProviders:\s*\['gemini'\]/u);
});
