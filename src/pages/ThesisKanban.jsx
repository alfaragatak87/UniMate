import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Plus, Trash2, GraduationCap } from 'lucide-react';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

// --- Komponen DND Helper ---
function DroppableColumn({ id, title, count, color, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`kanban-column ${isOver ? 'is-over' : ''}`}>
      <div className="kanban-header">
        <span style={{ color: `var(--${color})` }}>{title}</span>
        <span className="kanban-badge">{count}</span>
      </div>
      <div className="kanban-cards">
        {children}
      </div>
    </div>
  );
}

function DraggableCard({ task, color, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 100,
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`kanban-card ${isDragging ? 'is-dragging' : ''}`} 
      {...listeners} 
      {...attributes}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', borderLeft: `3px solid var(--${color})`, paddingLeft: '0.5rem' }}>
        <div>
          <h5 style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-main)' }}>{task.title}</h5>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{task.desc}</p>
        </div>
        <button 
          onPointerDown={(e) => e.stopPropagation()} // prevent drag when clicking delete
          onClick={() => onDelete(task.id)} 
          className="btn-icon btn-icon-danger" 
          style={{ padding: 0 }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
// ----------------------------

const initialKanban = {
  todo: [{ id: 't1', title: 'Bab 1: Pendahuluan', desc: 'Mencari latar belakang masalah.' }],
  inProgress: [{ id: 't2', title: 'Studi Literatur', desc: 'Membaca 5 jurnal rujukan utama.' }],
  review: [],
  done: []
};

const COLUMNS = [
  { id: 'todo', title: 'To Do', color: 'text-main' },
  { id: 'inProgress', title: 'In Progress', color: 'primary-color' },
  { id: 'review', title: 'Review Dosen', color: 'warning' },
  { id: 'done', title: 'Done', color: 'success' },
];

export default function ThesisKanban() {
  const { thesis: board, setThesis: setBoard } = useAppContext();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', desc: '', status: 'todo' });

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;

    const sourceId = active.id;
    const destColId = over.id; // column id
    
    // Find source column
    let sourceColId = null;
    let taskToMove = null;
    for (const col of COLUMNS) {
      const task = board[col.id].find(t => t.id === sourceId);
      if (task) {
        sourceColId = col.id;
        taskToMove = task;
        break;
      }
    }

    if (sourceColId && destColId && sourceColId !== destColId) {
      setBoard(prev => {
        const newBoard = { ...prev };
        newBoard[sourceColId] = newBoard[sourceColId].filter(t => t.id !== sourceId);
        newBoard[destColId] = [taskToMove, ...newBoard[destColId]];
        return newBoard;
      });
      toast.success(`Dipindahkan ke ${COLUMNS.find(c => c.id === destColId).title}`);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    const newTask = { id: `t_${Date.now()}`, title: formData.title, desc: formData.desc };
    setBoard(prev => ({ ...prev, [formData.status]: [newTask, ...prev[formData.status]] }));
    setIsModalOpen(false);
    setFormData({ title: '', desc: '', status: 'todo' });
    toast.success('Task Skripsi ditambahkan!');
  };

  const handleDelete = (taskId) => {
    if (window.confirm('Hapus task ini?')) {
      setBoard(prev => {
        const newBoard = { ...prev };
        for (const col of COLUMNS) {
          newBoard[col.id] = newBoard[col.id].filter(t => t.id !== taskId);
        }
        return newBoard;
      });
      toast.success('Dihapus!');
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header flex-between" style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '48px', height: '48px',
            background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.2)'
          }}>
            <GraduationCap size={24} />
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem', lineHeight: 1 }}>Thesis Tracker</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>Tarik dan lepas (Drag & Drop) kartu skripsi Anda.</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Tambah Task
        </button>
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {COLUMNS.map(col => (
            <DroppableColumn key={col.id} id={col.id} title={col.title} color={col.color} count={board[col.id]?.length || 0}>
              {board[col.id]?.map(task => (
                <DraggableCard key={task.id} task={task} color={col.color} onDelete={handleDelete} />
              ))}
            </DroppableColumn>
          ))}
        </div>
      </DndContext>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Tambah Task Skripsi">
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Judul</label>
            <input type="text" required className="form-input" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Deskripsi Singkat</label>
            <input type="text" className="form-input" value={formData.desc} onChange={e => setFormData({...formData, desc: e.target.value})} />
          </div>
          <div className="form-group">
            <label>Masukan ke Kolom</label>
            <select className="form-input" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
              {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Batal</button>
            <button type="submit" className="btn btn-primary">Simpan</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
