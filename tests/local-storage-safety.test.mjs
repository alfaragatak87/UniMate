import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_STATES,
  createLocalStorageController,
  isValidThesisBoard,
} from '../src/services/storageSafety.js';

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const calls = { get: 0, set: 0 };
  return {
    values,
    calls,
    getItem(key) {
      calls.get += 1;
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      calls.set += 1;
      values.set(key, value);
    },
  };
}

test('write quota exceeded tidak mengubah state yang dianggap tersimpan', () => {
  const storage = createStorage({ counter: '1' });
  storage.setItem = () => {
    const error = new Error('synthetic secret must not escape');
    error.name = 'QuotaExceededError';
    throw error;
  };
  const controller = createLocalStorageController({ storage, key: 'counter', initialValue: 0 });

  const result = controller.update(value => value + 1);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'write_failed');
  assert.equal(controller.getSnapshot().value, 1);
  assert.equal(JSON.stringify(result).includes('synthetic secret'), false);
});

test('storage unavailable menolak update tanpa menampilkan keberhasilan', () => {
  const controller = createLocalStorageController({ storage: null, key: 'counter', initialValue: 0 });
  const result = controller.update(1);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'storage_unavailable');
  assert.equal(controller.getSnapshot().state, STORAGE_STATES.UNAVAILABLE);
  assert.equal(controller.getSnapshot().value, 0);
});

test('malformed JSON dipertahankan dan tidak ditimpa otomatis', () => {
  const storage = createStorage({ college_thesis: '{broken-json' });
  const fallback = { todo: [], inProgress: [], review: [], done: [] };
  const controller = createLocalStorageController({
    storage,
    key: 'college_thesis',
    initialValue: fallback,
    validate: isValidThesisBoard,
  });

  const result = controller.update({ ...fallback, todo: [{ id: 1 }] });

  assert.equal(controller.getSnapshot().state, STORAGE_STATES.MALFORMED);
  assert.equal(controller.getSnapshot().recoverableRaw, true);
  assert.equal(result.code, 'recovery_required');
  assert.equal(storage.values.get('college_thesis'), '{broken-json');
  assert.equal(storage.calls.set, 0);
});

test('struktur Thesis lama yang tidak valid tidak diganti board kosong', () => {
  const raw = JSON.stringify({ todo: 'not-an-array', legacy: [{ id: 7 }] });
  const storage = createStorage({ college_thesis: raw });
  const controller = createLocalStorageController({
    storage,
    key: 'college_thesis',
    initialValue: { todo: [], inProgress: [], review: [], done: [] },
    validate: isValidThesisBoard,
  });

  assert.equal(controller.getSnapshot().state, STORAGE_STATES.INVALID);
  assert.equal(controller.update(value => value).ok, false);
  assert.equal(storage.values.get('college_thesis'), raw);
  assert.equal(storage.calls.set, 0);
});

test('functional update berurutan selalu memakai nilai terbaru yang berhasil disimpan', () => {
  const storage = createStorage({ counter: '0' });
  const controller = createLocalStorageController({ storage, key: 'counter', initialValue: 0 });

  assert.equal(controller.update(value => value + 1).ok, true);
  assert.equal(controller.update(value => value + 1).ok, true);
  assert.equal(controller.update(value => value + 1).ok, true);

  assert.equal(controller.getSnapshot().value, 3);
  assert.equal(storage.values.get('counter'), '3');
  assert.equal(storage.calls.set, 3);
});
