import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE_NAME = 'unimate_ai_session';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function parseCookieHeader(headerValue) {
  if (typeof headerValue !== 'string') return new Map();
  const cookies = new Map();
  for (const part of headerValue.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export function createCsrfManager(options = {}) {
  const {
    now = Date.now,
    randomBytesFn = randomBytes,
    sessionTtlMs = 30 * 60 * 1000,
    maxSessions = 100,
  } = options;

  if (typeof now !== 'function' || typeof randomBytesFn !== 'function') throw new TypeError('Sumber waktu dan random wajib berupa fungsi');
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 1000) throw new TypeError('TTL session tidak valid');
  if (!Number.isInteger(maxSessions) || maxSessions < 1) throw new TypeError('Batas session tidak valid');

  const sessions = new Map();

  function cleanup() {
    const currentTime = now();
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= currentTime) sessions.delete(sessionId);
    }
  }

  function makeToken() {
    const value = randomBytesFn(32);
    if (!Buffer.isBuffer(value) || value.length < 32) throw new TypeError('Sumber random harus menghasilkan minimal 32 byte');
    return value.toString('base64url');
  }

  return Object.freeze({
    issue(clientId) {
      cleanup();
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
        if (oldest) sessions.delete(oldest[0]);
      }

      const sessionId = makeToken();
      const csrfToken = makeToken();
      const createdAt = now();
      const expiresAt = createdAt + sessionTtlMs;
      sessions.set(sessionId, {
        clientId,
        csrfDigest: digest(csrfToken),
        createdAt,
        expiresAt,
      });

      return Object.freeze({
        sessionId,
        csrfToken,
        expiresAt,
        cookie: `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/v1; Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
      });
    },

    validateRequest(request, clientId) {
      cleanup();
      const sessionId = parseCookieHeader(request.headers.cookie).get(SESSION_COOKIE_NAME);
      const csrfToken = request.headers['x-csrf-token'];
      if (typeof sessionId !== 'string' || typeof csrfToken !== 'string') return null;
      const session = sessions.get(sessionId);
      if (session === undefined || session.clientId !== clientId) return null;
      if (!timingSafeEqual(digest(csrfToken), session.csrfDigest)) return null;
      return Object.freeze({
        key: digest(sessionId).toString('hex'),
        clientId: session.clientId,
        expiresAt: session.expiresAt,
      });
    },

    clear() {
      sessions.clear();
    },

    getSessionCount() {
      cleanup();
      return sessions.size;
    },
  });
}

export { SESSION_COOKIE_NAME };
