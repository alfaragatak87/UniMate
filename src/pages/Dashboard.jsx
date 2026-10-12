import { BookOpen, CheckCircle, Clock, Calendar as CalIcon, Calendar, ChevronRight, Sparkles, TrendingUp, AlertCircle, BarChart2, GraduationCap, Hash, Building2, MapPin, Search, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAppContext } from '../context/AppContext';
import { Link, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const navigate = useNavigate();
  const { semesters, tasks, academicPhase, hasPromptedDocs, setHasPromptedDocs, nextSemesterDate, semesterProfile, userName } = useAppContext();
  const [showDocPopup, setShowDocPopup] = useState(false);
  const [missingPhaseDocs, setMissingPhaseDocs] = useState([]);
  
  const isHoliday = academicPhase === 'libur';

  useEffect(() => {
    const currentSem = semesters.find(s => s.status === 'current');
    if (!currentSem || hasPromptedDocs === academicPhase) return;

    let rawDocs = currentSem.documents || [];
    if (rawDocs.length === 0 && currentSem.originalFile) rawDocs = [{ type: currentSem.documentType || 'Dokumen Semester' }];
    const currentDocsStr = rawDocs.map(d => (d.type || '').toLowerCase());
    
    let missing = [];
    if (academicPhase === 'krs' && !currentDocsStr.some(d => d.includes('krs'))) missing.push('KRS');
    if (academicPhase === 'kuliah' && !currentDocsStr.some(d => d.includes('mingguan'))) missing.push('Jadwal Kuliah Mingguan');
    if (academicPhase === 'uts' && !currentDocsStr.some(d => d.includes('kru'))) missing.push('KRU UTS');
    if (academicPhase === 'uas' && !currentDocsStr.some(d => d.includes('kru'))) missing.push('KRU UAS');
    if (academicPhase === 'khs' && !currentDocsStr.some(d => d.includes('khs'))) missing.push('KHS');

    if (missing.length > 0) {
      setMissingPhaseDocs(missing);
      setShowDocPopup(true);
    }
  }, [academicPhase, semesters, hasPromptedDocs, setHasPromptedDocs]);

  // Compute dynamic stats
  const totalSks = semesters.reduce((acc, sem) => acc + (sem.courses ? sem.courses.length * 3 : 0), 0);
  const validGpaSemesters = semesters.filter(sem => parseFloat(sem.gpa || 0) > 0);
  const avgGpa = validGpaSemesters.length > 0 
    ? (validGpaSemesters.reduce((acc, sem) => acc + parseFloat(sem.gpa || 0), 0) / validGpaSemesters.length).toFixed(2)
    : '0.00';
  
  const pendingTasks = tasks.filter(t => !t.done && t.type === 'task');
  
  // Get active semester courses
  const activeSemesters = semesters.filter(s => s.status === 'current');
  let activeCourses = [];
  activeSemesters.forEach(s => {
    activeCourses = [...activeCourses, ...s.courses];
  });

  // Calculate days until next semester if on holiday
  let daysUntil = null;
  if (isHoliday && nextSemesterDate) {
    const nextDate = new Date(nextSemesterDate);
    const today = new Date();
    const diffTime = nextDate - today;
    if (diffTime > 0) {
      daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  }

  // Trend Data for Recharts
  const trendData = semesters
    .filter(s => s.gpa > 0)
    .sort((a, b) => a.id - b.id)
    .map(s => ({ name: s.name, gpa: parseFloat(s.gpa) }));

  // Today's Schedule
  const daysMap = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const todayName = daysMap[new Date().getDay()];
  const todaysClasses = activeCourses
    .filter(c => typeof c === 'object' && c.day === todayName)
    .sort((a, b) => (a.timeStart || '').localeCompare(b.timeStart || ''));

  return (
    <div className="dashboard-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
            <span style={{ background: 'linear-gradient(135deg, #0f172a, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 800, paddingBottom: '0.2rem' }}>
              Halo, {userName}!
            </span> 
            <span className="wave-emoji" style={{ animation: 'wave 2.5s infinite', display: 'inline-block', transformOrigin: '70% 70%' }}>👋</span>
          </h1>
          <p className="page-subtitle" style={{ marginTop: '0.4rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Semoga harimu menyenangkan. Ini ringkasan akademismu.
          </p>
        </div>
      </div>

      <div className="dashboard-stats-grid">
        {/* STAT 1 */}
        <div className="stat-card premium-blue">
          <div className="stat-icon-wrapper">
            <BookOpen size={28} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Total SKS Kumulatif</p>
            <h3 className="stat-value">{totalSks}</h3>
          </div>
          <div className="stat-decoration"><Sparkles size={120} /></div>
        </div>
        
        {/* STAT 2 */}
        <div className="stat-card premium-emerald">
          <div className="stat-icon-wrapper">
            <TrendingUp size={28} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Rata-Rata IPK</p>
            <h3 className="stat-value">{avgGpa}</h3>
          </div>
          <div className="stat-decoration"><CheckCircle size={120} /></div>
        </div>

        {/* STAT 3 */}
        <div className="stat-card premium-amber">
          <div className="stat-icon-wrapper">
            <AlertCircle size={28} />
          </div>
          <div className="stat-content">
            <p className="stat-label">Tugas Menunggu</p>
            <h3 className="stat-value">{pendingTasks.length} <span style={{ fontSize: '1rem', fontWeight: 500, opacity: 0.9 }}>Tugas</span></h3>
          </div>
          <div className="stat-decoration"><Clock size={120} /></div>
        </div>
      </div>

      {academicPhase === 'libur' && (
        <div className="holiday-banner">
          <div className="holiday-content">
            <h2 className="holiday-title">
              <span className="palm-emoji">🏖️</span> Selamat Liburan Semester!
            </h2>
            <p className="holiday-text">
              Waktunya <i>healing</i> dan merebahkan diri sejenak sebelum Semester {parseInt(semesterProfile) + 1} memanggil.
            </p>
          </div>
          {daysUntil !== null && (
            <div className="countdown-box">
              <div className="countdown-number pulse-anim">{daysUntil}</div>
              <div className="countdown-label">HARI LAGI</div>
            </div>
          )}
        </div>
      )}

      {academicPhase === 'krs' && (
        <div className="holiday-banner" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}>
          <div className="holiday-content">
            <h2 className="holiday-title">
              📝 Awal Semester & Masa KRS
            </h2>
            <p className="holiday-text">
              Semester {semesterProfile} telah tiba! Jangan lupa unggah <strong>KRS dan Jadwal Mingguan</strong>-mu.
            </p>
          </div>
          <Link to="/semesters" className="countdown-box" style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', textDecoration: 'none' }}>
            <div className="countdown-number" style={{ fontSize: '1rem', marginTop: '4px' }}>Ke Semesters <ChevronRight size={16} /></div>
          </Link>
        </div>
      )}

      {academicPhase === 'uts' && (
        <div className="holiday-banner" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
          <div className="holiday-content">
            <h2 className="holiday-title">
              ✍️ Masa Ujian Tengah Semester
            </h2>
            <p className="holiday-text">
              Tetap semangat belajar! Pastikan jadwal <strong>KRU UTS</strong>-mu sudah ada di sistem.
            </p>
          </div>
        </div>
      )}

      {academicPhase === 'uas' && (
        <div className="holiday-banner" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' }}>
          <div className="holiday-content">
            <h2 className="holiday-title">
              🎓 Masa Ujian Akhir Semester
            </h2>
            <p className="holiday-text">
              Satu langkah lagi menuju akhir semester. Yuk siapkan jadwal <strong>KRU UAS</strong>-mu!
            </p>
          </div>
        </div>
      )}

      {academicPhase === 'khs' && (
        <div className="holiday-banner" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' }}>
          <div className="holiday-content">
            <h2 className="holiday-title">
              📊 Akhir Semester (Pasca UAS)
            </h2>
            <p className="holiday-text">
              UAS telah usai! Apakah kamu ada libur (Ganjil/Genap)? Pastikan tanggal liburmu sudah diatur di kalender profil.
            </p>
          </div>
        </div>
      )}

      <div className="dashboard-main-grid">
        {/* Kolom Kiri: Matkul Semester Aktif */}
        <div className="dashboard-card matkul-card">
          <div className="card-header">
            <h3 className="card-title">
              <BookOpen size={20} style={{ color: '#3b82f6' }} /> Mata Kuliah Semester Ini
            </h3>
            <Link to="/semesters" className="card-link">
              Kelola <ChevronRight size={16} />
            </Link>
          </div>
          
          <div className="card-body">
            {isHoliday ? (
              <div className="empty-state-holiday">
                <div className="emoji-float">🌴</div>
                <h4>Kampus Kosong!</h4>
                <p>Tidak ada jadwal kelas. Nikmati waktu luang Anda dengan maksimal!</p>
              </div>
            ) : activeSemesters.length === 0 ? (
              <div className="empty-state-generic">
                <BookOpen size={40} style={{ opacity: 0.5, marginBottom: '1rem' }} />
                <p>Belum ada semester yang di-set aktif.</p>
              </div>
            ) : (
              <div className="course-list">
                {activeCourses.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Belum ada mata kuliah di semester aktif.</p>}
                {activeCourses.map((course, idx) => (
                  <div key={idx} className="course-item">
                    <div className="course-dot"></div>
                    <span className="course-name">{typeof course === 'string' ? course : course.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Kolom Kanan: Tugas Terdekat */}
        <div className="dashboard-card tugas-card">
          <div className="card-header">
            <h3 className="card-title">
              <CalIcon size={20} style={{ color: '#f59e0b' }} /> Daftar Tugas Harian
            </h3>
            <Link to="/tasks" className="card-link">
              Lihat Semua <ChevronRight size={16} />
            </Link>
          </div>
          
          <div className="card-body">
            {pendingTasks.length === 0 ? (
              <div className="empty-state-success">
                <div className="success-icon-bg"><CheckCircle size={32} /></div>
                <h4>Luar Biasa! 🎉</h4>
                <p>Tidak ada tugas yang menumpuk. Anda bisa bernapas lega.</p>
              </div>
            ) : (
              <div className="task-list">
                {pendingTasks.slice(0, 4).map(task => (
                  <div key={task.id} className="task-item">
                    <div className="task-info">
                      <h5 className="task-title">{task.title}</h5>
                      <span className="task-course">{task.course || 'Umum'}</span>
                    </div>
                    {task.deadline && (
                      <div className="task-deadline">
                        <Clock size={12} />
                        <span>{new Date(task.deadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-main-grid" style={{ marginTop: '1.5rem', gridTemplateColumns: '2fr 1fr' }}>
        {/* Grafik Tren Akademik */}
        <div className="dashboard-card" style={{ padding: '1.5rem' }}>
          <div className="card-header">
            <h3 className="card-title">
              <BarChart2 size={20} style={{ color: '#8b5cf6' }} /> Tren Indeks Prestasi (IPS)
            </h3>
          </div>
          <div className="card-body" style={{ height: '250px', marginTop: '1rem' }}>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)', fontSize: 12}} />
                  <YAxis domain={[0, 4]} axisLine={false} tickLine={false} tick={{fill: 'var(--text-muted)', fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  />
                  <Line type="monotone" dataKey="gpa" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                Belum ada data nilai IPS yang diisi.
              </div>
            )}
          </div>
        </div>

        {/* Jadwal Hari Ini */}
        <div className="dashboard-card" style={{ padding: '1.5rem' }}>
          <div className="card-header">
            <h3 className="card-title">
              <Clock size={20} style={{ color: '#10b981' }} /> Jadwal Hari Ini ({todayName})
            </h3>
            <Link to="/timetable" className="card-link">
              Lihat <ChevronRight size={16} />
            </Link>
          </div>
          <div className="card-body" style={{ marginTop: '1rem' }}>
            {todaysClasses.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {todaysClasses.map((cls, idx) => (
                  <div key={idx} style={{ padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-main)', fontSize: '0.95rem' }}>{cls.name}</h4>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12}/> {cls.timeStart} - {cls.timeEnd} {cls.room && `| ${cls.room}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☕</div>
                Tidak ada kelas hari ini. Waktunya nugas atau istirahat!
              </div>
            )}
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        isOpen={showDocPopup}
        title="Dokumen Wajib Belum Lengkap"
        message={`Anda sudah memasuki masa ${
          academicPhase === 'krs' ? 'KRS' : 
          academicPhase === 'uts' ? 'UTS' : 
          academicPhase === 'uas' ? 'UAS' : 
          academicPhase === 'khs' ? 'KHS' : 'Perkuliahan'
        }, namun sistem belum menemukan dokumen: ${missingPhaseDocs.join(', ')}. Mau unggah sekarang agar fitur otomatis bisa bekerja?`}
        icon={Calendar}
        confirmText="Unggah Sekarang"
        cancelText="Nanti Saja"
        onConfirm={() => {
          setHasPromptedDocs(academicPhase);
          setShowDocPopup(false);
          navigate('/semesters');
        }}
        onCancel={() => {
          setHasPromptedDocs(academicPhase);
          setShowDocPopup(false);
        }}
      />
    </div>
  );
}
