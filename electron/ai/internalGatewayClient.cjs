const http = require('node:http');

const aiValidationModule = import('../../shared/ai/validation.mjs');

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,512}$/;
const SESSION_COOKIE_PATTERN = /^unimate_ai_session=[A-Za-z0-9_-]{32,512}$/;
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

const ERROR_MESSAGES = Object.freeze({
  invalid_request: 'Permintaan AI internal tidak valid.',
  gateway_unavailable: 'Gateway AI lokal tidak tersedia.',
  unauthorized: 'Autentikasi gateway lokal ditolak.',
  request_rejected: 'Permintaan gateway lokal ditolak.',
  invalid_response: 'Respons gateway lokal tidak valid.',
  request_cancelled: 'Permintaan AI dibatalkan.',
  client_closed: 'Client gateway lokal sudah ditutup.',
});

class InternalGatewayClientError extends Error {
  constructor(code, statusCode = null) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.gateway_unavailable);
    this.name = 'InternalGatewayClientError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'gateway_unavailable';
    this.statusCode = Number.isInteger(statusCode) ? statusCode : null;
  }
}

function validateAddress(address) {
  if (
    address === null
    || typeof address !== 'object'
    || address.host !== '127.0.0.1'
    || !Number.isInteger(address.port)
    || address.port < 1
    || address.port > 65535
  ) {
    throw new TypeError('Alamat gateway internal harus menggunakan IPv4 loopback');
  }
}

function validateOrigin(origin) {
  if (typeof origin !== 'string') throw new TypeError('Origin gateway internal tidak valid');
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new TypeError('Origin gateway internal harus berupa origin localhost');
  }
}

function parseJsonResponse(response, resolve, reject) {
  const chunks = [];
  let byteLength = 0;
  let settled = false;

  function fail(code) {
    if (settled) return;
    settled = true;
    chunks.length = 0;
    response.destroy();
    reject(new InternalGatewayClientError(code, response.statusCode));
  }

  response.on('data', chunk => {
    if (settled) return;
    byteLength += chunk.length;
    if (byteLength > RESPONSE_LIMIT_BYTES) {
      fail('invalid_response');
      return;
    }
    chunks.push(chunk);
  });
  response.on('end', () => {
    if (settled) return;
    settled = true;
    try {
      const contentType = response.headers['content-type'];
      if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
        throw new Error('invalid content type');
      }
      const body = JSON.parse(Buffer.concat(chunks, byteLength).toString('utf8'));
      chunks.length = 0;
      resolve(Object.freeze({ statusCode: response.statusCode, headers: response.headers, body }));
    } catch {
      chunks.length = 0;
      reject(new InternalGatewayClientError('invalid_response', response.statusCode));
    }
  });
  response.on('error', () => fail('gateway_unavailable'));
}

function createInternalGatewayClient(options = {}) {
  const {
    address,
    token,
    origin = 'http://localhost:3000',
    timeoutMs = 10_000,
    httpModule = http,
  } = options;
  validateAddress(address);
  validateOrigin(origin);
  if (!TOKEN_PATTERN.test(token)) throw new TypeError('Token gateway internal tidak valid');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new TypeError('Timeout gateway internal tidak valid');
  }
  if (typeof httpModule?.request !== 'function') throw new TypeError('Transport HTTP internal tidak valid');

  let session = null;
  let sessionPromise = null;
  let closed = false;

  function requestJson(pathname, body, sessionHeaders = {}, options = {}) {
    if (closed) return Promise.reject(new InternalGatewayClientError('client_closed'));
    const signal = options.signal;
    if (
      signal !== undefined
      && (
        typeof signal?.aborted !== 'boolean'
        || typeof signal?.addEventListener !== 'function'
        || typeof signal?.removeEventListener !== 'function'
      )
    ) {
      return Promise.reject(new InternalGatewayClientError('invalid_request'));
    }
    if (signal?.aborted) return Promise.reject(new InternalGatewayClientError('request_cancelled'));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      Connection: 'close',
      ...sessionHeaders,
    };
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const safeResolve = value => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const safeReject = error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        request?.destroy();
        safeReject(new InternalGatewayClientError('request_cancelled'));
      };
      request = httpModule.request({
        hostname: address.host,
        port: address.port,
        method: 'POST',
        path: pathname,
        headers,
        agent: false,
      }, response => parseJsonResponse(response, safeResolve, safeReject));
      request.once('error', () => safeReject(new InternalGatewayClientError(
        signal?.aborted ? 'request_cancelled' : 'gateway_unavailable',
      )));
      request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
      signal?.addEventListener('abort', onAbort, { once: true });
      request.end(payload);
    });
  }

  async function createSession() {
    const response = await requestJson('/v1/session');
    if (response.statusCode === 401) throw new InternalGatewayClientError('unauthorized', 401);
    if (response.statusCode !== 201) throw new InternalGatewayClientError('request_rejected', response.statusCode);
    const body = response.body;
    const bodyKeys = body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
    const cookieHeader = response.headers['set-cookie'];
    const cookie = Array.isArray(cookieHeader) && typeof cookieHeader[0] === 'string'
      ? cookieHeader[0].split(';')[0]
      : null;
    if (
      bodyKeys.length !== 2
      || !bodyKeys.includes('csrfToken')
      || !bodyKeys.includes('expiresAt')
      || !TOKEN_PATTERN.test(body.csrfToken)
      || !Number.isFinite(body.expiresAt)
      || typeof cookie !== 'string'
      || !SESSION_COOKIE_PATTERN.test(cookie)
    ) {
      throw new InternalGatewayClientError('invalid_response', response.statusCode);
    }
    session = Object.freeze({ csrfToken: body.csrfToken, cookie });
    return session;
  }

  function ensureSession() {
    if (session !== null) return Promise.resolve(session);
    if (sessionPromise === null) {
      sessionPromise = createSession().finally(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  return Object.freeze({
    async requestAI(request, options = {}) {
      const { assertValidAIRequest, validateAIResponse } = await aiValidationModule;
      try {
        assertValidAIRequest(request);
      } catch {
        throw new InternalGatewayClientError('invalid_request');
      }
      if (options.signal?.aborted) throw new InternalGatewayClientError('request_cancelled');
      const currentSession = await ensureSession();
      if (options.signal?.aborted) throw new InternalGatewayClientError('request_cancelled');
      const response = await requestJson('/v1/ai/requests', request, {
        Cookie: currentSession.cookie,
        'X-CSRF-Token': currentSession.csrfToken,
      }, { signal: options.signal });
      if (!validateAIResponse(response.body).valid) {
        const code = response.statusCode === 401 ? 'unauthorized' : 'invalid_response';
        throw new InternalGatewayClientError(code, response.statusCode);
      }
      return response.body;
    },

    close() {
      closed = true;
      session = null;
      sessionPromise = null;
    },
  });
}

module.exports = {
  InternalGatewayClientError,
  createInternalGatewayClient,
};
