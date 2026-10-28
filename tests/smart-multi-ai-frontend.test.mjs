import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function read(relativePath) {
  return fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('selector reusable menyediakan Otomatis, Manual, kategori, alasan, kuota, dan consent', async () => {
  const [component, styles] = await Promise.all([
    read('../src/components/AIModelSelector.jsx'),
    read('../src/components/AIModelSelector.css'),
  ]);
  assert.match(component, /AI_SELECTION_MODES\.AUTOMATIC/u);
  assert.match(component, /AI_SELECTION_MODES\.MANUAL/u);
  for (const label of ['Ringan', 'Sedang', 'Berat', 'reason', 'quotaSummary', 'freeTierDataConsent']) {
    assert.equal(component.includes(label), true, label);
  }
  assert.match(component, /Bukan sisa kuota Google secara real-time/u);
  assert.match(component, /kebijakan penggunaan data Google/u);
  assert.equal(component.includes('dangerouslySetInnerHTML'), false);
  assert.match(styles, /@media \(max-width: 560px\)/u);
});

test('Chat dan Analytics memakai selection v2 tanpa endpoint atau SDK provider', async () => {
  const sources = await Promise.all([
    read('../src/components/AIChatWidget.jsx'),
    read('../src/pages/DataAnalytics.jsx'),
  ]);
  const combined = sources.join('\n');
  assert.equal((combined.match(/<AIModelSelector/gu) ?? []).length, 2);
  assert.equal((combined.match(/selection=\{selection\}/gu) ?? []).length >= 2, true);
  assert.match(sources[0], /frontendAIClient\.chat\(\{ message: userMessage, selection \}\)/u);
  assert.match(sources[1], /frontendAIClient\.analyze\(\{[\s\S]*?selection,/u);
  assert.match(sources[1], /Analisis offline — data tidak dikirim/u);
  for (const forbidden of ['api.openai.com', 'generativelanguage.googleapis.com', 'GoogleGenerativeAI', 'allowGemini']) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
});

test('Scanner membatasi input dan mempertahankan preview serta konfirmasi penyimpanan', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  assert.match(source, /accept=\{AI_DOCUMENT_MIME_TYPES\.join\(','\)\}/u);
  assert.match(source, /file\.size > AI_LIMITS\.DOCUMENT_BYTES/u);
  assert.match(source, /selection\.freeTierDataConsent/u);
  assert.match(source, /validateAIDocumentPayload/u);
  assert.match(source, /frontendAIClient\.startDocumentScan/u);
  assert.match(source, /frontendAIClient\.cancel/u);
  assert.match(source, /onClick=\{handleCancelScan\}/u);
  assert.match(source, /createAIScannerReview/u);
  assert.match(source, /onClick=\{saveManual\}/u);
  assert.match(source, /onClick=\{closeReview\}/u);
  assert.match(source, /onClick=\{confirmOverwrite\}/u);
  assert.match(source, /onClick=\{cancelOverwrite\}/u);
  assert.equal(source.includes('allowGeminiFallback'), false);
});

test('Settings menyimpan preferensi metadata dan backend tetap terbatas pada Chat serta Scanner', async () => {
  const [settings, main, preload] = await Promise.all([
    read('../src/pages/Settings.jsx'),
    read('../electron/main.cjs'),
    read('../electron/preload.cjs'),
  ]);
  assert.match(settings, /preferenceService\.update\(preferenceDraft\)/u);
  assert.match(settings, /Preferensi ini tidak menyimpan prompt, dokumen, credential/u);
  assert.match(settings, /Gemini utama/u);
  assert.match(main, /createAIGatewayStartup\(\{[\s\S]*?enabled:\s*true/u);
  assert.match(main, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.match(preload, /createAIPreferencePreloadBridge/u);
  for (const forbidden of ['gatewayToken', 'sessionCookie', 'ciphertext']) {
    assert.equal(`${settings}\n${preload}`.includes(forbidden), false);
  }
});
