const { createCredentialService } = require('./credentialService.cjs');
const { createEncryptedCredentialFileStore } = require('./encryptedFileStore.cjs');
const { resolveCredentialPaths } = require('./credentialPaths.cjs');
const { createSafeStorageAdapter } = require('./safeStorageAdapter.cjs');

function createElectronCredentialRuntime(options = {}) {
  const {
    app,
    safeStorage,
    userDataPath,
    now,
  } = options;

  if (
    app === null
    || typeof app !== 'object'
    || typeof app.isReady !== 'function'
    || typeof app.getPath !== 'function'
  ) {
    throw new TypeError('Runtime Electron credential tidak valid');
  }
  if (app.isReady() !== true) throw new TypeError('Runtime credential hanya tersedia setelah Electron siap');

  const paths = resolveCredentialPaths({
    userDataPath: userDataPath ?? app.getPath('userData'),
  });
  const encryptionAdapter = createSafeStorageAdapter({
    safeStorage,
    isAppReady: () => app.isReady(),
  });
  const fileStore = createEncryptedCredentialFileStore({ filePath: paths.filePath });
  const service = createCredentialService({ fileStore, encryptionAdapter, now });

  return Object.freeze({ service });
}

module.exports = {
  createElectronCredentialRuntime,
};
