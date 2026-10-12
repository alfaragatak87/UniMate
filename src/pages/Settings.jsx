import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Key, Save, Database, GitBranch } from 'lucide-react';
import toast from 'react-hot-toast';
import DataBackup from '../components/DataBackup';

export default function Settings() {
  const { apiKey, setApiKey, githubUser, setGithubUser } = useAppContext();
  const [apiInputValue, setApiInputValue] = useState(apiKey);
  
  const [githubInputValue, setGithubInputValue] = useState(githubUser);

  const handleSaveAI = () => {
    setApiKey(apiInputValue);
    toast.success('API Key berhasil disimpan!');
  };

  const handleSaveGithub = () => {
    setGithubUser(githubInputValue);
    toast.success('Username GitHub berhasil disimpan!');
  };

  const { isHoliday, setIsHoliday } = useAppContext();

  const toggleHolidayMode = (e) => {
    const checked = e.target.checked;
    setIsHoliday(checked);
    window.dispatchEvent(new Event('storage'));
    toast.success(checked ? 'Mode Libur Diaktifkan!' : 'Mode Libur Dimatikan');
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
      el.style.boxShadow = '0 0 0 4px rgba(139, 92, 246, 0.3)';
      el.style.borderColor = 'var(--primary-color)';
      setTimeout(() => {
        el.style.boxShadow = '';
        el.style.borderColor = 'var(--border-color)';
      }, 1500);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Pengaturan</h1>
        <p className="page-subtitle">Sesuaikan konfigurasi AI dan preferensi aplikasi Anda.</p>
      </div>

      <div className="profile-layout">
        
        {/* Sidebar Menu */}
        <div className="profile-sidebar-sticky">
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1rem 0' }}>Menu Pengaturan</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li 
                onClick={() => scrollToSection('section-ai')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><Key size={18} style={{ color: '#8b5cf6' }}/> Konfigurasi AI</li>
              
              <li 
                onClick={() => scrollToSection('section-holiday')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><span style={{ fontSize: '1.1rem' }}>🌴</span> Mode Libur</li>
              
              <li 
                onClick={() => scrollToSection('section-github')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><GitBranch size={18} style={{ color: 'var(--text-main)' }}/> Integrasi GitHub</li>
              
              <li 
                onClick={() => scrollToSection('section-backup')} 
                style={{ cursor: 'pointer', color: 'var(--text-main)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', borderRadius: '8px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              ><Database size={18} style={{ color: '#10b981' }}/> Pencadangan Data</li>
            </ul>
          </div>
        </div>

        {/* Form Sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Konfigurasi AI */}
          <div id="section-ai" className="glass-card" tabIndex="-1" style={{ padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Key size={20} style={{ color: '#8b5cf6' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Konfigurasi AI (Gemini)</h3>
            </div>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              API Key dibutuhkan untuk fitur <strong>AI Scanner</strong> membaca gambar KRS/KHS. Data Anda aman dan hanya disimpan secara lokal di browser.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input 
                type="password" 
                className="form-input" 
                placeholder="Masukkan API Key (AIzaSy...)" 
                value={apiInputValue} 
                onChange={(e) => setApiInputValue(e.target.value)} 
                style={{ flex: '1 1 300px' }}
              />
              <button className="btn btn-primary" onClick={handleSaveAI} style={{ backgroundColor: '#8b5cf6', borderColor: '#8b5cf6', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                <Save size={18} /> Simpan Key
              </button>
            </div>
          </div>

          {/* Mode Libur */}
          <div id="section-holiday" className="glass-card" tabIndex="-1" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🌴</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Mode Libur Semester</h3>
              </div>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Nonaktifkan jadwal kelas harian dan kosongkan area dashboard.
              </p>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', flexShrink: 0 }}>
              <input type="checkbox" style={{ opacity: 0, width: 0, height: 0 }} 
                checked={isHoliday}
                onChange={toggleHolidayMode}
              />
              <span style={{ 
                position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
                backgroundColor: isHoliday ? '#10b981' : 'var(--border-color)', 
                transition: '.4s', borderRadius: '34px',
                display: 'flex', alignItems: 'center'
              }}>
                <span style={{
                  position: 'absolute', height: '18px', width: '18px', left: isHoliday ? '28px' : '4px',
                  bottom: '3px', backgroundColor: '#fff', transition: '.4s', borderRadius: '50%',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}></span>
              </span>
            </label>
          </div>

          {/* Konfigurasi GitHub */}
          <div id="section-github" className="glass-card" tabIndex="-1" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <GitBranch size={20} style={{ color: 'var(--text-main)' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Integrasi GitHub</h3>
            </div>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Masukkan username publik GitHub Anda untuk menarik daftar repositori secara instan ke Project Workspace.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Username GitHub (misal: octocat)" 
                value={githubInputValue} 
                onChange={(e) => setGithubInputValue(e.target.value)} 
                style={{ flex: '1 1 300px' }}
              />
              <button className="btn btn-primary" onClick={handleSaveGithub} style={{ backgroundColor: 'var(--text-main)', color: 'var(--card-bg)', borderColor: 'var(--text-main)', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
                <Save size={18} /> Simpan User
              </button>
            </div>
          </div>

          {/* Pencadangan Data */}
          <div id="section-backup" className="glass-card" tabIndex="-1" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', border: '1px solid var(--border-color)', outline: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <Database size={20} style={{ color: '#10b981' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Pencadangan Data</h3>
            </div>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Ekspor seluruh data akademik Anda ke format JSON, atau pulihkan data dari file cadangan sebelumnya.
            </p>
            <DataBackup />
          </div>

        </div>
      </div>
    </div>
  );
}
