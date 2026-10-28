import test from 'node:test';
import assert from 'node:assert/strict';

import { AI_PROVIDER_ERROR_CODES } from '../shared/ai/contracts.mjs';
import { createProviderHttpTransport } from '../gateway/ai/providers/providerHttpTransport.mjs';

const REQUEST = Object.freeze({
  url: 'https://api.openai.com/v1/responses',
  headers: { Authorization: 'Bearer synthetic-not-real', 'Content-Type': 'application/json' },
  body: { synthetic: true },
  timeoutMs: 1_000,
});

test('transport mengirim satu request POST tanpa redirect atau retry', async () => {
  const calls = [];
  const transport = createProviderHttpTransport({
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const response = await transport.send(REQUEST);
  assert.deepEqual(response, { status: 200, ok: true, body: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('transport menolak host, protokol, dan respons terlalu besar', async () => {
  const transport = createProviderHttpTransport({
    maxResponseBytes: 1024,
    fetchFn: async () => new Response(JSON.stringify({ padding: 'x'.repeat(2048) }), { status: 200 }),
  });
  for (const url of [
    'http://api.openai.com/v1/responses',
    'https://evil.example/v1/responses',
    'https://api.openai.com:444/v1/responses',
  ]) {
    await assert.rejects(
      transport.send({ ...REQUEST, url }),
      error => error.code === AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
    );
  }
  await assert.rejects(
    transport.send(REQUEST),
    error => error.code === AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
  );
});

test('timeout dan cancellation mengabort request secara deterministik', async () => {
  let calls = 0;
  const transport = createProviderHttpTransport({
    fetchFn: (_url, options) => new Promise((_resolve, reject) => {
      calls += 1;
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await assert.rejects(
    transport.send(REQUEST),
    error => error.code === AI_PROVIDER_ERROR_CODES.TIMEOUT,
  );
  const controller = new AbortController();
  const pending = transport.send({ ...REQUEST, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.code === AI_PROVIDER_ERROR_CODES.CANCELLED);
  assert.equal(calls, 2);
});

test('error jaringan dan JSON sukses malformed disanitasi', async () => {
  const networkTransport = createProviderHttpTransport({
    fetchFn: async () => { throw new Error('private network detail'); },
  });
  await assert.rejects(
    networkTransport.send(REQUEST),
    error => error.code === AI_PROVIDER_ERROR_CODES.NETWORK_ERROR
      && !error.message.includes('private network detail'),
  );

  const malformedTransport = createProviderHttpTransport({
    fetchFn: async () => new Response('{not-json', { status: 200 }),
  });
  await assert.rejects(
    malformedTransport.send(REQUEST),
    error => error.code === AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
  );
});
