import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_PROVIDER_ERROR_CODES,
  AI_PROVIDERS,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import {
  MockProviderError,
  MOCK_PROVIDER_SCENARIOS,
  createMockProvider,
} from '../gateway/ai/providers/mockProvider.mjs';
import {
  SYNTHETIC_CHAT_REQUEST,
  SYNTHETIC_CHAT_RESULT,
  SYNTHETIC_RESULTS_BY_CAPABILITY,
} from './fixtures/aiFixtures.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function expectProviderError(provider, expectedCode) {
  await assert.rejects(
    provider.generate(SYNTHETIC_CHAT_REQUEST),
    error => error instanceof MockProviderError && error.code === expectedCode,
  );
}

test('mock sukses mengembalikan hasil deterministik', async () => {
  const provider = createMockProvider({
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    responses: SYNTHETIC_RESULTS_BY_CAPABILITY,
  });

  const first = await provider.generate(SYNTHETIC_CHAT_REQUEST);
  const second = await provider.generate(SYNTHETIC_CHAT_REQUEST);

  assert.deepEqual(first, {
    provider: AI_PROVIDERS.GEMINI,
    modelId: AI_DEFAULT_MODEL_ID,
    result: SYNTHETIC_CHAT_RESULT,
  });
  assert.deepEqual(second, first);
  assert.equal(provider.getCallCount(), 2);
});

test('mock menyimpan salinan request, bukan referensi asli', async () => {
  const request = clone(SYNTHETIC_CHAT_REQUEST);
  const provider = createMockProvider({ responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
  await provider.generate(request);
  request.input.message = 'Diubah setelah pemanggilan';
  assert.equal(provider.getCalls()[0].input.message, SYNTHETIC_CHAT_REQUEST.input.message);
});

test('hasil mock tidak dapat memutasi fixture respons', async () => {
  const provider = createMockProvider({ responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
  const response = await provider.generate(SYNTHETIC_CHAT_REQUEST);
  response.result.message = 'Mutasi lokal';
  const nextResponse = await provider.generate(SYNTHETIC_CHAT_REQUEST);
  assert.equal(nextResponse.result.message, SYNTHETIC_CHAT_RESULT.message);
});

test('mock mensimulasikan timeout secara deterministik', async () => {
  const provider = createMockProvider({ scenario: MOCK_PROVIDER_SCENARIOS.TIMEOUT });
  await expectProviderError(provider, AI_PROVIDER_ERROR_CODES.TIMEOUT);
  assert.equal(provider.getCallCount(), 1);
});

test('mock mensimulasikan rate limit secara deterministik', async () => {
  const provider = createMockProvider({ scenario: MOCK_PROVIDER_SCENARIOS.RATE_LIMITED });
  await expectProviderError(provider, AI_PROVIDER_ERROR_CODES.RATE_LIMITED);
});

test('mock mensimulasikan provider unavailable secara deterministik', async () => {
  const provider = createMockProvider({ scenario: MOCK_PROVIDER_SCENARIOS.UNAVAILABLE });
  await expectProviderError(provider, AI_PROVIDER_ERROR_CODES.UNAVAILABLE);
});

test('mock dapat menghasilkan response tidak valid untuk pengujian router berikutnya', async () => {
  const provider = createMockProvider({ scenario: MOCK_PROVIDER_SCENARIOS.INVALID_RESPONSE });
  assert.deepEqual(await provider.generate(SYNTHETIC_CHAT_REQUEST), { invalid: true });
});

test('mock menolak request yang tidak valid sebelum mencatat panggilan', async () => {
  const provider = createMockProvider({ responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
  const invalidRequest = clone(SYNTHETIC_CHAT_REQUEST);
  invalidRequest.input.message = '';
  await assert.rejects(
    provider.generate(invalidRequest),
    error => error instanceof MockProviderError && error.code === AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
  );
  assert.equal(provider.getCallCount(), 0);
});

test('mock tidak memakai fetch atau koneksi jaringan', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('fetch tidak boleh dipanggil oleh provider mock');
  };

  try {
    const provider = createMockProvider({ responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
    const response = await provider.generate(SYNTHETIC_CHAT_REQUEST);
    assert.equal(response.provider, AI_PROVIDERS.GEMINI);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reset menghapus histori panggilan mock', async () => {
  const provider = createMockProvider({ responses: SYNTHETIC_RESULTS_BY_CAPABILITY });
  await provider.generate(SYNTHETIC_CHAT_REQUEST);
  provider.reset();
  assert.equal(provider.getCallCount(), 0);
  assert.deepEqual(provider.getCalls(), []);
});

test('mock menolak provider dan skenario yang tidak dikenal', () => {
  assert.throws(() => createMockProvider({ provider: 'unknown' }), TypeError);
  assert.throws(() => createMockProvider({ scenario: 'unknown' }), TypeError);
});
