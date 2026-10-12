import { createContext, useContext, useEffect } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [userName, setUserName] = useLocalStorage('profile_name', 'Mahasiswa');
  const [profilePicture, setProfilePicture] = useLocalStorage('profile_picture', '');
  const [fullName, setFullName] = useLocalStorage('profile_fullname', '');
  const [nim, setNim] = useLocalStorage('profile_nim', '');
  const [instansi, setInstansi] = useLocalStorage('profile_instansi', '');
  const [instansiNickname, setInstansiNickname] = useLocalStorage('profile_instansi_nickname', '');
  const [jurusan, setJurusan] = useLocalStorage('profile_jurusan', '');
  const [semesterProfile, setSemesterProfile] = useLocalStorage('profile_semester', 5);
  const [academicPhase, setAcademicPhase] = useLocalStorage('profile_academic_phase', 'libur');
  const [nextSemesterDate, setNextSemesterDate] = useLocalStorage('profile_next_date', '');
  const [academicCalendar, setAcademicCalendar] = useLocalStorage('profile_academic_calendar', { krs: '', uts: '', uas: '', libur: '' });
  
  const [semesters, setSemesters] = useLocalStorage('college_semesters', []);
  const [tasks, setTasks] = useLocalStorage('college_tasks', []);
  const [thesis, setThesis] = useLocalStorage('college_thesis', { 
    todo: [], 
    inProgress: [], 
    review: [], 
    done: [] 
  });
  
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('sidebar_collapsed', false);
  const [isDarkMode, setIsDarkMode] = useLocalStorage('dark_mode', false);
  const [apiKey, setApiKey] = useLocalStorage('gemini_api_key', '');
  const [hasPromptedDocs, setHasPromptedDocs] = useLocalStorage('prompted_docs_phase', '');
  
  // Missing keys found later
  const [isAutoPhase, setIsAutoPhase] = useLocalStorage('profile_academic_phase_auto', true);
  const [jenjang, setJenjang] = useLocalStorage('profile_jenjang', '');
  const [githubUser, setGithubUser] = useLocalStorage('github_username', '');
  const [isHoliday, setIsHoliday] = useLocalStorage('holiday_mode', false);
  const [projects, setProjects] = useLocalStorage('college_projects', []);

  // Fix corrupted thesis state from previous bug
  useEffect(() => {
    if (thesis && !Array.isArray(thesis.todo)) {
      setThesis({
        todo: [], 
        inProgress: [], 
        review: [], 
        done: [] 
      });
    }
  }, [thesis, setThesis]);

  const value = {
    userName, setUserName,
    profilePicture, setProfilePicture,
    fullName, setFullName,
    nim, setNim,
    instansi, setInstansi,
    instansiNickname, setInstansiNickname,
    jurusan, setJurusan,
    semesterProfile, setSemesterProfile,
    academicPhase, setAcademicPhase,
    nextSemesterDate, setNextSemesterDate,
    academicCalendar, setAcademicCalendar,
    semesters, setSemesters,
    tasks, setTasks,
    thesis, setThesis,
    isSidebarCollapsed, setIsSidebarCollapsed,
    isDarkMode, setIsDarkMode,
    apiKey, setApiKey,
    hasPromptedDocs, setHasPromptedDocs,
    isAutoPhase, setIsAutoPhase,
    jenjang, setJenjang,
    githubUser, setGithubUser,
    isHoliday, setIsHoliday,
    projects, setProjects
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
