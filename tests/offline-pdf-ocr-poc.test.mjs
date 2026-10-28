import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const electronBuilderCli = path.join(repositoryRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const localElectronDist = path.dirname(electronExecutable);
const electronTestLockPath = path.join(repositoryRoot, 'node_modules', '.unimate-electron-test.lock');
const assetRoot = path.join(repositoryRoot, 'public', 'offline-scanner');

const EXPECTED_ASSETS = Object.freeze([
  'THIRD_PARTY_NOTICES.txt',
  'licenses/LICENSE-pdfjs.txt',
  'licenses/LICENSE-tesseract.txt',
  'pdfjs/pdf.min.mjs',
  'pdfjs/pdf.worker.min.mjs',
  'tesseract/tesseract.esm.min.js',
  'tesseract/worker.min.js',
  'tesseract/core/tesseract-core-lstm.wasm.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract/lang/eng.traineddata.gz',
  'tesseract/lang/ind.traineddata.gz',
]);

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContainedPath(parentPath, childPath) {
  const parent = normalizedPath(parentPath);
  const child = normalizedPath(childPath);
  assert.equal(child === parent || child.startsWith(`${parent}${path.sep}`), true);
}

function normalizeArchiveEntry(value) {
  return value.replace(/^[/\\]+/u, '').split(/[/\\]+/u).join('/');
}

function createArchiveExtractionPath(value) {
  return value.replace(/^[/\\]+/u, '').split(/[/\\]+/u).join(path.sep);
}

function sanitizeDiagnostic(value, privatePaths) {
  let sanitized = String(value);
  for (const privatePath of privatePaths) {
    sanitized = sanitized.replaceAll(privatePath, '<isolated-path>');
    sanitized = sanitized.replaceAll(privatePath.replaceAll('\\', '/'), '<isolated-path>');
  }
  return sanitized
    .replace(/[A-Za-z]:[\\/][^\r\n"'`]*/gu, '<private-path>')
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-8)
    .join(' | ')
    .slice(0, 1200);
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

async function listRelativeFiles(rootPath, relativePath = '') {
  const entries = await fs.readdir(path.join(rootPath, relativePath), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelativePath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(rootPath, childRelativePath));
    else if (entry.isFile()) files.push(childRelativePath.split(path.sep).join('/'));
  }
  return files;
}

async function acquireElectronTestLock() {
  const deadline = Date.now() + 180_000;
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

async function removeTestDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
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
  return environment;
}

async function createStagingApp(paths) {
  const electronPackage = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'offlineScannerPocHarness.cjs'),
    path.join(paths.staging, 'electron', 'offlineScannerPocHarness.cjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'offlineScannerPoc.html'),
    path.join(paths.staging, 'dist', 'offline-scanner-poc.html'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'offlineScannerPocRenderer.mjs'),
    path.join(paths.staging, 'dist', 'offline-scanner-poc-renderer.mjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'offlineScannerPocBootstrap.mjs'),
    path.join(paths.staging, 'dist', 'offline-scanner-poc-bootstrap.mjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'src', 'services', 'offlineDocumentEngine.js'),
    path.join(paths.staging, 'dist', 'offline-document-engine.mjs'),
  );
  await copyDirectory(assetRoot, path.join(paths.staging, 'dist', 'offline-scanner'));
  const stagingPackage = {
    name: 'unimate-offline-scanner-poc',
    productName: 'UniMate Offline Scanner PoC',
    version: '1.0.0',
    private: true,
    main: 'electron/offlineScannerPocHarness.cjs',
    build: {
      appId: 'com.unimate.offline-scanner-poc',
      productName: 'UniMate Offline Scanner PoC',
      asar: true,
      electronVersion: electronPackage.version,
      electronDist: localElectronDist,
      npmRebuild: false,
      buildDependenciesFromSource: false,
      directories: { output: paths.buildOutput },
      files: ['dist/**/*', 'electron/**/*', 'package.json'],
      win: { signAndEditExecutable: false },
    },
  };
  await fs.writeFile(
    path.join(paths.staging, 'package.json'),
    JSON.stringify(stagingPackage, null, 2),
    'utf8',
  );
}

async function runChild({ executable, argumentsList, cwd, environment, timeoutMs }) {
  const child = spawn(executable, argumentsList, {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminateProcessTree(child);
  }, timeoutMs);
  try {
    const processResult = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
    });
    return { ...processResult, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) await terminateProcessTree(child);
  }
}

test('dependency dan aset PDF/OCR lokal terpin serta sesuai batas PWA', async () => {
  const expectedVersions = new Map([
    ['pdfjs-dist', ['6.4.299', 'Apache-2.0']],
    ['tesseract.js', ['7.0.0', 'Apache-2.0']],
    ['tesseract.js-core', ['7.0.0', 'Apache-2.0']],
    ['@tesseract.js-data/eng', ['1.0.0', 'MIT']],
    ['@tesseract.js-data/ind', ['1.0.0', 'MIT']],
  ]);
  for (const [name, [version, license]] of expectedVersions) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.version, version);
    assert.equal(manifest.license, license);
  }
  const sourceAssetFiles = await listRelativeFiles(assetRoot);
  assert.equal(sourceAssetFiles.length, 44);
  for (const relativePath of EXPECTED_ASSETS) {
    assert.equal(sourceAssetFiles.includes(relativePath), true, `${relativePath}_missing`);
  }
  for (const relativePath of sourceAssetFiles) {
    const stats = await fs.stat(path.join(assetRoot, relativePath));
    assert.equal(stats.isFile(), true);
    if (!relativePath.startsWith('licenses/') && relativePath !== 'THIRD_PARTY_NOTICES.txt') {
      assert.equal(stats.size <= (5 * 1024 * 1024), true, `${relativePath}_exceeds_pwa_limit`);
    }
  }
});

