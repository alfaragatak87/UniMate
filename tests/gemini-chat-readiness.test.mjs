import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  AI_COMPLEXITY_LEVELS,
  AI_SELECTION_MODES,
} from '../shared/ai/contracts.mjs';
import {
  AI_BACKEND_MODELS,
  AI_DEFAULT_MODEL_ID,
} from '../shared/ai/modelCatalog.mjs';
import {
  CREDENTIAL_CONFIGURATION_MODES,
} from '../shared/credentials/transportContracts.mjs';
import {
  createDefaultAISelection,
} from '../src/services/aiClient.js';
import {
  SYNTHETIC_DOCUMENT_REQUEST,
} from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
} from './fixtures/credentialFixtures.mjs';
import {
  createMultiAISyntheticHarness,
  waitForSynthetic,
} from './fixtures/multiAISyntheticHarness.mjs';

const require = createRequire(import.meta.url);
const { createProviderExecutors } = require('../electron/ai/providerExecutors.cjs');

const PRODUCTION_CAPABILITIES = Object.freeze(['chat', 'document_scan']);

function requestIds(count, prefix = '91') {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    return `${prefix}000000-0000-4000-8000-${suffix}`;
  });
}

function selection(overrides = {}) {
  return createDefaultAISelection({
    freeTierDataConsent: true,
    ...overrides,
  });
}

async function configureGemini(harness) {
  await harness.credentialClient.configure(
    'gemini',
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_GEMINI_CREDENTIAL,
  );
  await harness.budgetClient.configure({
    consentVersion: 1,
    dailyLimitMicrousd: 2_000_000,
    monthlyLimitMicrousd: 10_000_000,
  });
}

