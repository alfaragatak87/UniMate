import http from 'node:http';

import { createGateway } from '../../gateway/createGateway.mjs';
import { createMockRouter } from '../../gateway/ai/createMockRouter.mjs';
import { SYNTHETIC_RESULTS_BY_CAPABILITY } from './aiFixtures.mjs';

export const SYNTHETIC_GATEWAY_ORIGIN = 'http://localhost:3000';
export const SYNTHETIC_RUNTIME_TOKEN = 'unimate-m2-synthetic-runtime-token-000000000000000000000000000001';

export const SYNTHETIC_AUTH_CLIENTS = Object.freeze([
  Object.freeze({
    id: 'synthetic-browser-proxy',
    type: 'browser_proxy',
    token: SYNTHETIC_RUNTIME_TOKEN,
  }),
]);

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSyntheticClock(start = 1_800_000_000_000) {
  let currentTime = start;
  return Object.freeze({
    now: () => currentTime,
    advance(milliseconds) {
      currentTime += milliseconds;
      return currentTime;
    },
  });
}

export function createPermissiveBudgetGuard() {
  return Object.freeze({
    reserve: async request => Object.freeze({ requestId: request.requestId }),
    settle: async () => Object.freeze({ settled: true }),
    markUnknown: async () => Object.freeze({ retained: true }),
  });
}

export function withRequestId(request, requestId) {
  const value = clone(request);
  value.requestId = requestId;
  return value;
}

export function requestGateway(address, options = {}) {
  if (address.host !== '127.0.0.1') throw new Error('Test hanya boleh mengakses IPv4 loopback');
  const {
    method = 'GET',
    path = '/',
    headers = {},
    body,
  } = options;
  const payload = body === undefined
    ? null
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const requestHeaders = { Connection: 'close', ...headers };
  if (payload !== null && requestHeaders['Content-Length'] === undefined && requestHeaders['content-length'] === undefined) {
    requestHeaders['Content-Length'] = payload.length;
  }

  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: address.host,
      port: address.port,
      method,
      path,
      headers: requestHeaders,
      agent: false,
    }, (response) => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let parsedBody = null;
        if (rawBody.length > 0) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: parsedBody,
          rawBody,
        });
      });
    });
    request.on('error', reject);
    request.setTimeout(5_000, () => request.destroy(new Error('Request test timeout')));
    request.end(payload);
  });
}

export async function startSyntheticGateway(options = {}) {
  const clock = options.clock ?? createSyntheticClock();
  const providers = createMockRouter({
    responses: SYNTHETIC_RESULTS_BY_CAPABILITY,
    primaryScenario: options.primaryScenario,
    fallbackScenario: options.fallbackScenario,
  });
  const gateway = createGateway({
    router: providers.router,
    authClients: SYNTHETIC_AUTH_CLIENTS,
    allowedOrigins: [SYNTHETIC_GATEWAY_ORIGIN],
    now: clock.now,
    rateLimits: options.rateLimits,
    maxBodyBytes: options.maxBodyBytes,
    sessionTtlMs: options.sessionTtlMs,
    maxSessions: options.maxSessions,
    replayTtlMs: options.replayTtlMs,
    maxReplayEntries: options.maxReplayEntries,
  });
  const address = await gateway.start();
  return Object.freeze({ gateway, address, clock, ...providers });
}

export function baseHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${SYNTHETIC_RUNTIME_TOKEN}`,
    Origin: SYNTHETIC_GATEWAY_ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    ...extra,
  };
}

export async function openSyntheticSession(harness) {
  const response = await requestGateway(harness.address, {
    method: 'POST',
    path: '/v1/session',
    headers: baseHeaders(),
  });
  const setCookie = response.headers['set-cookie']?.[0];
  return Object.freeze({
    response,
    cookie: typeof setCookie === 'string' ? setCookie.split(';')[0] : null,
    csrfToken: response.body?.csrfToken ?? null,
  });
}

export function aiHeaders(session, extra = {}) {
  return baseHeaders({
    'Content-Type': 'application/json',
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrfToken,
    ...extra,
  });
}
