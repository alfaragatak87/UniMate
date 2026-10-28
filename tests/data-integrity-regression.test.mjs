import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  AI_ACCESS_MODES,
  AI_CAPABILITIES,
  AI_COMPLEXITY_LEVELS,
  AI_CONTRACT_VERSION,
  AI_PROVIDERS,
  AI_SELECTION_MODES,
} from '../shared/ai/contracts.mjs';
import { AI_DEFAULT_MODEL_ID } from '../shared/ai/modelCatalog.mjs';
import { createAIScannerReview } from '../src/services/aiScannerReview.js';
import { ACADEMIC_STORAGE_KEYS } from '../src/services/academicBackup.js';
import { createKHSElement } from '../src/utils/khsDocument.js';
import { SYNTHETIC_DOCUMENT_RESULT } from './fixtures/aiFixtures.mjs';

class SyntheticElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.children = [];
    this.value = '';
  }

  set textContent(value) {
    this.value = String(value);
    this.children = [];
  }

  get textContent() {
    return this.value + this.children.map(child => child.textContent).join('');
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

const syntheticDocument = Object.freeze({
  createElement: tagName => new SyntheticElement(tagName),
});

function createScannerResponse() {
  return {
    schemaVersion: AI_CONTRACT_VERSION,
    requestId: 'd4444444-4444-4444-8444-444444444444',
    capability: AI_CAPABILITIES.DOCUMENT_SCAN,
    success: true,
    meta: {
      provider: AI_PROVIDERS.GEMINI,
      modelId: AI_DEFAULT_MODEL_ID,
      selectionMode: AI_SELECTION_MODES.AUTOMATIC,
      complexity: AI_COMPLEXITY_LEVELS.LIGHT,
      accessMode: AI_ACCESS_MODES.FREE_ONLY,
      fallbackUsed: false,
      fallbackReason: null,
      attemptCount: 1,
    },
    result: structuredClone(SYNTHETIC_DOCUMENT_RESULT),
  };
}

test('KHS dan review AI tidak memutasi snapshot data akademik sintetis', () => {
  const academicData = {
    semesters: [{
      id: 1,
      name: 'Semester Sintetis',
      gpa: '3.80',
      courses: [{ id: 11, name: 'Keamanan Data', sks: 3, grade: 'A' }],
      documents: [{ id: 12, name: 'dokumen-lama.pdf', type: 'file' }],
    }],
    tasks: [{ id: 21, title: 'Tugas Lama', completed: false }],
    projects: [{ id: 31, name: 'Proyek Lama' }],
    thesis: { todo: [], inProgress: [], review: [], done: [] },
  };
  const before = structuredClone(academicData);
  const response = createScannerResponse();
  const responseBefore = structuredClone(response);

  const khs = createKHSElement(academicData.semesters[0], syntheticDocument);
  const pendingReview = createAIScannerReview(response, 'auto');
  const cancelledReview = null;

  assert.match(khs.textContent, /Total SKS: 3/u);
  assert.equal(pendingReview.direction, 'khs');
  assert.equal(cancelledReview, null);
  assert.deepEqual(academicData, before);
  assert.deepEqual(response, responseBefore);
});

test('pembatalan review Scanner tidak memiliki jalur penulisan data akademik', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  const closeStart = source.indexOf('const closeReview =');
  const closeEnd = source.indexOf('\n\n  return (', closeStart);
  const closeSource = source.slice(closeStart, closeEnd);

  assert.equal(closeStart >= 0 && closeEnd > closeStart, true);
  assert.equal(closeSource.includes('setSemesters('), false);
  assert.equal(closeSource.includes('setTasks('), false);
  assert.match(closeSource, /setShowModal\(false\)/u);
  assert.match(source, /onClick=\{closeReview\}/u);
});

test('jalur backup berversi dan Device Sync tidak memasukkan credential AI', async () => {
  const [backupSource, backupServiceSource, syncSource, contextSource] = await Promise.all([
    fs.readFile(new URL('../src/components/DataBackup.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/services/academicBackup.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/DeviceSync.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/context/AppContext.jsx', import.meta.url), 'utf8'),
  ]);
  const combined = `${backupSource}\n${syncSource}\n${contextSource}`;

  for (const key of ['college_semesters', 'college_tasks', 'college_thesis']) {
    assert.equal(ACADEMIC_STORAGE_KEYS.includes(key), true);
  }
  assert.match(backupSource, /createAcademicBackup\(localStorage\)/u);
  assert.match(backupSource, /createAcademicRestorePreview/u);
  assert.equal(backupSource.includes('localStorage.setItem'), false);
  assert.equal(backupServiceSource.includes('.setItem('), false);
  assert.equal(backupServiceSource.includes('.removeItem('), false);
  assert.match(syncSource, /createDeviceSyncPreview\(data, localStorage\)/u);
  assert.equal(syncSource.includes('localStorage.setItem'), false);
  assert.equal(syncSource.includes("type === 'SYNC_DATA'"), false);
  assert.equal(combined.includes('gemini_api_key'), false);
  assert.equal(combined.includes('openai_api_key'), false);
});
