import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_CAPABILITIES,
  AI_CONTRACT_VERSION,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import {
  FrontendAIError,
  createDefaultAISelection,
  createFrontendAIClient,
  formatAIProviderStatus,
} from '../src/services/aiClient.js';
import {
  SYNTHETIC_ANALYTICS_RESULT,
  SYNTHETIC_CHAT_RESULT,
  SYNTHETIC_DOCUMENT_RESULT,
} from './fixtures/aiFixtures.mjs';

const REQUEST_IDS = Object.freeze([
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333',
]);

function createSuccessEnvelope(request, result) {
  return {
    ok: true,
    response: {
      schemaVersion: AI_CONTRACT_VERSION,
      requestId: request.requestId,
      capability: request.capability,
      success: true,
      meta: {
        provider: AI_PROVIDERS.GEMINI,
        modelId: request.selection.modelId,
        selectionMode: request.selection.mode,
        complexity: request.selection.complexity,
        accessMode: request.selection.accessMode,
        fallbackUsed: false,
        fallbackReason: null,
        attemptCount: 1,
      },
      result,
    },
  };
}

test('adapter membentuk tiga capability v2 tanpa field credential atau fallback', async () => {
  const requests = [];
  let requestIndex = 0;
  const results = {
    [AI_CAPABILITIES.CHAT]: SYNTHETIC_CHAT_RESULT,
    [AI_CAPABILITIES.ANALYTICS]: SYNTHETIC_ANALYTICS_RESULT,
    [AI_CAPABILITIES.DOCUMENT_SCAN]: SYNTHETIC_DOCUMENT_RESULT,
  };
  const client = createFrontendAIClient({
    createRequestId: () => REQUEST_IDS[requestIndex++],
    transport: async request => {
      requests.push(request);
      return createSuccessEnvelope(request, results[request.capability]);
    },
  });

  const chat = await client.chat({
    message: 'Pesan sintetis',
    selection: createDefaultAISelection(),
  });
  const analytics = await client.analyze({
    rows: [{ minggu: 1, nilai: 80 }],
    xAxis: 'minggu',
    yAxes: ['nilai'],
    selection: createDefaultAISelection({ freeTierDataConsent: true }),
  });
  const scan = await client.scanDocument({
    scanType: 'auto',
    file: { name: 'contoh.txt', mimeType: 'text/plain', size: 4, base64: 'dGVzdA==' },
    userContext: 'Data sintetis',
    selection: createDefaultAISelection({ freeTierDataConsent: true }),
  });

  assert.equal(chat.result.message, SYNTHETIC_CHAT_RESULT.message);
  assert.equal(analytics.result.markdown, SYNTHETIC_ANALYTICS_RESULT.markdown);
  assert.equal(scan.result.direction, SYNTHETIC_DOCUMENT_RESULT.direction);
  assert.deepEqual(requests.map(request => request.capability), ['chat', 'analytics', 'document_scan']);
  assert.equal(requests.every(request => request.selection.provider === AI_PROVIDERS.GEMINI), true);
  assert.equal(requests.every(request => request.selection.allowModelFallback === false), true);
  const serialized = JSON.stringify(requests);
  for (const forbidden of ['apiKey', 'credential', 'ciphertext', 'csrfToken', 'Bearer ']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('adapter menolak field tambahan dan payload tidak valid sebelum IPC', async () => {
  let transportCalls = 0;
  const client = createFrontendAIClient({
    createRequestId: () => REQUEST_IDS[0],
    transport: async () => { transportCalls += 1; },
  });
  const selection = createDefaultAISelection();

  await assert.rejects(
    client.chat({ message: 'Tes', selection, apiKey: 'credential-sintetis-terlarang' }),
    error => error instanceof FrontendAIError && error.code === 'invalid_request',
  );
  await assert.rejects(
    client.analyze({ rows: [], xAxis: '', yAxes: [], selection }),
    error => error instanceof FrontendAIError && error.code === 'invalid_request',
  );
  assert.equal(transportCalls, 0);
});

test('scanDocument mempertahankan kontrak Promise saat input ditolak', async () => {
  const client = createFrontendAIClient({ createRequestId: () => REQUEST_IDS[0] });
  const pending = client.scanDocument({
    scanType: 'auto',
    file: { name: 'palsu.pdf', mimeType: 'application/pdf', size: 4, base64: 'TVqQAA==' },
    userContext: '',
    selection: createDefaultAISelection({ freeTierDataConsent: true }),
  });
  assert.equal(typeof pending?.then, 'function');
  await assert.rejects(pending, error => error.code === 'invalid_request');
});

test('operasi Scanner mengekspos request ID aman untuk pembatalan tanpa mengubah payload', async () => {
  const requests = [];
  const client = createFrontendAIClient({
    createRequestId: () => REQUEST_IDS[2],
    transport: async request => {
      requests.push(request);
      return createSuccessEnvelope(request, SYNTHETIC_DOCUMENT_RESULT);
    },
  });
  const operation = client.startDocumentScan({
    scanType: 'auto',
    file: { name: 'contoh.txt', mimeType: 'text/plain', size: 4, base64: 'dGVzdA==' },
    userContext: 'Data sintetis',
    selection: createDefaultAISelection({ freeTierDataConsent: true }),
  });

  assert.equal(operation.requestId, REQUEST_IDS[2]);
  assert.equal((await operation.result).success, true);
  assert.equal(requests[0].requestId, operation.requestId);
  assert.equal(Object.hasOwn(requests[0], 'credential'), false);
});

test('adapter menolak response tidak cocok tanpa memantulkan data sensitif', async () => {
  const syntheticSecret = 'credential-sintetis-yang-tidak-boleh-keluar';
  const client = createFrontendAIClient({
    createRequestId: () => REQUEST_IDS[0],
    transport: async request => ({
      ok: true,
      response: {
        ...createSuccessEnvelope(request, SYNTHETIC_CHAT_RESULT).response,
        requestId: REQUEST_IDS[1],
        debug: syntheticSecret,
      },
    }),
  });

  let captured;
  await assert.rejects(client.chat({
    message: 'Tes aman',
    selection: createDefaultAISelection(),
  }), error => {
    captured = error;
    return error instanceof FrontendAIError && error.code === 'invalid_response';
  });
  assert.equal(JSON.stringify(captured).includes(syntheticSecret), false);
});

test('mode tanpa Electron fail-closed dan tidak mencoba fetch', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    delete globalThis.window;
    globalThis.fetch = async () => { fetchCalls += 1; };
    const client = createFrontendAIClient({ createRequestId: () => REQUEST_IDS[0] });
    await assert.rejects(
      client.chat({ message: 'Tidak boleh keluar', selection: createDefaultAISelection() }),
      error => error instanceof FrontendAIError && error.code === 'backend_unavailable',
    );
    assert.equal(fetchCalls, 0);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('status provider menampilkan Gemini, model, mode, dan kompleksitas', () => {
  assert.equal(
    formatAIProviderStatus({
      provider: 'gemini',
      modelId: AI_DEFAULT_MODEL_ID,
      selectionMode: 'automatic',
      complexity: 'light',
      fallbackUsed: false,
      attemptCount: 1,
    }),
    'Gemini · Gemini 3.5 Flash Lite · Rekomendasi UniMate · Ringan',
  );
  assert.equal(formatAIProviderStatus({ provider: 'openai' }), 'Provider AI tidak diketahui');
});
