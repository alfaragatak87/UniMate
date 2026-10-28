export function createRateLimiter(options = {}) {
  const {
    now = Date.now,
    maxBuckets = 1000,
  } = options;

  if (typeof now !== 'function') throw new TypeError('Sumber waktu wajib berupa fungsi');
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1) throw new TypeError('Batas bucket tidak valid');

  const windows = new Map();
  const active = new Map();

  function pruneExpired(currentTime) {
    for (const [key, entry] of windows) {
      const validTimestamps = entry.timestamps.filter(timestamp => timestamp > currentTime - entry.windowMs);
      if (validTimestamps.length === 0) windows.delete(key);
      else entry.timestamps = validTimestamps;
    }
  }

  return Object.freeze({
    consume({ key, limit, windowMs }) {
      if (typeof key !== 'string' || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
        throw new TypeError('Konfigurasi rate limit tidak valid');
      }

      const currentTime = now();
      pruneExpired(currentTime);
      let entry = windows.get(key);
      if (entry === undefined) {
        if (windows.size >= maxBuckets) return { allowed: false, retryAfterSeconds: 1, reason: 'capacity' };
        entry = { timestamps: [], windowMs };
        windows.set(key, entry);
      }

      entry.timestamps = entry.timestamps.filter(timestamp => timestamp > currentTime - windowMs);
      entry.windowMs = windowMs;
      if (entry.timestamps.length >= limit) {
        const retryAfterMs = Math.max(1, entry.timestamps[0] + windowMs - currentTime);
        return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000), reason: 'rate_limit' };
      }

      entry.timestamps.push(currentTime);
      return { allowed: true, retryAfterSeconds: 0, reason: null };
    },

    acquire(key, limit) {
      if (typeof key !== 'string' || !Number.isInteger(limit) || limit < 1) throw new TypeError('Konfigurasi concurrency tidak valid');
      const count = active.get(key) ?? 0;
      if (count >= limit) return null;
      active.set(key, count + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const nextCount = (active.get(key) ?? 1) - 1;
        if (nextCount <= 0) active.delete(key);
        else active.set(key, nextCount);
      };
    },

    clear() {
      windows.clear();
      active.clear();
    },

    getBucketCount() {
      pruneExpired(now());
      return windows.size;
    },

    getActiveCount() {
      return [...active.values()].reduce((total, value) => total + value, 0);
    },
  });
}
