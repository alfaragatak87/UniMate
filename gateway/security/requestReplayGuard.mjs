export function createRequestReplayGuard(options = {}) {
  const {
    now = Date.now,
    ttlMs = 5 * 60 * 1000,
    maxEntries = 100,
  } = options;

  if (typeof now !== 'function') throw new TypeError('Sumber waktu wajib berupa fungsi');
  if (!Number.isInteger(ttlMs) || ttlMs < 1000) throw new TypeError('TTL replay tidak valid');
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('Batas replay tidak valid');

  const entries = new Map();

  function cleanup() {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  }

  return Object.freeze({
    begin({ clientId, requestId, fingerprint }) {
      cleanup();
      const key = `${clientId}:${requestId}`;
      const existing = entries.get(key);
      if (existing !== undefined) {
        return Object.freeze({
          accepted: false,
          reason: existing.fingerprint === fingerprint ? 'duplicate_request' : 'request_id_conflict',
        });
      }
      if (entries.size >= maxEntries) return Object.freeze({ accepted: false, reason: 'replay_capacity' });

      const handle = Object.freeze({ key, fingerprint });
      entries.set(key, {
        fingerprint,
        state: 'active',
        createdAt: now(),
        expiresAt: now() + ttlMs,
      });
      return Object.freeze({ accepted: true, reason: null, handle });
    },

    complete(handle) {
      const entry = entries.get(handle?.key);
      if (entry === undefined || entry.fingerprint !== handle.fingerprint) return false;
      entry.state = 'completed';
      entry.expiresAt = now() + ttlMs;
      return true;
    },

    clear() {
      entries.clear();
    },

    getEntryCount() {
      cleanup();
      return entries.size;
    },

    getMetadata() {
      cleanup();
      return [...entries.values()].map(entry => Object.freeze({
        state: entry.state,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        fingerprintLength: entry.fingerprint.length,
      }));
    },
  });
}
