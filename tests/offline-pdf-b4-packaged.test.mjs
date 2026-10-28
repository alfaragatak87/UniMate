/**
 * tests/offline-pdf-b4-packaged.test.mjs
 *
 * Test integrasi Electron packaged untuk Tahap B4:
 * Membuktikan bahwa processPdfDocumentOffline() (B4) membaca PDF hasil scan
 * (raster image embedded) dan PDF hybrid (campuran teks asli + scan) secara offline
 * dalam Electron packaged dengan sandbox dan contextIsolation aktif,
 * tanpa request jaringan, dan mengenali teks Indonesia serta Inggris.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
const electronTestLockPath = path.join(repositoryRoot, 'node_modules', '.unimate-electron-b4-test.lock');
const assetRoot = path.join(repositoryRoot, 'public', 'offline-scanner');

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
  // Salin fixtures B4
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfScanOcrHarness.cjs'),
    path.join(paths.staging, 'electron', 'pdfScanOcrHarness.cjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfScanOcr.html'),
    path.join(paths.staging, 'dist', 'pdf-scan-ocr.html'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfScanOcrBootstrap.mjs'),
    path.join(paths.staging, 'dist', 'pdf-scan-ocr-bootstrap.mjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfScanOcrRenderer.mjs'),
    path.join(paths.staging, 'dist', 'pdfScanOcrRenderer.mjs'),
  );
  // Engine offlineDocumentEngine
  await copyFile(
    path.join(repositoryRoot, 'src', 'services', 'offlineDocumentEngine.js'),
    path.join(paths.staging, 'dist', 'offline-document-engine.mjs'),
  );
  // Aset Tesseract dan PDF.js
  await copyDirectory(assetRoot, path.join(paths.staging, 'dist', 'offline-scanner'));

  const stagingPackage = {
    name: 'unimate-pdf-scan-b4',
    productName: 'UniMate PDF Scan OCR B4',
    version: '1.0.0',
    private: true,
    main: 'electron/pdfScanOcrHarness.cjs',
    build: {
      appId: 'com.unimate.pdf-scan-b4',
      productName: 'UniMate PDF Scan OCR B4',
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

test('B4: processPdfDocumentOffline() membaca PDF scan raster dan PDF hybrid dalam Electron packaged tanpa jaringan', {
  timeout: 360_000,
}, async () => {
  const releaseLock = await acquireElectronTestLock();
  let rootPath;
  let child = null;
  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-b4-pdf-'));
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
      result: path.join(rootPath, 'results', 'b4.json'),
    };
    for (const value of Object.values(paths)) assertContainedPath(rootPath, value);
    await Promise.all(
      Object.values(paths)
        .filter(value => value !== paths.result)
        .map(directory => fs.mkdir(directory, { recursive: true })),
    );
    await createStagingApp(paths);
    const environment = createIsolatedEnvironment(paths);

    // Build staging app via electron-builder
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

    const executable = path.join(paths.buildOutput, 'win-unpacked', 'UniMate PDF Scan OCR B4.exe');
    const asarPath = path.join(paths.buildOutput, 'win-unpacked', 'resources', 'app.asar');
    await fs.access(executable);
    await fs.access(asarPath);

    // Verifikasi aset dalam ASAR
    const archiveEntries = new Set(asar.listPackage(asarPath).map(normalizeArchiveEntry));
    const sourceAssetFiles = await listRelativeFiles(assetRoot);
    const requiredEntries = [
      'dist/offline-document-engine.mjs',
      'dist/pdf-scan-ocr.html',
      'dist/pdf-scan-ocr-bootstrap.mjs',
      'dist/pdfScanOcrRenderer.mjs',
      ...sourceAssetFiles.map(value => `dist/offline-scanner/${value}`),
    ];
    for (const entry of requiredEntries) {
      assert.equal(archiveEntries.has(entry), true, `${entry}_missing_from_asar`);
    }

    // Jalankan executable
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
      : 'stage_unavailable';
    const safeCode = typeof result?.code === 'string' && /^[a-z0-9_]+$/u.test(result.code)
      ? result.code
      : 'code_unavailable';
    const diagnosticSuffix = [
      `stage_${safeStage}`,
      `code_${safeCode}`,
      `report_${serializedResult === null ? 'missing' : 'written'}`,
    ].join('_');

    assert.equal(timedOut, false, `packaged_runtime_timeout_${diagnosticSuffix}_${runtimeDiagnostic}`);
    assert.equal(
      processResult.exitCode,
      0,
      `packaged_runtime_exit_${processResult.exitCode}_signal_${processResult.exitSignal ?? 'none'}_${diagnosticSuffix}_${runtimeDiagnostic}`,
    );
    assert.notEqual(result, null, 'result_file_not_written');
    assert.equal(result.ok, true, `b4_poc_failed_stage_${result?.stage ?? 'none'}_code_${result?.code ?? 'none'}`);

    // Verifikasi keamanan Electron
    assert.equal(result.sandboxed, true, 'sandbox_not_enabled');
    assert.equal(result.contextIsolated, true, 'context_isolation_not_enabled');
    assert.equal(result.nodeIntegrationDisabled, true, 'node_integration_enabled');

    // Verifikasi zero network
    assert.equal(result.networkAttemptCount, 0, `network_request_made_count_${result.networkAttemptCount}`);

    // Verifikasi hasil OCR PDF scan & hybrid
    const proof = result.proof;
    assert.notEqual(proof, null, 'proof_missing');

    // 1. PDF Scan Bahasa Indonesia (raster image murni)
    assert.equal(proof.indonesian.pageCount, 1, 'indonesian_pageCount_wrong');
    assert.equal(proof.indonesian.ocrPageCount, 1, 'indonesian_ocrPageCount_wrong');
    assert.equal(proof.indonesian.isAllScanned, true, 'indonesian_isAllScanned_false');
    assert.equal(proof.indonesian.hasText, true, 'indonesian_hasText_false');
    assert.equal(proof.indonesian.confidenceAvailable, true, 'indonesian_confidence_missing');
    assert.equal(proof.indonesian.matched, true, `indonesian_ocr_not_matched: ${proof.indonesian.text}`);

    // 2. PDF Scan Bahasa Inggris (raster image murni)
    assert.equal(proof.english.pageCount, 1, 'english_pageCount_wrong');
    assert.equal(proof.english.ocrPageCount, 1, 'english_ocrPageCount_wrong');
    assert.equal(proof.english.isAllScanned, true, 'english_isAllScanned_false');
    assert.equal(proof.english.matched, true, `english_ocr_not_matched: ${proof.english.text}`);

    // 3. PDF Hybrid (Halaman 1 teks asli, Halaman 2 scan raster)
    assert.equal(proof.hybrid.pageCount, 2, 'hybrid_pageCount_wrong');
    assert.equal(proof.hybrid.textPageCount, 1, 'hybrid_textPageCount_wrong');
    assert.equal(proof.hybrid.ocrPageCount, 1, 'hybrid_ocrPageCount_wrong');
    assert.equal(proof.hybrid.isHybrid, true, 'hybrid_isHybrid_false');
    assert.equal(proof.hybrid.page1Source, 'text', 'hybrid_page1_should_be_text');
    assert.equal(proof.hybrid.page2Source, 'ocr', 'hybrid_page2_should_be_ocr');
    assert.equal(proof.hybrid.page1Matched, true, 'hybrid_page1_text_not_matched');
    assert.equal(proof.hybrid.page2Matched, true, 'hybrid_page2_ocr_not_matched');

    // 4. PDF Teks Asli Murni
    assert.equal(proof.nativeOnly.pageCount, 2, 'nativeOnly_pageCount_wrong');
    assert.equal(proof.nativeOnly.textPageCount, 2, 'nativeOnly_textPageCount_wrong');
    assert.equal(proof.nativeOnly.ocrPageCount, 0, 'nativeOnly_ocrPageCount_should_be_zero');
    assert.equal(proof.nativeOnly.isTextOnly, true, 'nativeOnly_isTextOnly_false');

    // 5. Pembatalan (Cancellation)
    assert.equal(proof.cancellation.cancelled, true, 'cancellation_failed');
    assert.equal(proof.cancellation.code, 'request_cancelled', `cancellation_wrong_code_${proof.cancellation.code}`);

    assert.equal(Number.isSafeInteger(result.workingSetDeltaKb), true, 'working_set_not_reported');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await terminateProcessTree(child);
    if (process.platform === 'win32') await new Promise(resolve => setTimeout(resolve, 5_000));
    if (rootPath) await removeTestDirectory(rootPath);
    await releaseLock();
  }
  await assert.rejects(fs.access(rootPath), error => error.code === 'ENOENT');
});
