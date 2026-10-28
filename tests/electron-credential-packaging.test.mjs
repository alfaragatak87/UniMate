import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';

import constants from '../electron/credentials/constants.cjs';
import {
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_REPLACEMENT,
} from './fixtures/credentialFixtures.mjs';
import {
  SYNTHETIC_ANALYTICS_REQUEST,
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { CREDENTIAL_DIRECTORY_NAME, CREDENTIAL_FILE_NAME } = constants;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const electronBuilderCli = path.join(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const localElectronDist = path.dirname(electronExecutable);
const sourceHarnessPath = path.join(repositoryRoot, 'tests', 'fixtures', 'credentialPackagingHarness.cjs');
const syntheticSecrets = [SYNTHETIC_OPENAI_CREDENTIAL, SYNTHETIC_OPENAI_REPLACEMENT];
const electronTestLockPath = path.join(repositoryRoot, 'node_modules', '.unimate-electron-test.lock');

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContainedPath(parentPath, childPath) {
  const parent = normalizedPath(parentPath);
  const child = normalizedPath(childPath);
  assert.equal(child === parent || child.startsWith(`${parent}${path.sep}`), true);
}

function assertNoSyntheticSecret(value) {
  for (const secret of syntheticSecrets) assert.equal(value.includes(secret), false);
}

function assertNoSecret(value) {
  assertNoSyntheticSecret(value);
  assert.equal(value.includes('"ciphertext"'), false);
}

function sanitizeBuilderDiagnostic(value, privatePaths) {
  let sanitized = String(value);
  for (const privatePath of privatePaths) {
    sanitized = sanitized.replaceAll(privatePath, '<isolated-path>');
    sanitized = sanitized.replaceAll(privatePath.replaceAll('\\', '/'), '<isolated-path>');
  }
  sanitized = sanitized
    .replace(/[A-Za-z]:[\\/][^\r\n"'`]*/gu, '<private-path>')
    .replace(/\\\\[^\s"'`]+/gu, '<private-path>');
  return sanitized.split(/\r?\n/u).filter(Boolean).slice(-8).join(' | ').slice(0, 1200);
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeArchiveEntry(value) {
  return value.replace(/^[/\\]+/u, '').split(/[/\\]+/u).join('/');
}

function createArchiveExtractionPath(value) {
  return value.replace(/^[/\\]+/u, '').split(/[/\\]+/u).join(path.sep);
}

async function pathDoesNotExist(targetPath) {
  await assert.rejects(fs.access(targetPath), error => error.code === 'ENOENT');
}

async function removeTestDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise(resolve => killer.once('close', resolve));
    return;
  }
  child.kill('SIGKILL');
}

async function acquireElectronTestLock() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(electronTestLockPath);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(electronTestLockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('electron_test_lock_timeout');
}

async function waitForWindowsElectronTeardown() {
  if (process.platform === 'win32') await new Promise(resolve => setTimeout(resolve, 5_000));
}

async function copyFile(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function copyDirectory(sourcePath, destinationPath) {
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntry = path.join(sourcePath, entry.name);
    const destinationEntry = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourceEntry, destinationEntry);
    else if (entry.isFile()) await copyFile(sourceEntry, destinationEntry);
  }
}

async function createStagingApp(stagingPath, buildOutputPath) {
  const sourcePackage = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const electronPackage = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
  );
  const credentialModuleNames = (await fs.readdir(path.join(repositoryRoot, 'electron', 'credentials')))
    .filter(name => name.endsWith('.cjs'));
  const sharedModuleNames = (await fs.readdir(path.join(repositoryRoot, 'shared', 'credentials')))
    .filter(name => name.endsWith('.mjs'));

  for (const name of credentialModuleNames) {
    await copyFile(
      path.join(repositoryRoot, 'electron', 'credentials', name),
      path.join(stagingPath, 'electron', 'credentials', name),
    );
  }
  for (const name of sharedModuleNames) {
    await copyFile(
      path.join(repositoryRoot, 'shared', 'credentials', name),
      path.join(stagingPath, 'shared', 'credentials', name),
    );
  }
  for (const relativeDirectory of ['electron/ai', 'electron/ipc', 'electron/security', 'gateway', 'shared/ai']) {
    await copyDirectory(
      path.join(repositoryRoot, relativeDirectory),
      path.join(stagingPath, relativeDirectory),
    );
  }
  await copyFile(sourceHarnessPath, path.join(stagingPath, 'electron', 'credentialPackagingHarness.cjs'));
  await fs.writeFile(
    path.join(stagingPath, 'electron', 'preloadHarness.html'),
    '<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'"></head><body></body></html>',
    'utf8',
  );
  await viteBuild({
    configFile: path.join(repositoryRoot, 'vite.preload.config.js'),
    logLevel: 'silent',
    build: {
      emptyOutDir: false,
      outDir: path.join(stagingPath, 'dist'),
    },
  });

  const stagingPackage = {
    name: sourcePackage.name,
    productName: sourcePackage.productName,
    description: sourcePackage.description,
    author: sourcePackage.author,
    license: sourcePackage.license,
    private: true,
    version: sourcePackage.version,
    main: 'electron/credentialPackagingHarness.cjs',
    build: {
      appId: sourcePackage.build.appId,
      productName: sourcePackage.build.productName,
      asar: true,
      electronVersion: electronPackage.version,
      electronDist: localElectronDist,
      npmRebuild: false,
      buildDependenciesFromSource: false,
      directories: { output: buildOutputPath },
      files: sourcePackage.build.files,
      win: { signAndEditExecutable: false },
    },
  };
  await fs.writeFile(path.join(stagingPath, 'package.json'), JSON.stringify(stagingPackage, null, 2), 'utf8');
}

function createIsolatedEnvironment(paths) {
  const environment = {
    ...process.env,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    TEMP: paths.temp,
    TMP: paths.temp,
    HOME: paths.home,
    USERPROFILE: paths.home,
    ELECTRON_CACHE: paths.electronCache,
    ELECTRON_BUILDER_CACHE: paths.builderCache,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    npm_config_offline: 'true',
    NPM_CONFIG_OFFLINE: 'true',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost',
  };
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[name];
  }
  assert.equal(
    Object.keys(environment).some(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),
    false,
  );
  return environment;
}

test('credential kompatibel antara development dan packaged Electron terisolasi', { timeout: 180_000 }, async () => {
  const releaseElectronTestLock = await acquireElectronTestLock();
  let rootPath;
  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-m3b2b-packaging-'));
  const paths = {
    appData: path.join(rootPath, 'environment', 'appdata'),
    profile: path.join(rootPath, 'environment', 'appdata', 'UniMate'),
    localAppData: path.join(rootPath, 'environment', 'localappdata'),
    temp: path.join(rootPath, 'environment', 'temp'),
    home: path.join(rootPath, 'environment', 'home'),
    electronCache: path.join(rootPath, 'cache', 'electron'),
    builderCache: path.join(rootPath, 'cache', 'electron-builder'),
    staging: path.join(rootPath, 'staging'),
    buildOutput: path.join(rootPath, 'build-output'),
    requests: path.join(rootPath, 'requests'),
    results: path.join(rootPath, 'results'),
  };
  const environment = createIsolatedEnvironment(paths);
  const activeChildren = new Set();
  let originalFailure;

  async function runChild(label, executable, argumentsList, timeoutMs) {
    const child = spawn(executable, argumentsList, {
      cwd: paths.staging,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, timeoutMs);
    try {
      const processResult = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
      });
      assertNoSecret(stdout);
      assertNoSecret(stderr);
      assert.equal(timedOut, false, `${label}_timeout`);
      return { ...processResult, stdout, stderr };
    } finally {
      clearTimeout(timeoutId);
      if (child.exitCode === null && child.signalCode === null) await terminateProcessTree(child);
      activeChildren.delete(child);
    }
  }

  async function runCredentialOperation(executable, expectedMode, name, request) {
    const requestPath = path.join(paths.requests, `${name}.json`);
    const resultPath = path.join(paths.results, `${name}.json`);
    assertContainedPath(rootPath, requestPath);
    assertContainedPath(rootPath, resultPath);
    await fs.mkdir(path.dirname(requestPath), { recursive: true });
    await fs.writeFile(requestPath, JSON.stringify({ ...request, expectedMode }), 'utf8');

    const processResult = await runChild(name, executable, [
      `--user-data-dir=${paths.profile}`,
      expectedMode === 'development' ? paths.staging : undefined,
      `--isolation-root=${rootPath}`,
      `--request=${requestPath}`,
      `--result=${resultPath}`,
    ].filter(Boolean), 45_000);

    let serialized = null;
    try {
      serialized = await fs.readFile(resultPath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let result = null;
    if (serialized !== null) {
      assertNoSecret(serialized);
      result = JSON.parse(serialized);
    }
    if (processResult.exitCode !== 0 || result?.ok !== true) {
      const stage = typeof result?.stage === 'string' && /^[a-z0-9_]+$/u.test(result.stage)
        ? result.stage
        : 'result_unavailable';
      const code = typeof result?.code === 'string' && /^[a-z0-9_]+$/u.test(result.code)
        ? result.code
        : 'code_unavailable';
      const signal = processResult.exitSignal ?? 'none';
      assert.equal(
        `${processResult.exitCode}_${result?.ok === true}`,
        '0_true',
        `${name}_stage_${stage}_code_${code}_signal_${signal}`,
      );
    }

    await pathDoesNotExist(requestPath);
    assert.notEqual(serialized, null);
    assertNoSecret(serialized);
    assert.equal(result.ok, true);
    assert.equal(result.mode, expectedMode);
    assert.equal(typeof result.userDataRelative, 'string');
    assert.equal(path.isAbsolute(result.userDataRelative), false);
    assert.equal(result.userDataRelative.startsWith('..'), false);
    return result;
  }

  try {
    for (const environmentPath of Object.values(paths)) assertContainedPath(rootPath, environmentPath);
    await Promise.all([
      paths.appData,
      paths.profile,
      paths.localAppData,
      paths.temp,
      paths.home,
      paths.electronCache,
      paths.builderCache,
      paths.staging,
      paths.buildOutput,
      paths.requests,
      paths.results,
    ].map(directory => fs.mkdir(directory, { recursive: true })));

    await createStagingApp(paths.staging, paths.buildOutput);
    const builderProcess = await runChild('electron_builder', process.execPath, [
      electronBuilderCli,
      '--dir',
      '--win',
      '--x64',
      '--publish',
      'never',
    ], 90_000);
    const builderDiagnostic = sanitizeBuilderDiagnostic(
      `${builderProcess.stdout}\n${builderProcess.stderr}`,
      [rootPath, repositoryRoot],
    );
    assert.equal(
      builderProcess.exitCode,
      0,
      `electron_builder_exit_${builderProcess.exitCode}_signal_${builderProcess.exitSignal ?? 'none'}_${builderDiagnostic}`,
    );

    const packagedExecutable = path.join(paths.buildOutput, 'win-unpacked', 'UniMate.exe');
    const asarPath = path.join(paths.buildOutput, 'win-unpacked', 'resources', 'app.asar');
    assertContainedPath(rootPath, packagedExecutable);
    assertContainedPath(rootPath, asarPath);
    await fs.access(packagedExecutable);
    await fs.access(asarPath);

    const listedArchiveEntries = asar.listPackage(asarPath);
    assert.equal(listedArchiveEntries.every(entry => entry.startsWith(path.sep)), true);
    const archiveEntries = listedArchiveEntries.map(entry => ({
      canonicalPath: normalizeArchiveEntry(entry),
      extractionPath: createArchiveExtractionPath(entry),
    }));
    const requiredEntries = new Map([
      ['package.json', 'electron/credentialPackagingHarness.cjs'],
      ['dist/electron-preload.cjs', 'contextBridge.exposeInMainWorld'],
      ['electron/credentialPackagingHarness.cjs', 'createElectronCredentialRuntime'],
      ['electron/preloadHarness.html', 'Content-Security-Policy'],
      ['electron/credentials/credentialRuntime.cjs', 'createElectronCredentialRuntime'],
      ['electron/credentials/credentialService.cjs', 'createCredentialService'],
      ['electron/credentials/encryptedFileStore.cjs', 'createEncryptedCredentialFileStore'],
      ['electron/credentials/safeStorageAdapter.cjs', 'createSafeStorageAdapter'],
      ['electron/ai/budgetFileStore.cjs', 'createAIBudgetFileStore'],
      ['electron/ai/budgetPaths.cjs', 'resolveAIBudgetPaths'],
      ['electron/ai/budgetRuntime.cjs', 'createElectronBudgetRuntime'],
      ['electron/ai/budgetStartup.cjs', 'createAIBudgetStartup'],
      ['electron/ai/budgetController.cjs', 'createAIBudgetController'],
      ['electron/ai/gatewayRuntime.cjs', 'createElectronGatewayRuntime'],
      ['electron/ai/gatewayStartup.cjs', 'createAIGatewayStartup'],
      ['electron/ai/internalGatewayClient.cjs', 'createInternalGatewayClient'],
      ['electron/ai/providerExecutors.cjs', 'createProviderExecutors'],
      ['electron/ipc/aiHandlers.cjs', 'registerAIHandlers'],
      ['electron/ipc/budgetHandlers.cjs', 'registerAIBudgetHandlers'],
      ['electron/ipc/budgetPreloadBridge.cjs', 'createAIBudgetPreloadBridge'],
      ['electron/ipc/credentialHandlers.cjs', 'registerCredentialHandlers'],
      ['electron/ipc/credentialPreloadBridge.cjs', 'createCredentialPreloadBridge'],
      ['electron/security/ipcSenderPolicy.cjs', 'createIpcSenderPolicy'],
      ['electron/security/windowSecurityPolicy.cjs', 'installWindowSecurityPolicy'],
      ['gateway/createGateway.mjs', 'createGateway'],
      ['gateway/ai/budgetGuard.mjs', 'createAIBudgetGuard'],
      ['gateway/ai/budgetedRouter.mjs', 'createBudgetedAIRouter'],
      ['gateway/ai/providers/credentialBackedProvider.mjs', 'createCredentialBackedProvider'],
      ['gateway/ai/providers/providerAdapterSupport.mjs', 'ProviderAdapterError'],
      ['gateway/ai/providers/providerHttpTransport.mjs', 'createProviderHttpTransport'],
      ['gateway/ai/providers/openAIProviderAdapter.mjs', 'createOpenAIProviderAdapter'],
      ['gateway/ai/providers/geminiProviderAdapter.mjs', 'createGeminiProviderAdapter'],
      ['shared/ai/contracts.mjs', 'AI_CONTRACT_VERSION'],
      ['shared/ai/budgetTransportContracts.mjs', 'AI_BUDGET_TRANSPORT_VERSION'],
      ['shared/ai/budgetTransportValidation.mjs', 'validateAIBudgetTransportRequest'],
      ['shared/ai/modelCatalog.mjs', 'AI_MODEL_CATALOG'],
      ['shared/ai/runtimeStatusContracts.mjs', 'AI_RUNTIME_STATUS_VERSION'],
      ['shared/ai/runtimeStatusValidation.mjs', 'validateAIRuntimeStatusResponse'],
      ['shared/credentials/contracts.mjs', 'CREDENTIAL_CONTRACT_VERSION'],
      ['shared/credentials/validation.mjs', 'assertValidCredentialMutation'],
    ]);
    for (const [requiredPath, contentMarker] of requiredEntries) {
      const archiveEntry = archiveEntries.find(entry => entry.canonicalPath === requiredPath);
      assert.notEqual(archiveEntry, undefined, `missing_asar_entry_${requiredPath}`);
      const extracted = asar.extractFile(asarPath, archiveEntry.extractionPath);
      assert.equal(extracted.length > 0, true);
      assert.equal(extracted.toString('utf8').includes(contentMarker), true, `invalid_asar_content_${requiredPath}`);
    }
    const bundledPreloadEntry = archiveEntries.find(entry => entry.canonicalPath === 'dist/electron-preload.cjs');
    assert.notEqual(bundledPreloadEntry, undefined);
    const bundledPreload = asar.extractFile(asarPath, bundledPreloadEntry.extractionPath).toString('utf8');
    assert.match(bundledPreload, /require\(["']electron["']\)/u);
    assert.equal(/require\(["']\.\.?[/\\]/u.test(bundledPreload), false);
    for (const forbidden of ['apiKey', 'ciphertext', 'gatewayToken', 'csrfToken', 'sessionCookie']) {
      assert.equal(bundledPreload.includes(forbidden), false, `unsafe_bundled_preload_${forbidden}`);
    }
    for (const { canonicalPath: entry } of archiveEntries) {
      assert.equal(entry.startsWith('tests/'), false);
      assert.equal(entry.includes('/fixtures/'), false);
      assert.equal(entry.endsWith(CREDENTIAL_FILE_NAME), false);
      assert.equal(entry.endsWith('.tmp'), false);
      assert.equal(path.basename(entry).startsWith('.env'), false);
    }
    const archiveBytes = await fs.readFile(asarPath);
    for (const secret of syntheticSecrets) assert.equal(archiveBytes.includes(Buffer.from(secret, 'utf8')), false);

    const preloadVerified = await runCredentialOperation(packagedExecutable, 'packaged', 'packaged-preload', {
      operation: 'verify-preload',
      auditRequests: {
        analytics: SYNTHETIC_ANALYTICS_REQUEST,
        scanner: SYNTHETIC_DOCUMENT_REQUEST,
      },
    });
    assert.deepEqual(preloadVerified.operation.gateway, { state: 'running', available: true });
    assert.equal(preloadVerified.operation.productionEnabled, true);
    assert.equal(preloadVerified.operation.openaiEnabled, false);
    assert.equal(preloadVerified.operation.credentialBridgeAvailable, true);
    assert.equal(preloadVerified.operation.budgetBridgeAvailable, true);
    assert.equal(preloadVerified.operation.preferenceBridgeAvailable, true);
    assert.equal(preloadVerified.operation.analyticsRejected, true);
    assert.equal(preloadVerified.operation.scannerCapabilityEnabled, true);
    assert.equal(preloadVerified.operation.externalRequests, 0);

    const configured = await runCredentialOperation(electronExecutable, 'development', 'development-configure', {
      operation: 'configure',
      provider: 'openai',
      credential: SYNTHETIC_OPENAI_CREDENTIAL,
    });
    assert.equal(configured.operation.configured, true);
    assert.equal(configured.operation.replaced, false);

    const userDataPath = path.join(paths.appData, ...configured.userDataRelative.split('/'));
    assertContainedPath(paths.appData, userDataPath);
    const credentialPath = path.join(userDataPath, CREDENTIAL_DIRECTORY_NAME, CREDENTIAL_FILE_NAME);
    assertContainedPath(rootPath, credentialPath);
    const initialEnvelope = await fs.readFile(credentialPath, 'utf8');
    assertNoSyntheticSecret(initialEnvelope);

    const packagedVerified = await runCredentialOperation(packagedExecutable, 'packaged', 'packaged-verify', {
      operation: 'verify',
      provider: 'openai',
      expectedDigest: digest(SYNTHETIC_OPENAI_CREDENTIAL),
    });
    assert.equal(packagedVerified.userDataRelative, configured.userDataRelative);
    assert.equal(packagedVerified.operation.verified, true);

    const packagedReplaced = await runCredentialOperation(packagedExecutable, 'packaged', 'packaged-replace', {
      operation: 'configure',
      provider: 'openai',
      credential: SYNTHETIC_OPENAI_REPLACEMENT,
    });
    assert.equal(packagedReplaced.userDataRelative, configured.userDataRelative);
    assert.equal(packagedReplaced.operation.configured, true);
    assert.equal(packagedReplaced.operation.replaced, true);

    const developmentVerified = await runCredentialOperation(electronExecutable, 'development', 'development-verify', {
      operation: 'verify',
      provider: 'openai',
      expectedDigest: digest(SYNTHETIC_OPENAI_REPLACEMENT),
    });
    assert.equal(developmentVerified.userDataRelative, configured.userDataRelative);
    assert.equal(developmentVerified.operation.verified, true);

    const replacedEnvelope = await fs.readFile(credentialPath, 'utf8');
    assertNoSyntheticSecret(replacedEnvelope);
    assert.notEqual(createHash('sha256').update(replacedEnvelope).digest('hex'), createHash('sha256').update(initialEnvelope).digest('hex'));
    assert.equal(activeChildren.size, 0);

    const cachedFiles = [];
    for (const cachePath of [paths.electronCache, paths.builderCache]) {
      const entries = await fs.readdir(cachePath, { recursive: true, withFileTypes: true });
      cachedFiles.push(...entries.filter(entry => entry.isFile()));
    }
    assert.equal(cachedFiles.length, 0);
  } catch (error) {
    originalFailure = error;
  } finally {
    for (const child of activeChildren) await terminateProcessTree(child);
    activeChildren.clear();
    await removeTestDirectory(rootPath);
    await pathDoesNotExist(rootPath);
  }

  if (originalFailure) throw originalFailure;
  } finally {
    await waitForWindowsElectronTeardown();
    await releaseElectronTestLock();
  }
});
