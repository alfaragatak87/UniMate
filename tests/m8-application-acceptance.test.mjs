import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  CREDENTIAL_CONFIGURATION_MODES,
} from '../shared/credentials/transportContracts.mjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
} from './fixtures/credentialFixtures.mjs';
import { createMultiAISyntheticHarness } from './fixtures/multiAISyntheticHarness.mjs';

test('runtime sintetis melaporkan target packaged, model, routing, dan gate renderer aman', async (t) => {
  const harness = await createMultiAISyntheticHarness(t);
  await harness.credentialClient.configure('gemini', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_GEMINI_CREDENTIAL);
  await harness.budgetClient.configure({
    consentVersion: 1,
    dailyLimitMicrousd: 1_000_000,
    monthlyLimitMicrousd: 5_000_000,
  });
  await harness.startAI();

  const status = await harness.createRuntimeStatusClient().getStatus();
  assert.equal(status.target, 'electron_packaged_windows');
  assert.equal(status.profileScope, 'same_electron_profile');
  assert.equal(status.gateway.state, 'running');
  assert.equal(status.productionEnabled, true);
  assert.equal(status.rendererActivationAllowed, false);
  assert.deepEqual(status.routing, {
    primary: 'gemini',
    fallback: null,
    maxFallbackAttempts: 0,
    accessMode: 'free_only',
  });
  assert.equal(status.models.defaultModelId, 'gemini-3.5-flash-lite');
  assert.deepEqual(status.models.available, ['gemini-3.5-flash-lite']);
  assert.deepEqual(status.models.partiallyVerified, ['gemini-3.1-flash-lite']);
  assert.equal(status.models.openaiEnabled, false);
  assert.equal(JSON.stringify(status).includes(SYNTHETIC_GEMINI_CREDENTIAL), false);
});

test('jalur offline dan fitur akademik tetap tersedia saat production dibatasi Chat dan Scanner', async () => {
  const [analytics, scanner, backup, semesters, projects, thesis, main] = await Promise.all([
    fs.readFile(new URL('../src/pages/DataAnalytics.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/components/DataBackup.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/Semesters.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/Projects.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/ThesisKanban.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  ]);

  assert.match(analytics, /fallbackInsight/u);
  assert.match(analytics, /Analisis offline/u);
  assert.match(analytics, /parseSafeMarkdown\(text\)/u);
  assert.match(scanner, /createAIScannerReview/u);
  assert.match(scanner, /confirmOverwrite/u);
  assert.match(backup, /createAcademicRestorePreview/u);
  assert.match(semesters, /setSemesters/u);
  assert.match(projects, /setProjects/u);
  assert.match(thesis, /setThesis/u);
  assert.match(main, /enabled:\s*true/u);
  assert.match(main, /enabledCapabilities:\s*\['chat', 'document_scan'\]/u);
  assert.equal(main.includes("app.setPath('userData'"), false);
  assert.equal(main.includes('app.setPath("userData"'), false);
});
