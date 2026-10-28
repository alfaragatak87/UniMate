import { AIContractValidationError, assertValidAIRequest } from '../../shared/ai/validation.mjs';
import { AI_CAPABILITIES, AI_ERROR_CODES } from '../../shared/ai/contracts.mjs';
import { RequestTransportError, readJsonBody, validateTransportPayload } from '../security/requestLimits.mjs';

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

function sendTransportError(response, statusCode, code, message, extraHeaders = {}) {
  sendJson(response, statusCode, {
    success: false,
    error: { code, message },
  }, extraHeaders);
}

function consumeRateLimit(response, rateLimiter, options) {
  const result = rateLimiter.consume(options);
  if (result.allowed) return true;
  sendTransportError(
    response,
    429,
    'rate_limited',
    'Terlalu banyak permintaan lokal. Coba kembali setelah jeda singkat.',
    { 'Retry-After': String(result.retryAfterSeconds) },
  );
  return false;
}

function responseStatus(aiResponse) {
  if (aiResponse.success) return 200;
  if (aiResponse.error.code === AI_ERROR_CODES.CONSENT_REQUIRED) return 409;
  if (aiResponse.error.code === AI_ERROR_CODES.BUDGET_NOT_CONFIGURED) return 409;
  if (aiResponse.error.code === AI_ERROR_CODES.QUOTA_EXCEEDED) return 429;
  if (aiResponse.error.code === AI_ERROR_CODES.RATE_LIMITED) return 429;
  if (aiResponse.error.code === AI_ERROR_CODES.QUOTA_UNAVAILABLE) return 503;
  if (aiResponse.error.code === AI_ERROR_CODES.BUDGET_EXCEEDED) return 429;
  if (aiResponse.error.code === AI_ERROR_CODES.BUDGET_UNAVAILABLE) return 503;
  if (aiResponse.error.code === AI_ERROR_CODES.PROVIDER_TIMEOUT) return 504;
  if (aiResponse.error.code === AI_ERROR_CODES.PROVIDER_UNAVAILABLE) return 503;
  if (aiResponse.error.code === AI_ERROR_CODES.INVALID_RESPONSE) return 502;
  if (aiResponse.error.code === AI_ERROR_CODES.ALL_PROVIDERS_FAILED) return 502;
  if (aiResponse.error.code === AI_ERROR_CODES.REQUEST_CANCELLED) return 400;
  if (aiResponse.error.code === AI_ERROR_CODES.INVALID_REQUEST) return 400;
  return 500;
}

export function createRequestHandler(options) {
  const {
    router,
    authenticator,
    originPolicy,
    csrfManager,
    rateLimiter,
    replayGuard,
    getExpectedHost,
    rateLimits,
    maxBodyBytes,
    providerMode,
  } = options;

  return async function handleRequest(request, response) {
    try {
      const policy = originPolicy.validate(request, getExpectedHost());
      if (!policy.valid) {
        sendTransportError(response, 403, 'request_rejected', 'Permintaan lokal ditolak.');
        return;
      }

      const client = authenticator.authenticate(request.headers.authorization);
      if (client === null) {
        sendTransportError(response, 401, 'unauthorized', 'Autentikasi lokal tidak valid.');
        return;
      }

      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;

      if (request.method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, { status: 'ok', providerMode });
        return;
      }

      if (request.method === 'POST' && pathname === '/v1/session') {
        if (!consumeRateLimit(response, rateLimiter, {
          key: `session:${client.id}`,
          ...rateLimits.session,
        })) return;

        const session = csrfManager.issue(client.id);
        sendJson(response, 201, {
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
        }, { 'Set-Cookie': session.cookie });
        return;
      }

      if (pathname !== '/v1/ai/requests') {
        sendTransportError(response, 404, 'not_found', 'Endpoint tidak ditemukan.');
        return;
      }
      if (request.method !== 'POST') {
        sendTransportError(response, 405, 'method_not_allowed', 'Metode HTTP tidak diizinkan.', { Allow: 'POST' });
        return;
      }

      const session = csrfManager.validateRequest(request, client.id);
      if (session === null) {
        sendTransportError(response, 403, 'csrf_rejected', 'Session atau CSRF token tidak valid.');
        return;
      }

      if (!consumeRateLimit(response, rateLimiter, {
        key: `ai-total:${session.key}`,
        ...rateLimits.total,
      })) return;

      let parsed;
      try {
        parsed = await readJsonBody(request, { maxBytes: maxBodyBytes });
        assertValidAIRequest(parsed.value);
        validateTransportPayload(parsed.value, parsed.byteLength);
      } catch (error) {
        request.resume();
        if (error instanceof RequestTransportError) {
          sendTransportError(response, error.statusCode, error.code, error.message);
          return;
        }
        if (error instanceof AIContractValidationError) {
          sendTransportError(response, 400, 'invalid_request', 'Payload AI tidak sesuai kontrak.');
          return;
        }
        throw error;
      }

      const capabilityLimit = rateLimits.capabilities[parsed.value.capability];
      if (!consumeRateLimit(response, rateLimiter, {
        key: `ai-capability:${session.key}:${parsed.value.capability}`,
        ...capabilityLimit,
      })) return;

      const releaseTotal = rateLimiter.acquire(`ai-active:${session.key}`, rateLimits.concurrentTotal);
      if (releaseTotal === null) {
        sendTransportError(response, 429, 'concurrency_limited', 'Masih ada permintaan AI yang sedang diproses.', { 'Retry-After': '1' });
        return;
      }

      let releaseDocument = null;
      if (parsed.value.capability === AI_CAPABILITIES.DOCUMENT_SCAN) {
        releaseDocument = rateLimiter.acquire(`document-active:${session.key}`, rateLimits.concurrentDocument);
        if (releaseDocument === null) {
          releaseTotal();
          sendTransportError(response, 429, 'concurrency_limited', 'Masih ada dokumen yang sedang diproses.', { 'Retry-After': '1' });
          return;
        }
      }

      const replay = replayGuard.begin({
        clientId: client.id,
        requestId: parsed.value.requestId,
        fingerprint: parsed.fingerprint,
      });
      if (!replay.accepted) {
        releaseDocument?.();
        releaseTotal();
        sendTransportError(response, 409, replay.reason, 'Request ID sudah digunakan dan tidak diproses ulang.');
        return;
      }

      const abortController = new AbortController();
      const abortRequest = () => abortController.abort();
      const abortResponse = () => {
        if (!response.writableEnded) abortController.abort();
      };
      request.once('aborted', abortRequest);
      response.once('close', abortResponse);
      if (request.aborted) abortController.abort();
      try {
        const aiResponse = await router.route(parsed.value, { signal: abortController.signal });
        sendJson(response, responseStatus(aiResponse), aiResponse);
      } finally {
        request.off('aborted', abortRequest);
        response.off('close', abortResponse);
        replayGuard.complete(replay.handle);
        releaseDocument?.();
        releaseTotal();
      }
    } catch {
      if (!response.headersSent) {
        sendTransportError(response, 500, 'internal_error', 'Gateway lokal mengalami kesalahan internal.');
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  };
}
