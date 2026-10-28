import { createServer } from 'node:http';

import { createRequestHandler } from './http/requestHandler.mjs';
import { createRuntimeAuthenticator } from './security/runtimeAuth.mjs';
import { createOriginPolicy } from './security/originPolicy.mjs';
import { createCsrfManager } from './security/csrf.mjs';
import { createRateLimiter } from './security/rateLimiter.mjs';
import { MAX_AI_JSON_BYTES } from './security/requestLimits.mjs';
import { createRequestReplayGuard } from './security/requestReplayGuard.mjs';

const LOOPBACK_HOST = '127.0.0.1';

export const GATEWAY_PROVIDER_MODES = Object.freeze({
  MOCK: 'mock',
  CREDENTIAL_BACKED: 'credential-backed',
});

export const DEFAULT_GATEWAY_RATE_LIMITS = Object.freeze({
  session: Object.freeze({ limit: 5, windowMs: 60_000 }),
  total: Object.freeze({ limit: 30, windowMs: 60_000 }),
  capabilities: Object.freeze({
    chat: Object.freeze({ limit: 20, windowMs: 60_000 }),
    analytics: Object.freeze({ limit: 5, windowMs: 60_000 }),
    document_scan: Object.freeze({ limit: 5, windowMs: 60_000 }),
  }),
  concurrentTotal: 2,
  concurrentDocument: 1,
});

function mergeRateLimits(overrides = {}) {
  return Object.freeze({
    session: Object.freeze({ ...DEFAULT_GATEWAY_RATE_LIMITS.session, ...overrides.session }),
    total: Object.freeze({ ...DEFAULT_GATEWAY_RATE_LIMITS.total, ...overrides.total }),
    capabilities: Object.freeze({
      chat: Object.freeze({ ...DEFAULT_GATEWAY_RATE_LIMITS.capabilities.chat, ...overrides.capabilities?.chat }),
      analytics: Object.freeze({ ...DEFAULT_GATEWAY_RATE_LIMITS.capabilities.analytics, ...overrides.capabilities?.analytics }),
      document_scan: Object.freeze({ ...DEFAULT_GATEWAY_RATE_LIMITS.capabilities.document_scan, ...overrides.capabilities?.document_scan }),
    }),
    concurrentTotal: overrides.concurrentTotal ?? DEFAULT_GATEWAY_RATE_LIMITS.concurrentTotal,
    concurrentDocument: overrides.concurrentDocument ?? DEFAULT_GATEWAY_RATE_LIMITS.concurrentDocument,
  });
}

export function createGateway(options) {
  const {
    router,
    authClients,
    allowedOrigins,
    now = Date.now,
    randomBytesFn,
    rateLimits: rateLimitOverrides,
    maxBodyBytes = MAX_AI_JSON_BYTES,
    sessionTtlMs,
    maxSessions,
    replayTtlMs,
    maxReplayEntries,
    providerMode = GATEWAY_PROVIDER_MODES.MOCK,
  } = options ?? {};

  if (typeof router?.route !== 'function') throw new TypeError('Router AI wajib tersedia');
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new TypeError('Batas body tidak valid');
  if (!Object.values(GATEWAY_PROVIDER_MODES).includes(providerMode)) {
    throw new TypeError('Mode provider gateway tidak valid');
  }

  const authenticator = createRuntimeAuthenticator({ clients: authClients });
  const originPolicy = createOriginPolicy({ allowedOrigins });
  const csrfManager = createCsrfManager({ now, randomBytesFn, sessionTtlMs, maxSessions });
  const rateLimiter = createRateLimiter({ now });
  const replayGuard = createRequestReplayGuard({ now, ttlMs: replayTtlMs, maxEntries: maxReplayEntries });
  const rateLimits = mergeRateLimits(rateLimitOverrides);
  const sockets = new Set();
  let address = null;
  let stopped = false;

  const handler = createRequestHandler({
    router,
    authenticator,
    originPolicy,
    csrfManager,
    rateLimiter,
    replayGuard,
    getExpectedHost: () => address?.hostHeader ?? '',
    rateLimits,
    maxBodyBytes,
    providerMode,
  });

  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 50;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return Object.freeze({
    async start() {
      if (address !== null || stopped) throw new Error('Gateway tidak dapat dimulai ulang');
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true });
      });

      const serverAddress = server.address();
      if (serverAddress === null || typeof serverAddress === 'string' || serverAddress.address !== LOOPBACK_HOST) {
        throw new Error('Gateway gagal mengikat IPv4 loopback');
      }
      address = Object.freeze({
        host: LOOPBACK_HOST,
        port: serverAddress.port,
        hostHeader: `${LOOPBACK_HOST}:${serverAddress.port}`,
        url: `http://${LOOPBACK_HOST}:${serverAddress.port}`,
      });
      return address;
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      const closePromise = server.listening
        ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        : Promise.resolve();
      for (const socket of sockets) socket.destroy();
      await closePromise;
      sockets.clear();
      csrfManager.clear();
      rateLimiter.clear();
      replayGuard.clear();
      address = null;
    },

    getAddress() {
      return address;
    },

    getResourceState() {
      return Object.freeze({
        listening: server.listening,
        sockets: sockets.size,
        sessions: csrfManager.getSessionCount(),
        replayEntries: replayGuard.getEntryCount(),
        rateBuckets: rateLimiter.getBucketCount(),
        activeRequests: rateLimiter.getActiveCount(),
      });
    },
  });
}
