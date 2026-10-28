const AI_PREFERENCE_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:ai-preference:status',
  UPDATE: 'unimate:ai-preference:update',
});

function createAIPreferencePreloadBridge(options = {}) {
  const { ipcRenderer } = options;
  if (typeof ipcRenderer?.invoke !== 'function') throw new TypeError('Bridge preload preferensi AI tidak valid');
  return Object.freeze({
    getAIPreferenceStatus: () => ipcRenderer.invoke(AI_PREFERENCE_IPC_CHANNELS.STATUS, {
      schemaVersion: 1,
      operation: 'status',
    }),
    updateAIPreferences: request => ipcRenderer.invoke(AI_PREFERENCE_IPC_CHANNELS.UPDATE, request),
  });
}

module.exports = { AI_PREFERENCE_IPC_CHANNELS, createAIPreferencePreloadBridge };
