const { createHash, timingSafeEqual } = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');

const applicationRoot = path.basename(__dirname) === 'fixtures'
  ? path.resolve(__dirname, '../..')
  : path.resolve(__dirname, '..');
const { createElectronCredentialRuntime } = require(
  path.join(applicationRoot, 'electron', 'credentials', 'credentialRuntime.cjs'),
);
const { createCredentialController } = require(
  path.join(applicationRoot, 'electron', 'credentials', 'credentialController.cjs'),
);
const { createAIGatewayStartup } = require(
  path.join(applicationRoot, 'electron', 'ai', 'gatewayStartup.cjs'),
);
const { registerAIHandlers } = require(
  path.join(applicationRoot, 'electron', 'ipc', 'aiHandlers.cjs'),
);
const { registerCredentialHandlers } = require(
  path.join(applicationRoot, 'electron', 'ipc', 'credentialHandlers.cjs'),
);
const { createIpcSenderPolicy } = require(
  path.join(applicationRoot, 'electron', 'security', 'ipcSenderPolicy.cjs'),
);
let currentStage = 'bootstrap';
let resultWritten = false;
let activeAuditWindow = null;

function readArgument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContainedPath(parentPath, childPath) {
  const parent = normalizedPath(parentPath);
  const child = normalizedPath(childPath);
  if (child !== parent && !child.startsWith(`${parent}${path.sep}`)) {
    throw new Error('path_outside_isolation');
  }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestsEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : error?.message;
  return typeof code === 'string' && /^[a-z0-9_]+$/u.test(code) ? code : 'harness_failed';
}

async function writeResult(resultPath, result) {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify(result), 'utf8');
  resultWritten = true;
}

process.once('exit', exitCode => {
  if (resultWritten) return;
  const isolationRoot = readArgument('isolation-root');
  const resultPath = readArgument('result');
  if (!isolationRoot || !resultPath) return;
  try {
    assertContainedPath(isolationRoot, resultPath);
    fsSync.mkdirSync(path.dirname(resultPath), { recursive: true });
    fsSync.writeFileSync(resultPath, JSON.stringify({
      ok: false,
      stage: currentStage,
      code: exitCode === 0 ? 'premature_process_exit' : 'unreported_process_failure',
    }), 'utf8');
  } catch {}
});

async function loadContractVersion() {
  const contractPath = path.join(applicationRoot, 'shared', 'credentials', 'contracts.mjs');
  const contracts = await import(pathToFileURL(contractPath).href);
  return contracts.CREDENTIAL_CONTRACT_VERSION;
}

