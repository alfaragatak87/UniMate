import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const AI_RENDERER_FILES = [
  '../src/components/AIChatWidget.jsx',
  '../src/pages/DataAnalytics.jsx',
  '../src/pages/AIScanner.jsx',
];

async function read(relativePath) {
  return fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('seluruh fitur AI renderer memakai adapter tanpa SDK atau endpoint provider', async () => {
  const sources = await Promise.all(AI_RENDERER_FILES.map(read));
  const combined = sources.join('\n');

  assert.equal(combined.includes('@google/generative-ai'), false);
  assert.equal(combined.includes('GoogleGenerativeAI'), false);
  assert.equal(combined.includes('generativelanguage.googleapis.com'), false);
  assert.equal(combined.includes('generateContent('), false);
  assert.equal(combined.includes('apiKey'), false);
  assert.equal(combined.includes('console.error'), false);
  assert.match(sources[0], /frontendAIClient\.chat\(/u);
  assert.match(sources[1], /frontendAIClient\.analyze\(/u);
  assert.match(sources[2], /frontendAIClient\.startDocumentScan\(/u);
  assert.match(sources[2], /frontendAIClient\.cancel\(requestId\)/u);
});

test('legacy Gemini key tidak lagi dibaca context, Settings, atau Device Sync', async () => {
  const sources = await Promise.all([
    read('../src/context/AppContext.jsx'),
    read('../src/pages/Settings.jsx'),
    read('../src/pages/DeviceSync.jsx'),
    read('../src/services/credentialClient.js'),
  ]);
  const combined = sources.join('\n');

  assert.equal(combined.includes('gemini_api_key'), false);
  assert.equal(combined.includes('setApiKey'), false);
  assert.equal(combined.includes('apiInputValue'), false);
  assert.match(sources[1], /CredentialSettingsSection/u);
  assert.match(sources[3], /getCredentialStatus/u);
  assert.equal(sources[1].includes('localStorage'), false);
});

test('Scanner meminta consent Free Tier, memvalidasi MIME, dan selalu membuka review', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  assert.match(source, /AIModelSelector/u);
  assert.match(source, /requireConsent/u);
  assert.match(source, /AI_DOCUMENT_MIME_TYPES\.includes/u);
  assert.match(source, /selection,/u);
  assert.equal(source.includes('allowGeminiFallback'), false);
  assert.match(source, /setAiSuggestion\(review\.suggestion\)/u);
  assert.match(source, /setShowModal\(true\)/u);
  assert.match(source, /Data belum disimpan/u);
});

test('preload production membuka mutasi backend tanpa mengekspos material gateway', async () => {
  const source = await read('../electron/preload.cjs');
  const bridgeSource = await read('../electron/ipc/credentialPreloadBridge.cjs');
  assert.match(source, /createCredentialPreloadBridge/u);
  assert.match(source, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.match(source, /requestAI/u);
  assert.match(bridgeSource, /getCredentialStatus/u);
  assert.match(bridgeSource, /credentialMutationsEnabled:\s*mutationsEnabled/u);
  assert.equal(source.includes('credentials:mutate'), false);
  for (const forbidden of ['csrfToken', 'sessionCookie', 'gatewayToken', 'ciphertext']) {
    assert.equal(`${source}\n${bridgeSource}`.includes(forbidden), false);
  }
});
