import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import viteConfig from '../vite.config.js';
import { parseSafeMarkdown } from '../src/utils/safeMarkdown.js';

test('parser markdown mempertahankan HTML berbahaya sebagai teks biasa', () => {
  const payload = '<img src=x onerror="globalThis.compromised=true">\n- **Aman** <script>globalThis.compromised=true</script> [tautan](javascript:globalThis.compromised=true)';
  const blocks = parseSafeMarkdown(payload);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].segments[0].type, 'text');
  assert.equal(blocks[0].segments[0].text, '<img src=x onerror="globalThis.compromised=true">');
  assert.equal(blocks[1].type, 'bullet');
  assert.deepEqual(blocks[1].segments.map(segment => segment.type), ['strong', 'text']);
  assert.equal(blocks.some(block => Object.hasOwn(block, 'html')), false);
  const rendered = renderToStaticMarkup(React.createElement(
    'div',
    null,
    blocks.flatMap(block => block.segments.map(segment => segment.text)),
  ));
  assert.equal(rendered.includes('<img'), false);
  assert.equal(rendered.includes('<script'), false);
  assert.equal(rendered.includes('onerror='), true);
  assert.equal(rendered.includes('javascript:'), true);
  assert.equal(globalThis.compromised, undefined);
});

test('Data Analytics tidak memakai API penyisipan HTML mentah', async () => {
  const source = await fs.readFile(new URL('../src/pages/DataAnalytics.jsx', import.meta.url), 'utf8');
  for (const forbidden of ['dangerouslySetInnerHTML', 'innerHTML =', 'insertAdjacentHTML', 'document.write']) {
    assert.equal(source.includes(forbidden), false, `forbidden_${forbidden}`);
  }
  assert.match(source, /const renderMarkdown = \(text\) =>[\s\S]*parseSafeMarkdown\(text\)/u);
  assert.match(source, /\{renderMarkdown\(aiInsight\)\}/u);
  assert.match(source, /\{segment\.text\}/u);
});

test('konfigurasi dan script Vite hanya mengikat IPv4 loopback port 3000', async () => {
  const packageValue = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(viteConfig.server.host, '127.0.0.1');
  assert.equal(viteConfig.server.port, 3000);
  assert.equal(viteConfig.server.strictPort, true);
  assert.match(viteConfig.server.headers['Content-Security-Policy'], /default-src 'self'/u);
  assert.match(packageValue.scripts.dev, /vite --host 127\.0\.0\.1 --port 3000 --strictPort/u);
  assert.equal(packageValue.scripts.dev.includes('vite --host --port'), false);
  assert.equal(packageValue.scripts.dev.includes('wait-on http://localhost:3000'), true);
});
