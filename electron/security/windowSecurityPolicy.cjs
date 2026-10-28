const path = require('node:path');
const { fileURLToPath } = require('node:url');

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' http://localhost:3000 ws://localhost:3000 https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PACKAGED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isProtectedDocumentUrl(value, isPackaged, developmentOrigin, packagedEntryPath) {
  try {
    const parsed = new URL(value);
    if (!isPackaged) {
      return parsed.origin === developmentOrigin
        && parsed.pathname === '/'
        && parsed.search === ''
        && parsed.username === ''
        && parsed.password === '';
    }
    return parsed.protocol === 'file:'
      && parsed.search === ''
      && parsed.username === ''
      && parsed.password === ''
      && normalizePath(fileURLToPath(parsed)) === normalizePath(packagedEntryPath);
  } catch {
    return false;
  }
}

function withContentSecurityPolicy(responseHeaders, policy) {
  const headers = {};
  for (const [name, value] of Object.entries(responseHeaders ?? {})) {
    if (name.toLowerCase() !== 'content-security-policy') headers[name] = value;
  }
  headers['Content-Security-Policy'] = [policy];
  return headers;
}

const sessionManagers = new WeakMap();

function getOrCreateSessionState(session, filter) {
  let state = sessionManagers.get(session);
  if (!state) {
    state = {
      registrations: new Set(),
      filter,
      handler: null,
    };
    sessionManagers.set(session, state);
  }
  return state;
}

function installWindowSecurityPolicy(options = {}) {
  const {
    webContents,
    isPackaged,
    developmentOrigin = 'http://localhost:3000',
    packagedEntryPath,
  } = options;
  if (
    typeof webContents?.setWindowOpenHandler !== 'function'
    || typeof webContents?.on !== 'function'
    || typeof webContents?.removeListener !== 'function'
    || typeof webContents?.session?.webRequest?.onHeadersReceived !== 'function'
    || typeof isPackaged !== 'boolean'
  ) {
    throw new TypeError('WebContents kebijakan keamanan tidak valid');
  }
  const parsedOrigin = new URL(developmentOrigin);
  if (parsedOrigin.origin !== developmentOrigin || parsedOrigin.protocol !== 'http:') {
    throw new TypeError('Origin development kebijakan keamanan tidak valid');
  }
  if (typeof packagedEntryPath !== 'string' || !path.isAbsolute(packagedEntryPath)) {
    throw new TypeError('Entry packaged kebijakan keamanan tidak valid');
  }

  const session = webContents.session;

  const policy = isPackaged ? PACKAGED_CSP : DEVELOPMENT_CSP;
  const filter = Object.freeze({
    urls: Object.freeze([isPackaged ? 'file://*/*' : `${developmentOrigin}/*`]),
  });
  const preventNavigation = (event) => event.preventDefault();

  const registrationEntry = Object.freeze({
    isPackaged,
    developmentOrigin,
    packagedEntryPath,
    policy,
  });

  const sessionState = getOrCreateSessionState(session, filter);
  sessionState.registrations.add(registrationEntry);

  if (!sessionState.handler) {
    sessionState.handler = (details, callback) => {
      let matchedPolicy = null;
      for (const reg of sessionState.registrations) {
        if (isProtectedDocumentUrl(details?.url, reg.isPackaged, reg.developmentOrigin, reg.packagedEntryPath)) {
          matchedPolicy = reg.policy;
          break;
        }
      }
      if (!matchedPolicy) {
        callback({ responseHeaders: details?.responseHeaders ?? {} });
        return;
      }
      callback({ responseHeaders: withContentSecurityPolicy(details.responseHeaders, matchedPolicy) });
    };
    session.webRequest.onHeadersReceived(sessionState.filter, sessionState.handler);
  }

  webContents.setWindowOpenHandler(() => Object.freeze({ action: 'deny' }));
  webContents.on('will-navigate', preventNavigation);
  webContents.on('will-redirect', preventNavigation);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;

    const isWebContentsAlive = typeof webContents.isDestroyed === 'function'
      ? !webContents.isDestroyed()
      : true;

    if (isWebContentsAlive) {
      webContents.removeListener('will-navigate', preventNavigation);
      webContents.removeListener('will-redirect', preventNavigation);
      if (typeof webContents.removeListener === 'function') {
        webContents.removeListener('destroyed', dispose);
      }
    }

    sessionState.registrations.delete(registrationEntry);

    if (sessionState.registrations.size === 0) {
      sessionState.handler = null;
      if (typeof session?.webRequest?.onHeadersReceived === 'function') {
        session.webRequest.onHeadersReceived(sessionState.filter, null);
      }
    }
  };

  if (typeof webContents.once === 'function') {
    webContents.once('destroyed', dispose);
  }

  return Object.freeze({
    dispose,
  });
}

module.exports = {
  DEVELOPMENT_CSP,
  PACKAGED_CSP,
  installWindowSecurityPolicy,
};
