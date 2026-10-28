import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import viteConfig, {
  WEB_DEVELOPMENT_CSP,
  WEB_PRODUCTION_CSP,
  createWebCspPlugin,
} from '../vite.config.js';

test('CSP development mempertahankan Vite hanya pada loopback', () => {
  assert.equal(viteConfig.server.host, '127.0.0.1');
  assert.equal(viteConfig.server.port, 3000);
  assert.equal(viteConfig.server.strictPort, true);
  assert.equal(viteConfig.server.headers['Content-Security-Policy'], WEB_DEVELOPMENT_CSP);
  assert.match(WEB_DEVELOPMENT_CSP, /connect-src[^;]*http:\/\/localhost:3000/u);
  assert.match(WEB_DEVELOPMENT_CSP, /connect-src[^;]*ws:\/\/localhost:3000/u);
  assert.equal(WEB_DEVELOPMENT_CSP.includes('0.0.0.0'), false);
});

test('CSP production disisipkan tanpa unsafe script dan tidak diterapkan ke HTML dev', () => {
  const plugin = createWebCspPlugin();
  const source = '<head><meta charset="UTF-8" /></head>';
  const production = plugin.transformIndexHtml.handler(source, {});
  const development = plugin.transformIndexHtml.handler(source, { server: {} });
  assert.match(production, /http-equiv="Content-Security-Policy"/u);
  assert.equal(production.includes(WEB_PRODUCTION_CSP), true);
  assert.equal(WEB_PRODUCTION_CSP.match(/script-src[^;]*/u)?.[0].includes("'unsafe-inline'"), false);
  assert.equal(WEB_PRODUCTION_CSP.match(/script-src[^;]*/u)?.[0].includes("'unsafe-eval'"), false);
  assert.equal(development, source);
});

test('manifest PWA hanya memakai ikon lokal 512x512', async () => {
  const pwaPlugin = viteConfig.plugins.flat(Infinity).find(plugin => plugin?.name === 'vite-plugin-pwa');
  assert.ok(pwaPlugin);
  const source = await fs.readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(source, /src:\s*'icon\.png'/u);
  assert.match(source, /sizes:\s*'512x512'/u);
  assert.equal(source.includes('cdn-icons-png.flaticon.com'), false);
  const icon = await fs.readFile(new URL('../public/icon.png', import.meta.url));
  assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
});

test('SDK Gemini renderer yang tidak digunakan dihapus dari manifest dan lockfile', async () => {
  const [packageSource, lockSource] = await Promise.all([
    fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
    fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  ]);
  const packageValue = JSON.parse(packageSource);
  const lockValue = JSON.parse(lockSource);
  assert.equal(Object.hasOwn(packageValue.dependencies, '@google/generative-ai'), false);
  assert.equal(Object.hasOwn(lockValue.packages[''].dependencies, '@google/generative-ai'), false);
  assert.equal(Object.hasOwn(lockValue.packages, 'node_modules/@google/generative-ai'), false);
  assert.equal(lockSource.includes('@google/generative-ai'), false);
});
