export const STORAGE_STATES = Object.freeze({
  MISSING: 'missing',
  READY: 'ready',
  MALFORMED: 'malformed',
  INVALID: 'invalid',
  UNAVAILABLE: 'unavailable',
});

const issues = new Map();
const listeners = new Set();

function freezeIssue(issue) {
  return Object.freeze({
    key: issue.key,
    code: issue.code,
    operation: issue.operation,
    recoverableRaw: issue.recoverableRaw === true,
  });
}

function publishIssue(issue) {
  const safeIssue = freezeIssue(issue);
  const issueId = `${safeIssue.key}:${safeIssue.operation}`;
  const previous = issues.get(issueId);
  issues.set(issueId, safeIssue);
  if (previous?.code === safeIssue.code && previous?.recoverableRaw === safeIssue.recoverableRaw) return;
  for (const listener of listeners) listener(safeIssue);
}

function clearIssue(key, operation) {
  issues.delete(`${key}:${operation}`);
}

function createSnapshot(value, state, writable, recoverableRaw = false) {
  return Object.freeze({ value, state, writable, recoverableRaw });
}

function inspectStorage(storage, key, initialValue, validate) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    publishIssue({ key, code: 'storage_unavailable', operation: 'read', recoverableRaw: false });
    return createSnapshot(initialValue, STORAGE_STATES.UNAVAILABLE, false);
  }

  let rawValue;
  try {
    rawValue = storage.getItem(key);
  } catch {
    publishIssue({ key, code: 'storage_unavailable', operation: 'read', recoverableRaw: false });
    return createSnapshot(initialValue, STORAGE_STATES.UNAVAILABLE, false);
  }

  if (rawValue === null) {
    clearIssue(key, 'read');
    return createSnapshot(initialValue, STORAGE_STATES.MISSING, true);
  }

  let parsedValue;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    publishIssue({ key, code: 'malformed_json', operation: 'read', recoverableRaw: true });
    return createSnapshot(initialValue, STORAGE_STATES.MALFORMED, false, true);
  }

  if (typeof validate === 'function' && !validate(parsedValue)) {
    publishIssue({ key, code: 'invalid_data', operation: 'read', recoverableRaw: true });
    return createSnapshot(initialValue, STORAGE_STATES.INVALID, false, true);
  }

  clearIssue(key, 'read');
  return createSnapshot(parsedValue, STORAGE_STATES.READY, true);
}

export function createLocalStorageController({ storage, key, initialValue, validate } = {}) {
  if (typeof key !== 'string' || key.length === 0) throw new TypeError('Key penyimpanan tidak valid');
  let snapshot = inspectStorage(storage, key, initialValue, validate);

  return Object.freeze({
    getSnapshot() {
      return snapshot;
    },
    update(nextValueOrUpdater) {
      if (!snapshot.writable) {
        const result = Object.freeze({
          ok: false,
          code: snapshot.recoverableRaw ? 'recovery_required' : 'storage_unavailable',
          snapshot,
        });
        publishIssue({
          key,
          code: result.code,
          operation: 'write',
          recoverableRaw: snapshot.recoverableRaw,
        });
        return result;
      }

      let nextValue;
      try {
        nextValue = typeof nextValueOrUpdater === 'function'
          ? nextValueOrUpdater(snapshot.value)
          : nextValueOrUpdater;
      } catch {
        publishIssue({ key, code: 'update_failed', operation: 'write', recoverableRaw: false });
        return Object.freeze({ ok: false, code: 'update_failed', snapshot });
      }

      if (typeof validate === 'function' && !validate(nextValue)) {
        publishIssue({ key, code: 'invalid_data', operation: 'write', recoverableRaw: false });
        return Object.freeze({ ok: false, code: 'invalid_data', snapshot });
      }

      let serialized;
      try {
        serialized = JSON.stringify(nextValue);
        if (serialized === undefined) throw new TypeError('Nilai tidak dapat diserialisasi');
      } catch {
        publishIssue({ key, code: 'serialization_failed', operation: 'write', recoverableRaw: false });
        return Object.freeze({ ok: false, code: 'serialization_failed', snapshot });
      }

      try {
        storage.setItem(key, serialized);
      } catch {
        publishIssue({ key, code: 'write_failed', operation: 'write', recoverableRaw: false });
        return Object.freeze({ ok: false, code: 'write_failed', snapshot });
      }

      snapshot = createSnapshot(nextValue, STORAGE_STATES.READY, true);
      clearIssue(key, 'write');
      return Object.freeze({ ok: true, value: nextValue, snapshot });
    },
  });
}

export function isValidThesisBoard(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['todo', 'inProgress', 'review', 'done'].every(column => Array.isArray(value[column]));
}

export function getStorageSafetyIssues() {
  return Object.freeze([...issues.values()]);
}

export function subscribeStorageSafety(listener) {
  if (typeof listener !== 'function') throw new TypeError('Listener penyimpanan tidak valid');
  listeners.add(listener);
  return () => listeners.delete(listener);
}
