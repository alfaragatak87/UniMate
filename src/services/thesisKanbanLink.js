/**
 * thesisKanbanLink.js — Konversi Catatan Revisi ke Tugas Kanban Skripsi (B8C)
 *
 * Kebijakan & Prinsip:
 * 1. Konversi Manual Eksplisit: Dilarang mengonversi seluruh catatan secara otomatis.
 * 2. Tanpa Efek Samping Merusak: Catatan revisi sumber TIDAK dihapus atau diubah.
 * 3. Anti-Duplikasi: Memeriksa apakah catatan sudah pernah dikonversi ke salah satu kolom Kanban.
 * 4. Tanpa Sinkronisasi Liar: Perubahan status revisi TIDAK otomatis menggeser kartu Kanban.
 * 5. Integritas Papan Kanban: Format task mematuhi skema Kanban yang divalidasi oleh isValidThesisBoard.
 */

export const KANBAN_COLUMNS = Object.freeze([
  { id: 'todo', title: 'To Do', color: 'text-main' },
  { id: 'inProgress', title: 'In Progress', color: 'primary-color' },
  { id: 'review', title: 'Review Dosen', color: 'warning' },
  { id: 'done', title: 'Done', color: 'success' },
]);

export class ThesisKanbanLinkError extends Error {
  constructor(code, message = '') {
    super(message || `Konversi tugas Kanban gagal (${code}).`);
    this.name = 'ThesisKanbanLinkError';
    this.code = code;
  }
}

/**
 * Memeriksa apakah sebuah catatan revisi sudah pernah dikonversi ke salah satu kartu pada papan Kanban
 */
export function isNoteAlreadyInKanban(board, noteId) {
  if (!board || typeof board !== 'object' || !noteId) {
    return { exists: false, columnId: null, task: null };
  }

  const columns = ['todo', 'inProgress', 'review', 'done'];
  for (const colId of columns) {
    const list = Array.isArray(board[colId]) ? board[colId] : [];
    const found = list.find(t => t.sourceNoteId === noteId);
    if (found) {
      return { exists: true, columnId: colId, task: found };
    }
  }

  return { exists: false, columnId: null, task: null };
}

/**
 * Memformat dan mentransformasi catatan revisi menjadi kartu task Kanban baru
 */
export function formatKanbanTaskFromNote({
  note,
  targetColumn = 'todo',
  includeChecklist = true,
  customTitle = null,
  customDesc = null,
}) {
  if (!note || typeof note !== 'object' || !note.id) {
    throw new ThesisKanbanLinkError('invalid_note', 'Catatan revisi tidak valid');
  }

  const validColumn = ['todo', 'inProgress', 'review', 'done'].includes(targetColumn)
    ? targetColumn
    : 'todo';

  const title = (customTitle && String(customTitle).trim()) || note.title || 'Tugas Revisi Skripsi';

  let desc = customDesc !== null ? String(customDesc) : '';
  if (customDesc === null) {
    const descParts = [];
    if (note.sectionTitle) {
      descParts.push(`[${note.sectionTitle}]`);
    }
    if (note.content) {
      descParts.push(note.content);
    }
    if (note.supervisorNote) {
      descParts.push(`Catatan Dosen: ${note.supervisorNote}`);
    }
    if (includeChecklist && Array.isArray(note.checklist) && note.checklist.length > 0) {
      const chkLines = note.checklist.map(c => `${c.done ? '✓' : '○'} ${c.text}`);
      descParts.push(`Checklist:\n${chkLines.join('\n')}`);
    }
    desc = descParts.join('\n\n');
  }

  const now = Date.now();
  const taskId = `t_rev_${now}_${Math.random().toString(36).slice(2, 6)}`;

  const newTask = {
    id: taskId,
    title: title.trim(),
    desc: desc.trim(),
    sourceNoteId: note.id,
    sourceDocumentId: note.documentId || null,
    createdAt: now,
  };

  return {
    newTask: Object.freeze(newTask),
    targetColumn: validColumn,
  };
}

/**
 * Menambahkan task ke salinan papan Kanban secara murni (tanpa memutasi board lama)
 */
export function commitTaskToBoard(board, { newTask, targetColumn }) {
  if (!board || typeof board !== 'object') {
    throw new ThesisKanbanLinkError('invalid_board', 'Papan Kanban tidak valid');
  }
  if (!newTask || !newTask.id || !newTask.title) {
    throw new ThesisKanbanLinkError('invalid_task', 'Kartu tugas tidak valid');
  }

  const validColumn = ['todo', 'inProgress', 'review', 'done'].includes(targetColumn)
    ? targetColumn
    : 'todo';

  const newBoard = {
    todo: Array.isArray(board.todo) ? [...board.todo] : [],
    inProgress: Array.isArray(board.inProgress) ? [...board.inProgress] : [],
    review: Array.isArray(board.review) ? [...board.review] : [],
    done: Array.isArray(board.done) ? [...board.done] : [],
  };

  // Tambahkan task baru di bagian paling atas kolom tujuan
  newBoard[validColumn] = [newTask, ...newBoard[validColumn]];

  return {
    board: Object.freeze(newBoard),
    addedTask: newTask,
    targetColumn: validColumn,
  };
}
