const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site']);
const FORWARDED_HEADERS = ['forwarded', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto'];

function countRawHeader(request, headerName) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === headerName) count += 1;
  }
  return count;
}

function validateOrigins(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError('Minimal satu Origin harus diizinkan');
  }

  return new Set(allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new TypeError(`Origin tidak valid: ${origin}`);
    }
    return origin;
  }));
}

export function createOriginPolicy({ allowedOrigins }) {
  const originSet = validateOrigins(allowedOrigins);

  return Object.freeze({
    validate(request, expectedHost) {
      if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress)) {
        return { valid: false, code: 'non_loopback_client' };
      }
      if (typeof expectedHost !== 'string' || request.headers.host !== expectedHost || countRawHeader(request, 'host') !== 1) {
        return { valid: false, code: 'invalid_host' };
      }
      if (FORWARDED_HEADERS.some(header => request.headers[header] !== undefined)) {
        return { valid: false, code: 'forwarded_header_rejected' };
      }
      if (countRawHeader(request, 'origin') !== 1 || typeof request.headers.origin !== 'string') {
        return { valid: false, code: 'missing_origin' };
      }
      if (request.headers.origin === 'null' || !originSet.has(request.headers.origin)) {
        return { valid: false, code: 'invalid_origin' };
      }
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite !== undefined && !ALLOWED_FETCH_SITES.has(fetchSite)) {
        return { valid: false, code: 'cross_site_request' };
      }
      return { valid: true, code: null };
    },
  });
}
