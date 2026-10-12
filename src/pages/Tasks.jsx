import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Plus, Check, FileText, Trash2, Calendar, BookOpen, Clock, Paperclip, Eye, Users, Target, Download, Edit3, LayoutDashboard, Folder, ChevronRight, CheckSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import MonthlyCalendar from '../components/MonthlyCalendar';

export default function Tasks() {
  const location = useLocation();
  const { tasks, setTasks, semesters } = useAppContext();
  
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'task', 'event', 'file'
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ title: '', deadline: '', type: 'task', course: '' });
  const [viewFile, setViewFile] = useState(null);

  // Get courses from "current" semesters
  const activeCourses = useMemo(() => {
    let courses = [];
    semesters.filter(s => s.status === 'current').forEach(s => {
      courses = [...courses, ...s.courses];
    });
    return courses;
  }, [semesters]);


  const handleDelete = (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    toast.success('Berhasil dihapus!');
  };

  const handleOpenModal = (item = null) => {
    if (item && item.id) {
      setFormData(item);
    } else {
      setFormData({ title: '', deadline: '', type: activeTab, course: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (formData.id) {
      setTasks(prev => prev.map(t => t.id === formData.id ? { ...t, ...formData } : t));
      toast.success('Berhasil diperbarui!');
    } else {
      setTasks(prev => [{ ...formData, id: Date.now(), status: 'todo', done: false }, ...prev]);
      toast.success('Berhasil ditambahkan!');
    }
    setIsModalOpen(false);
  };

  const handleDownload = (item) => {
    if (!item.originalFile) return;
    const a = document.createElement('a');
    a.href = item.originalFile;
    const ext = item.fileType === 'pdf' ? '.pdf' : item.fileType === 'image' ? '.png' : '';
    a.download = (item.title || 'dokumen') + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('taskId', taskId);
    e.currentTarget.classList.add('dragging');
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('dragging');
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, status) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;
    
    setTasks(prev => prev.map(t => {
      if (t.id.toString() === taskId) {
        return { ...t, status: status, done: status === 'done' };
      }
      return t;
    }));
  };

  const kanbanColumns = [
    { id: 'todo', title: 'Belum Mulai' },
    { id: 'in_progress', title: 'Sedang Dikerjakan' },
    { id: 'waiting', title: 'Tunggu Teman' },
    { id: 'done', title: 'Selesai' }
  ];

  const currentItems = useMemo(() => {
    let result = tasks;
    if (activeTab !== 'all') {
      result = tasks.filter(t => t.type === activeTab);
    }
    
    if (activeTab === 'task' && !showDone) {
      result = result.filter(t => !t.done);
    }
    
    // Sort by date (if deadline exists)
    return result.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1; // Done items at bottom
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
  }, [tasks, activeTab, showDone]);

  // UI Helpers
  const formatSafeDate = (dateString, isShort = false) => {
    if (!dateString) return 'Tidak ada jadwal/tanggal';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString; // Return raw string if it's not a standard date format
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: isShort ? 'short' : 'long', year: 'numeric' });
  };

  const renderEmptyState = () => (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
      {activeTab === 'all' && <LayoutDashboard size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />}
      {activeTab === 'task' && <Check size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />}
      {activeTab === 'event' && <Calendar size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />}
      {activeTab === 'file' && <Paperclip size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />}
      <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-main)' }}>Belum ada {activeTab === 'all' ? 'item' : activeTab === 'task' ? 'tugas' : activeTab === 'event' ? 'agenda' : 'file'} di sini</h3>
      <p style={{ fontSize: '0.875rem' }}>Klik tombol Tambah Item di sudut kanan atas untuk mulai mengatur.</p>
    </div>
  );

  return (
    <div>
      <div className="page-header flex-between" style={{ 
        alignItems: 'flex-start',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            width: '48px', height: '48px', flexShrink: 0, 
            background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)', 
            borderRadius: '12px', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            color: 'white', 
            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.2)' 
          }}>
            <CheckSquare size={24} />
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem', lineHeight: 1 }}>Tasks & Files</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>Ruang kerja profesional untuk mengelola tugas, agenda, dan arsip kuliah.</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleOpenModal} style={{ padding: '0.75rem 1.25rem', boxShadow: '0 4px 6px rgba(79, 70, 229, 0.2)' }}>
          <Plus size={18} /> Tambah Item
        </button>
      </div>

      {/* Main App Layout Wrapper */}
      <div style={{ display: 'flex', width: '100%', overflow: 'hidden', minHeight: '600px', height: 'calc(100vh - 180px)', marginBottom: '2rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff' }}>
        
        {/* Navigation Pane (Left) */}
        <div className="file-nav-pane" style={{ width: '220px', minWidth: '220px', background: '#f8fafc', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', padding: '1rem 0' }}>
          <div style={{ padding: '0 1.25rem', marginBottom: '1rem', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Kategori</div>
          
          <div onClick={() => setActiveTab('all')} style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: activeTab === 'all' ? '#e0f2fe' : 'transparent', color: activeTab === 'all' ? 'var(--primary-color)' : '#64748b', borderRight: activeTab === 'all' ? '3px solid var(--primary-color)' : '3px solid transparent', transition: 'background 0.2s' }} onMouseEnter={e => activeTab !== 'all' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeTab !== 'all' && (e.currentTarget.style.background = 'transparent')}>
            <LayoutDashboard size={16} fill={activeTab === 'all' ? 'currentColor' : 'none'} />
            <span style={{ fontSize: '0.85rem', fontWeight: activeTab === 'all' ? 600 : 500 }}>Semua Item</span>
          </div>
          
          <div onClick={() => setActiveTab('task')} style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: activeTab === 'task' ? '#e0f2fe' : 'transparent', color: activeTab === 'task' ? 'var(--primary-color)' : '#64748b', borderRight: activeTab === 'task' ? '3px solid var(--primary-color)' : '3px solid transparent', transition: 'background 0.2s' }} onMouseEnter={e => activeTab !== 'task' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeTab !== 'task' && (e.currentTarget.style.background = 'transparent')}>
            <Check size={16} />
            <span style={{ fontSize: '0.85rem', fontWeight: activeTab === 'task' ? 600 : 500 }}>Tugas Kuliah</span>
          </div>
          
          <div onClick={() => setActiveTab('event')} style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: activeTab === 'event' ? '#e0f2fe' : 'transparent', color: activeTab === 'event' ? 'var(--primary-color)' : '#64748b', borderRight: activeTab === 'event' ? '3px solid var(--primary-color)' : '3px solid transparent', transition: 'background 0.2s' }} onMouseEnter={e => activeTab !== 'event' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeTab !== 'event' && (e.currentTarget.style.background = 'transparent')}>
            <Calendar size={16} fill={activeTab === 'event' ? 'currentColor' : 'none'} />
            <span style={{ fontSize: '0.85rem', fontWeight: activeTab === 'event' ? 600 : 500 }}>Agenda Kalender</span>
          </div>
          
          <div onClick={() => setActiveTab('file')} style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: activeTab === 'file' ? '#e0f2fe' : 'transparent', color: activeTab === 'file' ? 'var(--primary-color)' : '#64748b', borderRight: activeTab === 'file' ? '3px solid var(--primary-color)' : '3px solid transparent', transition: 'background 0.2s' }} onMouseEnter={e => activeTab !== 'file' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeTab !== 'file' && (e.currentTarget.style.background = 'transparent')}>
            <Paperclip size={16} />
            <span style={{ fontSize: '0.85rem', fontWeight: activeTab === 'file' ? 600 : 500 }}>Arsip File</span>
          </div>
        </div>

        {/* Main Content Area (Right) */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          
          {/* Logical Breadcrumb (Address Bar) */}
          <div style={{ padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b' }}>
              <Folder size={14} fill="currentColor" color="currentColor" />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Tasks & Files</span>
            </div>
            
            <ChevronRight size={14} color="#cbd5e1" />
            
            <span style={{ fontSize: '0.85rem', color: 'var(--primary-color)', fontWeight: 600 }}>
              {activeTab === 'all' ? 'Semua Item' : activeTab === 'task' ? 'Tugas Kuliah' : activeTab === 'event' ? 'Agenda Kalender' : 'Arsip File'}
            </span>
          </div>

          {/* Toolbar (Header) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
             <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', margin: 0, fontWeight: 600 }}>
               {activeTab === 'all' ? 'Semua Kumpulan Item' : activeTab === 'task' ? 'Daftar Tugas' : activeTab === 'event' ? 'Jadwal Mendatang' : 'Kumpulan File'}
             </h3>
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {activeTab === 'task' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={showDone} 
                      onChange={e => setShowDone(e.target.checked)} 
                      style={{ accentColor: 'var(--primary-color)' }}
                    />
                    Tampilkan yang selesai
                  </label>
                )}
             </div>
          </div>

          {/* Content Area */}
          <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1, backgroundColor: '#f8fafc' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {activeTab === 'event' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <MonthlyCalendar events={tasks.filter(t => t.type === 'event')} />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h4 style={{ color: 'var(--text-main)', fontSize: '1.1rem', margin: '1rem 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={18} /> Detail Agenda Mendatang
              </h4>
              {currentItems.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>Belum ada agenda bulan ini.</p>
              ) : currentItems.map(item => (
                <div key={item.id} style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                  padding: '1rem', backgroundColor: 'var(--bg-color)', 
                  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <h4 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1rem' }}>{item.title}</h4>
                    <span style={{ 
                      fontSize: '0.75rem', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px',
                      color: item.deadline ? '#d97706' : '#9ca3af', backgroundColor: item.deadline ? '#fef3c7' : '#f3f4f6', padding: '4px 8px', borderRadius: '99px', width: 'fit-content'
                    }}>
                      <Clock size={12} /> 
                      {formatSafeDate(item.deadline)}
                    </span>
                  </div>
                  <button className="btn-icon" onClick={() => handleDelete(item.id)} style={{ color: 'var(--text-muted)' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'task' ? (
          <div className="kanban-board">
            {kanbanColumns.map(col => {
              const colTasks = tasks.filter(t => t.type === 'task' && (t.status === col.id || (col.id === 'todo' && t.done === false && !t.status) || (col.id === 'done' && t.done === true && !t.status)));
              return (
                <div 
                  key={col.id} 
                  className="kanban-column"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  <div className="kanban-column-header">
                    <span>{col.title}</span>
                    <span className="kanban-count">{colTasks.length}</span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: '100px' }}>
                    {colTasks.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                        Tarik tugas ke sini
                      </div>
                    )}
                    {colTasks.map(item => (
                      <div 
                        key={item.id} 
                        className="kanban-card"
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        onDragEnd={handleDragEnd}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-main)', textDecoration: item.status === 'done' ? 'line-through' : 'none', flex: 1, paddingRight: '0.5rem' }}>{item.title}</h4>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {item.originalFile && (
                              <>
                                <button className="btn-icon" onClick={() => setViewFile({title: item.title, url: item.originalFile, type: item.fileType})} style={{ padding: 0, color: 'var(--text-muted)' }} title="Lihat">
                                  <Eye size={14} />
                                </button>
                                <button className="btn-icon" onClick={() => handleDownload(item)} style={{ padding: 0, color: 'var(--text-muted)' }} title="Unduh">
                                  <Download size={14} />
                                </button>
                              </>
                            )}
                            <button className="btn-icon" onClick={() => handleOpenModal(item)} style={{ padding: 0, color: 'var(--text-muted)' }} title="Edit">
                              <Edit3 size={14} />
                            </button>
                            <button className="btn-icon" onClick={() => handleDelete(item.id)} style={{ padding: 0, color: '#ef4444' }} title="Hapus">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {item.course && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#4f46e5', backgroundColor: '#e0e7ff', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.course}
                            </span>
                          )}
                          {item.exam_type && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#e11d48', backgroundColor: '#ffe4e6', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.exam_type}
                            </span>
                          )}
                          {item.task_type && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#059669', backgroundColor: '#d1fae5', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.task_type}
                            </span>
                          )}
                          {item.project_type && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#7c3aed', backgroundColor: '#ede9fe', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.project_type} {item.task_number ? `ke-${item.task_number}` : ''}
                            </span>
                          )}
                          {item.meeting_number && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#2563eb', backgroundColor: '#dbeafe', padding: '2px 6px', borderRadius: '4px' }}>
                              Pertemuan {item.meeting_number}
                            </span>
                          )}
                          {item.semester && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#f59e0b', backgroundColor: '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>
                              Semester {item.semester}
                            </span>
                          )}
                          {item.deadline && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#ea580c', backgroundColor: '#ffedd5', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <Clock size={10} /> {formatSafeDate(item.deadline, true)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : currentItems.length === 0 ? renderEmptyState() : currentItems.map(item => (
          <div key={item.id} style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
            padding: '1.25rem', backgroundColor: 'var(--bg-color)', 
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)', transition: 'transform 0.2s, box-shadow 0.2s',
            opacity: item.done ? 0.6 : 1
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              {(item.type === 'event' || activeTab === 'event') && <div style={{ padding: '0.5rem', backgroundColor: '#eff6ff', color: 'var(--primary-color)', borderRadius: '8px' }}><Calendar size={20} /></div>}
              {(item.type === 'file' || activeTab === 'file') && <div style={{ padding: '0.5rem', backgroundColor: '#f3f4f6', color: 'var(--text-muted)', borderRadius: '8px' }}><FileText size={20} /></div>}
              {item.type === 'task' && activeTab === 'all' && <div style={{ padding: '0.5rem', backgroundColor: '#eef2ff', color: '#4f46e5', borderRadius: '8px' }}><Check size={20} /></div>}
              
              <div style={{ flex: 1 }}>
                <h4 
                  style={{ margin: '0 0 0.5rem 0', color: 'var(--text-main)', fontSize: '1.05rem', textDecoration: item.done ? 'line-through' : 'none', cursor: item.originalFile ? 'pointer' : 'default' }}
                  onClick={() => item.originalFile && setViewFile({title: item.title, url: item.originalFile, type: item.fileType})}
                >
                  {item.title}
                </h4>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {item.course && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#4f46e5', backgroundColor: '#e0e7ff', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <BookOpen size={12} /> {item.course}
                    </span>
                  )}
                  {item.exam_type && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#e11d48', backgroundColor: '#ffe4e6', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <FileText size={12} /> {item.exam_type}
                    </span>
                  )}
                  {item.task_type && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#059669', backgroundColor: '#d1fae5', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Users size={12} /> {item.task_type}
                    </span>
                  )}
                  {item.project_type && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#7c3aed', backgroundColor: '#ede9fe', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Target size={12} /> {item.project_type} {item.task_number ? `ke-${item.task_number}` : ''}
                    </span>
                  )}
                  {item.meeting_number && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#2563eb', backgroundColor: '#dbeafe', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={12} /> Pertemuan {item.meeting_number}
                    </span>
                  )}
                  {item.semester && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#f59e0b', backgroundColor: '#fef3c7', padding: '4px 8px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={12} /> Semester {item.semester}
                    </span>
                  )}
                  
                  {item.deadline && item.type !== 'file' && (
                    <span style={{ 
                      fontSize: '0.75rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px',
                      color: item.type === 'event' ? '#d97706' : '#ea580c',
                      backgroundColor: item.type === 'event' ? '#fef3c7' : '#ffedd5',
                      padding: '4px 8px', borderRadius: '99px'
                    }}>
                      <Clock size={12} /> 
                      {item.type === 'event' ? 'Jadwal:' : 'Deadline:'} {formatSafeDate(item.deadline)}
                    </span>
                  )}
                </div>
                {item.originalFile && (
                  <button 
                    onClick={() => setViewFile({title: item.title, url: item.originalFile, type: item.fileType})} 
                    className="btn btn-outline" 
                    style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem', marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px'}}
                  >
                    <Eye size={14} /> Lihat Dokumen
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {item.originalFile && (
                <button className="btn-icon" onClick={() => handleDownload(item)} style={{ color: 'var(--text-muted)', padding: '0.5rem' }} title="Unduh">
                  <Download size={18} />
                </button>
              )}
              <button className="btn-icon" onClick={() => handleOpenModal(item)} style={{ color: 'var(--text-muted)', padding: '0.5rem' }} title="Edit">
                <Edit3 size={18} />
              </button>
              <button className="btn-icon" onClick={() => handleDelete(item.id)} style={{ color: '#ef4444', padding: '0.5rem' }} title="Hapus">
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={
        formData.type === 'task' ? '📝 Tambah Tugas Baru' : 
        formData.type === 'event' ? '🗓️ Tambah Agenda / Acara' : '📁 Tambah Arsip / Link'
      }>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Jenis Item</label>
            <select className="form-input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} style={{ backgroundColor: 'var(--bg-color)' }}>
              <option value="task">Tugas Pribadi (To-Do)</option>
              <option value="event">Acara Kalender (Ujian/Libur)</option>
              <option value="file">File / Materi / Link</option>
            </select>
          </div>
          <div className="form-group">
            <label>Judul {formData.type === 'task' ? 'Tugas' : formData.type === 'event' ? 'Acara' : 'File'}</label>
            <input type="text" required className="form-input" placeholder="Ketik judul di sini..." value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} autoFocus />
          </div>
          
          <div className="form-group">
            <label>Tautkan ke Mata Kuliah (Opsional)</label>
            <select className="form-input" value={formData.course} onChange={e => setFormData({...formData, course: e.target.value})}>
              <option value="">-- Tidak ditautkan --</option>
              {activeCourses.map((c, idx) => <option key={idx} value={c}>{c}</option>)}
            </select>
          </div>

          {(formData.type === 'task' || formData.type === 'event') && (
            <div className="form-group">
              <label>{formData.type === 'event' ? 'Tanggal Acara' : 'Tenggat Waktu (Deadline)'}</label>
              <input type="date" className="form-input" value={formData.deadline} onChange={e => setFormData({...formData, deadline: e.target.value})} />
            </div>
          )}
          
          <div className="form-actions" style={{ marginTop: '2rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Batal</button>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem 2rem' }}>Simpan {formData.type === 'task' ? 'Tugas' : formData.type === 'event' ? 'Acara' : 'File'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!viewFile} onClose={() => setViewFile(null)} title={viewFile?.title || 'Dokumen'}>
        <div style={{ width: '100%', height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', borderRadius: '8px', overflow: 'hidden' }}>
           {viewFile?.type === 'pdf' ? (
              <iframe src={viewFile.url} width="100%" height="100%" style={{border: 'none'}} title="PDF Viewer" />
           ) : viewFile?.type === 'image' ? (
              <img src={viewFile.url} style={{maxWidth: '100%', maxHeight: '100%', objectFit: 'contain'}} alt="Pratinjau Dokumen" />
           ) : (
              <div style={{textAlign: 'center', color: 'var(--text-muted)'}}>
                <FileText size={48} style={{margin: '0 auto 1rem'}} />
                <p>Pratinjau visual tidak tersedia untuk format file ini.</p>
              </div>
           )}
        </div>
        <div className="form-actions" style={{ marginTop: '1.5rem' }}>
          <button className="btn btn-primary" onClick={() => setViewFile(null)}>Tutup</button>
        </div>
      </Modal>
    </div>
  );
}
