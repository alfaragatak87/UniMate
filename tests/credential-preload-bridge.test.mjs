import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import bridgeModule from '../electron/ipc/credentialPreloadBridge.cjs';
import { SYNTHETIC_OPENAI_CREDENTIAL } from './fixtures/credentialFixtures.mjs';

const { CREDENTIAL_IPC_CHANNELS, createCredentialPreloadBridge } = bridgeModule;

function createIpcRendererMock() {
  const calls = [];
  return {
    calls,
    async invoke(channel, request) {
      calls.push({ channel, request });
      if (channel === CREDENTIAL_IPC_CHANNELS.STATUS) {
        return { ok: true, response: { operation: 'status' } };
      }
      return {
        ok: true,
        response: { operation: 'configure', provider: 'openai', outcome: 'completed', changed: true },
      };
    },
  };
}

test('bridge production hanya mengekspos status ketika mutasi nonaktif', async () => {
  const ipcRenderer = createIpcRendererMock();
  const bridge = createCredentialPreloadBridge({ ipcRenderer, mutationsEnabled: false });
  const result = await bridge.getCredentialStatus();

  assert.equal(bridge.credentialMutationsEnabled, false);
  assert.equal(Object.hasOwn(bridge, 'mutateCredential'), false);
  assert.deepEqual(ipcRenderer.calls, [{
    channel: CREDENTIAL_IPC_CHANNELS.STATUS,
    request: { schemaVersion: 1, operation: 'status' },
  }]);
  assert.equal(result.ok, true);
  assert.equal(Object.isFrozen(bridge), true);
});

test('bridge pengujian meneruskan mutasi tanpa mencatat atau memantulkan credential', async () => {
  const ipcRenderer = createIpcRendererMock();
  const bridge = createCredentialPreloadBridge({ ipcRenderer, mutationsEnabled: true });
  const request = {
    schemaVersion: 1,
    operation: 'configure',
    provider: 'openai',
    mode: 'create',
    credential: SYNTHETIC_OPENAI_CREDENTIAL,
  };
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];
  console.log = value => logs.push(value);
  console.warn = value => logs.push(value);
  console.error = value => logs.push(value);
  try {
    const result = await bridge.mutateCredential(request);
    assert.equal(bridge.credentialMutationsEnabled, true);
    assert.equal(ipcRenderer.calls[0].channel, CREDENTIAL_IPC_CHANNELS.MUTATE);
    assert.equal(ipcRenderer.calls[0].request, request);
    assert.equal(JSON.stringify(result).includes(SYNTHETIC_OPENAI_CREDENTIAL), false);
    assert.deepEqual(logs, []);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('preload production membuka transport mutasi tanpa mengekspos channel atau secret', async () => {
  const source = await fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(source, /createCredentialPreloadBridge/u);
  assert.match(source, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.equal(source.includes('unimate:credentials:mutate'), false);
  for (const forbidden of ['apiKey', 'ciphertext', 'gatewayToken', 'csrfToken', 'sessionCookie']) {
    assert.equal(source.includes(forbidden), false);
  }
});