test('production mengaktifkan Gemini Chat dan Scanner tanpa membuka OpenAI atau budget berbayar', async () => {
  const [mainSource, preloadSource] = await Promise.all([
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /createAIGatewayStartup\(\{[\s\S]*?enabled:\s*true/u);
  assert.match(mainSource, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.match(mainSource, /registerCredentialHandlers\(\{[\s\S]*?mutationsEnabled:\s*true,[\s\S]*?allowedMutationProviders:\s*\['gemini'\]/u);
  assert.match(mainSource, /registerAIBudgetHandlers\(\{[\s\S]*?mutationsEnabled:\s*false/u);
  assert.match(preloadSource, /createCredentialPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*true/u);
  assert.match(preloadSource, /createAIBudgetPreloadBridge\(\{[\s\S]*?mutationsEnabled:\s*false/u);
  assert.deepEqual(AI_BACKEND_MODELS.openai, []);

  const executors = await createProviderExecutors();
  assert.deepEqual(Object.keys(executors.openai), []);
  assert.deepEqual(Object.keys(executors.gemini), [AI_DEFAULT_MODEL_ID]);
});

test('credential Gemini sintetis terenkripsi bertahan setelah restart dan melayani pilihan Chat', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  const encryptedBeforeRestart = await fs.readFile(harness.credentialPath, 'utf8');
  assert.equal(encryptedBeforeRestart.includes(SYNTHETIC_GEMINI_CREDENTIAL), false);

  await harness.restartPersistentBackends();
  const status = await harness.credentialClient.getStatus();
  assert.equal(status.providers.gemini, 'configured');
  await harness.startAI({ enabledCapabilities: PRODUCTION_CAPABILITIES });

  const inputs = [
    { message: 'Buat ringkasan singkat.', selection: selection() },
    { message: 'Jelaskan; bandingkan; analisis rencana belajar.', selection: selection() },
    { message: `Susun rencana mendalam: ${'materi '.repeat(420)}`, selection: selection() },
    ...Object.values(AI_COMPLEXITY_LEVELS).map(complexity => ({
      message: `Pilihan manual ${complexity}.`,
      selection: selection({
        mode: AI_SELECTION_MODES.MANUAL,
        complexity,
        modelId: AI_DEFAULT_MODEL_ID,
      }),
    })),
  ];
  const client = harness.createAIClient(requestIds(inputs.length));
  const responses = [];
  for (const input of inputs) responses.push(await client.chat(input));

  assert.deepEqual(responses.map(response => response.meta.complexity), [
    AI_COMPLEXITY_LEVELS.LIGHT,
    AI_COMPLEXITY_LEVELS.MEDIUM,
    AI_COMPLEXITY_LEVELS.HEAVY,
    AI_COMPLEXITY_LEVELS.LIGHT,
    AI_COMPLEXITY_LEVELS.MEDIUM,
    AI_COMPLEXITY_LEVELS.HEAVY,
  ]);
  assert.deepEqual(responses.map(response => response.meta.selectionMode), [
    AI_SELECTION_MODES.AUTOMATIC,
    AI_SELECTION_MODES.AUTOMATIC,
    AI_SELECTION_MODES.AUTOMATIC,
    AI_SELECTION_MODES.MANUAL,
    AI_SELECTION_MODES.MANUAL,
    AI_SELECTION_MODES.MANUAL,
  ]);
  assert.equal(harness.control.calls.every(call => (
    call.provider === 'gemini'
    && call.capability === 'chat'
    && call.model === AI_DEFAULT_MODEL_ID
    && call.credentialMatched
  )), true);
  assert.equal(JSON.stringify(responses).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
});

test('gate production mengizinkan Scanner tetapi menolak Analytics, model OpenAI, dan Gateway belum aktif', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  const inactiveClient = harness.createAIClient(requestIds(1, '92'));
  await assert.rejects(
    inactiveClient.chat({ message: 'Gateway belum aktif.', selection: selection() }),
    error => error.code === 'backend_unavailable',
  );

  await harness.startAI({ enabledCapabilities: PRODUCTION_CAPABILITIES });
  const client = harness.createAIClient(requestIds(3, '93'));
  await assert.rejects(
    client.analyze({ rows: [{ nilai: 80 }], xAxis: 'nilai', yAxes: ['nilai'], selection: selection() }),
    error => error.code === 'capability_disabled',
  );
  const scanner = await client.scanDocument({
    scanType: 'auto',
    file: SYNTHETIC_DOCUMENT_REQUEST.input.file,
    userContext: SYNTHETIC_DOCUMENT_REQUEST.input.userContext,
    selection: selection(),
  });
  assert.equal(scanner.success, true);
  assert.equal(scanner.capability, 'document_scan');
  await assert.rejects(
    client.chat({
      message: 'Coba provider tidak diizinkan.',
      selection: selection({
        mode: AI_SELECTION_MODES.MANUAL,
        complexity: AI_COMPLEXITY_LEVELS.LIGHT,
        modelId: 'gpt-6-luna',
      }),
    }),
    error => error.code === 'invalid_request',
  );
  assert.deepEqual(harness.control.calls.map(call => call.capability), ['document_scan']);
  assert.equal(harness.control.calls[0].credentialMatched, true);
});

test('kegagalan Gemini sintetis berhenti pada satu percobaan tanpa fallback', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  await harness.startAI({ enabledCapabilities: PRODUCTION_CAPABILITIES });
  const behaviors = Object.freeze([
    ['auth_failed', 'provider_unavailable'],
    ['timeout', 'provider_timeout'],
    ['invalid_response', 'invalid_response'],
    ['network_error', 'provider_unavailable'],
  ]);
  const client = harness.createAIClient(requestIds(behaviors.length, '94'));

  for (const [behavior, expectedCode] of behaviors) {
    const callsBefore = harness.control.calls.length;
    harness.control.behavior.gemini = behavior;
    const response = await client.chat({ message: `Kegagalan ${behavior}.`, selection: selection() });
    assert.equal(response.success, false);
    assert.equal(response.error.code, expectedCode);
    assert.equal(harness.control.calls.length, callsBefore + 1);
    assert.equal(response.error.fallbackReason, null);
  }
  assert.equal(harness.control.calls.some(call => call.provider === 'openai'), false);
});

test('shutdown saat request Chat berjalan membatalkan request dan restart tetap memakai credential sama', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await configureGemini(harness);
  harness.control.behavior.gemini = 'hang';
  await harness.startAI({ enabledCapabilities: PRODUCTION_CAPABILITIES });
  const client = harness.createAIClient(requestIds(1, '95'));
  const pending = client.chat({ message: 'Request berjalan saat restart.', selection: selection() });
  await waitForSynthetic(() => harness.control.calls.length === 1);
  await harness.stopAI();
  await assert.rejects(pending, error => error.code === 'request_cancelled');

  harness.control.behavior.gemini = 'success';
  await harness.restartPersistentBackends();
  await harness.startAI({ enabledCapabilities: PRODUCTION_CAPABILITIES });
  const restartedClient = harness.createAIClient(requestIds(1, '96'));
  const response = await restartedClient.chat({ message: 'Sesudah restart.', selection: selection() });
  const safeErrorCode = typeof response?.error?.code === 'string'
    && /^[a-z0-9_]+$/u.test(response.error.code)
    ? response.error.code
    : 'none';
  assert.equal(response.success, true, `restart_response_${safeErrorCode}`);
  assert.equal(harness.control.calls.at(-1).credentialMatched, true);
});
