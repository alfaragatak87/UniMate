import { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { User, Settings as SettingsIcon, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ProfileBadge() {
  const { userName, instansiNickname, semesterProfile: semester, profilePicture, tasks, fullName, nim, instansi, jurusan, academicCalendar } = useAppContext();

  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const completedTasksCount = tasks.filter(t => t.done === true || t.status === 'done').length;
  const isGoldFrame = completedTasksCount >= 3;

  const getProfileCompletionData = () => {
    let filledFields = 0;
    const totalFields = 8;
    if (userName && userName !== 'Mahasiswa') filledFields++;
    if (fullName && fullName.trim() !== '') filledFields++;
    if (nim && nim.trim() !== '') filledFields++;
    if (instansi && instansi.trim() !== '') filledFields++;
    if (jurusan && jurusan.trim() !== '') filledFields++;
    if (academicCalendar.krs && academicCalendar.krs !== '') filledFields++;
    if (academicCalendar.uts && academicCalendar.uts !== '') filledFields++;
    if (academicCalendar.uas && academicCalendar.uas !== '') filledFields++;

    let status = 'yellow';
    if (filledFields === 0) status = 'red';
    if (filledFields === totalFields) status = 'green';
    return status;
  };

  const status = getProfileCompletionData();
  const statusColor = status === 'red' ? '#ef4444' : status === 'yellow' ? '#eab308' : '#22c55e';

  const handleNavigate = (path) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <div className="profile-container" ref={dropdownRef} style={{ position: 'relative' }}>
      <div className="profile-badge" onClick={() => setIsOpen(!isOpen)} title="Menu Profil" style={{ cursor: 'pointer' }}>
        <div className="profile-info">
          <span className="profile-name">{userName}</span>
          <span className="profile-role">{instansiNickname ? instansiNickname : `Semester ${semester}`}</span>
        </div>
        <div className={`profile-avatar ${isGoldFrame ? 'gold-frame-container' : ''}`} style={{ overflow: 'visible' }}>
          <div className={`profile-avatar-inner ${isGoldFrame ? 'gold-frame' : ''}`} style={{ 
            width: '36px', height: '36px', borderRadius: '50%', overflow: 'hidden', 
            display: 'flex', justifyContent: 'center', alignItems: 'center', 
            background: 'var(--primary-color)', color: 'white',
            boxShadow: `0 0 0 2px var(--bg-color), 0 0 0 4px ${statusColor}`
          }}>
            {profilePicture ? (
              <img src={profilePicture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <User size={20} />
            )}
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="profile-dropdown" style={{ width: '220px', padding: '0.5rem' }}>
          <button 
            className="dropdown-item" 
            onClick={() => handleNavigate('/profile')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', padding: '0.75rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.9rem' }}
          >
            <User size={16} style={{ color: 'var(--primary-color)' }} />
            Profil Saya
          </button>
          <button 
            className="dropdown-item" 
            onClick={() => handleNavigate('/sync')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', padding: '0.75rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.9rem' }}
          >
            <RefreshCw size={16} style={{ color: 'var(--primary-color)' }} />
            Device Sync
          </button>
          <button 
            className="dropdown-item" 
            onClick={() => handleNavigate('/settings')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', padding: '0.75rem', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.9rem' }}
          >
            <SettingsIcon size={16} style={{ color: 'var(--primary-color)' }} />
            Settings
          </button>
        </div>
      )}
    </div>
  );
}
