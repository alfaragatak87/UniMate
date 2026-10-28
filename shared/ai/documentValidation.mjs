const MIME_EXTENSIONS = Object.freeze({
  'application/pdf': Object.freeze(['pdf']),
  'image/bmp': Object.freeze(['bmp']),
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
  'text/csv': Object.freeze(['csv']),
  'text/plain': Object.freeze(['txt']),
});

const PREFERRED_EXTENSIONS = Object.freeze({
  'application/pdf': 'pdf',
  'image/bmp': 'bmp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
});

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function result(valid, code = null) {
  return Object.freeze({ valid, code });
}

function getExtension(name) {
  const separator = name.lastIndexOf('.');
  return separator > 0 ? name.slice(separator + 1).toLowerCase() : '';
}

function decodeBase64Prefix(value, maximumBytes = 4096) {
  const bytes = [];
  for (let offset = 0; offset < value.length && bytes.length < maximumBytes; offset += 4) {
    const first = BASE64_ALPHABET.indexOf(value[offset]);
    const second = BASE64_ALPHABET.indexOf(value[offset + 1]);
    const thirdCharacter = value[offset + 2];
    const fourthCharacter = value[offset + 3];
    const third = thirdCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(thirdCharacter);
    const fourth = fourthCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter);
    if ([first, second, third, fourth].some(index => index < 0)) return null;
    bytes.push((first << 2) | (second >> 4));
    if (thirdCharacter !== '=' && bytes.length < maximumBytes) {
      bytes.push(((second & 15) << 4) | (third >> 2));
    }
    if (fourthCharacter !== '=' && bytes.length < maximumBytes) {
      bytes.push(((third & 3) << 6) | fourth);
    }
  }
  return Uint8Array.from(bytes);
}

function hasPrefix(bytes, expected, offset = 0) {
  return bytes.length >= offset + expected.length
    && expected.every((value, index) => bytes[offset + index] === value);
}

function hasExpectedSignature(mimeType, bytes) {
  if (mimeType === 'application/pdf') return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (mimeType === 'image/bmp') return hasPrefix(bytes, [0x42, 0x4d]);
  if (mimeType === 'image/jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/webp') {
    return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
      && hasPrefix(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  if (mimeType === 'text/csv' || mimeType === 'text/plain') {
    return bytes.length > 0 && !bytes.some(byte => (
      byte === 0
      || byte === 0x7f
      || (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte))
    ));
  }
  return false;
}

export function getPreferredAIDocumentExtension(mimeType) {
  return PREFERRED_EXTENSIONS[mimeType] ?? null;
}

export function isAIDocumentNameMimeMatch(name, mimeType) {
  if (
    typeof name !== 'string'
    || name.length < 1
    || name.length > 255
    || [...name].some(character => character === '/' || character === '\\' || character.codePointAt(0) < 32)
  ) return false;
  const extensions = MIME_EXTENSIONS[mimeType];
  return Array.isArray(extensions) && extensions.includes(getExtension(name));
}

export function validateAIDocumentPayload(file) {
  if (file === null || typeof file !== 'object' || Array.isArray(file)) return result(false, 'invalid_file');
  if (!isAIDocumentNameMimeMatch(file.name, file.mimeType)) return result(false, 'name_mime_mismatch');
  if (!Number.isSafeInteger(file.size) || file.size < 1) return result(false, 'invalid_size');
  if (
    typeof file.base64 !== 'string'
    || file.base64.length < 4
    || file.base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(file.base64)
  ) return result(false, 'invalid_base64');
  const padding = file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0;
  const decodedSize = (file.base64.length / 4) * 3 - padding;
  if (decodedSize !== file.size) return result(false, 'size_mismatch');
  const prefix = decodeBase64Prefix(file.base64);
  if (prefix === null || !hasExpectedSignature(file.mimeType, prefix)) return result(false, 'signature_mismatch');
  return result(true);
}
