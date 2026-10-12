import { useState, useEffect } from 'react';
import Modal from './Modal';
import { Clock, Calendar, MapPin, User, FileText, Upload, Trash2, Folder, ChevronRight, HardDrive, Search, Monitor, Plus, Users, Star, FileSpreadsheet, Presentation, FileCode, Image as ImageIcon, File, Menu, Minus, Maximize, RotateCw, Edit2, Undo, Redo, Download, Printer, MoreVertical, Copy, MoveRight, Link, Info, Lock, FolderUp } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CourseVaultModal({ isOpen, onClose, course, semesterName, onSave }) {
  const [formData, setFormData] = useState({
    name: '',
    day: 'Senin',
    timeStart: '08:00',
    timeEnd: '10:00',
    room: '',
    lecturer: '',
    files: []
  });

  const [activeNav, setActiveNav] = useState('course');
  const [currentFolder, setCurrentFolder] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [activeSubMenu, setActiveSubMenu] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);

  useEffect(() => {
    if (previewFile && previewFile.fileObject) {
      const ext = previewFile.name.split('.').pop().toLowerCase();
      if (['txt', 'js', 'jsx', 'html', 'css', 'py', 'java', 'cpp', 'json', 'md', 'csv'].includes(ext)) {
        const reader = new FileReader();
        reader.onload = (e) => setTextContent(e.target.result);
        reader.readAsText(previewFile.fileObject);
      } else {
        setTextContent('');
      }
    } else {
      setTextContent('');
    }
  }, [previewFile]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    if (course) {
      if (typeof course === 'string') {
        setFormData({ name: course, day: 'Senin', timeStart: '08:00', timeEnd: '10:00', room: '', lecturer: '', files: [] });
      } else {
        setFormData({
          name: course.name || '',
          day: course.day || 'Senin',
          timeStart: course.timeStart || '08:00',
          timeEnd: course.timeEnd || '10:00',
          room: course.room || '',
          lecturer: course.lecturer || '',
          files: course.files || []
        });
      }
    }
  }, [course]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleSave = (e) => {
    e.preventDefault();
    onSave({
      id: typeof course === 'object' && course.id ? course.id : Date.now().toString(),
      ...formData
    });
  };

  const addDummyFile = () => {
    if (!newFileName.trim()) return;
    const newFile = { id: Date.now(), name: newFileName + '.pdf', date: new Date().toLocaleDateString(), timestamp: Date.now(), starred: false, deleted: false, folderId: currentFolder ? currentFolder.id : undefined };
    setFormData(prev => ({ ...prev, files: [...prev.files, newFile] }));
    setNewFileName('');
    toast.success('File berhasil ditambahkan ke Vault');
  };

  const removeFile = (fileId) => {
    setFormData(prev => ({ ...prev, files: prev.files.map(f => f.id === fileId ? { ...f, deleted: true } : f) }));
    toast.success('File dipindahkan ke tempat sampah');
  };

  const restoreFile = (fileId) => {
    setFormData(prev => ({ ...prev, files: prev.files.map(f => f.id === fileId ? { ...f, deleted: false } : f) }));
    toast.success('File berhasil dipulihkan');
  };

  const permanentlyDeleteFile = (fileId) => {
    setFormData(prev => ({ ...prev, files: prev.files.filter(f => f.id !== fileId) }));
  };

  const toggleStarFile = (fileId) => {
    setFormData(prev => ({ ...prev, files: prev.files.map(f => f.id === fileId ? { ...f, starred: !f.starred } : f) }));
  };

  let filteredFiles = formData.files || [];
  if (activeNav === 'course') {
    filteredFiles = filteredFiles.filter(f => !f.deleted && f.folderId === (currentFolder ? currentFolder.id : undefined));
  } else if (activeNav === 'recent') {
    filteredFiles = filteredFiles.filter(f => !f.deleted).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  } else if (activeNav === 'starred') {
    filteredFiles = filteredFiles.filter(f => !f.deleted && f.starred);
  } else if (activeNav === 'trash') {
    filteredFiles = filteredFiles.filter(f => f.deleted);
  }

  const getNavStyle = (tabId) => ({
    padding: '0.6rem 1.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    cursor: 'pointer',
    background: activeNav === tabId ? '#e0f2fe' : 'transparent',
    color: activeNav === tabId ? 'var(--primary-color)' : '#64748b',
    borderRight: activeNav === tabId ? '3px solid var(--primary-color)' : '3px solid transparent',
    transition: 'background 0.2s'
  });

  const renderPreviewContent = (file) => {
    if (!file) return null;
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'pdf') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
          
          {/* PDF Toolbar */}
          <div style={{ background: '#323639', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#f1f1f1', borderBottom: '1px solid #1a1a1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Menu size={18} style={{ cursor: 'pointer', opacity: 0.8 }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500, maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.8rem' }}>
              <span style={{ background: '#1a1a1a', padding: '2px 8px', borderRadius: '4px' }}>1 / 1</span>
              <div style={{ width: '1px', height: '16px', background: '#555' }}></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Minus size={16} style={{ cursor: 'pointer', opacity: 0.8 }} />
                <span>91%</span>
                <Plus size={16} style={{ cursor: 'pointer', opacity: 0.8 }} />
              </div>
              <div style={{ width: '1px', height: '16px', background: '#555' }}></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Maximize size={16} style={{ cursor: 'pointer', opacity: 0.8 }} />
                <RotateCw size={16} style={{ cursor: 'pointer', opacity: 0.8 }} />
                <Edit2 size={16} style={{ cursor: 'pointer', opacity: 0.8 }} />
                <Undo size={16} style={{ cursor: 'pointer', opacity: 0.4 }} />
                <Redo size={16} style={{ cursor: 'pointer', opacity: 0.4 }} />
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Download size={18} style={{ cursor: 'pointer', opacity: 0.9 }} />
              <Printer size={18} style={{ cursor: 'pointer', opacity: 0.9 }} />
              <MoreVertical size={18} style={{ cursor: 'pointer', opacity: 0.9 }} />
            </div>
          </div>

          {/* PDF Viewer Area */}
          <div style={{ background: '#525659', flex: 1, display: 'flex', justifyContent: 'center', overflowY: 'auto' }}>
            {file.url ? (
              <iframe src={file.url + "#toolbar=0"} style={{ width: '100%', height: '100%', border: 'none', minHeight: '800px' }} title={file.name} />
            ) : (
              <div style={{ background: '#fff', width: '100%', maxWidth: '800px', minHeight: '900px', padding: '4rem 5rem', display: 'flex', flexDirection: 'column', color: '#000', fontFamily: '"Times New Roman", Times, serif', margin: '2rem 0' }}>
                <h1 style={{ textAlign: 'center', fontSize: '1.8rem', fontWeight: 'bold', marginBottom: '2rem' }}>{file.name.replace('.pdf', '')}</h1>
                <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1rem', textIndent: '2rem' }}>
                  Ini adalah simulasi isi dokumen PDF. Pada aplikasi sesungguhnya, konten file <strong>{file.name}</strong> akan dirender secara langsung menggunakan library PDF viewer (seperti PDF.js) di dalam area ini.
                </p>
                <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1rem', textIndent: '2rem' }}>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam in dui mauris. Vivamus hendrerit arcu sed erat molestie vehicula. Sed auctor neque eu tellus rhoncus ut eleifend nibh porttitor. Ut in nulla enim. Phasellus molestie magna non est bibendum non venenatis nisl tempor.
                </p>
                <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1rem', textIndent: '2rem' }}>
                  Suspendisse dictum feugiat nisl ut dapibus. Mauris iaculis porttitor posuere. Praesent id metus massa, ut blandit odio. Proin quis tortor orci. Etiam at risus et justo dignissim congue. Donec congue lacinia dui, a porttitor lectus condimentum laoreet. Nunc eu ullamcorper orci. Quisque eget odio ac lectus vestibulum faucibus eget in metus.
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }
    
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      return (
        <div style={{ background: '#fff', width: '100%', height: '500px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', borderRadius: '8px', overflow: 'hidden' }}>
           <div style={{ background: '#16a34a', padding: '0.75rem 1rem', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
             <FileSpreadsheet size={18} /> {file.name}
           </div>
           <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
             <table style={{ width: '100%', borderCollapse: 'collapse' }}>
               <thead>
                 <tr>
                   {['A', 'B', 'C', 'D', 'E', 'F'].map(c => <th key={c} style={{ border: '1px solid #cbd5e1', background: '#f8fafc', padding: '0.5rem', textAlign: 'center', color: '#64748b' }}>{c}</th>)}
                 </tr>
               </thead>
               <tbody>
                 {[1,2,3,4,5,6,7,8,9,10].map(r => (
                   <tr key={r}>
                     {[1,2,3,4,5,6].map(c => <td key={c} style={{ border: '1px solid #cbd5e1', padding: '0.5rem', color: '#334155', fontSize: '0.85rem' }}>Data {r}-{c}</td>)}
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      );
    }
    
    if (ext === 'pptx' || ext === 'ppt') {
      return (
        <div style={{ background: '#f1f5f9', width: '100%', height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', borderRadius: '8px' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '700px', aspectRatio: '16/9', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', padding: '3rem', borderLeft: '8px solid #ea580c' }}>
             <h1 style={{ color: '#ea580c', fontSize: '2.5rem', marginBottom: '1.5rem', marginTop: 'auto', lineHeight: '1.2' }}>{file.name.replace(`.${ext}`, '')}</h1>
             <p style={{ color: '#64748b', fontSize: '1.25rem', marginBottom: 'auto' }}>Materi Presentasi Kuliah</p>
          </div>
        </div>
      );
    }
    
    if (['js', 'jsx', 'html', 'css', 'py', 'java', 'cpp', 'json', 'md', 'txt'].includes(ext)) {
      return (
        <div style={{ background: '#1e293b', width: '100%', height: '500px', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
           <div style={{ background: '#0f172a', padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
             <FileCode size={16} /> {file.name}
           </div>
           <div style={{ padding: '1.5rem', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.9rem', lineHeight: '1.5', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
             {file.url ? (textContent || 'Memuat isi file...') : (
               <>
                 <span style={{ color: '#c678dd' }}>import</span> <span style={{ color: '#e5c07b' }}>React</span> <span style={{ color: '#c678dd' }}>from</span> <span style={{ color: '#98c379' }}>'react'</span>;<br/><br/>
                 <span style={{ color: '#c678dd' }}>export default function</span> <span style={{ color: '#61afef' }}>App</span>() {'{'}<br/>
                 &nbsp;&nbsp;<span style={{ color: '#c678dd' }}>return</span> (<br/>
                 &nbsp;&nbsp;&nbsp;&nbsp;&lt;<span style={{ color: '#e06c75' }}>div</span>&gt;<br/>
                 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span style={{ color: '#e06c75' }}>h1</span>&gt;Hello World!&lt;/<span style={{ color: '#e06c75' }}>h1</span>&gt;<br/>
                 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span style={{ color: '#e06c75' }}>p</span>&gt;Simulasi kode untuk {file.name}&lt;/<span style={{ color: '#e06c75' }}>p</span>&gt;<br/>
                 &nbsp;&nbsp;&nbsp;&nbsp;&lt;/<span style={{ color: '#e06c75' }}>div</span>&gt;<br/>
                 &nbsp;&nbsp;);<br/>
                 {'}'}
               </>
             )}
           </div>
        </div>
      );
    }
    
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
      return (
        <div style={{ background: '#f8fafc', width: '100%', height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px', borderRadius: '8px', overflow: 'hidden' }}>
          {file.url ? (
            <img src={file.url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ background: '#fff', padding: '1rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderRadius: '8px' }}>
              <div style={{ width: '400px', height: '300px', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', borderRadius: '4px' }}>
                <ImageIcon size={64} />
              </div>
              <p style={{ textAlign: 'center', margin: '1rem 0 0 0', fontWeight: 600, color: '#334155' }}>{file.name}</p>
            </div>
          )}
        </div>
      );
    }
    
    return (
      <div style={{ background: '#fff', width: '100%', height: '500px', display: 'flex', flexDirection: 'column', padding: '3rem 4rem', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <h1 style={{ color: '#334155', marginBottom: '2rem' }}>{file.name}</h1>
        <p style={{ color: '#475569', lineHeight: '1.8', marginBottom: '1rem' }}>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
        <p style={{ color: '#475569', lineHeight: '1.8', marginBottom: '1rem' }}>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
        <p style={{ color: '#475569', lineHeight: '1.8' }}>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</p>
      </div>
    );
  };

  if (!course) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Arsip & Detail Matkul`} width="1100px">
      <form onSubmit={handleSave}>
        
        {/* Info Mata Kuliah */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-color)', borderRadius: '12px' }}>
          <div className="form-group">
            <label>Nama Mata Kuliah</label>
            <input type="text" className="form-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
          </div>
          <div className="form-group">
            <label><Calendar size={14} style={{display:'inline', marginRight:'4px'}}/> Hari</label>
            <select className="form-input" value={formData.day} onChange={e => setFormData({...formData, day: e.target.value})}>
              {['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label><Clock size={14} style={{display:'inline', marginRight:'4px'}}/> Jam</label>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input type="time" className="form-input" value={formData.timeStart} onChange={e => setFormData({...formData, timeStart: e.target.value})} style={{ padding: '0.4rem' }} />
              <span>-</span>
              <input type="time" className="form-input" value={formData.timeEnd} onChange={e => setFormData({...formData, timeEnd: e.target.value})} style={{ padding: '0.4rem' }} />
            </div>
          </div>
          <div className="form-group">
            <label><MapPin size={14} style={{display:'inline', marginRight:'4px'}}/> Ruang</label>
            <input type="text" className="form-input" placeholder="Gedung/Ruang" value={formData.room} onChange={e => setFormData({...formData, room: e.target.value})} />
          </div>
          <div className="form-group">
            <label><User size={14} style={{display:'inline', marginRight:'4px'}}/> Dosen</label>
            <input type="text" className="form-input" placeholder="Nama Dosen" value={formData.lecturer} onChange={e => setFormData({...formData, lecturer: e.target.value})} />
          </div>
        </div>

        {/* File Explorer UI */}
        <div style={{ display: 'flex', width: '100%', overflow: 'hidden', marginBottom: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff' }}>
          
          {/* Navigation Pane */}
          <div className="file-nav-pane" style={{ width: '220px', minWidth: '220px', background: '#f8fafc', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', padding: '1rem 0' }}>
            <div style={{ padding: '0 1.25rem', marginBottom: '1rem', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Navigasi</div>
            
            <div onClick={() => setActiveNav('course')} style={getNavStyle('course')} onMouseEnter={e => activeNav !== 'course' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeNav !== 'course' && (e.currentTarget.style.background = 'transparent')}>
              <Folder size={16} fill="currentColor" color="currentColor" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{formData.name || 'Mata Kuliah'}</span>
            </div>

            <div onClick={() => setActiveNav('recent')} style={getNavStyle('recent')} onMouseEnter={e => activeNav !== 'recent' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeNav !== 'recent' && (e.currentTarget.style.background = 'transparent')}>
              <Clock size={16} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Terbaru</span>
            </div>
            <div onClick={() => setActiveNav('starred')} style={getNavStyle('starred')} onMouseEnter={e => activeNav !== 'starred' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeNav !== 'starred' && (e.currentTarget.style.background = 'transparent')}>
              <Star size={16} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Berbintang</span>
            </div>
            <div onClick={() => setActiveNav('trash')} style={getNavStyle('trash')} onMouseEnter={e => activeNav !== 'trash' && (e.currentTarget.style.background = '#f1f5f9')} onMouseLeave={e => activeNav !== 'trash' && (e.currentTarget.style.background = 'transparent')}>
              <Trash2 size={16} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Sampah</span>
            </div>
          </div>

          {/* Main Content Area */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          
          {/* Logical Breadcrumb */}
          <div style={{ padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            <div 
              onClick={() => setCurrentFolder(null)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: currentFolder ? '#64748b' : 'var(--primary-color)', transition: 'color 0.2s', fontWeight: currentFolder ? 500 : 600 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--primary-color)'}
              onMouseLeave={e => e.currentTarget.style.color = currentFolder ? '#64748b' : 'var(--primary-color)'}
              title={currentFolder ? "Kembali ke Utama" : "Sedang di Utama"}
            >
              <Folder size={14} color="currentColor" />
              <span style={{ fontSize: '0.85rem' }}>{formData.name || 'Mata Kuliah'}</span>
            </div>
            
            {currentFolder && (
              <>
                <ChevronRight size={14} color="#cbd5e1" />
                <span style={{ fontSize: '0.85rem', color: 'var(--primary-color)', fontWeight: 600 }}>{currentFolder.name}</span>
              </>
            )}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.75rem 1rem', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', gap: 0, alignItems: 'center', flex: '1 1 auto' }}>
              <button 
                type="button" 
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({ x: rect.left, y: rect.bottom + 4, type: 'empty' });
                }} 
                style={{ padding: '0.45rem 1rem', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '24px', border: '1px solid #cbd5e1', background: '#fff', color: 'var(--text-main)', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                <Plus size={18} /> Baru
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', padding: '0.4rem 0.75rem', borderRadius: '6px' }}>
              <Search size={14} color="var(--text-muted)" style={{ marginRight: '0.5rem' }} />
              <input type="text" placeholder="Cari file..." style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem', width: '120px' }} />
            </div>
          </div>

          {/* File List */}
          <div 
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'empty' });
              setActiveSubMenu(null);
            }}
            style={{ background: '#fff', height: '400px', overflowY: 'auto', overflowX: 'auto' }}
          >
            <table style={{ width: '100%', minWidth: '500px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, width: '50%' }}>Nama File</th>
                  <th style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tanggal Diubah</th>
                  <th style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Ukuran</th>
                  <th style={{ padding: '0.6rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredFiles.length > 0 ? filteredFiles.map(file => (
                  <tr 
                    key={file.id} 
                    style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', file });
                      setActiveSubMenu(null);
                    }}
                    onDoubleClick={() => {
                      if (!file.deleted) {
                        if (file.name.includes('.')) {
                          setPreviewFile(file);
                        } else {
                          setCurrentFolder(file);
                          setActiveNav('course');
                        }
                      } else {
                        toast.error('Pulihkan file terlebih dahulu untuk membukanya');
                      }
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {file.name.includes('.') ? <FileText size={18} color="#3b82f6" /> : <Folder size={18} color="#3b82f6" fill="#bfdbfe" />}
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', textDecoration: file.deleted ? 'line-through' : 'none', opacity: file.deleted ? 0.6 : 1 }}>{file.name}</span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{file.date}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{(Math.random() * 5 + 0.1).toFixed(1)} MB</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      {activeNav === 'trash' ? (
                        <>
                          <button type="button" onClick={(e) => { e.stopPropagation(); restoreFile(file.id); }} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#16a34a', transition: 'all 0.2s' }} title="Pulihkan">
                            <Clock size={14} />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); permanentlyDeleteFile(file.id); }} style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#dc2626', transition: 'all 0.2s' }} title="Hapus Permanen">
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={(e) => { e.stopPropagation(); toggleStarFile(file.id); }} style={{ background: file.starred ? '#fef9c3' : '#f8fafc', border: `1px solid ${file.starred ? '#fef08a' : '#e2e8f0'}`, padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: file.starred ? '#eab308' : '#94a3b8', transition: 'all 0.2s' }} title="Bintangi">
                            <Star size={14} fill={file.starred ? 'currentColor' : 'none'} />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(file.id); }} style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#dc2626', transition: 'all 0.2s' }} title="Pindah ke Sampah">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                      <Folder size={56} color="#cbd5e1" style={{ margin: '0 auto 1rem auto', display: 'block', fill: '#f8fafc' }} />
                      <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        {activeNav === 'trash' ? 'Tempat sampah kosong' : activeNav === 'starred' ? 'Belum ada file berbintang' : 'Folder ini masih kosong'}
                      </p>
                      {activeNav === 'course' && <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem' }}>Silakan ketik nama materi dan klik Upload.</p>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Tutup</button>
          <button type="submit" className="btn btn-primary">Simpan Detail</button>
        </div>
      </form>

      {contextMenu && (
        <div style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          background: '#fff',
          boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '6px 0',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          minWidth: '240px',
          fontSize: '13px',
          color: '#334155'
        }}>
          {contextMenu.type === 'empty' && (
            <>
              <div
                onClick={() => {
                  setContextMenu(null);
                  setPromptDialog({
                    title: "Buat Folder Baru",
                    placeholder: "Nama Folder",
                    defaultValue: "",
                    onSubmit: (name) => {
                      const newFile = { id: Date.now(), name: name, date: new Date().toLocaleDateString('id-ID'), timestamp: Date.now(), starred: false, deleted: false, folderId: currentFolder ? currentFolder.id : undefined };
                      setFormData(prev => ({ ...prev, files: [...prev.files, newFile] }));
                      toast.success('Folder berhasil dibuat');
                    }
                  });
                }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Folder size={16} color="#64748b" /> Buat Folder
              </div>
              <div
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.onchange = (e) => {
                    if (e.target.files.length > 0) {
                      const fileObj = e.target.files[0];
                      const url = URL.createObjectURL(fileObj);
                      const newFile = { 
                        id: Date.now(), 
                        name: fileObj.name, 
                        date: new Date().toLocaleDateString('id-ID'), 
                        timestamp: Date.now(), 
                        starred: false, 
                        deleted: false, 
                        folderId: currentFolder ? currentFolder.id : undefined,
                        url: url,
                        fileObject: fileObj
                      };
                      setFormData(prev => ({ ...prev, files: [...prev.files, newFile] }));
                      toast.success('File berhasil diupload');
                    }
                  };
                  input.click();
                  setContextMenu(null);
                }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Upload size={16} color="#64748b" /> Upload File
              </div>
              <div
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.webkitdirectory = true;
                  input.onchange = (e) => {
                    if (e.target.files.length > 0) {
                      const folderPath = e.target.files[0].webkitRelativePath;
                      const rootFolderName = folderPath.split('/')[0] || 'Folder Baru';
                      
                      const newFolderId = Date.now();
                      const newFolder = { 
                         id: newFolderId, 
                         name: rootFolderName, 
                         date: new Date().toLocaleDateString('id-ID'), 
                         timestamp: Date.now(), 
                         starred: false, 
                         deleted: false, 
                         folderId: currentFolder ? currentFolder.id : undefined 
                      };
                      
                      const newFiles = Array.from(e.target.files).map((fileObj, idx) => ({
                         id: Date.now() + idx + 1,
                         name: fileObj.name,
                         date: new Date().toLocaleDateString('id-ID'),
                         timestamp: Date.now() + idx + 1,
                         starred: false,
                         deleted: false,
                         folderId: newFolderId,
                         url: URL.createObjectURL(fileObj),
                         fileObject: fileObj
                      }));
                      
                      setFormData(prev => ({ ...prev, files: [...prev.files, newFolder, ...newFiles] }));
                      toast.success(`Folder ${rootFolderName} beserta isinya berhasil diupload`);
                    }
                  };
                  input.click();
                  setContextMenu(null);
                }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <FolderUp size={16} color="#64748b" /> Upload Folder
              </div>
            </>
          )}

          {contextMenu.type === 'file' && (
            <>
               {/* Download */}
               <div
                onClick={() => { toast.success('Mengunduh ' + contextMenu.file.name); setContextMenu(null); }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
               >
                 <Download size={16} color="#64748b" /> Download
               </div>

               {/* Divider */}
               <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>

               {/* Ganti Nama */}
               <div
                onClick={() => { 
                   setContextMenu(null); 
                   setPromptDialog({
                     title: "Ganti Nama",
                     placeholder: "Nama baru",
                     defaultValue: contextMenu.file.name,
                     onSubmit: (newName) => {
                       setFormData(prev => ({ ...prev, files: prev.files.map(f => f.id === contextMenu.file.id ? { ...f, name: newName } : f) }));
                       toast.success('Nama diubah');
                     }
                   });
                }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
               >
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Edit2 size={16} color="#64748b" /> Ganti nama</div>
                 <span style={{ color: '#94a3b8', fontSize: '11px' }}>Ctrl+Alt+E</span>
               </div>

               {/* Buat Salinan */}
               <div
                onClick={() => { 
                   const copy = { ...contextMenu.file, id: Date.now(), name: 'Salinan ' + contextMenu.file.name };
                   setFormData(prev => ({ ...prev, files: [...prev.files, copy] }));
                   toast.success('Salinan dibuat');
                   setContextMenu(null); 
                }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
               >
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Copy size={16} color="#64748b" /> Buat salinan</div>
                 <span style={{ color: '#94a3b8', fontSize: '11px' }}>Ctrl+C Ctrl+V</span>
               </div>

               {/* Divider */}
               <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>

               {/* Atur */}
               <div
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; setActiveSubMenu('atur'); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; setActiveSubMenu(null); }}
                style={{ position: 'relative', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
               >
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Folder size={16} color="#64748b" /> Atur</div>
                 <ChevronRight size={14} color="#64748b" />
                 
                 {activeSubMenu === 'atur' && (
                   <div style={{ position: 'absolute', top: '-4px', left: '100%', background: '#fff', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 0', minWidth: '220px', zIndex: 10001 }}>
                      <div onClick={() => { toast.success('Pindahkan diklik'); setContextMenu(null); }} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><MoveRight size={16} color="#64748b" /> Pindahkan</div>
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>Ctrl+Alt+M</span>
                      </div>
                      <div onClick={() => { toast.success('Pintasan ditambahkan'); setContextMenu(null); }} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Link size={16} color="#64748b" /> Tambahkan pintasan</div>
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>Ctrl+Alt+R</span>
                      </div>
                      <div onClick={() => { toggleStarFile(contextMenu.file.id); setContextMenu(null); }} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Star size={16} color="#64748b" /> Tambahkan ke berbintang</div>
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>Ctrl+Alt+S</span>
                      </div>
                   </div>
                 )}
               </div>

               {/* Informasi File */}
               <div
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; setActiveSubMenu('info'); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; setActiveSubMenu(null); }}
                style={{ position: 'relative', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
               >
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Info size={16} color="#64748b" /> Informasi file</div>
                 <ChevronRight size={14} color="#64748b" />
                 
                 {activeSubMenu === 'info' && (
                   <div style={{ position: 'absolute', top: '-4px', left: '100%', background: '#fff', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 0', minWidth: '220px', zIndex: 10001 }}>
                      <div onClick={() => { toast.success('Menampilkan detail...'); setContextMenu(null); }} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><Info size={16} color="#64748b" /> Detail</div>
                        <span style={{ color: '#94a3b8', fontSize: '11px' }}>Alt+V kmdn D</span>
                      </div>
                      <div onClick={() => { toast.success('File dikunci'); setContextMenu(null); }} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <Lock size={16} color="#64748b" /> Kunci
                      </div>
                   </div>
                 )}
               </div>

               {/* Divider */}
               <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }}></div>

               {/* Pindahkan ke sampah */}
               <div
                onClick={() => { removeFile(contextMenu.file.id); setContextMenu(null); }}
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
               >
                 <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#dc2626' }}><Trash2 size={16} color="#dc2626" /> Pindahkan ke sampah</div>
                 <span style={{ color: '#94a3b8', fontSize: '11px' }}>Delete</span>
               </div>
            </>
          )}
        </div>
      )}

      {previewFile && (
        <Modal isOpen={!!previewFile} onClose={() => setPreviewFile(null)} title={`Pratinjau: ${previewFile.name}`} width="1000px">
          <div style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '85vh', maxHeight: '900px' }}>
            {renderPreviewContent(previewFile)}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', padding: '0.5rem 0' }}>
              <button onClick={() => setPreviewFile(null)} className="btn btn-secondary">Tutup</button>
              <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Download size={16} /> Download Dokumen</button>
            </div>
          </div>
        </Modal>
      )}

      {promptDialog && (
        <Modal isOpen={true} onClose={() => setPromptDialog(null)} title={promptDialog.title} width="400px">
          <form onSubmit={(e) => {
             e.preventDefault();
             const val = e.target.elements.promptInput.value.trim();
             if (val) {
                promptDialog.onSubmit(val);
                setPromptDialog(null);
             }
          }}>
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <input 
                 name="promptInput"
                 defaultValue={promptDialog.defaultValue}
                 placeholder={promptDialog.placeholder}
                 autoFocus
                 style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.95rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                 <button type="button" onClick={() => setPromptDialog(null)} style={{ padding: '0.5rem 1.25rem', background: '#f1f5f9', color: '#475569', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Batal</button>
                 <button type="submit" style={{ padding: '0.5rem 1.25rem', background: '#3b82f6', color: '#fff', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Simpan</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
