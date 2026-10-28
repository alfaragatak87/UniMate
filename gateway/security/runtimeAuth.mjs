import { createHash, timingSafeEqual } from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,512}$/;

function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest();
}

function parseBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(headerValue);
  return match?.[1] ?? null;
}

export function createRuntimeAuthenticator({ clients }) {
  if (!Array.isArray(clients) || clients.length === 0) {
    throw new TypeError('Minimal satu client autentikasi diperlukan');
  }

  const identities = clients.map((client) => {
    if (
      client === null
      || typeof client !== 'object'
      || typeof client.id !== 'string'
      || client.id.length === 0
      || typeof client.type !== 'string'
      || !TOKEN_PATTERN.test(client.token)
    ) {
      throw new TypeError('Konfigurasi client autentikasi tidak valid');
    }

    return Object.freeze({
      id: client.id,
      type: client.type,
      digest: digestToken(client.token),
    });
  });

  if (new Set(identities.map(identity => identity.id)).size !== identities.length) {
    throw new TypeError('ID client autentikasi harus unik');
  }

  return Object.freeze({
    authenticate(headerValue) {
      const token = parseBearerToken(headerValue);
      if (token === null) return null;
      const candidate = digestToken(token);
      let matchedIdentity = null;

      for (const identity of identities) {
        if (timingSafeEqual(candidate, identity.digest)) matchedIdentity = identity;
      }

      if (matchedIdentity === null) return null;
      return Object.freeze({ id: matchedIdentity.id, type: matchedIdentity.type });
    },
  });
}
