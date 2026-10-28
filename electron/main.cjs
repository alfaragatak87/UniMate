const { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } = require('electron');
const path = require('path');
const { createCredentialStartup } = require('./credentials/credentialStartup.cjs');
const { createCredentialController } = require('./credentials/credentialController.cjs');
const { createAIBudgetStartup } = require('./ai/budgetStartup.cjs');
const { createAIBudgetController } = require('./ai/budgetController.cjs');
const { createAIGatewayStartup } = require('./ai/gatewayStartup.cjs');
const { createAIQuotaStartup } = require('./ai/quotaStartup.cjs');
const { createAIPreferenceStartup } = require('./ai/preferenceStartup.cjs');
const { registerAIHandlers } = require('./ipc/aiHandlers.cjs');
const { registerAIBudgetHandlers } = require('./ipc/budgetHandlers.cjs');
const { registerCredentialHandlers } = require('./ipc/credentialHandlers.cjs');
const { registerAIPreferenceHandlers } = require('./ipc/preferenceHandlers.cjs');
const { createIpcSenderPolicy } = require('./security/ipcSenderPolicy.cjs');
const { installWindowSecurityPolicy } = require('./security/windowSecurityPolicy.cjs');

let mainWindow;
let windowSecurityRegistration = null;
let secureIpcInitialized = false;
const secureIpcRegistrations = [];
const credentialStartup = createCredentialStartup({ app, safeStorage });
const aiBudgetStartup = createAIBudgetStartup({ app });
const aiQuotaStartup = createAIQuotaStartup({ app });
const aiPreferenceStartup = createAIPreferenceStartup({
  app,
  getQuotaRuntime: () => aiQuotaStartup.getRuntimeForMainProcess(),
});
const aiGatewayStartup = createAIGatewayStartup({
  enabled: true,
  enabledCapabilities: ['chat', 'document_scan'],
  getCredentialRuntime: () => credentialStartup.getRuntimeForMainProcess(),
  getBudgetRuntime: () => aiBudgetStartup.getRuntimeForMainProcess(),
  getQuotaRuntime: () => aiQuotaStartup.getRuntimeForMainProcess(),
});

const CONFIRMATION_COPY = Object.freeze({
  configure: Object.freeze({ title: 'Konfigurasi Credential', action: 'Simpan credential' }),
  replace: Object.freeze({ title: 'Ganti Credential', action: 'Ganti credential' }),
  remove: Object.freeze({ title: 'Hapus Credential', action: 'Hapus credential' }),
});

async function confirmCredentialMutation({ action, provider }) {
  const copy = CONFIRMATION_COPY[action];
  if (!copy || !['openai', 'gemini'].includes(provider) || !mainWindow || mainWindow.isDestroyed()) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: copy.title,
    message: `${copy.action} ${provider === 'openai' ? 'OpenAI' : 'Gemini'}?`,
    detail: 'Credential hanya disimpan oleh backend Electron dan tidak dapat dibaca kembali dari aplikasi.',
    buttons: ['Batal', copy.action],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  });
  return result.response === 1;
}

async function confirmAIBudgetMutation({ action, dailyLimitMicrousd, monthlyLimitMicrousd }) {
  if (!['configure', 'replace'].includes(action) || !mainWindow || mainWindow.isDestroyed()) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: action === 'configure' ? 'Konfigurasi Batas Biaya AI' : 'Ganti Batas Biaya AI',
    message: 'Setujui batas estimasi biaya AI?',
    detail: `Harian: ${dailyLimitMicrousd} microUSD. Bulanan: ${monthlyLimitMicrousd} microUSD. Nilai ini adalah estimasi konservatif, bukan tagihan provider.`,
    buttons: ['Batal', 'Setujui'],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  });
  return result.response === 1;
}

