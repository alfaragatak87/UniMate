import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { LayoutDashboard, BookOpen, CheckSquare, GraduationCap, BarChart2, Scan, Settings, Minus, X, Maximize2, Minimize2, Square, Calendar, Moon, Sun, Briefcase, RefreshCw, User, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import LiveClockWidget from './LiveClockWidget';
import DesktopWidget from './DesktopWidget';
import ProfileBadge from './ProfileBadge';
import AIChatWidget from './AIChatWidget';

export default function Layout() {
  const { semesterProfile: semester, semesters, academicPhase, isSidebarCollapsed, setIsSidebarCollapsed, isDarkMode, setIsDarkMode } = useAppContext();
  const [isWidget, setIsWidget] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  useEffect(() => {
    if (isElectron && typeof window.electronAPI?.onMaximizedChange === 'function') {
      const unsubscribe = window.electronAPI.onMaximizedChange((maximized) => {
        setIsMaximized(maximized);
      });
      if (typeof window.electronAPI?.isWindowMaximized === 'function') {
        window.electronAPI.isWindowMaximized().then(setIsMaximized).catch(() => {});
      }
      return unsubscribe;
    }
  }, [isElectron]);

  // Pull to refresh state
  const [pullStart, setPullStart] = useState(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mainContentRef = useRef(null);

  const handleTouchStart = (e) => {
    if (mainContentRef.current && mainContentRef.current.scrollTop === 0) {
      setPullStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e) => {
    if (pullStart !== null) {
      const distance = e.touches[0].clientY - pullStart;
      if (distance > 0 && distance < 150) {
        setPullDistance(distance);
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setIsRefreshing(true);
      setTimeout(() => window.location.reload(), 500);
    } else {
      setPullDistance(0);
    }
    setPullStart(null);
  };

  // Helper to check missing documents (sync with Semesters.jsx logic)
  const getMissingDocuments = (sem) => {
    if (sem.status === 'future') return [];
    let rawDocs = sem.documents || [];
    if (rawDocs.length === 0 && sem.originalFile) rawDocs = [{ type: sem.documentType || 'Dokumen Semester' }];
    const currentDocs = rawDocs.map(d => (d.type || '').toLowerCase());
    const missing = [];
    
    if (!currentDocs.some(d => d.includes('krs'))) missing.push('KRS');
    if (!currentDocs.some(d => d.includes('mingguan'))) missing.push('Jadwal Mingguan');
    if (!currentDocs.some(d => d.includes('ujian') || d.includes('uts') || d.includes('uas'))) missing.push('Jadwal Ujian');
    if (sem.status === 'past' && !currentDocs.some(d => d.includes('khs') && !d.includes('rekap'))) missing.push('KHS');
    return missing;
  };

  // Calculate sidebar warnings
  const currentSem = semesters.find(s => s.status === 'current');
  const isJadwalWarning = academicPhase !== 'libur' && (currentSem ? (!currentSem.courses || currentSem.courses.length === 0) : true);
  
  const isSemestersWarning = semesters.some(sem => {
    if (sem.status === 'future') return false;
    if (!sem.courses || sem.courses.length === 0) return true;
    if (sem.status === 'past' && (!sem.gpa || sem.gpa <= 0)) return true;
    if (getMissingDocuments(sem).length > 0) return true;
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleWidgetMode = () => {
    if (isElectron) {
      const nextState = !isWidget;
      setIsWidget(nextState);
      window.electronAPI.setWidgetMode(nextState);
      if (nextState) {
        document.body.classList.add('widget-mode');
      } else {
        document.body.classList.remove('widget-mode');
      }
    }
  };

  const handleMinimize = () => {
    if (isElectron) window.electronAPI.minimizeWindow();
  };

  const handleToggleMaximize = () => {
    if (isElectron) window.electronAPI.toggleMaximizeWindow();
  };

  const handleClose = () => {
    if (isElectron) window.electronAPI.closeWindow();
  };

  return (
    <div className="app-layout">
      {/* Custom Titlebar for Electron Frameless Window */}
      {isElectron && (
        <header className="electron-titlebar" aria-label="Kontrol Jendela">
          <div className="titlebar-drag-region" onDoubleClick={handleToggleMaximize}>
            <span className="titlebar-app-title">UniMate</span>
          </div>
          <div className="titlebar-controls">
            <button 
              className="titlebar-btn titlebar-btn-widget" 
              onClick={toggleWidgetMode} 
              title={isWidget ? "Kembali ke Mode Penuh" : "Mode Widget Desktop"}
              aria-label={isWidget ? "Kembali ke Mode Penuh" : "Mode Widget Desktop"}
            >
              {isWidget ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
            {!isWidget && (
              <>
                <button 
                  className="titlebar-btn titlebar-btn-minimize" 
                  onClick={handleMinimize} 
                  title="Minimize"
                  aria-label="Minimize"
                >
                  <Minus size={14} />
                </button>
                <button 
                  className="titlebar-btn titlebar-btn-maximize" 
                  onClick={handleToggleMaximize} 
                  title={isMaximized ? "Restore" : "Maximize"}
                  aria-label={isMaximized ? "Restore" : "Maximize"}
                >
                  {isMaximized ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                      <rect x="2.5" y="0.5" width="8" height="8" rx="1" />
                      <path d="M0.5 3.5V10.5C0.5 11.0523 0.947715 11.5 1.5 11.5H8.5" />
                    </svg>
                  ) : (
                    <Square size={12} strokeWidth={1.8} />
                  )}
                </button>
                <button 
                  className="titlebar-btn titlebar-btn-close" 
                  onClick={handleClose} 
                  title="Close"
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {isWidget ? (
        <DesktopWidget />
      ) : (
        <>
          {/* Sidebar */}
          <aside 
            className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}
            style={{ 
              marginTop: isElectron && !isWidget ? '32px' : '0', 
              height: isElectron && !isWidget ? 'calc(100vh - 32px)' : '100vh' 
            }}
          >
            <div style={{ display: 'flex', flexDirection: isSidebarCollapsed ? 'column' : 'row', alignItems: 'center', justifyContent: isSidebarCollapsed ? 'center' : 'space-between', gap: isSidebarCollapsed ? '1rem' : '0', marginBottom: '2.5rem' }}>
              <Link to="/" className="sidebar-logo" style={{ textDecoration: 'none', color: 'inherit', margin: 0, paddingLeft: isSidebarCollapsed ? '0' : '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img src="./favicon.svg" alt="UniMate Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
                {!isSidebarCollapsed && <span className="brand-text">UniMate</span>}
              </Link>
              <button 
                className="sidebar-collapse-btn-top" 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                title={isSidebarCollapsed ? "Perluas Sidebar" : "Sembunyikan Sidebar"}
              >
                {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
            
            <nav className="nav-links">
              <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <LayoutDashboard size={20} /> <span className="nav-label">Dashboard</span>
              </NavLink>
              
              <NavLink to="/timetable" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ position: 'relative' }}>
                <Calendar size={20} /> <span className="nav-label">Jadwal Kuliah</span>
                {isJadwalWarning && (
                  <span title="Jadwal belum lengkap" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)' }}></span>
                )}
              </NavLink>

              <NavLink to="/semesters" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ position: 'relative' }}>
                <BookOpen size={20} /> <span className="nav-label">Semesters</span>
                {isSemestersWarning && (
                  <span title="Ada data semester yang belum lengkap" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#eab308', boxShadow: '0 0 8px rgba(234, 179, 8, 0.6)' }}></span>
                )}
              </NavLink>
              
              <NavLink to="/tasks" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <CheckSquare size={20} /> <span className="nav-label">Tasks & Files</span>
              </NavLink>

              <NavLink to="/projects" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Briefcase size={20} /> <span className="nav-label">Workspace</span>
              </NavLink>
              
              {semester >= 7 && (
                <NavLink to="/thesis" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <GraduationCap size={20} /> <span className="nav-label">Thesis Tracker</span>
                </NavLink>
              )}

              <NavLink to="/analytics" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <BarChart2 size={20} /> <span className="nav-label">Data Analytics</span>
              </NavLink>

              <div style={{ margin: '1rem 0', borderBottom: '1px solid var(--border-color)' }}></div>
              
              <NavLink to="/ai-scanner" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ color: 'var(--primary-color)' }}>
                <Scan size={20} /> <span className="nav-label">AI Scanner</span>
              </NavLink>
            </nav>
          </aside>

          {/* Main Content Area */}
          <main 
            className="main-content" 
            style={{ 
              marginTop: isElectron && !isWidget ? '32px' : '0', 
              height: isElectron && !isWidget ? 'calc(100vh - 32px)' : '100vh',
              position: 'relative' 
            }}
            ref={mainContentRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Pull to refresh indicator */}
            <div style={{
              height: `${pullDistance}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              transition: pullStart === null ? 'height 0.3s ease' : 'none',
              color: 'var(--text-muted)'
            }}>
              {isRefreshing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RefreshCw size={18} className="spin-anim" /> 
                  <span style={{ fontSize: '0.875rem' }}>Memuat ulang...</span>
                </div>
              ) : pullDistance > 60 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RefreshCw size={18} style={{ transform: 'rotate(180deg)', transition: 'transform 0.3s ease' }} /> 
                  <span style={{ fontSize: '0.875rem' }}>Lepas untuk refresh</span>
                </div>
              ) : pullDistance > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RefreshCw size={18} style={{ transform: `rotate(${pullDistance * 2}deg)` }} /> 
                  <span style={{ fontSize: '0.875rem' }}>Tarik ke bawah...</span>
                </div>
              ) : null}
            </div>

            <div className="top-header glass-header">
              <div className="topbar-left mobile-logo" style={{ alignItems: 'center', gap: '1rem' }}>
                <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'inherit' }}>
                  <img src="./favicon.svg" alt="UniMate Logo" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UniMate</span>
                </Link>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginLeft: 'auto', position: 'relative', zIndex: 100 }}>
                <div className="hide-on-mobile">
                  <LiveClockWidget />
                </div>
                
                <button 
                  onClick={(e) => { 
                    e.currentTarget.querySelector('svg').classList.add('spin-anim');
                    setTimeout(() => window.location.reload(), 200); // slight delay to see the animation
                  }} 
                  className="btn-icon hide-on-mobile" 
                  title="Muat Ulang Halaman"
                  style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 0 }}
                >
                  <RefreshCw size={18} style={{ transition: 'transform 0.3s ease' }} /> 
                </button>

                <button 
                  onClick={() => setIsDarkMode(!isDarkMode)} 
                  className="btn-icon" 
                  title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
                  style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 0 }}
                >
                  {isDarkMode ? <Sun size={18} /> : <Moon size={18} />} 
                </button>

                <ProfileBadge />
              </div>
            </div>
            <Outlet />
            <AIChatWidget />
          </main>
        </>
      )}
    </div>
  );
}
