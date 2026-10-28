import { AI_PROVIDER_ERROR_CODES } from '../../../shared/ai/contracts.mjs';
import { ProviderAdapterError } from './providerAdapterSupport.mjs';

const ALLOWED_HOSTS = Object.freeze(new Set([
  'api.openai.com',
  'generativelanguage.googleapis.com',
]));

function assertRequestOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  let parsed;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.hash !== ''
    || !ALLOWED_HOSTS.has(parsed.hostname)
  ) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_REQUEST);
  }
  return parsed.href;
}

async function readBody(response, maxResponseBytes) {
  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) {
      throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    }
    return new TextDecoder().decode(bytes);
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createProviderHttpTransport(options = {}) {
  const {
    fetchFn = globalThis.fetch,
    maxResponseBytes = 1024 * 1024,
  } = options;
  if (typeof fetchFn !== 'function') throw new TypeError('Fetch provider tidak tersedia');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 2 * 1024 * 1024) {
    throw new TypeError('Batas respons provider tidak valid');
  }

  return Object.freeze({
    async send(requestOptions) {
      const url = assertRequestOptions(requestOptions);
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      requestOptions.signal?.addEventListener?.('abort', onAbort, { once: true });
      if (requestOptions.signal?.aborted) controller.abort();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestOptions.timeoutMs);
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: requestOptions.headers,
          body: JSON.stringify(requestOptions.body),
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
        const rawBody = await readBody(response, maxResponseBytes);
        let body = null;
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            if (response.ok) throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE);
          }
        }
        return Object.freeze({ status: response.status, ok: response.ok, body });
      } catch (error) {
        if (error instanceof ProviderAdapterError) throw error;
        if (timedOut) throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.TIMEOUT);
        if (requestOptions.signal?.aborted) {
          throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.CANCELLED);
        }
        throw new ProviderAdapterError(AI_PROVIDER_ERROR_CODES.NETWORK_ERROR);
      } finally {
        clearTimeout(timeoutId);
        requestOptions.signal?.removeEventListener?.('abort', onAbort);
      }
    },
  });
}
