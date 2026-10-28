import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import securityModule from '../electron/security/windowSecurityPolicy.cjs';

const {
  DEVELOPMENT_CSP,
  PACKAGED_CSP,
  installWindowSecurityPolicy,
} = securityModule;

function createWebContentsMock() {
  const listeners = new Map();
  const webRequest = {
    filter: null,
    listener: null,
    onHeadersReceived(filter, listener) {
      this.filter = filter;
      this.listener = listener;
    },
  };
  return {
    listeners,
    windowOpenHandler: null,
    session: { webRequest },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event);
    },
  };
}

function applyHeaders(webContents, details) {
  let result;
  webContents.session.webRequest.listener(details, value => { result = value; });
  return result;
}

test('kebijakan window menolak navigasi dan window baru', () => {
  const webContents = createWebContentsMock();
  const registration = installWindowSecurityPolicy({
    webContents,
    isPackaged: false,
    packagedEntryPath: path.resolve('dist/index.html'),
  });
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };

  assert.deepEqual(webContents.windowOpenHandler(), { action: 'deny' });
  webContents.listeners.get('will-navigate')(event);
  webContents.listeners.get('will-redirect')(event);
  assert.equal(prevented, 2);

  registration.dispose();
  registration.dispose();
  assert.equal(webContents.listeners.size, 0);
  assert.equal(webContents.session.webRequest.listener, null);
});

test('CSP development melindungi dokumen utama tanpa membuka script inline', () => {
  const webContents = createWebContentsMock();
  installWindowSecurityPolicy({
    webContents,
    isPackaged: false,
    packagedEntryPath: path.resolve('dist/index.html'),
  });
  const result = applyHeaders(webContents, {
    url: 'http://localhost:3000/',
    responseHeaders: {
      Server: ['synthetic'],
      'content-security-policy': ["default-src *"],
    },
  });
  const scriptDirective = DEVELOPMENT_CSP.split('; ').find(value => value.startsWith('script-src'));

  assert.deepEqual(webContents.session.webRequest.filter, { urls: ['http://localhost:3000/*'] });
  assert.deepEqual(result.responseHeaders.Server, ['synthetic']);
  assert.deepEqual(result.responseHeaders['Content-Security-Policy'], [DEVELOPMENT_CSP]);
  assert.equal(Object.hasOwn(result.responseHeaders, 'content-security-policy'), false);
  assert.equal(scriptDirective.includes("'unsafe-inline'"), false);
  for (const directive of ["object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'"]) {
    assert.equal(DEVELOPMENT_CSP.includes(directive), true);
  }
});

test('CSP packaged hanya diterapkan pada entry file yang tepat', () => {
  const webContents = createWebContentsMock();
  const entryPath = path.resolve('dist/index.html');
  installWindowSecurityPolicy({ webContents, isPackaged: true, packagedEntryPath: entryPath });
  const protectedResult = applyHeaders(webContents, {
    url: pathToFileURL(entryPath).href,
    responseHeaders: {},
  });
  const unrelatedResult = applyHeaders(webContents, {
    url: pathToFileURL(path.resolve('dist/other.html')).href,
    responseHeaders: { Existing: ['value'] },
  });

  assert.deepEqual(protectedResult.responseHeaders['Content-Security-Policy'], [PACKAGED_CSP]);
  assert.deepEqual(unrelatedResult.responseHeaders, { Existing: ['value'] });
  assert.equal(PACKAGED_CSP.includes("script-src 'self'"), true);
  assert.equal(PACKAGED_CSP.includes('unsafe-eval'), false);
});

