import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  formatAIBudgetMicrousd,
  parseAIBudgetUsdInput,
} from '../src/services/budgetClient.js';
import {
  AI_RUNTIME_READ_STATES,
  getAIRuntimeStatusDisplay,
} from '../src/services/aiRuntimeStatusDisplay.js';

test('konversi input budget USD presisi dan mengikuti batas backend', () => {
  assert.equal(parseAIBudgetUsdInput('0.000001'), 1);
  assert.equal(parseAIBudgetUsdInput('1.25'), 1_250_000);
  assert.equal(parseAIBudgetUsdInput('1000'), 1_000_000_000);
  for (const invalid of ['', '0', '-1', '1.0000001', '1e2', '1000.000001', 'Infinity']) {
    assert.equal(parseAIBudgetUsdInput(invalid), null, invalid);
  }
  assert.equal(formatAIBudgetMicrousd(0), 'US$0');
  assert.equal(formatAIBudgetMicrousd(1_250_000), 'US$1.25');
  assert.equal(formatAIBudgetMicrousd(null), 'Tidak tersedia');
});

test('status Settings membedakan nonaktif, gagal, dan komunikasi tidak dapat dibaca', () => {
  assert.deepEqual(
    getAIRuntimeStatusDisplay(null, AI_RUNTIME_READ_STATES.UNREADABLE),
    { gateway: 'status tidak dapat dibaca', production: 'status tidak dapat dibaca' },
  );
  assert.deepEqual(
    getAIRuntimeStatusDisplay(
      { productionEnabled: false, gateway: { state: 'disabled', available: false } },
      AI_RUNTIME_READ_STATES.READY,
    ),
    { gateway: 'nonaktif', production: 'nonaktif' },
  );
  assert.deepEqual(
    getAIRuntimeStatusDisplay(
      { productionEnabled: true, gateway: { state: 'unavailable', available: false } },
      AI_RUNTIME_READ_STATES.READY,
    ),
    { gateway: 'gagal berjalan', production: 'aktif' },
  );
  assert.deepEqual(
    getAIRuntimeStatusDisplay(
      { productionEnabled: true, gateway: { state: 'running', available: true } },
      AI_RUNTIME_READ_STATES.READY,
    ),
    { gateway: 'berjalan', production: 'aktif' },
  );
});

test('Settings menampilkan Gemini Chat aktif dengan mutasi provider terbatas', async () => {
  const [settings, main, preload, catalog] = await Promise.all([
    fs.readFile(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../shared/ai/modelCatalog.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(settings, /aiRuntimeStatusClient/u);
  assert.match(settings, /getAIRuntimeStatusDisplay/u);
  assert.match(settings, /aiBudgetClient/u);
  assert.match(settings, /aiPreferenceClient/u);
  assert.match(settings, /Gemini utama/u);
  assert.match(settings, /tanpa fallback otomatis ke OpenAI/u);
  assert.match(settings, /Electron packaged Windows/u);
  assert.match(settings, /bukan jaminan batas tagihan provider/u);
  assert.match(settings, /providerMutationAvailable = client\.canMutate\(provider\.id\)/u);
  assert.match(settings, /disabled=\{!providerMutationAvailable/u);
  assert.match(settings, /disabled=\{!budgetMutationsAvailable/u);
  assert.equal(settings.includes('localStorage'), false);
  assert.equal(settings.includes('gemini_api_key'), false);

  assert.match(catalog, /modelId: 'gpt-6-luna'/u);
  assert.match(catalog, /AI_DEFAULT_MODEL_ID = 'gemini-3\.5-flash-lite'/u);
  assert.match(catalog, /selectable: false/u);
  assert.match(catalog, /https:\/\/ai\.google\.dev\/gemini-api\/docs\/pricing/u);
  assert.match(main, /createAIGatewayStartup\(\{[\s\S]*?enabled:\s*true/u);
  assert.match(main, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.match(main, /allowedMutationProviders:\s*\['gemini'\]/u);
  assert.match(preload, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.match(preload, /createAIBudgetPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*false/u);
});
