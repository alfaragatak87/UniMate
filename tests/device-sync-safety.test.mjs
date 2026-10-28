import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  DEVICE_SYNC_PREVIEW_TYPE,
  DEVICE_SYNC_VERSION,
  DeviceSyncSafetyError,
  createDeviceSyncPreview,
  createDeviceSyncRejection,
} from '../src/services/deviceSyncSafety.js';

function createMessage(payload = {}) {
  return {
    type: DEVICE_SYNC_PREVIEW_TYPE,
    version: DEVICE_SYNC_VERSION,
    requestId: 'synthetic-request-001',
    payload,
  };
}

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    setCalls: 0,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem() {
      this.setCalls += 1;
    },
  };
}

test('preview tervalidasi membedakan tambahan, perubahan, data sama, dan konflik tanpa menulis', () => {
  const storage = createStorage({
    college_tasks: JSON.stringify([{ id: 'same' }]),
    college_projects: JSON.stringify([{ id: 'old' }]),
    college_semesters: '{broken-json',
  });
  const preview = createDeviceSyncPreview(createMessage({
    college_tasks: JSON.stringify([{ id: 'same' }]),
    college_projects: JSON.stringify([{ id: 'new' }]),
    college_semesters: JSON.stringify([]),
    github_username: JSON.stringify('synthetic-user'),
  }), storage);

  assert.deepEqual(preview.keys, ['college_projects', 'college_semesters', 'college_tasks', 'github_username']);
  assert.equal(preview.additions, 1);
  assert.equal(preview.differences, 1);
  assert.equal(preview.unchanged, 1);
  assert.equal(preview.conflicts, 1);
  assert.equal(preview.writeAllowed, false);
  assert.equal(storage.setCalls, 0);
});

test('protokol legacy, key asing, tipe salah, dan prototype berbahaya ditolak', () => {
  const invalidMessages = [
    { type: 'SYNC_DATA', payload: {} },
    createMessage({ gemini_api_key: JSON.stringify('forbidden') }),
    createMessage({ college_tasks: JSON.stringify({ not: 'array' }) }),
    createMessage({ college_tasks: '{broken' }),
    createMessage({ college_tasks: '[{"__proto__":[]}]' }),
  ];

  for (const message of invalidMessages) {
    assert.throws(
      () => createDeviceSyncPreview(message, createStorage()),
      error => error instanceof DeviceSyncSafetyError,
    );
  }
});

test('rejection hanya memuat metadata aman dan tidak mengakui keberhasilan', () => {
  const rejection = createDeviceSyncRejection('synthetic-request-001');
  assert.deepEqual(rejection, {
    type: 'SYNC_REJECTED',
    version: 1,
    requestId: 'synthetic-request-001',
    code: 'secure_pairing_required',
  });
  assert.equal(JSON.stringify(rejection).includes('payload'), false);
});

test('Device Sync tidak memiliki jalur tulis remote atau klaim offline/semua data', async () => {
  const source = await fs.readFile(new URL('../src/pages/DeviceSync.jsx', import.meta.url), 'utf8');
  assert.equal(source.includes('localStorage.setItem'), false);
  assert.equal(source.includes("type === 'SYNC_DATA'"), false);
  assert.match(source, /data\?\.type === 'SYNC_REJECTED'/u);
  assert.equal(source.includes('100% Offline'), false);
  assert.equal(source.includes('Kirim Semua Data'), false);
  assert.match(source, /createDeviceSyncPreview/u);
  assert.match(source, /Transfer data dinonaktifkan/u);
});
