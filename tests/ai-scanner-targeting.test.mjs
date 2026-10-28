import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AIScannerTargetError,
  parseAIScannerDocumentTarget,
  resolveAIScannerDocumentTarget,
  resolveAIScannerSemesterById,
} from '../src/services/aiScannerTargeting.js';

const SEMESTERS = Object.freeze([
  Object.freeze({
    id: 'semester-lama',
    name: 'Semester Lama',
    status: 'past',
    documents: Object.freeze([
      Object.freeze({ type: 'Dokumen KHS', binaryRef: Object.freeze({ id: 'lama' }) }),
    ]),
  }),
  Object.freeze({
    id: 'semester-aktif',
    name: 'Semester Aktif',
    status: 'current',
    documents: Object.freeze([]),
  }),
]);

test('replaceDoc menargetkan semester historis dan indeks yang tepat', () => {
  const before = structuredClone(SEMESTERS);
  const target = parseAIScannerDocumentTarget({
    mode: 'replace',
    semesterId: 'semester-lama',
    docIndex: 0,
    oldType: 'Dokumen KHS',
  });
  const resolved = resolveAIScannerDocumentTarget(SEMESTERS, target);

  assert.equal(resolved.mode, 'replace');
  assert.equal(resolved.semesterIndex, 0);
  assert.equal(resolved.documentIndex, 0);
  assert.equal(resolved.documentType, 'Dokumen KHS');
  assert.deepEqual(SEMESTERS, before);
});

test('target replace yang hilang atau berubah ditolak tanpa fallback ke semester aktif', () => {
  const cases = [
    {
      target: { mode: 'replace', semesterId: 'tidak-ada', docIndex: 0, oldType: 'Dokumen KHS' },
      code: 'target_not_found',
    },
    {
      target: { mode: 'replace', semesterId: 'semester-lama', docIndex: 1, oldType: 'Dokumen KHS' },
      code: 'target_changed',
    },
    {
      target: { mode: 'replace', semesterId: 'semester-lama', docIndex: 0, oldType: 'Dokumen KRS' },
      code: 'target_changed',
    },
  ];

  for (const entry of cases) {
    const target = parseAIScannerDocumentTarget(entry.target);
    assert.throws(
      () => resolveAIScannerDocumentTarget(SEMESTERS, target),
      error => error instanceof AIScannerTargetError && error.code === entry.code,
    );
  }
});

test('target create menerima seluruh slot kosong dan menolak slot yang sudah terisi', () => {
  const slots = [
    ['Dokumen KRS', 'KRS'],
    ['Jadwal Mingguan', 'Jadwal Mingguan'],
    ['Jadwal Ujian', 'KRU UTS'],
    ['Dokumen KHS', 'KHS'],
  ];

  for (const [documentType, occupiedType] of slots) {
    const target = parseAIScannerDocumentTarget({
      mode: 'create',
      semesterId: 'semester-aktif',
      documentType,
    });
    const empty = resolveAIScannerDocumentTarget(SEMESTERS, target);
    assert.equal(empty.mode, 'create');
    assert.equal(empty.semesterIndex, 1);
    assert.equal(empty.documentType, documentType);

    const occupiedSemesters = structuredClone(SEMESTERS);
    occupiedSemesters[1].documents.push({ type: occupiedType, binaryRef: { id: `occupied-${documentType}` } });
    assert.throws(
      () => resolveAIScannerDocumentTarget(occupiedSemesters, target),
      error => error instanceof AIScannerTargetError && error.code === 'target_changed',
    );
  }
});

test('kontrak target dan pencarian semester menolak input ambigu', () => {
  for (const value of [
    null,
    { mode: 'replace', semesterId: 'semester-lama', docIndex: -1, oldType: 'Dokumen KHS' },
    { mode: 'create', semesterId: 'semester-aktif', documentType: 'Dokumen KHS', extra: true },
    { mode: 'unknown', semesterId: 'semester-aktif' },
  ]) {
    assert.throws(
      () => parseAIScannerDocumentTarget(value),
      error => error instanceof AIScannerTargetError && error.code === 'invalid_target',
    );
  }

  assert.equal(resolveAIScannerSemesterById(SEMESTERS, 'semester-lama').semesterIndex, 0);
  assert.throws(
    () => resolveAIScannerSemesterById(SEMESTERS, 'tidak-ada'),
    error => error instanceof AIScannerTargetError && error.code === 'target_not_found',
  );
});
