import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Briefcase, FolderKanban, Plus, GitBranch, HardDrive, Terminal, X, Save, Edit3, Trash2, ExternalLink, Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Projects() {
  const { projects, setProjects, githubUser } = useAppContext();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubRepos, setGithubRepos] = useState([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    category: 'Tugas Kuliah', // Tugas Kuliah, Freelance, Riset/Lomba, Komersial, Eksperimen
    status: 'In Progress', // Planning, In Progress, On Hold, Completed
    techStack: '',
    githubLink: '',
    localPath: '',
    notes: ''
  });

  const handleOpenModal = (project = null) => {
    if (project) {
      setEditingId(project.id);
      setFormData(project);
    } else {
      setEditingId(null);
      setFormData({
        title: '',
        category: 'Tugas Kuliah',
        status: 'In Progress',
        techStack: '',
        githubLink: '',
        localPath: '',
        notes: ''
      });
    }
    setIsModalOpen(true);
  };

  const fetchGithubRepos = async () => {
    if (!githubUser) {
      toast.error('Username GitHub belum diatur! Silakan isi di menu Settings.');
      return;
    }

    setIsLoadingRepos(true);
    setShowGithubModal(true);
    try {
      const res = await fetch(`https://api.github.com/users/${githubUser}/repos?sort=updated&per_page=30`);
      if (!res.ok) throw new Error('Gagal menarik data. Pastikan username benar.');
      const data = await res.json();
      setGithubRepos(data);
    } catch (error) {
      toast.error(error.message);
      setShowGithubModal(false);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const importRepoAsProject = (repo) => {
    const newProject = {
      id: Date.now() + Math.random(),
      title: repo.name,
      category: 'Eksperimen', // Default
      status: 'In Progress',
      techStack: repo.language || '',
      githubLink: repo.html_url,
      localPath: '',
      notes: repo.description || 'Diimpor dari GitHub'
    };
    setProjects(prev => [newProject, ...prev]);
    toast.success(`${repo.name} berhasil diimpor!`);
    setShowGithubModal(false);
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!formData.title) {
      toast.error('Judul proyek tidak boleh kosong');
      return;
    }

    if (editingId) {
      setProjects(prev => prev.map(p => p.id === editingId ? { ...formData, id: editingId } : p));
      toast.success('Proyek berhasil diperbarui');
    } else {
      setProjects(prev => [{ ...formData, id: Date.now() }, ...prev]);
      toast.success('Proyek baru berhasil ditambahkan');
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('Yakin ingin menghapus proyek ini?')) {
      setProjects(prev => prev.filter(p => p.id !== id));
      toast.success('Proyek dihapus');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Planning': return { bg: 'rgba(79, 70, 229, 0.15)', text: '#818cf8', border: 'rgba(79, 70, 229, 0.3)' };
      case 'In Progress': return { bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.3)' };
      case 'On Hold': return { bg: 'rgba(239, 68, 68, 0.15)', text: '#f87171', border: 'rgba(239, 68, 68, 0.3)' };
      case 'Completed': return { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' };
      default: return { bg: 'rgba(100, 116, 139, 0.15)', text: '#94a3b8', border: 'rgba(100, 116, 139, 0.3)' };
    }
  };

  return (
    <div>
      <div className="page-header flex-between" style={{ 
        alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap',
        marginBottom: '2rem'
      }}>
        <div style={{ flex: '1 1 300px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            width: '48px', height: '48px', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.2)'
          }}>
            <FolderKanban size={24} />
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem', lineHeight: 1 }}>Projects Workspace</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>Pusat komando untuk melacak semua proyek coding, freelance, hingga tugas akhir Anda.</p>
          </div>
        </div>
        <div className="mobile-wrap" style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn btn-outline" onClick={fetchGithubRepos} style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <GitBranch size={18} /> Tarik dari GitHub
          </button>
          <button className="btn btn-primary" onClick={() => handleOpenModal()} style={{ padding: '0.75rem 1.25rem', boxShadow: '0 4px 6px rgba(79, 70, 229, 0.2)' }}>
            <Plus size={18} /> Proyek Baru
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
        {projects.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
            <Briefcase size={64} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
            <h3 style={{ color: 'var(--text-main)', marginBottom: '0.5rem' }}>Belum ada Proyek</h3>
            <p>Klik tombol "Proyek Baru" untuk mulai mencatat proyek Anda.</p>
          </div>
        ) : (
          projects.map(project => (
            <div key={project.id} className="card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', transition: 'transform 0.2s, box-shadow 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main)', fontSize: '1.25rem' }}>{project.title}</h3>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>{project.category}</span>
                </div>
                <span style={{
                  backgroundColor: getStatusColor(project.status).bg,
                  color: getStatusColor(project.status).text,
                  border: `1px solid ${getStatusColor(project.status).border}`,
                  padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600
                }}>
                  {project.status}
                </span>
              </div>

              {project.techStack && (
                <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {project.techStack.split(',').map((tech, idx) => (
                    <span key={idx} style={{
                      fontSize: '0.75rem', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)',
                      padding: '2px 8px', borderRadius: '4px', color: 'var(--text-main)'
                    }}>
                      {tech.trim()}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ flex: 1 }}></div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {project.githubLink && (
                  <a href={project.githubLink} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', textDecoration: 'none', fontSize: '0.9rem' }}>
                    <GitBranch size={16} /> GitHub Repo <ExternalLink size={12} style={{ opacity: 0.5 }} />
                  </a>
                )}
                {project.localPath && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <HardDrive size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ wordBreak: 'break-all', fontFamily: 'monospace', backgroundColor: 'var(--bg-color)', padding: '2px 4px', borderRadius: '4px' }}>
                      {project.localPath}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <button className="btn-outline" onClick={() => handleOpenModal(project)} style={{ color: 'var(--text-main)', padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'transparent', cursor: 'pointer' }} title="Edit Proyek">
                  <Edit3 size={14} /> Edit
                </button>
                <button className="btn-outline" onClick={() => handleDelete(project.id)} style={{ color: '#ef4444', padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.05)', cursor: 'pointer' }} title="Hapus">
                  <Trash2 size={14} /> Hapus
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{editingId ? 'Edit Proyek' : 'Tambah Proyek Baru'}</h3>
              <button className="btn-icon" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Judul Proyek</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Misal: Aplikasi Kasir Toko Baju"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Kategori</label>
                  <select
                    className="form-input"
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                  >
                    <option value="Tugas Kuliah">Tugas Kuliah</option>
                    <option value="Freelance">Freelance / Klien</option>
                    <option value="Riset/Lomba">Riset & Lomba</option>
                    <option value="Komersial">Komersial / Startup</option>
                    <option value="Eksperimen">Eksperimen Pribadi</option>
                  </select>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Status</label>
                  <select
                    className="form-input"
                    value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="Planning">Planning</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Tech Stack</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="React, Node.js, Tailwind (pisahkan dengan koma)"
                  value={formData.techStack}
                  onChange={e => setFormData({ ...formData, techStack: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>URL Repositori (Opsional)</label>
                  <div className="form-input" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}>
                    <GitBranch size={16} style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="url"
                      style={{ border: 'none', background: 'transparent', outline: 'none', color: 'inherit', width: '100%', fontSize: '0.875rem' }}
                      placeholder="https://github.com/..."
                      value={formData.githubLink}
                      onChange={e => setFormData({ ...formData, githubLink: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Folder Lokal (Opsional)</label>
                  <div className="form-input" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem' }}>
                    <Terminal size={16} style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      style={{ border: 'none', background: 'transparent', outline: 'none', color: 'inherit', width: '100%', fontSize: '0.875rem' }}
                      placeholder="C:\Projects\..."
                      value={formData.localPath}
                      onChange={e => setFormData({ ...formData, localPath: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Catatan / To-Do</label>
                <textarea
                  className="form-input"
                  rows="2"
                  placeholder="Tuliskan ide, tugas tersisa, atau bug yang harus diperbaiki..."
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                ></textarea>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">
                  <Save size={18} /> Simpan Proyek
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GitHub Importer Modal */}
      {showGithubModal && (
        <div className="modal-overlay" onClick={() => setShowGithubModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ position: 'sticky', top: 0, backgroundColor: 'var(--card-bg)', zIndex: 10, paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GitBranch size={24} /> Repositori GitHub Anda
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Username: <strong>{githubUser}</strong></p>
              </div>
              <button className="btn-icon" onClick={() => setShowGithubModal(false)}><X size={20} /></button>
            </div>

            <div style={{ paddingTop: '1rem' }}>
              {isLoadingRepos ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                  <Loader2 size={32} className="animate-spin" style={{ marginBottom: '1rem', color: 'var(--primary-color)' }} />
                  <p>Mencari repositori...</p>
                </div>
              ) : githubRepos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                  <p>Tidak ada repositori publik yang ditemukan.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {githubRepos.map(repo => (
                    <div key={repo.id} style={{
                      padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      backgroundColor: 'var(--bg-color)'
                    }}>
                      <div style={{ flex: 1, paddingRight: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--primary-color)', fontSize: '1.1rem' }}>{repo.name}</h4>
                        {repo.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem 0' }}>{repo.description}</p>}
                        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {repo.language && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f1e05a' }}></span>{repo.language}</span>}
                          <span>⭐ {repo.stargazers_count}</span>
                        </div>
                      </div>
                      <button className="btn btn-primary" onClick={() => importRepoAsProject(repo)} style={{ padding: '0.5rem 1rem', flexShrink: 0 }}>
                        <Download size={16} style={{ marginRight: '4px' }} /> Impor
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
