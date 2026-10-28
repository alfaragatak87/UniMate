const AI_BUDGET_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:ai-budget:status',
  CONFIGURE: 'unimate:ai-budget:configure',
});

function createAIBudgetPreloadBridge(options = {}) {
  const { ipcRenderer, mutationsEnabled = false } = options;
  if (typeof ipcRenderer?.invoke !== 'function' || typeof mutationsEnabled !== 'boolean') {
    throw new TypeError('Bridge preload budget AI tidak valid');
  }
  const bridge = {
    aiBudgetMutationsEnabled: mutationsEnabled,
    getAIBudgetStatus: () => ipcRenderer.invoke(AI_BUDGET_IPC_CHANNELS.STATUS, {
      schemaVersion: 1,
      operation: 'status',
    }),
  };
  if (mutationsEnabled) {
    bridge.configureAIBudget = request => ipcRenderer.invoke(AI_BUDGET_IPC_CHANNELS.CONFIGURE, request);
  }
  return Object.freeze(bridge);
}

module.exports = {
  AI_BUDGET_IPC_CHANNELS,
  createAIBudgetPreloadBridge,
};