test('cleanup aman saat webContents sudah destroyed tanpa mengakses getter session yang hancur', () => {
  const listeners = new Map();
  const webRequest = {
    filter: null,
    listener: null,
    onHeadersReceived(filter, listener) {
      this.filter = filter;
      this.listener = listener;
    },
  };
  const sessionObj = { webRequest };

  let isDestroyed = false;
  const webContents = {
    listeners,
    windowOpenHandler: null,
    get session() {
      if (isDestroyed) {
        throw new TypeError('Object has been destroyed');
      }
      return sessionObj;
    },
    isDestroyed() {
      return isDestroyed;
    },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    once(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      if (isDestroyed) {
        throw new TypeError('Object has been destroyed');
      }
      if (listeners.get(event) === handler) listeners.delete(event);
    },
  };

  const registration = installWindowSecurityPolicy({
    webContents,
    isPackaged: true,
    packagedEntryPath: path.resolve('dist/index.html'),
  });

  assert.notEqual(sessionObj.webRequest.listener, null);

  // Simulasikan penghancuran webContents oleh Electron
  isDestroyed = true;

  // dispose() dipanggil saat before-quit atau setelah jendela hancur
  // Wajib tidak melempar TypeError: Object has been destroyed
  assert.doesNotThrow(() => {
    registration.dispose();
  });

  // Pemanggilan berulang kali harus idempoten
  assert.doesNotThrow(() => {
    registration.dispose();
  });

  assert.equal(sessionObj.webRequest.listener, null);
});

test('webContents memicu event destroyed melakukan cleanup otomatis dan idempoten', () => {
  const listeners = new Map();
  const webRequest = {
    filter: null,
    listener: null,
    onHeadersReceived(filter, listener) {
      this.filter = filter;
      this.listener = listener;
    },
  };
  let isDestroyed = false;
  const webContents = {
    listeners,
    windowOpenHandler: null,
    session: { webRequest },
    isDestroyed() {
      return isDestroyed;
    },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    once(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      if (isDestroyed) throw new TypeError('Object has been destroyed');
      if (listeners.get(event) === handler) listeners.delete(event);
    },
  };

  const registration = installWindowSecurityPolicy({
    webContents,
    isPackaged: false,
    packagedEntryPath: path.resolve('dist/index.html'),
  });

  assert.notEqual(webContents.session.webRequest.listener, null);
  assert.equal(typeof listeners.get('destroyed'), 'function');

  // Trigger event destroyed
  isDestroyed = true;
  listeners.get('destroyed')();

  // Listener session otomatis dibersihkan
  assert.equal(webContents.session.webRequest.listener, null);

  // Pemanggilan dispose setelah destroyed tetap aman
  assert.doesNotThrow(() => {
    registration.dispose();
  });
});

test('multi-window berbagi session mempertahankan proteksi CSP sampai seluruh window ditutup', () => {
  const sharedWebRequest = {
    filter: null,
    listener: null,
    onHeadersReceived(filter, listener) {
      this.filter = filter;
      this.listener = listener;
    },
  };
  const sharedSession = { webRequest: sharedWebRequest };

  function createSubWebContents() {
    const listeners = new Map();
    let destroyed = false;
    return {
      listeners,
      windowOpenHandler: null,
      session: sharedSession,
      isDestroyed: () => destroyed,
      destroy: () => { destroyed = true; },
      setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
      on(event, handler) { listeners.set(event, handler); },
      once(event, handler) { listeners.set(event, handler); },
      removeListener(event, handler) {
        if (destroyed) throw new TypeError('Object has been destroyed');
        if (listeners.get(event) === handler) listeners.delete(event);
      },
    };
  }

  const wc1 = createSubWebContents();
  const wc2 = createSubWebContents();
  const entryPath = path.resolve('dist/index.html');

  const reg1 = installWindowSecurityPolicy({ webContents: wc1, isPackaged: true, packagedEntryPath: entryPath });
  const reg2 = installWindowSecurityPolicy({ webContents: wc2, isPackaged: true, packagedEntryPath: entryPath });

  assert.notEqual(sharedSession.webRequest.listener, null);

  // Tutup jendela 1
  wc1.destroy();
  reg1.dispose();

  // Proteksi CSP TIDAK boleh hilang karena jendela 2 masih aktif!
  assert.notEqual(sharedSession.webRequest.listener, null);
  const testDetails = { url: pathToFileURL(entryPath).href, responseHeaders: {} };
  let appliedHeaders;
  sharedSession.webRequest.listener(testDetails, value => { appliedHeaders = value; });
  assert.deepEqual(appliedHeaders.responseHeaders['Content-Security-Policy'], [PACKAGED_CSP]);

  // Tutup jendela 2
  wc2.destroy();
  reg2.dispose();

  // Sekarang seluruh jendela ditutup, listener session dibersihkan
  assert.equal(sharedSession.webRequest.listener, null);
});

