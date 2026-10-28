const path = require('node:path');
const { fileURLToPath } = require('node:url');

class IpcSenderPolicyError extends Error {
  constructor() {
    super('Pengirim IPC tidak diizinkan.');
    this.name = 'IpcSenderPolicyError';
    this.code = 'ipc_sender_rejected';
  }
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isAllowedDevelopmentUrl(value, developmentOrigin) {
  try {
    const parsed = new URL(value);
    return parsed.origin === developmentOrigin
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function isAllowedPackagedUrl(value, packagedEntryPath) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'file:'
      && parsed.search === ''
      && parsed.username === ''
      && parsed.password === ''
      && normalizePath(fileURLToPath(parsed)) === normalizePath(packagedEntryPath);
  } catch {
    return false;
  }
}

function createIpcSenderPolicy(options = {}) {
  const {
    getTrustedWebContents,
    isPackaged,
    developmentOrigin = 'http://localhost:3000',
    packagedEntryPath,
  } = options;
  if (typeof getTrustedWebContents !== 'function') throw new TypeError('Resolver WebContents IPC tidak valid');
  if (typeof isPackaged !== 'function') throw new TypeError('Resolver mode Electron tidak valid');
  const parsedDevelopmentOrigin = new URL(developmentOrigin);
  if (parsedDevelopmentOrigin.origin !== developmentOrigin || parsedDevelopmentOrigin.protocol !== 'http:') {
    throw new TypeError('Origin development IPC tidak valid');
  }
  if (typeof packagedEntryPath !== 'string' || !path.isAbsolute(packagedEntryPath)) {
    throw new TypeError('Entry packaged IPC harus berupa path absolut');
  }

  return Object.freeze({
    assertTrusted(event) {
      try {
        const trustedWebContents = getTrustedWebContents();
        const sender = event?.sender;
        const senderFrame = event?.senderFrame;
        if (
          trustedWebContents === null
          || typeof trustedWebContents !== 'object'
          || sender !== trustedWebContents
          || senderFrame === null
          || typeof senderFrame !== 'object'
          || senderFrame !== sender.mainFrame
          || senderFrame.parent !== null
          || typeof senderFrame.url !== 'string'
          || senderFrame.url.length > 4096
          || sender.isDestroyed?.() === true
        ) {
          throw new IpcSenderPolicyError();
        }
        const allowed = isPackaged()
          ? isAllowedPackagedUrl(senderFrame.url, packagedEntryPath)
          : isAllowedDevelopmentUrl(senderFrame.url, developmentOrigin);
        if (!allowed) throw new IpcSenderPolicyError();
        return true;
      } catch (error) {
        if (error instanceof IpcSenderPolicyError) throw error;
        throw new IpcSenderPolicyError();
      }
    },
  });
}

module.exports = {
  IpcSenderPolicyError,
  createIpcSenderPolicy,
};
