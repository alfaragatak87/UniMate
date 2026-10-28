/**
 * tests/offline-pdf-b2-extraction.test.mjs
 *
 * Test integrasi Electron packaged untuk Tahap B2.
 *
 * Test ini membuktikan bahwa extractPdfTextOnly() (B2) bekerja pada Electron
 * packaged dengan sandbox dan contextIsolation, tanpa koneksi jaringan,
 * dan menghasilkan teks yang benar dari PDF sintetis nyata.
 *
 * Menggunakan infrastruktur yang sama dengan B1 (offline-pdf-ocr-poc.test.mjs)
 * tetapi berfokus pada ekstraksi teks multi-halaman, bukan OCR.
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
const electronTestLockPath = path.join(repositoryRoot, 'node_modules', '.unimate-electron-b2-test.lock');
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
  // Salin fixture B2
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfTextExtractionHarness.cjs'),
    path.join(paths.staging, 'electron', 'pdfTextExtractionHarness.cjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfTextExtraction.html'),
    path.join(paths.staging, 'dist', 'pdf-text-extraction.html'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfTextExtractionBootstrap.mjs'),
    path.join(paths.staging, 'dist', 'pdf-text-extraction-bootstrap.mjs'),
  );
  await copyFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'pdfTextExtractionRenderer.mjs'),
    path.join(paths.staging, 'dist', 'pdfTextExtractionRenderer.mjs'),
  );
  // Engine B2 yang baru
  await copyFile(
    path.join(repositoryRoot, 'src', 'services', 'offlineDocumentEngine.js'),
    path.join(paths.staging, 'dist', 'offline-document-engine.mjs'),
  );
  // Aset PDF.js dan Tesseract (sama dengan B1)
  await copyDirectory(assetRoot, path.join(paths.staging, 'dist', 'offline-scanner'));
  const stagingPackage = {
    name: 'unimate-pdf-text-b2',
    productName: 'UniMate PDF Text Extraction B2',
    version: '1.0.0',
    private: true,
    main: 'electron/pdfTextExtractionHarness.cjs',
    build: {
      appId: 'com.unimate.pdf-text-b2',
      productName: 'UniMate PDF Text Extraction B2',
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

test('B2: extractPdfTextOnly() mengekstrak teks dari PDF sintetis dalam Electron packaged tanpa jaringan', {
  timeout: 360_000,
}, async () => {
  const releaseLock = await acquireElectronTestLock();
  let rootPath;
  let child = null;
  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-b2-pdf-'));
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
      result: path.join(rootPath, 'results', 'b2.json'),
    };
    for (const value of Object.values(paths)) assertContainedPath(rootPath, value);
    await Promise.all(
      Object.values(paths)
        .filter(value => value !== paths.result)
        .map(directory => fs.mkdir(directory, { recursive: true })),
    );
    await createStagingApp(paths);
    const environment = createIsolatedEnvironment(paths);

    // Build staging app
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

    const executable = path.join(paths.buildOutput, 'win-unpacked', 'UniMate PDF Text Extraction B2.exe');
    const asarPath = path.join(paths.buildOutput, 'win-unpacked', 'resources', 'app.asar');
    await fs.access(executable);
    await fs.access(asarPath);

    // Verifikasi aset dalam ASAR
    const archiveEntries = new Set(asar.listPackage(asarPath).map(normalizeArchiveEntry));
    const sourceAssetFiles = await listRelativeFiles(assetRoot);
    const requiredEntries = [
      'dist/offline-document-engine.mjs',
      'dist/pdf-text-extraction.html',
      'dist/pdf-text-extraction-bootstrap.mjs',
      'dist/pdfTextExtractionRenderer.mjs',
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
    assert.equal(result.ok, true, `b2_poc_failed_stage_${result?.stage ?? 'none'}_code_${result?.code ?? 'none'}`);

    // Verifikasi keamanan Electron
    assert.equal(result.sandboxed, true, 'sandbox_not_enabled');
    assert.equal(result.contextIsolated, true, 'context_isolation_not_enabled');
    assert.equal(result.nodeIntegrationDisabled, true, 'node_integration_enabled');

    // Verifikasi tidak ada request jaringan
    assert.equal(result.networkAttemptCount, 0, `network_request_made_count_${result.networkAttemptCount}`);

    // Verifikasi hasil ekstraksi teks PDF nyata
    const proof = result.proof;
    assert.notEqual(proof, null, 'proof_missing');

    // PDF satu halaman: worker dimuat, teks ditemukan, progress dilaporkan
    assert.equal(proof.workerLoaded, true, 'pdf_worker_not_loaded');
    assert.equal(proof.singlePage.pageCount, 1, 'single_page_count_wrong');
    assert.equal(proof.singlePage.extractedPageCount, 1, 'single_extracted_count_wrong');
    assert.equal(proof.singlePage.textFound, true, 'single_page_text_not_found');
    assert.equal(proof.singlePage.progressReported, true, 'single_page_progress_not_reported');

    // PDF multi-halaman: kedua halaman terbaca
    assert.equal(proof.multiPage.pageCount, 2, 'multi_page_count_wrong');
    assert.equal(proof.multiPage.extractedPageCount, 2, 'multi_extracted_count_wrong');
    assert.equal(proof.multiPage.page1TextFound, true, 'multi_page1_text_not_found');
    assert.equal(proof.multiPage.page2TextFound, true, 'multi_page2_text_not_found');
    assert.equal(proof.multiPage.hasPageLabels, true, 'multi_page_labels_missing');

    // PDF tanpa teks (scan murni): 0 halaman terekstrak, terdeteksi isAllScanned
    assert.equal(proof.allScanned.pageCount, 1, 'all_scanned_page_count_wrong');
    assert.equal(proof.allScanned.extractedPageCount, 0, 'all_scanned_extracted_count_wrong');
    assert.equal(proof.allScanned.scannedPageCount, 1, 'all_scanned_scanned_count_wrong');
    assert.equal(proof.allScanned.isAllScanned, true, 'all_scanned_flag_wrong');
    assert.equal(proof.allScanned.isPartial, false, 'all_scanned_partial_flag_wrong');

    // PDF campuran: 1 halaman teks, 1 halaman scan, terdeteksi isPartial
    assert.equal(proof.mixed.pageCount, 2, 'mixed_page_count_wrong');
    assert.equal(proof.mixed.extractedPageCount, 1, 'mixed_extracted_count_wrong');
    assert.equal(proof.mixed.scannedPageCount, 1, 'mixed_scanned_count_wrong');
    assert.equal(proof.mixed.isPartial, true, 'mixed_partial_flag_wrong');
    assert.equal(proof.mixed.isAllScanned, false, 'mixed_all_scanned_flag_wrong');
    assert.equal(proof.mixed.page1HasText, true, 'mixed_page1_text_flag_wrong');
    assert.equal(proof.mixed.page2HasText, false, 'mixed_page2_text_flag_wrong');

    // Cancellation berhasil
    assert.equal(proof.cancellation.cancelled, true, 'cancellation_did_not_work');
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
