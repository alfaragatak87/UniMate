import test from 'node:test';
import assert from 'node:assert/strict';

import clientModule from '../electron/ai/internalGatewayClient.cjs';
import { SYNTHETIC_CHAT_REQUEST } from './fixtures/aiFixtures.mjs';
import {
  SYNTHETIC_GATEWAY_ORIGIN,
  SYNTHETIC_RUNTIME_TOKEN,
  startSyntheticGateway,
} from './fixtures/gatewayFixtures.mjs';

const { InternalGatewayClientError, createInternalGatewayClient } = clientModule;

test('client internal melewati sesi, CSRF, auth, dan validasi gateway M2', async (t) => {
  const harness = await startSyntheticGateway();
  const client = createInternalGatewayClient({
    address: harness.address,
    token: SYNTHETIC_RUNTIME_TOKEN,
    origin: SYNTHETIC_GATEWAY_ORIGIN,
  });
  t.after(async () => {
    client.close();
    await harness.gateway.stop();
  });
  const response = await client.requestAI(SYNTHETIC_CHAT_REQUEST);
  assert.equal(response.success, true);
  assert.equal(harness.primaryProvider.getCallCount(), 1);
  assert.equal(harness.gateway.getResourceState().sessions, 1);
  assert.deepEqual(Object.keys(client).sort(), ['close', 'requestAI']);
});

test('client menolak alamat non-loopback sebelum membuat koneksi', () => {
  assert.throws(() => createInternalGatewayClient({
    address: { host: '0.0.0.0', port: 3000 },
    token: SYNTHETIC_RUNTIME_TOKEN,
    origin: SYNTHETIC_GATEWAY_ORIGIN,
  }), /IPv4 loopback/);
});

test('token salah menghasilkan error aman tanpa memantulkan token', async (t) => {
  const harness = await startSyntheticGateway();
  const invalidToken = 'unimate-m3c-synthetic-invalid-token-000000000000000000000001';
  const client = createInternalGatewayClient({
    address: harness.address,
    token: invalidToken,
    origin: SYNTHETIC_GATEWAY_ORIGIN,
  });
  t.after(async () => {
    client.close();
    await harness.gateway.stop();
  });
  let captured;
  await assert.rejects(client.requestAI(SYNTHETIC_CHAT_REQUEST), error => {
    captured = error;
    return error instanceof InternalGatewayClientError
      && error.code === 'unauthorized'
      && error.statusCode === 401;
  });
  assert.equal(JSON.stringify(captured).includes(invalidToken), false);
});

test('client memvalidasi request sebelum membuka sesi', async (t) => {
  const harness = await startSyntheticGateway();
  const client = createInternalGatewayClient({
    address: harness.address,
    token: SYNTHETIC_RUNTIME_TOKEN,
    origin: SYNTHETIC_GATEWAY_ORIGIN,
  });
  t.after(async () => {
    client.close();
    await harness.gateway.stop();
  });
  await assert.rejects(
    client.requestAI({ ...SYNTHETIC_CHAT_REQUEST, extra: true }),
    error => error.code === 'invalid_request',
  );
  assert.equal(harness.gateway.getResourceState().sessions, 0);
});

test('close menghapus sesi client dan menolak request berikutnya', async (t) => {
  const harness = await startSyntheticGateway();
  const client = createInternalGatewayClient({
    address: harness.address,
    token: SYNTHETIC_RUNTIME_TOKEN,
    origin: SYNTHETIC_GATEWAY_ORIGIN,
  });
  t.after(() => harness.gateway.stop());
  await client.requestAI(SYNTHETIC_CHAT_REQUEST);
  client.close();
  await assert.rejects(
    client.requestAI(SYNTHETIC_CHAT_REQUEST),
    error => error.code === 'client_closed',
  );
});