async function verifyPackagedPreload(request, service) {
  if (!app.isPackaged) throw new Error('packaged_runtime_required');
  if (
    request.auditRequests === null
    || typeof request.auditRequests !== 'object'
    || Array.isArray(request.auditRequests)
  ) throw new Error('invalid_audit_requests');

  let externalRequests = 0;
  currentStage = 'preload_gateway_initialize';
  const gatewayStartup = createAIGatewayStartup({
    enabled: true,
    enabledCapabilities: ['chat', 'document_scan'],
    getCredentialRuntime: () => ({ service }),
    transport: Object.freeze({
      async send() {
        externalRequests += 1;
        throw new Error('network_disabled');
      },
    }),
  });
  const gatewayStatus = await gatewayStartup.initialize();
  if (gatewayStatus.state !== 'running' || gatewayStatus.available !== true) {
    throw new Error('gateway_not_running');
  }

  currentStage = 'preload_window_create';
  const htmlPath = path.join(__dirname, 'preloadHarness.html');
  const preloadPath = path.join(applicationRoot, 'dist', 'electron-preload.cjs');
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
  });
  activeAuditWindow = window;
  const senderPolicy = createIpcSenderPolicy({
    getTrustedWebContents: () => window.webContents,
    isPackaged: () => true,
    packagedEntryPath: htmlPath,
  });
  const registrations = [
    registerCredentialHandlers({
      ipcMain,
      senderPolicy,
      credentialController: createCredentialController({
        credentialService: service,
        confirmMutation: async () => false,
      }),
      mutationsEnabled: true,
      allowedMutationProviders: ['gemini'],
    }),
    registerAIHandlers({ ipcMain, senderPolicy, gatewayRuntime: gatewayStartup }),
  ];
  const safeStatusChannels = [
    ['unimate:ai-budget:status', Object.freeze({ operation: 'status', bridge: 'budget' })],
    ['unimate:ai-preference:status', Object.freeze({ operation: 'status', bridge: 'preference' })],
  ];
  for (const [channel, response] of safeStatusChannels) {
    ipcMain.handle(channel, event => {
      senderPolicy.assertTrusted(event);
      return Object.freeze({ ok: true, response });
    });
  }

  try {
    currentStage = 'preload_load_file';
    await window.loadFile(htmlPath);
    currentStage = 'preload_execute_audit';
    const serializedRequests = JSON.stringify(request.auditRequests);
    const audit = await window.webContents.executeJavaScript(`(async () => {
      const api = globalThis.window?.electronAPI;
      const requests = ${serializedRequests};
      return {
        bridgePresent: api !== null && typeof api === 'object',
        methodNames: api ? Object.keys(api).filter(name => typeof api[name] === 'function').sort() : [],
        credentialMutationsEnabled: api?.credentialMutationsEnabled,
        budgetMutationsEnabled: api?.aiBudgetMutationsEnabled,
        nodeGlobalsHidden: typeof globalThis.require === 'undefined' && typeof globalThis.process === 'undefined',
        aiStatus: await api?.getAIRuntimeStatus?.(),
        credentialStatus: await api?.getCredentialStatus?.(),
        budgetStatus: await api?.getAIBudgetStatus?.(),
        preferenceStatus: await api?.getAIPreferenceStatus?.(),
        analytics: await api?.requestAI?.(requests.analytics),
        scanner: await api?.requestAI?.(requests.scanner),
      };
    })()`, true);
    currentStage = 'preload_validate_audit';
    const requiredMethods = [
      'cancelAI', 'closeWindow', 'getAIBudgetStatus', 'getAIPreferenceStatus',
      'getAIRuntimeStatus', 'getCredentialStatus', 'minimizeWindow', 'mutateCredential',
      'requestAI', 'setWidgetMode', 'toggleMaximizeWindow', 'updateAIPreferences',
    ];
    if (!audit.bridgePresent || !requiredMethods.every(method => audit.methodNames.includes(method))) {
      throw new Error('preload_bridge_missing');
    }
    for (const forbidden of [
      'getCredential', 'readCredential', 'getPlaintextCredential', 'getGatewayToken',
      'getCsrfToken', 'getSessionCookie',
    ]) {
      if (audit.methodNames.includes(forbidden)) throw new Error('unsafe_preload_api');
    }
    if (
      audit.credentialMutationsEnabled !== true
      || audit.budgetMutationsEnabled !== false
      || audit.nodeGlobalsHidden !== true
      || audit.aiStatus?.ok !== true
      || audit.aiStatus.response?.productionEnabled !== true
      || audit.aiStatus.response?.gateway?.state !== 'running'
      || audit.aiStatus.response?.gateway?.available !== true
      || audit.aiStatus.response?.models?.openaiEnabled !== false
      || audit.credentialStatus?.ok !== true
      || audit.budgetStatus?.ok !== true
      || audit.preferenceStatus?.ok !== true
      || audit.analytics?.error?.code !== 'capability_disabled'
      || audit.scanner?.ok !== true
      || audit.scanner.response?.capability !== 'document_scan'
      || audit.scanner.response?.success !== false
      || audit.scanner.response?.error?.code !== 'quota_unavailable'
      || externalRequests !== 0
    ) {
      throw new Error('preload_audit_failed');
    }
    return {
      gateway: audit.aiStatus.response.gateway,
      productionEnabled: audit.aiStatus.response.productionEnabled,
      openaiEnabled: audit.aiStatus.response.models.openaiEnabled,
      credentialBridgeAvailable: audit.credentialStatus.ok,
      budgetBridgeAvailable: audit.budgetStatus.ok,
      preferenceBridgeAvailable: audit.preferenceStatus.ok,
      analyticsRejected: audit.analytics.error.code === 'capability_disabled',
      scannerCapabilityEnabled: audit.scanner.response.error.code === 'quota_unavailable',
      externalRequests,
    };
  } finally {
    currentStage = 'preload_dispose_ipc';
    for (const registration of registrations.reverse()) registration.dispose();
    for (const [channel] of safeStatusChannels) ipcMain.removeHandler(channel);
    currentStage = 'preload_stop_gateway';
    await gatewayStartup.stop();
  }
}

