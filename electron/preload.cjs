const { contextBridge, ipcRenderer } = require('electron');
const { createCredentialPreloadBridge } = require('./ipc/credentialPreloadBridge.cjs');
const { createAIBudgetPreloadBridge } = require('./ipc/budgetPreloadBridge.cjs');
const { createAIPreferencePreloadBridge } = require('./ipc/preferencePreloadBridge.cjs');

const credentialBridge = createCredentialPreloadBridge({
  ipcRenderer,
  mutationsEnabled: true,
});
const budgetBridge = createAIBudgetPreloadBridge({
  ipcRenderer,
  mutationsEnabled: false,
});
const preferenceBridge = createAIPreferencePreloadBridge({ ipcRenderer });

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isMax) => callback(isMax);
    ipcRenderer.on('window-maximized-change', listener);
    return () => ipcRenderer.removeListener('window-maximized-change', listener);
  },
  setWidgetMode: (isWidget) => ipcRenderer.send('set-widget-mode', isWidget),
  ...credentialBridge,
  ...budgetBridge,
  ...preferenceBridge,
  getAIRuntimeStatus: () => ipcRenderer.invoke('unimate:ai:status', {
    schemaVersion: 2,
    operation: 'status',
  }),
  requestAI: (request) => ipcRenderer.invoke('unimate:ai:request', request),
  cancelAI: (requestId) => ipcRenderer.invoke('unimate:ai:cancel', {
    schemaVersion: 2,
    requestId,
  }),
});
