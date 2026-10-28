import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNoteAlreadyInKanban,
  formatKanbanTaskFromNote,
  commitTaskToBoard,
} from '../src/services/thesisKanbanLink.js';
import { isValidThesisBoard } from '../src/services/storageSafety.js';

test('B8C.1: formatKanbanTaskFromNote membentuk kartu Kanban lengkap dengan checklist dan referensi', () => {
  const note = {
    id: 'note_123',
    documentId: 'doc_thesis_1',
    title: 'Perbaiki Landasan Teori',
    content: 'Jelaskan konsep arsitektur offline-first.',
    sectionTitle: '2.1 Landasan Teori',
    supervisorNote: 'Bandingkan dengan arsitektur cloud.',
    checklist: [
      { text: 'Kutip buku Fowler', done: true },
      { text: 'Jelaskan Service Worker', done: false },
    ],
  };

  const { newTask, targetColumn } = formatKanbanTaskFromNote({
    note,
    targetColumn: 'inProgress',
    includeChecklist: true,
  });

  assert.equal(newTask.title, 'Perbaiki Landasan Teori');
  assert.equal(newTask.sourceNoteId, 'note_123');
  assert.equal(newTask.sourceDocumentId, 'doc_thesis_1');
  assert.equal(targetColumn, 'inProgress');
  assert.ok(newTask.desc.includes('[2.1 Landasan Teori]'));
  assert.ok(newTask.desc.includes('Catatan Dosen: Bandingkan dengan arsitektur cloud.'));
  assert.ok(newTask.desc.includes('✓ Kutip buku Fowler'));
  assert.ok(newTask.desc.includes('○ Jelaskan Service Worker'));
});

test('B8C.2: isNoteAlreadyInKanban mendeteksi catatan yang sudah pernah dikonversi', () => {
  const board = {
    todo: [{ id: 't1', title: 'Task 1', sourceNoteId: 'note_existing_99' }],
    inProgress: [],
    review: [],
    done: [],
  };

  const checkFound = isNoteAlreadyInKanban(board, 'note_existing_99');
  assert.equal(checkFound.exists, true);
  assert.equal(checkFound.columnId, 'todo');

  const checkNotFound = isNoteAlreadyInKanban(board, 'note_unknown');
  assert.equal(checkNotFound.exists, false);
  assert.equal(checkNotFound.columnId, null);
});

test('B8C.3: commitTaskToBoard menambahkan task secara murni dan mematuhi isValidThesisBoard', () => {
  const initialBoard = {
    todo: [{ id: 't1', title: 'Task 1' }],
    inProgress: [],
    review: [],
    done: [],
  };

  const newTask = {
    id: 't_new_1',
    title: 'Task Baru dari Revisi',
    desc: 'Deskripsi',
    sourceNoteId: 'note_1',
  };

  const { board: updatedBoard, targetColumn } = commitTaskToBoard(initialBoard, {
    newTask,
    targetColumn: 'review',
  });

  assert.equal(targetColumn, 'review');
  assert.equal(updatedBoard.review.length, 1);
  assert.equal(updatedBoard.review[0].id, 't_new_1');

  // Pastikan board lama tidak termutasi
  assert.equal(initialBoard.review.length, 0);

  // Pastikan mematuhi skema Kanban yang divalidasi sistem
  assert.equal(isValidThesisBoard(updatedBoard), true);
});

test('B8C.4: Penanganan input tidak valid fail-closed', () => {
  assert.throws(
    () => formatKanbanTaskFromNote({ note: null }),
    { code: 'invalid_note' }
  );

  assert.throws(
    () => commitTaskToBoard(null, { newTask: { id: '1', title: 't' }, targetColumn: 'todo' }),
    { code: 'invalid_board' }
  );
});