test('PDF.js dan OCR Indonesia/Inggris bekerja pada packaged Electron sandbox tanpa jaringan', {
  timeout: 360_000,
}, async () => {
  const releaseLock = await acquireElectronTestLock();
  let rootPath;
  let child = null;
  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-b1-ocr-'));
    const paths = {
      root: rootPath,
      appData: path.join(rootPath, 'environment', 'appdata'),
      localAppData: path.join(rootPath, 'environment', 'localappdata'),
      temp: path.join(rootPath, 'environment', 'temp'),
      home: path.join(rootPath, 'environment', 'home'),
      profile: path.join(rootPath, 'profile'),
      electronCache: path.join(rootPath, 'cache', 'electron'),
      builderCache: path.join(rootPath, 'cache', 'electron-builder'),
      staging: path.join(rootPath, 'staging'),
      buildOutput: path.join(rootPath, 'build-output'),
      result: path.join(rootPath, 'results', 'poc.json'),
    };
    for (const value of Object.values(paths)) assertContainedPath(rootPath, value);
    await Promise.all(Object.values(paths)
      .filter(value => value !== paths.result)
      .map(directory => fs.mkdir(directory, { recursive: true })));
    await createStagingApp(paths);
    const environment = createIsolatedEnvironment(paths);
    const builder = await runChild({
      executable: process.execPath,
      argumentsList: [electronBuilderCli, '--dir', '--win', '--x64', '--publish', 'never'],
      cwd: paths.staging,
      environment,
      timeoutMs: 120_000,
    });
    const builderDiagnostic = sanitizeDiagnostic(
      `${builder.stdout}\n${builder.stderr}`,
      [rootPath, repositoryRoot],
    );
    assert.equal(builder.timedOut, false, `electron_builder_timeout_${builderDiagnostic}`);
    assert.equal(
      builder.exitCode,
      0,
      `electron_builder_exit_${builder.exitCode}_signal_${builder.exitSignal ?? 'none'}_${builderDiagnostic}`,
    );

    const executable = path.join(paths.buildOutput, 'win-unpacked', 'UniMate Offline Scanner PoC.exe');
    const asarPath = path.join(paths.buildOutput, 'win-unpacked', 'resources', 'app.asar');
    await fs.access(executable);
    await fs.access(asarPath);
    const archiveEntries = new Set(asar.listPackage(asarPath).map(normalizeArchiveEntry));
    const sourceAssetFiles = await listRelativeFiles(assetRoot);
    const packagedAssets = [
      'dist/offline-document-engine.mjs',
      'dist/offline-scanner-poc.html',
      'dist/offline-scanner-poc-bootstrap.mjs',
      'dist/offline-scanner-poc-renderer.mjs',
      ...sourceAssetFiles.map(value => `dist/offline-scanner/${value}`),
    ];
    for (const entry of packagedAssets) assert.equal(archiveEntries.has(entry), true, `${entry}_missing`);
    for (const relativePath of sourceAssetFiles) {
      const source = await fs.readFile(path.join(assetRoot, relativePath));
      const packaged = asar.extractFile(
        asarPath,
        createArchiveExtractionPath(`dist/offline-scanner/${relativePath}`),
      );
      assert.equal(
        createHash('sha256').update(packaged).digest('hex'),
        createHash('sha256').update(source).digest('hex'),
        `${relativePath}_hash_mismatch`,
      );
    }

    child = spawn(executable, [
      `--user-data-dir=${paths.profile}`,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${paths.result}`,
    ], {
      cwd: path.dirname(executable),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
    }, 180_000);
    const processResult = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
    });
    clearTimeout(timeout);
    const runtimeDiagnostic = sanitizeDiagnostic(`${stdout}\n${stderr}`, [rootPath, repositoryRoot]);
    let serializedResult = null;
    try {
      serializedResult = await fs.readFile(paths.result, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const result = serializedResult === null ? null : JSON.parse(serializedResult);
    const safeStage = typeof result?.stage === 'string' && /^[a-z0-9_]+$/u.test(result.stage)
      ? result.stage
      : 'result_unavailable';
    const safeCode = typeof result?.code === 'string' && /^[a-z0-9_]+$/u.test(result.code)
      ? result.code
      : 'code_unavailable';
    const rendererState = result?.rendererDiagnostic ?? {};
    const rendererStage = typeof rendererState.stage === 'string' && /^[a-z0-9_]+$/u.test(rendererState.stage)
      ? rendererState.stage
      : 'renderer_stage_unavailable';
    const ocrStage = typeof rendererState.ocrStage === 'string' && /^[a-z0-9_]+$/u.test(rendererState.ocrStage)
      ? rendererState.ocrStage
      : 'ocr_stage_unavailable';
    const diagnosticSuffix = [
      `stage_${safeStage}`,
      `code_${safeCode}`,
      `renderer_${rendererStage}`,
      `pdfstage_${typeof rendererState.pdfStage === 'string' && /^[a-z0-9_]+$/u.test(rendererState.pdfStage) ? rendererState.pdfStage : 'unavailable'}`,
      `ocrstage_${ocrStage}`,
      `ocrprogress_${Number.isSafeInteger(rendererState.ocrProgressBucket) ? rendererState.ocrProgressBucket : 'unavailable'}`,
      `report_${serializedResult === null ? 'missing' : 'written'}`,
      `pdf_${rendererState.pdfWorkerLoaded === true}`,
      `worker_${rendererState.tesseractWorkerLoaded === true}`,
      `wasm_${rendererState.tesseractWasmLoaded === true}`,
      `eng_${rendererState.englishModelLoaded === true}`,
      `ind_${rendererState.indonesianModelLoaded === true}`,
      `workerblob_${rendererState.workerBlobURL === false ? 'false' : 'true'}`,
    ].join('_');
    assert.equal(timedOut, false, `packaged_runtime_timeout_${diagnosticSuffix}_${runtimeDiagnostic}`);
    assert.equal(
      processResult.exitCode,
      0,
      `packaged_runtime_exit_${processResult.exitCode}_signal_${processResult.exitSignal ?? 'none'}_${diagnosticSuffix}_${runtimeDiagnostic}`,
    );
    assert.notEqual(result, null);
    assert.equal(result.ok, true, `poc_stage_${result.stage ?? 'none'}_code_${result.code ?? 'none'}`);
    assert.equal(result.sandboxed, true);
    assert.equal(result.contextIsolated, true);
    assert.equal(result.nodeIntegrationDisabled, true);
    assert.equal(result.networkAttemptCount, 0);
    assert.equal(result.proof.pdf.extracted, true);
    assert.equal(result.proof.pdf.rendered, true);
    assert.equal(result.proof.pdf.pageCount, 1);
    assert.equal(result.proof.english.matched, true);
    assert.equal(result.proof.indonesian.matched, true);
    assert.equal(result.proof.mixed.matched, true);
    assert.equal(result.proof.english.progressReported, true);
    assert.equal(result.proof.indonesian.progressReported, true);
    assert.equal(result.proof.mixed.progressReported, true);
    assert.equal(result.proof.workerBlobURL, false);
    assert.equal(result.proof.cancellation.cancelled, true);
    assert.equal(result.proof.cancellation.disposed, true);
    assert.equal(Number.isSafeInteger(result.proof.durationMs), true);
    assert.equal(Number.isSafeInteger(result.workingSetDeltaKb), true);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await terminateProcessTree(child);
    if (process.platform === 'win32') await new Promise(resolve => setTimeout(resolve, 5_000));
    if (rootPath) await removeTestDirectory(rootPath);
    await releaseLock();
  }
  await assert.rejects(fs.access(rootPath), error => error.code === 'ENOENT');
});
