import { useAppContext } from '../context/AppContext';
import { useState } from 'react';
import { Clock, MapPin, User, Sparkles, Globe, Download, Settings, X, Edit3, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import Modal from '../components/Modal';

export default function Timetable() {
  const { semesters, academicPhase } = useAppContext();
  const isHoliday = academicPhase === 'libur';
  const navigate = useNavigate();

  // Filter only current active semester courses
  const currentSemester = semesters.find(s => s.status === 'current');
  const allCourses = currentSemester ? currentSemester.courses.filter(c => typeof c === 'object') : [];

  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printConfig, setPrintConfig] = useState({
    title: `Jadwal Kuliah ${currentSemester ? currentSemester.name : ''}`,
    showTime: true,
    showRoom: true,
    showLecturer: true,
    showMode: true,
    showFriday: false
  });
  
  const [editingCourse, setEditingCourse] = useState(null);

  const days = printConfig.showFriday ? ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'] : ['Senin', 'Selasa', 'Rabu', 'Kamis'];
  
  // Create a mapping of days to courses
  const scheduleByDay = days.reduce((acc, day) => {
    acc[day] = allCourses
      .filter(course => course.day && course.day.trim().toLowerCase().includes(day.toLowerCase()))
      .sort((a, b) => (a.timeStart || '00:00').localeCompare(b.timeStart || '00:00'));
    return acc;
  }, {});

  const unmappedCourses = allCourses.filter(course => !course.day || !days.some(d => course.day.trim().toLowerCase().includes(d.toLowerCase())));

  const handleExportPDF = () => {
    const element = document.getElementById('timetable-content');
    if (!element) return;
    const opt = {
      margin: 0.3,
      filename: `${printConfig.title.replace(/[^a-zA-Z0-9]/g, '_') || 'Jadwal_Kuliah'}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { scale: 2, windowWidth: 1400, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
    };
    html2pdf().set(opt).from(element).save().then(() => setIsPrintMode(false));
  };

  const handleSaveCourse = (e) => {
    e.preventDefault();
    setSemesters(prev => prev.map(sem => {
      if (sem.id === currentSemester.id) {
        return {
          ...sem,
          courses: sem.courses.map(c => c.id === editingCourse.id ? editingCourse : c)
        };
      }
      return sem;
    }));
    setEditingCourse(null);
  };

  const colors = ['#eff6ff', '#f0fdf4', '#fdf2f8', '#fffbeb', '#f5f3ff'];
  const borderColors = ['#3b82f6', '#22c55e', '#ec4899', '#f59e0b', '#8b5cf6'];

  return (
    <div>
      {!isPrintMode ? (
        <div className="page-header" style={{ 
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem',
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
              <Calendar size={24} />
            </div>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--text-color)', marginBottom: '0.25rem', lineHeight: 1 }}>Jadwal Mingguan</h1>
              <p style={{ color: 'var(--text-secondary)' }}>
                {isHoliday 
                  ? 'Nikmati waktu libur Anda! Tidak ada kelas saat ini.' 
                  : `Jadwal kelas aktif untuk ${currentSemester ? currentSemester.name : 'Semester Saat Ini'}. (Total: ${allCourses.length} kelas)`
                }
              </p>
            </div>
          </div>
          {!isHoliday && currentSemester && allCourses.length > 0 && (
            <button className="btn btn-primary" onClick={() => {
              setPrintConfig(prev => ({ ...prev, title: `Jadwal Kuliah ${currentSemester ? currentSemester.name : ''}` }));
              setIsPrintMode(true);
            }} style={{ whiteSpace: 'nowrap' }}>
              <Download size={18} /> Download Jadwal (PDF)
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: '2px solid #3b82f6', backgroundColor: '#eff6ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings size={20} /> Pengaturan Tampilan PDF
            </h3>
            <button className="btn-icon" onClick={() => setIsPrintMode(false)}><X size={20} /></button>
          </div>
          
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ color: '#1e293b' }}>Judul Dokumen (Akan tampil di PDF)</label>
            <input type="text" className="form-input" value={printConfig.title} onChange={e => setPrintConfig({...printConfig, title: e.target.value})} />
          </div>
          
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#334155', fontWeight: 600 }}>
              <input type="checkbox" checked={printConfig.showTime} onChange={e => setPrintConfig({...printConfig, showTime: e.target.checked})} style={{ width: '18px', height: '18px' }} /> 
              Tampilkan Jam
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#334155', fontWeight: 600 }}>
              <input type="checkbox" checked={printConfig.showRoom} onChange={e => setPrintConfig({...printConfig, showRoom: e.target.checked})} style={{ width: '18px', height: '18px' }} /> 
              Tampilkan Ruangan
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#334155', fontWeight: 600 }}>
              <input type="checkbox" checked={printConfig.showLecturer} onChange={e => setPrintConfig({...printConfig, showLecturer: e.target.checked})} style={{ width: '18px', height: '18px' }} /> 
              Tampilkan Dosen
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#334155', fontWeight: 600 }}>
              <input type="checkbox" checked={printConfig.showMode} onChange={e => setPrintConfig({...printConfig, showMode: e.target.checked})} style={{ width: '18px', height: '18px' }} /> 
              Tampilkan Label (Online/Offline)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#334155', fontWeight: 600 }}>
              <input type="checkbox" checked={printConfig.showFriday} onChange={e => setPrintConfig({...printConfig, showFriday: e.target.checked})} style={{ width: '18px', height: '18px' }} /> 
              Tampilkan Hari Jumat
            </label>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button className="btn btn-outline" onClick={() => setIsPrintMode(false)}>Batal</button>
            <button className="btn btn-primary" onClick={handleExportPDF}>
              <Download size={18} /> Simpan & Download PDF Sekarang
            </button>
          </div>
        </div>
      )}

      <div id="timetable-content" style={{ padding: '1rem', backgroundColor: 'var(--bg-color)', borderRadius: '12px' }}>
        {isPrintMode && printConfig.title && (
          <h2 style={{ textAlign: 'center', marginBottom: '2rem', marginTop: '1rem', color: 'var(--text-main)', fontSize: '1.8rem', fontWeight: 800 }}>
            {printConfig.title}
          </h2>
        )}
        
      {isHoliday ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--bg-color)', borderRadius: '16px', border: '2px dashed #cbd5e1' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏖️</div>
          <h2 style={{ color: 'var(--text-main)', marginBottom: '0.5rem' }}>Anda Sedang Libur Sekarang</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: '0 auto' }}>
            Santai sejenak! Fitur jadwal akan aktif kembali ketika Anda mematikan mode libur semester di halaman Pengaturan.
          </p>
        </div>
      ) : (
        <div id="pdf-grid-container" className="timetable-grid" style={{
          ...(isPrintMode ? { gridTemplateColumns: `repeat(${days.length}, 1fr)` } : {})
        }}>
        {days.map((day, idx) => (
          <div key={day} className="card" style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', pageBreakInside: 'avoid' }}>
            <h3 style={{ textAlign: 'center', marginBottom: '1.5rem', color: 'var(--text-main)', borderBottom: `2px solid ${borderColors[idx]}`, paddingBottom: '0.5rem' }}>
              {day}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
              {scheduleByDay[day] && scheduleByDay[day].length > 0 ? (
                scheduleByDay[day].map((course, cIdx) => (
                  <div 
                    key={course.id || cIdx} 
                    className="timetable-course-card"
                    style={{
                      backgroundColor: colors[idx],
                      borderLeft: `4px solid ${borderColors[idx]}`,
                      padding: '0.75rem',
                      borderRadius: '0 8px 8px 0',
                      fontSize: '0.9rem',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => setEditingCourse(course)}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                    title="Klik untuk mengedit"
                  >
                    <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', color: borderColors[idx], opacity: 0.7 }}>
                      <Edit3 size={14} />
                    </div>
                    <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main)', fontSize: '1rem', paddingRight: '1rem' }}>{course.name}</h4>
                    {printConfig.showTime && course.timeStart && (
                      <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12}/> {course.timeStart} - {course.timeEnd}
                      </p>
                    )}
                    {printConfig.showRoom && course.room && (
                      <p style={{ margin: '0 0 0.25rem 0', color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12}/> {course.room}
                      </p>
                    )}
                    {printConfig.showLecturer && course.lecturer && (
                      <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <User size={12}/> {course.lecturer}
                      </p>
                    )}
                    {printConfig.showMode && course.mode && (
                      <span style={{ 
                        fontSize: '0.7rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px',
                        color: course.mode.toLowerCase() === 'online' ? '#059669' : '#4f46e5', 
                        backgroundColor: course.mode.toLowerCase() === 'online' ? '#d1fae5' : '#e0e7ff', 
                        padding: '2px 6px', borderRadius: '4px', marginTop: '0.25rem' 
                      }}>
                        {course.mode.toLowerCase() === 'online' ? <Globe size={10} /> : <MapPin size={10} />}
                        {course.mode.toUpperCase()}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                  <div>
                    <span style={{ fontSize: '1.5rem', display: 'block', marginBottom: '0.25rem' }}>📭</span>
                    <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>Jadwal Kosong?</strong>
                    <p style={{ margin: '0.25rem 0 0 0' }}>Cek SIAKAD kampusmu sekarang dan isi jadwal agar tidak ada kelas yang terlewat!</p>
                  </div>
                  <button 
                    onClick={() => navigate('/ai-scanner')}
                    className="btn btn-outline" 
                    style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Sparkles size={14} style={{ color: 'var(--primary-color)' }} />
                    Scan Jadwal AI
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
      
      {!isPrintMode && !isHoliday && unmappedCourses.length > 0 && (
        <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#d97706', fontSize: '1.1rem' }}>⚠️ Ada kelas yang harinya tidak dikenali AI:</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {unmappedCourses.map((course, idx) => (
              <div key={idx} style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #fef3c7' }}>
                <strong style={{ display: 'block', marginBottom: '0.5rem' }}>{course.name}</strong>
                <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Hari terdeteksi: {course.day || 'Kosong'}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.85rem', color: '#b45309', marginTop: '1rem', marginBottom: 0 }}>
            Tips: Pastikan teks nama hari di gambar jadwal Anda terlihat jelas (Senin, Selasa, dsb).
          </p>
        </div>
      )}
      
      {!isPrintMode && !currentSemester && !isHoliday && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Tandai salah satu semester sebagai "Aktif (Saat Ini)" di halaman Semesters untuk melihat jadwal mingguan.
        </div>
      )}
      </div>

      {/* Edit Course Modal */}
      <Modal isOpen={!!editingCourse} onClose={() => setEditingCourse(null)} title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e293b' }}>
          <Edit3 size={20} className="text-primary" /> Edit Jadwal Kelas
        </span>
      }>
        {editingCourse && (
            
            <form onSubmit={handleSaveCourse} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Nama Mata Kuliah</label>
                <input required type="text" className="form-input" value={editingCourse.name || ''} onChange={e => setEditingCourse({...editingCourse, name: e.target.value})} />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Hari</label>
                  <select className="form-input" value={editingCourse.day || ''} onChange={e => setEditingCourse({...editingCourse, day: e.target.value})}>
                    <option value="">Pilih Hari</option>
                    <option value="Senin">Senin</option>
                    <option value="Selasa">Selasa</option>
                    <option value="Rabu">Rabu</option>
                    <option value="Kamis">Kamis</option>
                    <option value="Jumat">Jumat</option>
                    <option value="Sabtu">Sabtu</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Jam Mulai</label>
                    <input type="time" className="form-input" value={editingCourse.timeStart || ''} onChange={e => setEditingCourse({...editingCourse, timeStart: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Jam Selesai</label>
                    <input type="time" className="form-input" value={editingCourse.timeEnd || ''} onChange={e => setEditingCourse({...editingCourse, timeEnd: e.target.value})} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Ruangan</label>
                  <input type="text" className="form-input" placeholder="Contoh: Lab Komputer" value={editingCourse.room || ''} onChange={e => setEditingCourse({...editingCourse, room: e.target.value})} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Mode</label>
                  <select className="form-input" value={editingCourse.mode || ''} onChange={e => setEditingCourse({...editingCourse, mode: e.target.value})}>
                    <option value="Offline">Offline</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
              </div>
              
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>Dosen Pengampu</label>
                <input type="text" className="form-input" value={editingCourse.lecturer || ''} onChange={e => setEditingCourse({...editingCourse, lecturer: e.target.value})} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" className="btn btn-outline" onClick={() => setEditingCourse(null)}>Batal</button>
                <button type="submit" className="btn btn-primary">Simpan Perubahan</button>
              </div>
            </form>
        )}
      </Modal>
    </div>
  );
}
