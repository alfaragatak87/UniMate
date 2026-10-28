export const DEVICE_SYNC_VERSION = 1;
export const DEVICE_SYNC_PREVIEW_TYPE = 'SYNC_PREVIEW_REQUEST';
export const DEVICE_SYNC_MAX_BYTES = 2 * 1024 * 1024;

const STORAGE_SCHEMA = Object.freeze({
  college_tasks: 'array',
  college_projects: 'array',
  college_semesters: 'array',
  github_username: 'string',
  dark_mode: 'boolean',
});

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/u;

export class DeviceSyncSafetyError extends Error {
  constructor(code) {
    super('Data sinkronisasi ditolak.');
    this.name = 'DeviceSyncSafetyError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function assertSafeJson(value, state, depth = 0) {
  if (depth > 20 || state.nodes > 50_000) throw new DeviceSyncSafetyError('payload_too_complex');
  state.nodes += 1;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DeviceSyncSafetyError('invalid_payload');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJson(item, state, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw new DeviceSyncSafetyError('invalid_payload');
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) throw new DeviceSyncSafetyError('unsafe_key');
    assertSafeJson(item, state, depth + 1);
  }
}

function assertExpectedType(key, value) {
  const expected = STORAGE_SCHEMA[key];
  const valid = expected === 'array' ? Array.isArray(value) : typeof value === expected;
  if (!valid) throw new DeviceSyncSafetyError('invalid_data_type');
}

function parsePayload(message) {
  if (!hasExactKeys(message, ['type', 'version', 'requestId', 'payload'])) {
    throw new DeviceSyncSafetyError('invalid_envelope');
  }
  if (message.type !== DEVICE_SYNC_PREVIEW_TYPE || message.version !== DEVICE_SYNC_VERSION) {
    throw new DeviceSyncSafetyError('unsupported_protocol');
  }
  if (typeof message.requestId !== 'string' || !REQUEST_ID_PATTERN.test(message.requestId)) {
    throw new DeviceSyncSafetyError('invalid_request_id');
  }
  if (!isPlainObject(message.payload)) throw new DeviceSyncSafetyError('invalid_payload');

  let totalBytes = 0;
  const parsed = {};
  for (const [key, serialized] of Object.entries(message.payload)) {
    if (!Object.hasOwn(STORAGE_SCHEMA, key)) throw new DeviceSyncSafetyError('unknown_storage_key');
    if (typeof serialized !== 'string') throw new DeviceSyncSafetyError('invalid_payload');
    totalBytes += new TextEncoder().encode(serialized).byteLength;
    if (totalBytes > DEVICE_SYNC_MAX_BYTES) throw new DeviceSyncSafetyError('payload_too_large');
    try {
      parsed[key] = JSON.parse(serialized);
    } catch {
      throw new DeviceSyncSafetyError('malformed_json');
    }
    assertExpectedType(key, parsed[key]);
    assertSafeJson(parsed[key], { nodes: 0 });
  }
  return parsed;
}

export function createDeviceSyncPreview(message, storage) {
  const parsed = parsePayload(message);
  const keys = Object.keys(parsed).sort();
  let additions = 0;
  let differences = 0;
  let unchanged = 0;
  let conflicts = 0;

  for (const key of keys) {
    let currentRaw;
    try {
      currentRaw = storage?.getItem?.(key) ?? null;
    } catch {
      conflicts += 1;
      continue;
    }
    if (currentRaw === null) {
      additions += 1;
      continue;
    }
    try {
      const current = JSON.parse(currentRaw);
      if (JSON.stringify(current) === JSON.stringify(parsed[key])) unchanged += 1;
      else differences += 1;
    } catch {
      conflicts += 1;
    }
  }

  return Object.freeze({
    requestId: message.requestId,
    keys: Object.freeze(keys),
    additions,
    differences,
    unchanged,
    conflicts,
    writeAllowed: false,
    reason: 'secure_pairing_required',
  });
}

export function createDeviceSyncRejection(requestId, code = 'secure_pairing_required') {
  const safeRequestId = typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
  const safeCodes = ['secure_pairing_required', 'invalid_message'];
  return Object.freeze({
    type: 'SYNC_REJECTED',
    version: DEVICE_SYNC_VERSION,
    requestId: safeRequestId,
    code: safeCodes.includes(code) ? code : 'invalid_message',
  });
}
