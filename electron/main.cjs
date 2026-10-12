const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;

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
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: iconPath
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for custom titlebar and widget mode
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-toggle-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('set-widget-mode', (event, isWidget) => {
  if (mainWindow) {
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
  }
});
