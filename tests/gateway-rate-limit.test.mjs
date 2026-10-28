import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../gateway/security/rateLimiter.mjs';
import { createRequestReplayGuard } from '../gateway/security/requestReplayGuard.mjs';
import { SYNTHETIC_CHAT_REQUEST } from './fixtures/aiFixtures.mjs';
import {
  aiHeaders,
  createSyntheticClock,
  openSyntheticSession,
  requestGateway,
  startSyntheticGateway,
  withRequestId,
} from './fixtures/gatewayFixtures.mjs';

async function prepare(t, options = {}) {
  const harness = await startSyntheticGateway(options);
  t.after(() => harness.gateway.stop());
  return harness;
}

async function sendAI(harness, session, body) {
  return requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/ai/requests',
    headers: aiHeaders(session),
    body,
  });
}

test('sliding window memberi Retry-After dan pulih setelah waktu maju', () => {
  const clock = createSyntheticClock();
  const limiter = createRateLimiter({ now: clock.now });
  assert.equal(limiter.consume({ key: 'synthetic', limit: 1, windowMs: 1000 }).allowed, true);
  const rejected = limiter.consume({ key: 'synthetic', limit: 1, windowMs: 1000 });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 1);
  clock.advance(1001);
  assert.equal(limiter.consume({ key: 'synthetic', limit: 1, windowMs: 1000 }).allowed, true);
});

test('concurrency guard membatasi dan melepaskan resource', () => {
  const limiter = createRateLimiter();
  const release = limiter.acquire('synthetic-active', 1);
  assert.equal(typeof release, 'function');
  assert.equal(limiter.acquire('synthetic-active', 1), null);
  assert.equal(limiter.getActiveCount(), 1);
  release();
  assert.equal(limiter.getActiveCount(), 0);
  assert.equal(typeof limiter.acquire('synthetic-active', 1), 'function');
  limiter.clear();
});

test('replay guard hanya menyimpan fingerprint dan metadata terbatas', () => {
  const guard = createRequestReplayGuard({ maxEntries: 2 });
  const first = guard.begin({ clientId: 'client', requestId: 'request', fingerprint: 'a'.repeat(64) });
  assert.equal(first.accepted, true);
  guard.complete(first.handle);
  const duplicate = guard.begin({ clientId: 'client', requestId: 'request', fingerprint: 'a'.repeat(64) });
  const conflict = guard.begin({ clientId: 'client', requestId: 'request', fingerprint: 'b'.repeat(64) });
  assert.equal(duplicate.reason, 'duplicate_request');
  assert.equal(conflict.reason, 'request_id_conflict');
  assert.deepEqual(Object.keys(guard.getMetadata()[0]).sort(), ['createdAt', 'expiresAt', 'fingerprintLength', 'state']);
  assert.equal(guard.getMetadata()[0].fingerprintLength, 64);
  guard.clear();
  assert.equal(guard.getEntryCount(), 0);
});

test('rate limit pembuatan sesi diterapkan per client', async (t) => {
  const harness = await prepare(t, {
    rateLimits: { session: { limit: 1, windowMs: 60_000 } },
  });
  const first = await openSyntheticSession(harness);
  const second = await openSyntheticSession(harness);
  assert.equal(first.response.statusCode, 201);
  assert.equal(second.response.statusCode, 429);
  assert.equal(second.response.headers['retry-after'], '60');
});

test('rate limit capability menghentikan request sebelum provider', async (t) => {
  const harness = await prepare(t, {
    rateLimits: {
      total: { limit: 10, windowMs: 60_000 },
      capabilities: { chat: { limit: 1, windowMs: 60_000 } },
    },
  });
  const session = await openSyntheticSession(harness);
  const first = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);
  const secondRequest = withRequestId(SYNTHETIC_CHAT_REQUEST, '44444444-4444-4444-8444-444444444444');
  const second = await sendAI(harness, session, secondRequest);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('request duplikat tidak diproses ulang oleh provider', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const first = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);
  const duplicate = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.error.code, 'duplicate_request');
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('requestId sama dengan payload berbeda ditolak sebagai konflik', async (t) => {
  const harness = await prepare(t);
  const session = await openSyntheticSession(harness);
  const changed = withRequestId(SYNTHETIC_CHAT_REQUEST, SYNTHETIC_CHAT_REQUEST.requestId);
  changed.input.message = 'Payload sintetis yang berbeda.';
  await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);
  const conflict = await sendAI(harness, session, changed);

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.error.code, 'request_id_conflict');
  assert.equal(harness.primaryProvider.getCallCount(), 1);
});

test('replay entry kedaluwarsa tanpa menyimpan hasil AI', async (t) => {
  const clock = createSyntheticClock();
  const harness = await prepare(t, { clock, replayTtlMs: 1000 });
  const session = await openSyntheticSession(harness);
  const first = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);
  clock.advance(1001);
  const second = await sendAI(harness, session, SYNTHETIC_CHAT_REQUEST);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(harness.primaryProvider.getCallCount(), 2);
});