async function runOperation(request, service) {
  if (request.operation === 'verify-preload') return verifyPackagedPreload(request, service);
  if (request.operation === 'configure') {
    const schemaVersion = await loadContractVersion();
    const configured = await service.configure({
      schemaVersion,
      provider: request.provider,
      credential: request.credential,
    });
    return { configured: configured.configured, replaced: configured.replaced };
  }

  if (request.operation === 'verify') {
    const verified = await service.withCredential(request.provider, credential => ({
      matches: digestsEqual(digest(credential), request.expectedDigest),
    }));
    return { verified: verified.matches === true };
  }

  throw new Error('invalid_test_operation');
}

async function main() {
  currentStage = 'validate_arguments';
  const isolationRoot = readArgument('isolation-root');
  const requestPath = readArgument('request');
  const resultPath = readArgument('result');
  if (
    !isolationRoot
    || !requestPath
    || !resultPath
    || !path.isAbsolute(isolationRoot)
    || !path.isAbsolute(requestPath)
    || !path.isAbsolute(resultPath)
  ) {
    throw new Error('invalid_test_arguments');
  }

  currentStage = 'validate_environment';
  assertContainedPath(isolationRoot, requestPath);
  assertContainedPath(isolationRoot, resultPath);
  for (const name of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    const environmentPath = process.env[name];
    if (!environmentPath || !path.isAbsolute(environmentPath)) throw new Error('invalid_test_environment');
    assertContainedPath(isolationRoot, environmentPath);
  }

  currentStage = 'electron_ready';
  await app.whenReady();
  currentStage = 'validate_user_data';
  const userDataPath = app.getPath('userData');
  assertContainedPath(isolationRoot, userDataPath);
  assertContainedPath(process.env.APPDATA, userDataPath);

  currentStage = 'read_request';
  const serializedRequest = await fs.readFile(requestPath, 'utf8');
  currentStage = 'remove_request';
  await fs.rm(requestPath);
  currentStage = 'parse_request';
  const request = JSON.parse(serializedRequest);
  currentStage = 'validate_runtime_mode';
  const mode = app.isPackaged ? 'packaged' : 'development';
  if (request.expectedMode !== mode) throw new Error('unexpected_runtime_mode');

  currentStage = 'disable_network';
  globalThis.fetch = async () => {
    throw new Error('network_disabled');
  };

  currentStage = 'create_runtime';
  const runtime = createElectronCredentialRuntime({ app, safeStorage });
  currentStage = 'run_operation';
  const operation = await runOperation(request, runtime.service);
  currentStage = 'validate_result_location';
  const userDataRelative = path.relative(process.env.APPDATA, userDataPath);
  if (!userDataRelative || path.isAbsolute(userDataRelative) || userDataRelative.startsWith('..')) {
    throw new Error('invalid_user_data_location');
  }

  currentStage = 'write_result';
  await writeResult(resultPath, {
    ok: true,
    mode,
    userDataRelative: userDataRelative.split(path.sep).join('/'),
    operation,
  });
  currentStage = 'close_audit_window';
  if (activeAuditWindow && !activeAuditWindow.isDestroyed()) activeAuditWindow.destroy();
  activeAuditWindow = null;
  currentStage = 'completed';
}

main()
  .then(() => app.exit(0))
  .catch(async error => {
    const isolationRoot = readArgument('isolation-root');
    const resultPath = readArgument('result');
    if (isolationRoot && resultPath) {
      try {
        assertContainedPath(isolationRoot, resultPath);
        await writeResult(resultPath, {
          ok: false,
          stage: currentStage,
          code: safeErrorCode(error),
        });
      } catch {}
    }
    app.exit(1);
  });
