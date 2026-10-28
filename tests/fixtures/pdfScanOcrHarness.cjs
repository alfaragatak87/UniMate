const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

let stage = 'bootstrap';
let resultWritten = false;
let activeWindow = null;
let rendererDiagnostic = null;

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContained(parentPath, childPath) {
  const parent = normalized(parentPath);
  const child = normalized(childPath);
  if (child !== parent && !child.startsWith(`${parent}${path.sep}`)) throw new Error('path_outside_isolation');
}

function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/^[a-z0-9_]+$/u.test(code)) return code;
  const message = typeof error?.message === 'string' ? error.message : '';
  return /^[a-z0-9_]+$/u.test(message) ? message : 'pdf_scan_ocr_poc_failed';
}

function aggregateWorkingSet() {
  return app.getAppMetrics().reduce((total, metric) => (
    total + (Number.isFinite(metric?.memory?.workingSetSize) ? metric.memory.workingSetSize : 0)
  ), 0);
}

async function writeResult(resultPath, result) {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  fsSync.writeFileSync(resultPath, JSON.stringify(result), 'utf8');
  resultWritten = true;
}

async function waitForRendererApi(window, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await window.webContents.executeJavaScript(`({
      ready: typeof globalThis.runPdfScanOcrProof === 'function',
      diagnostic: globalThis.getPdfScanOcrDiagnostic?.() ?? null,
    })`, true);
    if (state.ready || typeof state.diagnostic?.code === 'string') return state;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return state;
}

function startDiagnosticMonitor(window, resultPath) {
  let stopped = false;
  let lastSerialized = '';
  let pending = Promise.resolve();
  const poll = () => {
    pending = pending.then(async () => {
      if (stopped || window.isDestroyed()) return;
      const current = await window.webContents
        .executeJavaScript('globalThis.getPdfScanOcrDiagnostic?.() ?? null', true)
        .catch(() => null);
      const serialized = JSON.stringify(current);
      if (!current || serialized === lastSerialized) return;
      lastSerialized = serialized;
      rendererDiagnostic = current;
      await writeResult(resultPath, {
        ok: false,
        stage: 'run_proof',
        code: 'proof_in_progress',
        rendererDiagnostic: current,
      });
    }).catch(() => {});
  };
  const timer = setInterval(poll, 250);
  poll();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}

process.once('exit', exitCode => {
  if (resultWritten) return;
  const isolationRoot = readArgument('isolation-root');
  const resultPath = readArgument('result');
  if (!isolationRoot || !resultPath) return;
  try {
    assertContained(isolationRoot, resultPath);
    fsSync.mkdirSync(path.dirname(resultPath), { recursive: true });
    fsSync.writeFileSync(resultPath, JSON.stringify({
      ok: false,
      stage,
      code: exitCode === 0 ? 'premature_process_exit' : 'unreported_process_failure',
      rendererDiagnostic,
    }), 'utf8');
  } catch {}
});

async function main() {
  stage = 'validate_arguments';
  const isolationRoot = readArgument('isolation-root');
  const profilePath = readArgument('profile');
  const resultPath = readArgument('result');
  if (
    !isolationRoot
    || !profilePath
    || !resultPath
    || !path.isAbsolute(isolationRoot)
    || !path.isAbsolute(profilePath)
    || !path.isAbsolute(resultPath)
  ) throw new Error('invalid_arguments');
  assertContained(isolationRoot, profilePath);
  assertContained(isolationRoot, resultPath);

  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-default-apps');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('no-first-run');
  app.disableHardwareAcceleration();
  app.setPath('userData', profilePath);

  stage = 'electron_ready';
  await app.whenReady();
  assertContained(isolationRoot, app.getPath('userData'));
  const networkAttempts = [];
  const session = require('electron').session.defaultSession;
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    networkAttempts.push(details.resourceType);
    callback({ cancel: true });
  });

  stage = 'create_window';
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  activeWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());

  const pagePath = path.join(__dirname, '../dist/pdf-scan-ocr.html');
  stage = 'load_page';
  await window.loadFile(pagePath);
  const beforeWorkingSetKb = aggregateWorkingSet();

  stage = 'validate_renderer_api';
  const rendererState = await waitForRendererApi(window);
  if (!rendererState?.ready) {
    rendererDiagnostic = rendererState?.diagnostic ?? null;
    const failure = new Error(
      typeof rendererDiagnostic?.code === 'string'
        ? rendererDiagnostic.code
        : 'renderer_api_unavailable',
    );
    failure.code = failure.message;
    throw failure;
  }

  stage = 'run_proof';
  const stopDiagnosticMonitor = startDiagnosticMonitor(window, resultPath);
  let proof;
  try {
    proof = await window.webContents.executeJavaScript('globalThis.runPdfScanOcrProof()', true);
  } catch (error) {
    rendererDiagnostic = await window.webContents
      .executeJavaScript('globalThis.getPdfScanOcrDiagnostic?.() ?? null', true)
      .catch(() => null);
    const failure = new Error(
      typeof rendererDiagnostic?.code === 'string' ? rendererDiagnostic.code : safeCode(error),
    );
    failure.code = failure.message;
    throw failure;
  } finally {
    await stopDiagnosticMonitor();
  }
  const afterWorkingSetKb = aggregateWorkingSet();

  stage = 'write_result';
  await writeResult(resultPath, {
    ok: true,
    sandboxed: window.webContents.getLastWebPreferences().sandbox === true,
    contextIsolated: window.webContents.getLastWebPreferences().contextIsolation === true,
    nodeIntegrationDisabled: window.webContents.getLastWebPreferences().nodeIntegration === false,
    networkAttemptCount: networkAttempts.length,
    workingSetDeltaKb: afterWorkingSetKb - beforeWorkingSetKb,
    proof,
  });
  stage = 'close_window';
  window.destroy();
  activeWindow = null;
  stage = 'completed';
}

main()
  .then(() => app.exit(0))
  .catch(async error => {
    const isolationRoot = readArgument('isolation-root');
    const resultPath = readArgument('result');
    if (isolationRoot && resultPath) {
      try {
        assertContained(isolationRoot, resultPath);
        await writeResult(resultPath, {
          ok: false,
          stage,
          code: safeCode(error),
          rendererDiagnostic,
        });
      } catch {}
    }
    if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy();
    app.exit(1);
  });
