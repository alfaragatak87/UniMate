import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  AIScannerMergeError,
  applyCourseMergePlan,
  createCourseMergePlan,
} from '../src/services/aiScannerMerge.js';

const EXISTING = Object.freeze([
  Object.freeze({ id: 'old-1', name: 'Keamanan Data', sks: 3, grade: 'A', room: '' }),
  Object.freeze({ id: 'old-2', name: 'Sistem Operasi', sks: 4, grade: 'A-' }),
]);

test('merge menambah mata kuliah tanpa menghapus data lama', () => {
  const before = structuredClone(EXISTING);
  const plan = createCourseMergePlan(EXISTING, [
    { name: 'Jaringan Komputer', sks: 3, grade: 'B+', day: 'Senin' },
  ], { idFactory: index => `new-${index}` });
  const merged = applyCourseMergePlan(plan);

  assert.equal(plan.summary.additions, 1);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.slice(0, 2), before);
  assert.equal(merged[2].sks, 3);
  assert.equal(merged[2].grade, 'B+');
  assert.deepEqual(EXISTING, before);
});

test('field kosong boleh dilengkapi tetapi SKS dan nilai lama tetap dipertahankan', () => {
  const plan = createCourseMergePlan(EXISTING, [
    { name: 'Keamanan Data', sks: null, grade: null, room: 'R-101' },
  ]);
  const merged = applyCourseMergePlan(plan);

  assert.equal(plan.summary.updates, 1);
  assert.equal(plan.requiresReplacementConfirmation, false);
  assert.equal(merged[0].sks, 3);
  assert.equal(merged[0].grade, 'A');
  assert.equal(merged[0].room, 'R-101');
});

test('replacement field akademik ditolak sampai ada persetujuan eksplisit', () => {
  const plan = createCourseMergePlan(EXISTING, [
    { name: 'Keamanan Data', sks: 2, grade: 'B', room: 'R-202' },
  ]);

  assert.equal(plan.summary.replacements, 1);
  assert.deepEqual([...plan.operations[0].replacements].sort(), ['grade', 'sks']);
  assert.throws(
    () => applyCourseMergePlan(plan),
    error => error instanceof AIScannerMergeError && error.code === 'confirmation_required',
  );
  const merged = applyCourseMergePlan(plan, { allowReplacements: true });
  assert.equal(merged[0].sks, 2);
  assert.equal(merged[0].grade, 'B');
  assert.equal(merged[1].grade, 'A-');
});

test('nama duplikat menjadi konflik dan data lama tidak disentuh', () => {
  const plan = createCourseMergePlan(EXISTING, [
    { name: 'Keamanan Data', sks: 3 },
    { name: ' keamanan   data ', sks: 2 },
  ]);
  const merged = applyCourseMergePlan(plan);

  assert.equal(plan.summary.conflicts, 2);
  assert.deepEqual(merged, EXISTING);
});

test('UI Scanner menampilkan diff dan tidak lagi mengganti seluruh daftar mata kuliah', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  assert.match(source, /createCourseMergePlan/u);
  assert.match(source, /requiresReplacementConfirmation/u);
  assert.match(source, /Izinkan penggantian field/u);
  assert.equal(source.includes('courses: extractedCourses.length > 0 ? extractedCourses : currentSem.courses'), false);
});
