import test from 'node:test';
import assert from 'node:assert/strict';

import { createGateway } from '../gateway/createGateway.mjs';
import {
  RequestTransportError,
  validateTransportPayload,
} from '../gateway/security/requestLimits.mjs';
import { SYNTHETIC_CHAT_REQUEST, SYNTHETIC_DOCUMENT_REQUEST } from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GATEWAY_ORIGIN,
  SYNTHETIC_RUNTIME_TOKEN,
  aiHeaders,
  baseHeaders,
  clone,
  openSyntheticSession,
  requestGateway,
  startSyntheticGateway,
} from './fixtures/gatewayFixtures.mjs';

async function prepare(t, options = {}) {
  const harness = await startSyntheticGateway(options);
  t.after(() => harness.gateway.stop());
  return harness;
}

test('gateway menolak mode provider yang tidak dikenal', () => {
  assert.throws(() => createGateway({
    router: { route: async () => null },
    authClients: [],
    allowedOrigins: [SYNTHETIC_GATEWAY_ORIGIN],
    providerMode: 'production-unverified',
  }), /Mode provider gateway tidak valid/u);
});

test('gateway hanya mengikat 127.0.0.1 dengan port acak', async (t) => {
  const harness = await prepare(t);
  assert.equal(harness.address.host, '127.0.0.1');
  assert.equal(Number.isInteger(harness.address.port), true);
  assert.equal(harness.address.port > 0, true);
  assert.match(harness.address.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('health memerlukan autentikasi dan tidak membuka CORS', async (t) => {
  const harness = await prepare(t);
  const unauthorized = await requestGateway(harness.address, {
    path: '/v1/health',
    headers: { Origin: SYNTHETIC_GATEWAY_ORIGIN },
  });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await requestGateway(harness.address, {
    path: '/v1/health',
    headers: baseHeaders(),
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.body, { status: 'ok', providerMode: 'mock' });
  assert.equal(authorized.headers['access-control-allow-origin'], undefined);
  assert.equal(authorized.rawBody.includes(SYNTHETIC_RUNTIME_TOKEN), false);
});

test('token autentikasi yang salah ditolak', async (t) => {
  const harness = await prepare(t);
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/session',
    headers: baseHeaders({ Authorization: `Bearer ${'x'.repeat(64)}` }),
  });
  assert.equal(response.statusCode, 401);
});

test('Host, Origin, Fetch Metadata, dan forwarded header divalidasi', async (t) => {
  const harness = await prepare(t);
  const cases = [
    baseHeaders({ Host: 'attacker.invalid' }),
    baseHeaders({ Origin: 'http://attacker.invalid' }),
    baseHeaders({ Origin: 'null' }),
    baseHeaders({ 'Sec-Fetch-Site': 'cross-site' }),
    baseHeaders({ 'X-Forwarded-Host': 'attacker.invalid' }),
  ];

  for (const headers of cases) {
    const response = await requestGateway(harness.address, {
      method: 'POST',
      path: '/v1/session',
      headers,
    });
    assert.equal(response.statusCode, 403);
  }
});

test('Origin wajib tersedia untuk membuat sesi', async (t) => {
  const harness = await prepare(t);
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/session',
    headers: {
      Authorization: `Bearer ${SYNTHETIC_RUNTIME_TOKEN}`,
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  assert.equal(response.statusCode, 403);
});

test('sesi awal aman tanpa CSRF yang belum diterbitkan', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const setCookie = session.response.headers['set-cookie'][0];

  assert.equal(session.response.statusCode, 201);
  assert.equal(typeof session.csrfToken, 'string');
  assert.equal(session.csrfToken.length >= 32, true);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\/v1/i);
  assert.doesNotMatch(setCookie, /Domain=/i);
});

test('request AI tanpa CSRF atau dengan CSRF salah ditolak', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const withoutCsrf = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: baseHeaders({ 'Content-Type': 'application/json', Cookie: session.cookie }),
    body: SYNTHETIC_CHAT_REQUEST,
  });
  const wrongCsrf = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session, { 'X-CSRF-Token': 'wrong-token' }),
    body: SYNTHETIC_CHAT_REQUEST,
  });

  assert.equal(withoutCsrf.statusCode, 403);
  assert.equal(wrongCsrf.statusCode, 403);
  assert.equal(harness.primaryProvider.getCallCount(), 0);
});

test('request AI valid melewati autentikasi, session, dan CSRF', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body: SYNTHETIC_CHAT_REQUEST,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('content type, JSON rusak, dan body terlalu besar ditolak', async (t) => {
  const harness = await prepare(t, { maxBodyBytes: 256 });
  const session = await openSyntheticSession(harness);
  const wrongType = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session, { 'Content-Type': 'text/plain' }),
    body: '{}',
  });
  const malformed = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body: '{not-json',
  });
  const oversized = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body: JSON.stringify({ padding: 'x'.repeat(300) }),
  });

  assert.equal(wrongType.statusCode, 415);
  assert.equal(malformed.statusCode, 400);
  assert.equal(oversized.statusCode, 413);
});

test('ukuran base64 dokumen harus sama dengan deklarasi file', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file.size += 1;
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body: request,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'invalid_request');
  assert.equal(harness.primaryProvider.getCallCount(), 0);
});

test('validator transport tetap mendeteksi document_size_mismatch secara langsung', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file.size += 1;
  assert.throws(
    () => validateTransportPayload(request, Buffer.byteLength(JSON.stringify(request), 'utf8')),
    error => error instanceof RequestTransportError && error.code === 'document_size_mismatch',
  );
});

test('signature dokumen palsu ditolak sebelum provider dipanggil', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file.size = 4;
  request.input.file.base64 = 'TVqQAA==';
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body: request,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'invalid_request');
  assert.equal(harness.primaryProvider.getCallCount(), 0);
});

test('stop membersihkan server, socket, session, dan resource memori', async () => {
  const harness = await startSyntheticGateway();
  await openSyntheticSession(harness);
  await harness.gateway.stop();
  assert.deepEqual(harness.gateway.getResourceState(), {
    listening: false,
    sockets: 0,
    sessions: 0,
    replayEntries: 0,
    rateBuckets: 0,
    activeRequests: 0,
  });
});
