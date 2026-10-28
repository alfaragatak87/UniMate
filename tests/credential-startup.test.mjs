import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import startupModule from '../electron/credentials/credentialStartup.cjs';

const { CREDENTIAL_STARTUP_STATES, createCredentialStartup } = startupModule;

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createSafeStorageMock() {
  const calls = { availability: 0, encrypt: 0, decrypt: 0 };
  return {
    calls,
    safeStorage: {
      async isAsyncEncryptionAvailable() {
        calls.availability += 1;
        return true;
      },
      async encryptStringAsync() {
        calls.encrypt += 1;
        return Buffer.from('synthetic-ciphertext');
      },
      async decryptStringAsync() {
        calls.decrypt += 1;
        return { result: 'synthetic-credential-value-000001', shouldReEncrypt: false };
      },
    },
  };
}

test('startup membuat credential runtime tepat satu kali setelah app siap tanpa menulis file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-m3b2a-startup-'));
  const ready = createDeferred();
  const mock = createSafeStorageMock();
  let appReady = false;
  let getPathCalls = 0;
  let setPathCalls = 0;
  const app = {
    whenReady: () => ready.promise,
    isReady: () => appReady,
    getPath(name) {
      assert.equal(name, 'userData');
      getPathCalls += 1;
      return directory;
    },
    setPath() {
      setPathCalls += 1;
      throw new Error('setPath tidak boleh dipanggil');
    },
  };
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const startup = createCredentialStartup({ app, safeStorage: mock.safeStorage });
  assert.deepEqual(startup.getStatus(), { state: CREDENTIAL_STARTUP_STATES.IDLE, available: false });
  assert.equal(startup.getRuntimeForMainProcess(), null);

  const firstInitialization = startup.initialize();
  const secondInitialization = startup.initialize();
  assert.strictEqual(secondInitialization, firstInitialization);
  assert.equal(getPathCalls, 0);

  appReady = true;
  ready.resolve();
  const status = await firstInitialization;
  assert.deepEqual(status, { state: CREDENTIAL_STARTUP_STATES.READY, available: true });
  assert.equal(startup.getRuntimeForMainProcess()?.service !== undefined, true);
  assert.equal(getPathCalls, 1);
  assert.equal(setPathCalls, 0);
  assert.deepEqual(mock.calls, { availability: 0, encrypt: 0, decrypt: 0 });
  await assert.rejects(
    fs.access(path.join(directory, 'credentials')),
    error => error.code === 'ENOENT',
  );

  assert.strictEqual(await startup.initialize(), status);
  assert.equal(getPathCalls, 1);
});

test('kegagalan runtime disanitasi dan tidak menghentikan startup aplikasi', async () => {
  const secret = 'synthetic-private-error-value-000001';
  const captured = [];
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...values) => captured.push(values);
  console.warn = (...values) => captured.push(values);
  console.error = (...values) => captured.push(values);

  try {
    const app = { whenReady: async () => undefined };
    const startup = createCredentialStartup({
      app,
      safeStorage: {},
      createRuntime() {
        throw new Error(secret);
      },
    });
    const status = await startup.initialize();
    assert.deepEqual(status, { state: CREDENTIAL_STARTUP_STATES.UNAVAILABLE, available: false });
    assert.equal(startup.getRuntimeForMainProcess(), null);
    assert.equal(JSON.stringify(status).includes(secret), false);
    assert.equal(captured.length, 0);
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});

test('startup dan packaging mempertahankan identitas, origin, session, dan file yang disetujui', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const mainSource = await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const preloadSource = await fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const preloadBridgeSource = await fs.readFile(new URL('../electron/ipc/credentialPreloadBridge.cjs', import.meta.url), 'utf8');

  assert.equal(packageJson.name, 'unimate');
  assert.equal(packageJson.productName, 'UniMate');
  assert.equal(packageJson.build.appId, 'com.unimate.app');
  assert.equal(packageJson.scripts['build:preload'], 'vite build --config vite.preload.config.js');
  assert.match(packageJson.scripts.dev, /npm run build:preload/u);
  assert.match(packageJson.scripts.build, /vite build && npm run build:preload && electron-builder/u);
  for (const requiredPattern of [
    'dist/**/*',
    'electron/**/*',
    'gateway/**/*',
    'shared/ai/**/*',
    'shared/credentials/**/*',
    '!**/credentials/ai-credentials*.enc.json',
    '!**/credentials/.*.tmp',
    'package.json',
  ]) assert.equal(packageJson.build.files.includes(requiredPattern), true, `missing_package_pattern_${requiredPattern}`);
  assert.equal(mainSource.includes("mainWindow.loadURL('http://localhost:3000')"), true);
  assert.equal(mainSource.includes("mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))"), true);
  assert.equal(mainSource.includes("preload: path.join(__dirname, '../dist/electron-preload.cjs')"), true);
  assert.equal(mainSource.includes('app.setPath'), false);
  assert.equal(mainSource.includes('partition:'), false);
  assert.equal(preloadSource.includes('createCredentialPreloadBridge'), true);
  assert.match(preloadSource, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.equal(preloadBridgeSource.includes('getCredentialStatus'), true);
  assert.equal(preloadBridgeSource.includes('unimate:credentials:status'), true);
  assert.equal(preloadBridgeSource.includes('unimate:credentials:mutate'), true);
  assert.equal(preloadSource.includes('unimate:credentials:mutate'), false);
  for (const forbidden of ['apiKey', 'ciphertext', 'csrfToken', 'Bearer ', 'gatewayToken', 'sessionCookie']) {
    assert.equal(`${preloadSource}\n${preloadBridgeSource}`.includes(forbidden), false, `unsafe_preload_${forbidden}`);
  }
  assert.match(mainSource, /registerCredentialHandlers\(\{[\s\S]*?mutationsEnabled:\s*true,[\s\S]*?allowedMutationProviders:\s*\['gemini'\]/u);
  assert.equal(mainSource.includes('createIpcSenderPolicy'), true);
  assert.equal(mainSource.includes('contextIsolation: true'), true);
  assert.equal(mainSource.includes('nodeIntegration: false'), true);
});
