const CREDENTIAL_IPC_CHANNELS = Object.freeze({
  STATUS: 'unimate:credentials:status',
  MUTATE: 'unimate:credentials:mutate',
});

function createCredentialPreloadBridge(options = {}) {
  const {
    ipcRenderer,
    mutationsEnabled = false,
  } = options;
  if (typeof ipcRenderer?.invoke !== 'function' || typeof mutationsEnabled !== 'boolean') {
    throw new TypeError('Bridge preload credential tidak valid');
  }

  const bridge = {
    credentialMutationsEnabled: mutationsEnabled,
    getCredentialStatus: () => ipcRenderer.invoke(CREDENTIAL_IPC_CHANNELS.STATUS, {
      schemaVersion: 1,
      operation: 'status',
    }),
  };
  if (mutationsEnabled) {
    bridge.mutateCredential = request => ipcRenderer.invoke(CREDENTIAL_IPC_CHANNELS.MUTATE, request);
  }
  return Object.freeze(bridge);
}

module.exports = {
  CREDENTIAL_IPC_CHANNELS,
  createCredentialPreloadBridge,
};