test('jendela dibuat kembali menggunakan session yang sama setelah jendela lama ditutup', () => {
  const sharedWebRequest = {
    filter: null,
    listener: null,
    onHeadersReceived(filter, listener) {
      this.filter = filter;
      this.listener = listener;
    },
  };
  const sharedSession = { webRequest: sharedWebRequest };

  function createSubWebContents() {
    const listeners = new Map();
    return {
      listeners,
      windowOpenHandler: null,
      session: sharedSession,
      setWindowOpenHandler(h) { this.windowOpenHandler = h; },
      on(e, h) { listeners.set(e, h); },
      once(e, h) { listeners.set(e, h); },
      removeListener(e, h) { if (listeners.get(e) === h) listeners.delete(e); },
    };
  }

  const entryPath = path.resolve('dist/index.html');

  // Siklus 1: Window 1 buka dan tutup
  const wc1 = createSubWebContents();
  const reg1 = installWindowSecurityPolicy({ webContents: wc1, isPackaged: true, packagedEntryPath: entryPath });
  assert.notEqual(sharedSession.webRequest.listener, null);
  reg1.dispose();
  assert.equal(sharedSession.webRequest.listener, null);

  // Siklus 2: Window 2 dibuat kembali pada session yang sama
  const wc2 = createSubWebContents();
  const reg2 = installWindowSecurityPolicy({ webContents: wc2, isPackaged: true, packagedEntryPath: entryPath });
  assert.notEqual(sharedSession.webRequest.listener, null);

  let appliedHeaders;
  sharedSession.webRequest.listener({ url: pathToFileURL(entryPath).href, responseHeaders: {} }, val => {
    appliedHeaders = val;
  });
  assert.deepEqual(appliedHeaders.responseHeaders['Content-Security-Policy'], [PACKAGED_CSP]);

  reg2.dispose();
  assert.equal(sharedSession.webRequest.listener, null);
});

test('validasi IPC sender policy menolak secara aman saat mainWindow atau webContents dihancurkan', async () => {
  const { createIpcSenderPolicy } = await import('../electron/security/ipcSenderPolicy.cjs');

  let windowDestroyed = false;
  let webContentsDestroyed = false;

  const mockWebContents = {
    isDestroyed: () => webContentsDestroyed,
    mainFrame: null,
  };
  const mockMainWindow = {
    isDestroyed: () => windowDestroyed,
    get webContents() {
      if (windowDestroyed) throw new TypeError('Object has been destroyed');
      return mockWebContents;
    },
  };

  const senderPolicy = createIpcSenderPolicy({
    getTrustedWebContents: () => {
      if (!mockMainWindow || mockMainWindow.isDestroyed()) return null;
      const wc = mockMainWindow.webContents;
      return (wc && !wc.isDestroyed()) ? wc : null;
    },
    isPackaged: () => true,
    developmentOrigin: 'http://localhost:3000',
    packagedEntryPath: path.resolve('dist/index.html'),
  });

  const validFrame = {
    parent: null,
    url: pathToFileURL(path.resolve('dist/index.html')).href,
  };
  mockWebContents.mainFrame = validFrame;

  // Saat masih aktif: valid
  assert.equal(senderPolicy.assertTrusted({ sender: mockWebContents, senderFrame: validFrame }), true);

  // Saat webContents dihancurkan: ditolak tanpa throw Object has been destroyed
  webContentsDestroyed = true;
  assert.throws(
    () => senderPolicy.assertTrusted({ sender: mockWebContents, senderFrame: validFrame }),
    error => error.code === 'ipc_sender_rejected',
  );

  // Saat window dihancurkan: getTrustedWebContents mengembalikan null tanpa error getter
  windowDestroyed = true;
  assert.throws(
    () => senderPolicy.assertTrusted({ sender: mockWebContents, senderFrame: validFrame }),
    error => error.code === 'ipc_sender_rejected',
  );
});

