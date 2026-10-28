import { createHash } from 'node:crypto';

import { AI_CAPABILITIES, AI_LIMITS } from '../../shared/ai/contracts.mjs';

export const MAX_AI_JSON_BYTES = Math.ceil(AI_LIMITS.DOCUMENT_BYTES / 3) * 4 + (64 * 1024);

const CAPABILITY_BODY_LIMITS = Object.freeze({
  [AI_CAPABILITIES.CHAT]: 32 * 1024,
  [AI_CAPABILITIES.ANALYTICS]: 512 * 1024,
  [AI_CAPABILITIES.DOCUMENT_SCAN]: MAX_AI_JSON_BYTES,
});

export class RequestTransportError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'RequestTransportError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateHeaders(request, maxBytes) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new RequestTransportError('unsupported_media_type', 'Content-Type harus application/json.', 415);
  }
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding !== undefined && contentEncoding !== 'identity') {
    throw new RequestTransportError('unsupported_content_encoding', 'Content-Encoding tidak didukung.', 415);
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new RequestTransportError('invalid_content_length', 'Content-Length tidak valid.', 400);
    }
    if (parsedLength > maxBytes) {
      throw new RequestTransportError('request_too_large', 'Ukuran request melewati batas.', 413);
    }
  }
}

export function readJsonBody(request, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_AI_JSON_BYTES;
  validateHeaders(request, maxBytes);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const hash = createHash('sha256');
    let byteLength = 0;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    }

    request.on('data', (chunk) => {
      if (settled) return;
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        fail(new RequestTransportError('request_too_large', 'Ukuran request melewati batas.', 413));
        request.resume();
        return;
      }
      hash.update(chunk);
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const rawBody = Buffer.concat(chunks, byteLength).toString('utf8');
        chunks.length = 0;
        const value = JSON.parse(rawBody);
        resolve({ value, byteLength, fingerprint: hash.digest('hex') });
      } catch {
        chunks.length = 0;
        reject(new RequestTransportError('invalid_json', 'Body harus berupa JSON valid.', 400));
      }
    });

    request.on('aborted', () => fail(new RequestTransportError('request_aborted', 'Request dibatalkan.', 400)));
    request.on('error', () => fail(new RequestTransportError('request_stream_error', 'Request tidak dapat dibaca.', 400)));
  });
}

export function validateTransportPayload(request, byteLength) {
  const capabilityLimit = CAPABILITY_BODY_LIMITS[request.capability];
  if (capabilityLimit !== undefined && byteLength > capabilityLimit) {
    throw new RequestTransportError('request_too_large', 'Payload capability melewati batas.', 413);
  }

  if (request.capability === AI_CAPABILITIES.DOCUMENT_SCAN) {
    const decodedSize = Buffer.from(request.input.file.base64, 'base64').length;
    if (decodedSize !== request.input.file.size || decodedSize > AI_LIMITS.DOCUMENT_BYTES) {
      throw new RequestTransportError('document_size_mismatch', 'Ukuran dokumen tidak sesuai deklarasi.', 400);
    }
  }
}