function registerWindowHandlers(senderPolicy) {
  const handlers = [
    ['window-minimize', (event) => {
      senderPolicy.assertTrusted(event);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    }],
    ['window-toggle-maximize', (event) => {
      senderPolicy.assertTrusted(event);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }],
    ['window-close', (event) => {
      senderPolicy.assertTrusted(event);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }],
    ['set-widget-mode', (event, isWidget) => {
      senderPolicy.assertTrusted(event);
      if (typeof isWidget !== 'boolean' || !mainWindow || mainWindow.isDestroyed()) return;
      if (isWidget) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width } = primaryDisplay.workAreaSize;
        mainWindow.setSize(350, 200, true);
        mainWindow.setPosition(width - 370, 40, true);
        mainWindow.setAlwaysOnTop(true, 'floating');
        mainWindow.setSkipTaskbar(true);
      } else {
        mainWindow.setSize(1200, 800, true);
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setSkipTaskbar(false);
        mainWindow.center();
      }
    }],
  ];

  for (const [channel, handler] of handlers) {
    const guardedHandler = (event, ...args) => {
      try {
        handler(event, ...args);
      } catch {}
    };
    ipcMain.on(channel, guardedHandler);
    secureIpcRegistrations.push(Object.freeze({
      dispose: () => ipcMain.removeListener(channel, guardedHandler),
    }));
  }

  const isMaximizedHandler = (event) => {
    senderPolicy.assertTrusted(event);
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
  };
  ipcMain.handle('window-is-maximized', isMaximizedHandler);
  secureIpcRegistrations.push(Object.freeze({
    dispose: () => ipcMain.removeHandler('window-is-maximized'),
  }));
}

function initializeSecureIpc() {
  if (secureIpcInitialized) return;
  secureIpcInitialized = true;
  const senderPolicy = createIpcSenderPolicy({
    getTrustedWebContents: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const wc = mainWindow.webContents;
      return (wc && !wc.isDestroyed()) ? wc : null;
    },
    isPackaged: () => app.isPackaged,
    developmentOrigin: 'http://localhost:3000',
    packagedEntryPath: path.join(__dirname, '../dist/index.html'),
  });
  registerWindowHandlers(senderPolicy);

  const credentialRuntime = credentialStartup.getRuntimeForMainProcess();
  if (credentialRuntime?.service) {
    const credentialController = createCredentialController({
      credentialService: credentialRuntime.service,
      confirmMutation: confirmCredentialMutation,
    });
    secureIpcRegistrations.push(registerCredentialHandlers({
      ipcMain,
      senderPolicy,
      credentialController,
      mutationsEnabled: true,
      allowedMutationProviders: ['gemini'],
    }));
  }
  const budgetRuntime = aiBudgetStartup.getRuntimeForMainProcess();
  if (budgetRuntime?.guard) {
    const budgetController = createAIBudgetController({
      budgetGuard: budgetRuntime.guard,
      confirmMutation: confirmAIBudgetMutation,
    });
    secureIpcRegistrations.push(registerAIBudgetHandlers({
      ipcMain,
      senderPolicy,
      budgetController,
      mutationsEnabled: false,
    }));
  }
  const preferenceRuntime = aiPreferenceStartup.getRuntimeForMainProcess();
  if (preferenceRuntime?.controller) {
    secureIpcRegistrations.push(registerAIPreferenceHandlers({
      ipcMain,
      senderPolicy,
      preferenceController: preferenceRuntime.controller,
    }));
  }
  secureIpcRegistrations.push(registerAIHandlers({
    ipcMain,
    senderPolicy,
    gatewayRuntime: aiGatewayStartup,
  }));
}

function disposeSecureIpc() {
  while (secureIpcRegistrations.length > 0) secureIpcRegistrations.pop().dispose();
  windowSecurityRegistration?.dispose();
  windowSecurityRegistration = null;
  secureIpcInitialized = false;
}

function createWindow() {
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  const iconPath = isDev 
    ? path.join(__dirname, '../public/icon.ico') 
    : path.join(__dirname, '../dist/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 350,
    minHeight: 400,
    frame: false, // Frameless window
    transparent: true, // Transparent background
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '../dist/electron-preload.cjs'),
    },
    icon: iconPath
  });

  windowSecurityRegistration = installWindowSecurityPolicy({
    webContents: mainWindow.webContents,
    isPackaged: app.isPackaged,
    developmentOrigin: 'http://localhost:3000',
    packagedEntryPath: path.join(__dirname, '../dist/index.html'),
  });

  mainWindow.on('closed', () => {
    windowSecurityRegistration?.dispose();
    windowSecurityRegistration = null;
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-change', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-change', false);
    }
  });

  initializeSecureIpc();

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await credentialStartup.initialize();
  await aiBudgetStartup.initialize();
  await aiQuotaStartup.initialize();
  await aiPreferenceStartup.initialize();
  await aiGatewayStartup.initialize();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.once('before-quit', () => {
  disposeSecureIpc();
  void aiGatewayStartup.stop();
});
