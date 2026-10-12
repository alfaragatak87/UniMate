import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { User, BookOpen, Calendar, Save, Camera, Eye, Trash2, Upload, Download, ZoomIn, ZoomOut, RotateCcw, Hash, Building2, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmDialog from '../components/ConfirmDialog';

export default function Profile() {
  const {
    userName, setUserName,
    fullName, setFullName,
    nim, setNim,
    instansi, setInstansi,
    instansiNickname, setInstansiNickname,
    jurusan, setJurusan,
    jenjang, setJenjang,
    semesterProfile: semester, setSemesterProfile: setSemester,
    academicPhase, setAcademicPhase,
    isAutoPhase, setIsAutoPhase,
    nextSemesterDate, setNextSemesterDate,
    academicCalendar, setAcademicCalendar,
    profilePicture, setProfilePicture,
    tasks,
    semesters, setSemesters
  } = useAppContext();

  const completedTasksCount = tasks.filter(t => t.done === true || t.status === 'done').length;
  const isGoldFrame = completedTasksCount >= 3;

  // Calculate Profile Completion
  const getProfileCompletionData = () => {
    let filledFields = 0;
    const totalFields = 8;
    const missing = [];
    
    if (userName && userName !== 'Mahasiswa') filledFields++; else missing.push('Nama Singkat');
    if (fullName && fullName.trim() !== '') filledFields++; else missing.push('Nama Lengkap');
    if (nim && nim.trim() !== '') filledFields++; else missing.push('NIM');
    if (instansi && instansi.trim() !== '') filledFields++; else missing.push('Asal Kampus');
    if (jurusan && jurusan.trim() !== '') filledFields++; else missing.push('Program Studi');
    if (academicCalendar.krs && academicCalendar.krs !== '') filledFields++; else missing.push('Kalender Awal Kuliah');
    if (academicCalendar.uts && academicCalendar.uts !== '') filledFields++; else missing.push('Kalender UTS');
    if (academicCalendar.uas && academicCalendar.uas !== '') filledFields++; else missing.push('Kalender UAS');

    let status = 'yellow';
    if (filledFields === 0) status = 'red';
    if (filledFields === totalFields) status = 'green';
    
    return { status, missing, filledFields, totalFields };
  };

  const profileData = getProfileCompletionData();
  const statusColor = profileData.status === 'red' ? '#ef4444' : profileData.status === 'yellow' ? '#eab308' : '#22c55e';

  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isViewingPhoto, setIsViewingPhoto] = useState(false);
  const [pendingPhaseChange, setPendingPhaseChange] = useState(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  
  const [nameInputValue, setNameInputValue] = useState(userName);
  const [fullNameInputValue, setFullNameInputValue] = useState(fullName);
  const [nimInputValue, setNimInputValue] = useState(nim);
  const [instansiInputValue, setInstansiInputValue] = useState(instansi);
  const [instansiNickInputValue, setInstansiNickInputValue] = useState(instansiNickname);
  const [jurusanInputValue, setJurusanInputValue] = useState(jurusan);
  const [jenjangInputValue, setJenjangInputValue] = useState(jenjang);
  const [semInputValue, setSemInputValue] = useState(semester);
  const [phaseInputValue, setPhaseInputValue] = useState(academicPhase);
  const [dateInputValue, setDateInputValue] = useState(nextSemesterDate);
  const [calendarInputValue, setCalendarInputValue] = useState(academicCalendar);

  const hasChanges = 
    nameInputValue !== userName ||
    fullNameInputValue !== fullName ||
    nimInputValue !== nim ||
    instansiInputValue !== instansi ||
    instansiNickInputValue !== instansiNickname ||
    jurusanInputValue !== jurusan ||
    jenjangInputValue !== jenjang ||
    semInputValue != semester ||
    phaseInputValue !== academicPhase ||
    dateInputValue !== nextSemesterDate ||
    JSON.stringify(calendarInputValue) !== JSON.stringify(academicCalendar);

  const avatarMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const zoomContainerRef = useRef(null);

  // Auto-estimate academic phase
  useEffect(() => {
    if (!isAutoPhase) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let estimatedPhase = 'kuliah'; // Default to active class

    if (academicCalendar.krs || academicCalendar.uts || academicCalendar.uas || academicCalendar.libur) {
      // Use Exact Calendar Match
      const parseDate = (dStr) => dStr ? new Date(dStr).setHours(0,0,0,0) : null;
      const krsDate = parseDate(academicCalendar.krs);
      const utsDate = parseDate(academicCalendar.uts);
      const uasDate = parseDate(academicCalendar.uas);
      const liburDate = parseDate(academicCalendar.libur);
      const todayTime = today.getTime();

      if (liburDate && todayTime >= liburDate) {
        estimatedPhase = 'libur';
      } else if (uasDate && todayTime >= uasDate) {
        const diffUasDays = Math.floor((todayTime - uasDate) / (1000 * 60 * 60 * 24));
        if (diffUasDays < 14) {
          estimatedPhase = 'uas';
        } else {
          estimatedPhase = 'khs'; // Pasca UAS
        }
      } else if (utsDate && todayTime >= utsDate) {
        const diffUtsDays = Math.floor((todayTime - utsDate) / (1000 * 60 * 60 * 24));
        if (diffUtsDays < 14) {
          estimatedPhase = 'uts';
        } else {
          estimatedPhase = 'kuliah'; // Kembali kuliah setelah UTS
        }
      } else if (krsDate && todayTime >= krsDate) {
        // Between KRS and UTS
        // First 2 weeks is KRS phase
        const diffDays = Math.floor((todayTime - krsDate) / (1000 * 60 * 60 * 24));
        if (diffDays < 14) estimatedPhase = 'krs';
        else estimatedPhase = 'kuliah';
      } else if (krsDate && todayTime < krsDate) {
        estimatedPhase = 'libur';
      }
    } else if (nextSemesterDate) {
      // Fallback to old Week-Based Estimation
      const startDate = new Date(nextSemesterDate);
      startDate.setHours(0, 0, 0, 0);

      if (today < startDate) {
        estimatedPhase = 'libur';
      } else {
        const diffTime = today - startDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const weekNumber = Math.floor(diffDays / 7) + 1;

        if (weekNumber <= 2) estimatedPhase = 'krs';
        else if (weekNumber > 2 && weekNumber <= 7) estimatedPhase = 'kuliah';
        else if (weekNumber === 8 || weekNumber === 9) estimatedPhase = 'uts';
        else if (weekNumber > 9 && weekNumber <= 15) estimatedPhase = 'kuliah';
        else if (weekNumber === 16 || weekNumber === 17) estimatedPhase = 'uas';
        else if (weekNumber > 17 && weekNumber <= 20) estimatedPhase = 'khs';
        else estimatedPhase = 'libur';
      }
    } else {
      return; // No data to auto-estimate
    }

    if (estimatedPhase !== academicPhase) {
      setPendingPhaseChange(estimatedPhase);
    }
  }, [nextSemesterDate, academicCalendar, isAutoPhase, academicPhase, setPendingPhaseChange]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target)) {
        setIsAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setNameInputValue(userName);
    setFullNameInputValue(fullName);
    setNimInputValue(nim);
    setInstansiInputValue(instansi);
    setInstansiNickInputValue(instansiNickname);
    setJurusanInputValue(jurusan);
    setJenjangInputValue(jenjang);
    setSemInputValue(semester);
    setPhaseInputValue(academicPhase);
    setDateInputValue(nextSemesterDate);
    setCalendarInputValue(academicCalendar);
  }, [userName, fullName, nim, instansi, instansiNickname, jurusan, jenjang, semester, academicPhase, nextSemesterDate, academicCalendar]);

  // Handle Mouse Wheel Zoom
  useEffect(() => {
    const container = zoomContainerRef.current;
    if (!container || !isViewingPhoto) return;

    const handleWheel = (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoomLevel(prev => Math.min(prev + 0.15, 4));
      } else {
        setZoomLevel(prev => Math.max(prev - 0.15, 0.5));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isViewingPhoto]);

  const handleSaveProfile = () => {
    const newSemNum = parseInt(semInputValue) || 1;
    
    // Strict KHS Requirement check
    if (newSemNum > semester) {
      const currentSemesterObj = semesters.find(s => s.status === 'current');
      if (currentSemesterObj && !currentSemesterObj.originalFile) {
        toast.error(`Gagal Naik Semester: Anda belum mengunggah KHS/KRS untuk ${currentSemesterObj.name}! Silakan Scan KHS Anda terlebih dahulu.`);
        setSemInputValue(semester); // Revert input value
        return; // Abort save
      }
    }

    setUserName(nameInputValue);
    setFullName(fullNameInputValue);
    setNim(nimInputValue);
    setInstansi(instansiInputValue);
    setInstansiNickname(instansiNickInputValue);
    setJurusan(jurusanInputValue);
    setJenjang(jenjangInputValue);
    setSemester(newSemNum);
    
    let nextAutoPhase = isAutoPhase;
    if (dateInputValue !== nextSemesterDate) {
       nextAutoPhase = true; 
       setNextSemesterDate(dateInputValue);
    }
    
    // Check if calendar changed
    const isCalendarChanged = JSON.stringify(calendarInputValue) !== JSON.stringify(academicCalendar);
    if (isCalendarChanged) {
       nextAutoPhase = true;
       setAcademicCalendar(calendarInputValue);
    }

    if (phaseInputValue !== academicPhase) {
       nextAutoPhase = false;
       setAcademicPhase(phaseInputValue);
    }
    
    setIsAutoPhase(nextAutoPhase);

    // Auto-sync semesters
    const targetSemName = `Semester ${newSemNum}`;
    let updatedSemesters = [...semesters];
    const existingIndex = updatedSemesters.findIndex(s => s.name.toLowerCase() === targetSemName.toLowerCase());
    
    if (existingIndex !== -1) {
      updatedSemesters = updatedSemesters.map((s, idx) => ({
        ...s,
        status: idx === existingIndex ? 'current' : 'past'
      }));
    } else {
      updatedSemesters = updatedSemesters.map(s => ({ ...s, status: 'past' }));
      updatedSemesters.push({
        id: Date.now().toString(),
        name: targetSemName,
        status: 'current',
        courses: []
      });
    }
    setSemesters(updatedSemesters);

    toast.success('Profil & Status Akademik berhasil disimpan!');
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Gagal: Ukuran gambar maksimal 2MB!');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setProfilePicture(event.target.result);
      toast.success('Foto profil berhasil diperbarui!');
    };
    reader.readAsDataURL(file);
    setIsAvatarMenuOpen(false);
    if(fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeletePhoto = () => {
    setProfilePicture('');
    setIsAvatarMenuOpen(false);
    toast.success('Foto profil berhasil dihapus!');
  };

  const handleDownloadPhoto = (aspectRatio, label) => {
    const img = new Image();
    img.src = profilePicture;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let sw = img.width;
      let sh = img.height;
      let sx = 0;
      let sy = 0;

      if (aspectRatio) {
        const imgRatio = sw / sh;
        if (imgRatio > aspectRatio) {
          sw = sh * aspectRatio;
          sx = (img.width - sw) / 2;
        } else {
          sh = sw / aspectRatio;
          sy = (img.height - sh) / 2;
        }
      }

      canvas.width = sw;
      canvas.height = sh;

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `UniMate_PP_${label}.jpg`;
      a.click();
      toast.success(`Foto ukuran ${label} berhasil diunduh!`);
    };
  };

  const scrollToField = (label) => {
    let id = '';
    if (label === 'Nama Singkat') id = 'input-nama-singkat';
    if (label === 'Nama Lengkap') id = 'input-nama-lengkap';
    if (label === 'NIM') id = 'input-nim';
    if (label === 'Asal Kampus') id = 'input-asal-kampus';
    if (label === 'Program Studi') id = 'input-jurusan';
    if (label === 'Kalender Awal Kuliah') id = 'input-kalender-krs';
    if (label === 'Kalender UTS') id = 'input-kalender-uts';
    if (label === 'Kalender UAS') id = 'input-kalender-uas';
    
    if (id) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
        el.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.3)';
        el.style.borderColor = 'var(--primary-color)';
        setTimeout(() => {
          el.style.boxShadow = '';
          el.style.borderColor = '';
        }, 1500);
      }
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Profil Pengguna</h1>
        <p className="page-subtitle">Sesuaikan identitas dan status akademik Anda</p>
      </div>

      <div className="profile-layout">
        
        {/* Kolom Kiri: Profil & Kelengkapan */}
        <div className="profile-sidebar-sticky">
          
          <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ position: 'relative', marginBottom: '1.5rem' }} ref={avatarMenuRef}>
              <div 
                className="profile-avatar-large" 
                style={{ width: '140px', height: '140px', cursor: 'pointer', overflow: 'hidden', position: 'relative', boxShadow: `0 0 0 6px var(--card-bg), 0 0 0 12px ${statusColor}`, borderRadius: '50%', background: 'var(--primary-color)' }}
                onClick={() => profilePicture ? setIsAvatarMenuOpen(!isAvatarMenuOpen) : fileInputRef.current?.click()}
              >
                {profilePicture ? (
                  <img src={profilePicture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'white' }}>
                    <User size={64} />
                  </div>
                )}
                <div className="avatar-overlay" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', padding: '0.75rem', display: 'flex', justifyContent: 'center', color: 'white' }}>
                  <Camera size={20} />
                </div>
              </div>
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} ref={fileInputRef} />
              
              {isAvatarMenuOpen && profilePicture && (
                <div className="avatar-context-menu" style={{ top: '110%', left: '50%', transform: 'translateX(-50%)', zIndex: 10, position: 'absolute', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: '0.5rem', minWidth: '160px' }}>
                  <button onClick={() => { setIsViewingPhoto(true); setIsAvatarMenuOpen(false); }} style={{ width: '100%', textAlign: 'left', padding: '0.6rem', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Eye size={16}/> Lihat Foto</button>
                  <button onClick={() => { fileInputRef.current?.click(); setIsAvatarMenuOpen(false); }} style={{ width: '100%', textAlign: 'left', padding: '0.6rem', background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Upload size={16}/> Ubah Foto</button>
                  <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }}></div>
                  <button onClick={handleDeletePhoto} style={{ width: '100%', textAlign: 'left', padding: '0.6rem', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Trash2 size={16}/> Hapus Foto</button>
                </div>
              )}
            </div>
            
            <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>{userName}</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '1rem', letterSpacing: '0.5px' }}>{instansiNickname ? instansiNickname : `Semester ${semester}`}</p>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem', backgroundColor: `${statusColor}0A`, border: `1px solid ${statusColor}30` }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem 0', color: statusColor, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={16} /> 
              Status Profil ({profileData.filledFields}/{profileData.totalFields})
            </h3>
            
            {profileData.missing.length > 0 ? (
              <>
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                  Lengkapi data berikut agar lingkaran avatar Anda berubah hijau:
                </p>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {profileData.missing.map((item, idx) => (
                    <li 
                      key={idx} 
                      onClick={() => scrollToField(item)}
                      style={{ marginBottom: '0.5rem', cursor: 'pointer', color: 'var(--primary-color)', textDecoration: 'underline' }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-main)' }}>
                Mantap! Profil Anda sudah lengkap sepenuhnya.
              </p>
            )}
          </div>

        </div>

        {/* Kolom Kanan: Formulir Pengaturan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <User size={18} className="text-primary" /> Data Pribadi
            </h3>
            
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label><User size={14} /> Nama Lengkap</label>
              <input 
                id="input-nama-lengkap"
                type="text" 
                className="form-input" 
                value={fullNameInputValue} 
                onChange={(e) => setFullNameInputValue(e.target.value)} 
                placeholder="Cth: M. Alfa Rizky"
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label><User size={14} /> Nama Panggilan</label>
                <input 
                  id="input-nama-singkat"
                  type="text" 
                  className="form-input" 
                  value={nameInputValue} 
                  onChange={(e) => setNameInputValue(e.target.value)} 
                  placeholder="Nama..."
                />
              </div>
              <div className="form-group">
                <label><Hash size={14} /> NIM / NIS</label>
                <input 
                  id="input-nim"
                  type="text" 
                  className="form-input" 
                  value={nimInputValue} 
                  onChange={(e) => setNimInputValue(e.target.value)} 
                  placeholder="Nomor Induk..."
                />
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={18} className="text-primary" /> Data Institusi
            </h3>
            
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label><Building2 size={14} /> Nama Instansi (Lengkap)</label>
              <input 
                id="input-asal-kampus"
                type="text" 
                className="form-input" 
                value={instansiInputValue} 
                onChange={(e) => setInstansiInputValue(e.target.value)} 
                placeholder="Cth: Institut Teknologi dan Bisnis..."
              />
            </div>

            <div className="form-grid-2-1">
              <div className="form-group">
                <label><Building2 size={14} /> Singkatan Kampus</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={instansiNickInputValue} 
                  onChange={(e) => setInstansiNickInputValue(e.target.value)} 
                  placeholder="Cth: WIGA"
                />
              </div>
              <div className="form-group">
                <label><BookOpen size={14} /> Semester</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select 
                    className="form-input" 
                    value={parseInt(semInputValue) > 8 || semInputValue === 'custom' || semInputValue === '' ? 'custom' : semInputValue} 
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setSemInputValue('');
                      } else {
                        setSemInputValue(Number(e.target.value));
                      }
                    }}
                    style={{ flex: (parseInt(semInputValue) > 8 || semInputValue === 'custom' || semInputValue === '') ? '0 0 auto' : '1', padding: '0.75rem 0.5rem' }}
                  >
                    {[1,2,3,4,5,6,7,8].map(num => (
                      <option key={num} value={num}>{num}</option>
                    ))}
                    <option value="custom">Lainnya...</option>
                  </select>
                  
                  {(parseInt(semInputValue) > 8 || semInputValue === 'custom' || semInputValue === '') && (
                    <input 
                      type="number" 
                      className="form-input" 
                      min="1" max="20"
                      value={semInputValue === 'custom' ? '' : semInputValue} 
                      onChange={(e) => setSemInputValue(e.target.value)} 
                      placeholder="Ketik..."
                      style={{ flex: '1', minWidth: '80px' }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="form-grid-2-1">
              <div className="form-group">
                <label><BookOpen size={14} /> Jenjang</label>
                <select 
                  className="form-input" 
                  value={jenjangInputValue} 
                  onChange={(e) => setJenjangInputValue(e.target.value)}
                  style={{ padding: '0.75rem 0.5rem' }}
                >
                  <option value="">Pilih...</option>
                  <option value="SMA">SMA</option>
                  <option value="SMK">SMK</option>
                  <option value="D1">D1</option>
                  <option value="D2">D2</option>
                  <option value="D3">D3</option>
                  <option value="D4">D4</option>
                  <option value="S1">S1</option>
                  <option value="S2">S2</option>
                  <option value="S3">S3</option>
                </select>
              </div>

              <div className="form-group" style={{ position: 'relative' }}>
                <label><BookOpen size={14} /> Jurusan / Prodi</label>
                <input 
                  id="input-jurusan"
                  type="text" 
                  className="form-input" 
                  value={jurusanInputValue} 
                  onChange={(e) => setJurusanInputValue(e.target.value)} 
                  onFocus={() => document.getElementById('jurusan-dropdown').style.display = 'block'}
                  onBlur={() => setTimeout(() => document.getElementById('jurusan-dropdown').style.display = 'none', 200)}
                  placeholder="Cth: Sistem Informasi"
                />
                <div 
                  id="jurusan-dropdown"
                  className="glass-card"
                  style={{ 
                    display: 'none',
                    position: 'absolute', 
                    top: '100%', 
                    left: 0, 
                    right: 0, 
                    marginTop: '0.5rem', 
                    maxHeight: '200px', 
                    overflowY: 'auto', 
                    zIndex: 50,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                    padding: '0',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    backgroundColor: 'var(--bg-color)' 
                  }}
                >
                  {[
                    // Teknologi & Komputer
                    "Teknik Informatika", "Sistem Informasi", "Ilmu Komputer", "Teknologi Informasi", "Rekayasa Perangkat Lunak", "Manajemen Informatika", "Sistem Komputer", "Kecerdasan Buatan", "Sains Data",
                    // Teknik & Rekayasa
                    "Teknik Sipil", "Teknik Mesin", "Teknik Elektro", "Teknik Industri", "Arsitektur", "Teknik Lingkungan", "Teknik Kimia", "Teknik Pertambangan", "Teknik Geologi", "Teknik Metalurgi", "Perencanaan Wilayah dan Kota (PWK)", "Teknik Penerbangan / Dirgantara", "Teknik Perkapalan", "Teknik Biomedis",
                    // Kesehatan & Medis
                    "Kedokteran", "Kedokteran Gigi", "Kedokteran Hewan", "Keperawatan", "Kebidanan", "Farmasi", "Kesehatan Masyarakat", "Gizi", "Fisioterapi", "Rekam Medis dan Informasi Kesehatan", "Radiologi",
                    // Ekonomi & Bisnis
                    "Manajemen", "Akuntansi", "Ekonomi Pembangunan", "Bisnis Digital", "Manajemen Bisnis", "Ilmu Ekonomi", "Keuangan", "Pemasaran", "Kewirausahaan",
                    // Sosial & Politik
                    "Ilmu Komunikasi", "Ilmu Hukum", "Hubungan Internasional", "Ilmu Administrasi Negara", "Ilmu Administrasi Bisnis", "Ilmu Pemerintahan", "Ilmu Politik", "Sosiologi", "Psikologi", "Kriminologi", "Ilmu Kesejahteraan Sosial", "Antropologi",
                    // Sains & Matematika (MIPA)
                    "Matematika", "Fisika", "Kimia", "Biologi", "Statistika", "Aktuaria", "Astronomi",
                    // Pertanian & Kelautan
                    "Agribisnis", "Agroteknologi", "Ilmu Tanah", "Ilmu Hama dan Penyakit Tumbuhan", "Penyuluhan Pertanian", "Kehutanan", "Peternakan", "Ilmu Kelautan", "Budi Daya Perairan", "Teknologi Hasil Pertanian",
                    // Pendidikan
                    "Pendidikan Guru Sekolah Dasar (PGSD)", "Pendidikan Anak Usia Dini (PAUD)", "Bimbingan dan Konseling", "Pendidikan Matematika", "Pendidikan Bahasa Inggris", "Pendidikan Bahasa Indonesia", "Pendidikan Agama Islam", "Pendidikan Jasmani dan Olahraga", "Pendidikan Biologi", "Pendidikan Fisika",
                    // Sastra & Budaya
                    "Sastra Inggris", "Sastra Indonesia", "Sastra Jepang", "Sastra Arab", "Sastra Mandarin", "Sastra Korea", "Sastra Jawa", "Ilmu Sejarah", "Arkeologi",
                    // Seni & Desain
                    "Desain Komunikasi Visual (DKV)", "Desain Interior", "Desain Produk", "Seni Rupa Murni", "Seni Tari", "Seni Musik", "Televisi dan Film", "Fotografi",
                    // Pariwisata & Perhotelan
                    "Pariwisata", "Perhotelan", "Manajemen Tata Boga"
                  ].filter(j => j.toLowerCase().includes(jurusanInputValue.toLowerCase())).map((jurusan, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        setJurusanInputValue(jurusan);
                        document.getElementById('jurusan-dropdown').style.display = 'none';
                      }}
                      style={{
                        padding: '0.75rem 1rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border-color)',
                        fontSize: '0.95rem',
                        color: 'var(--text-main)',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      {jurusan}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={18} className="text-primary" /> Kalender & Fase Akademik
            </h3>

            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Fase Akademik Saat Ini</span>
                {isAutoPhase && <span style={{ fontSize: '0.8rem', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}><Sparkles size={12} /> Otomatis Aktif</span>}
              </label>
              <select 
                className="form-input" 
                value={phaseInputValue}
                onChange={(e) => setPhaseInputValue(e.target.value)}
                style={{ fontWeight: 500 }}
              >
                <option value="libur">🏖️ Libur Semester</option>
                <option value="krs">📝 Masa KRS & Awal Kuliah</option>
                <option value="kuliah">📚 Perkuliahan Aktif</option>
                <option value="uts">✍️ Ujian Tengah Semester (UTS)</option>
                <option value="uas">🎓 Ujian Akhir Semester (UAS)</option>
                <option value="khs">📊 Akhir Semester & Cek Nilai (KHS)</option>
              </select>
              {!isAutoPhase && phaseInputValue !== 'libur' && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>Mode Manual aktif. Atur kalender akademik dengan benar agar deteksi otomatis aktif kembali.</p>
              )}
            </div>

            <div style={{ marginTop: '0.75rem', marginBottom: '1.5rem', padding: '1rem', borderRadius: '12px', fontSize: '0.85rem', lineHeight: '1.5', backgroundColor: phaseInputValue === 'libur' ? 'rgba(16, 185, 129, 0.1)' : phaseInputValue === 'uts' || phaseInputValue === 'uas' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)', border: '1px solid', borderColor: phaseInputValue === 'libur' ? 'rgba(16, 185, 129, 0.3)' : phaseInputValue === 'uts' || phaseInputValue === 'uas' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(59, 130, 246, 0.3)' }}>
              {phaseInputValue === 'libur' && <span><strong>Selamat liburan!</strong> Pastikan untuk menyetel tanggal kalender akademik di bawah agar sistem dapat mempersiapkan Anda menyambut semester baru.</span>}
              {phaseInputValue === 'krs' && <span><strong>Awal Semester Baru!</strong> Yuk segera scan <strong>KRS</strong> dan Jadwal Mingguan-mu di menu Semesters agar tidak ada jadwal yang terlewat.</span>}
              {phaseInputValue === 'kuliah' && <span><strong>Perkuliahan Aktif!</strong> Fokus belajar dan jangan lupa kerjakan tugas-tugas dari dosen ya.</span>}
              {phaseInputValue === 'uts' && <span><strong>Masa UTS Tiba!</strong> Sudah scan jadwal <strong>KRU UTS</strong>-mu? Jangan sampai salah jadwal ujian!</span>}
              {phaseInputValue === 'uas' && <span><strong>Masa UAS di Depan Mata!</strong> Yuk segera scan jadwal <strong>KRU UAS</strong>-mu. Semangat!</span>}
              {phaseInputValue === 'khs' && <span><strong>UAS Usai!</strong> Apakah kamu ada libur (Ganjil/Genap)? Pastikan <strong>Tanggal Libur / KHS</strong> di kalendermu sudah diatur!</span>}
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem 0' }}>Jadwal Penting</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem' }}>Mulai Kuliah / KRS</label>
                  <input 
                    id="input-kalender-krs"
                    type="date" 
                    className="form-input" 
                    value={calendarInputValue.krs || dateInputValue} 
                    onChange={(e) => setCalendarInputValue({...calendarInputValue, krs: e.target.value})} 
                  />
                </div>
                
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem' }}>Mulai UTS</label>
                  <input 
                    id="input-kalender-uts"
                    type="date" 
                    className="form-input" 
                    value={calendarInputValue.uts} 
                    onChange={(e) => setCalendarInputValue({...calendarInputValue, uts: e.target.value})} 
                  />
                </div>
                
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem' }}>Mulai UAS</label>
                  <input 
                    id="input-kalender-uas"
                    type="date" 
                    className="form-input" 
                    value={calendarInputValue.uas} 
                    onChange={(e) => setCalendarInputValue({...calendarInputValue, uas: e.target.value})} 
                  />
                </div>
                
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem' }}>Libur Semester / KHS</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    value={calendarInputValue.libur} 
                    onChange={(e) => setCalendarInputValue({...calendarInputValue, libur: e.target.value})} 
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{
            position: hasChanges ? 'sticky' : 'static',
            bottom: hasChanges ? '20px' : 'auto',
            zIndex: 100,
            marginTop: '0.5rem',
            transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <button 
              className="btn btn-primary" 
              onClick={handleSaveProfile} 
              style={{ 
                padding: '1rem', 
                fontSize: '1rem', 
                fontWeight: 600, 
                display: 'flex', 
                justifyContent: 'center', 
                gap: '0.5rem',
                width: '100%',
                boxShadow: hasChanges ? '0 10px 25px -5px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.1)' : 'none',
                transform: hasChanges ? 'translateY(-2px)' : 'none',
                transition: 'all 0.3s ease'
              }}
            >
              <Save size={20} /> {hasChanges ? 'Simpan Semua Perubahan (Belum Disimpan)' : 'Simpan Semua Perubahan'}
            </button>
          </div>
        </div>

      </div>

      {pendingPhaseChange && (
        <ConfirmDialog 
          isOpen={true}
          title="Perubahan Fase Akademik"
          message={`Berdasarkan kalender Anda, saat ini Anda memasuki masa ${
            pendingPhaseChange === 'uts' ? 'UTS' : 
            pendingPhaseChange === 'uas' ? 'UAS' : 
            pendingPhaseChange === 'krs' ? 'KRS & Awal Kuliah' : 
            pendingPhaseChange === 'khs' ? 'Akhir Semester (KHS)' :
            pendingPhaseChange === 'libur' ? 'Libur Semester' : 'Perkuliahan Aktif'
          }. Ingin mengaktifkan mode ini?`}
          icon={Calendar}
          confirmText="Ya, Aktifkan"
          cancelText="Nanti Saja"
          onConfirm={() => {
            setAcademicPhase(pendingPhaseChange);
            setPhaseInputValue(pendingPhaseChange);
            setPendingPhaseChange(null);
          }}
          onCancel={() => {
            setPendingPhaseChange(null);
            setIsAutoPhase(false);
          }}
        />
      )}

      {isViewingPhoto && profilePicture && (
        <div className="photo-modal-overlay" onMouseDown={e => e.stopPropagation()} onClick={() => { setIsViewingPhoto(false); setZoomLevel(1); }}>
          <div className="photo-modal-content" onClick={e => e.stopPropagation()}>
            <div className="photo-zoom-container" ref={zoomContainerRef}>
              <img src={profilePicture} alt="Full Profile" style={{ height: `${zoomLevel * 60}vh`, width: 'auto' }} />
            </div>
            <div className="zoom-controls">
              <button onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.max(prev - 0.25, 0.5)); }} title="Perkecil"><ZoomOut size={18}/></button>
              <button onClick={(e) => { e.stopPropagation(); setZoomLevel(1); }} title="Reset Zoom"><RotateCcw size={16}/></button>
              <button onClick={(e) => { e.stopPropagation(); setZoomLevel(prev => Math.min(prev + 0.5, 4)); }} title="Perbesar"><ZoomIn size={18}/></button>
            </div>
            
            <div className="photo-modal-download-menu">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.5rem' }}>UNDUH FOTO (CROP)</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => handleDownloadPhoto(null, 'Asli')}><Download size={14} /> Ukuran Asli</button>
                <button onClick={() => handleDownloadPhoto(2/3, '4x6')}><Download size={14} /> 4x6</button>
                <button onClick={() => handleDownloadPhoto(3/4, '3x4')}><Download size={14} /> 3x4</button>
                <button onClick={() => handleDownloadPhoto(1, '1x1')}><Download size={14} /> 1x1 (Persegi)</button>
              </div>
            </div>
            <button className="photo-modal-close" onClick={() => { setIsViewingPhoto(false); setZoomLevel(1); }}>Tutup Foto</button>
          </div>
        </div>
      )}
    </div>
  );
}
