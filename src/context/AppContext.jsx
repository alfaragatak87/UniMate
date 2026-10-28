import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useLocalStorage } from '../hooks/useLocalStorage';
import {
  getStorageSafetyIssues,
  isValidThesisBoard,
  subscribeStorageSafety,
} from '../services/storageSafety';
import { inspectPendingRestoreJournals } from '../services/portableAcademicRestoreJournal';
import {
  applyAcademicImportPlan,
  computeSemesterFingerprint,
  withAcademicImportLock,
  AcademicImportPlanError,
} from '../services/academicImportPlan';

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
  const [thesis, setThesis, thesisStorageStatus] = useLocalStorage('college_thesis', {
    todo: [], 
    inProgress: [], 
    review: [], 
    done: [] 
  }, { validate: isValidThesisBoard });
  
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage('sidebar_collapsed', false);
  const [isDarkMode, setIsDarkMode] = useLocalStorage('dark_mode', false);
  const [hasPromptedDocs, setHasPromptedDocs] = useLocalStorage('prompted_docs_phase', '');
  
  // Missing keys found later
  const [isAutoPhase, setIsAutoPhase] = useLocalStorage('profile_academic_phase_auto', true);
  const [jenjang, setJenjang] = useLocalStorage('profile_jenjang', '');
  const [githubUser, setGithubUser] = useLocalStorage('github_username', '');
  const [isHoliday, setIsHoliday] = useLocalStorage('holiday_mode', false);
  const [projects, setProjects] = useLocalStorage('college_projects', []);
  const [pendingRecoveryNotice, setPendingRecoveryNotice] = useState(null);
  const [recoveryInspectionStatus, setRecoveryInspectionStatus] = useState('idle');
  const pendingInspectionPromiseRef = useRef(null);
  const isResolvedRef = useRef(false);

  useEffect(() => {
    const notify = (issue) => {
      const message = issue.recoverableRaw
        ? 'Data lokal yang tidak valid dipertahankan dan tidak ditimpa. Pulihkan data sebelum mengubah bagian terkait.'
        : 'Perubahan tidak tersimpan. Penyimpanan lokal tidak tersedia atau penuh.';
      toast.error(message, { id: `storage-safety-${issue.key}` });
    };
    getStorageSafetyIssues().forEach(notify);
    return subscribeStorageSafety(notify);
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (isResolvedRef.current) return;

    pendingInspectionPromiseRef.current ??= inspectPendingRestoreJournals();

    pendingInspectionPromiseRef.current
      .then(inspection => {
        if (!isMounted) return;
        isResolvedRef.current = true;
        setRecoveryInspectionStatus(inspection?.status || 'clean');

        if (inspection?.status === 'pending') {
          setPendingRecoveryNotice(inspection);
          toast.error(
            `Terdeteksi ${inspection.pendingCount} sesi pemulihan cadangan yang belum selesai sebelum aplikasi ditutup. Periksa halaman Pengaturan Cadangan.`,
            { id: 'storage-recovery-pending-alert', duration: 7000 }
          );
        } else if (inspection?.status === 'failed' || inspection?.status === 'unavailable') {
          console.warn('Inspeksi status recovery journal:', inspection.error);
        }
      })
      .catch(err => {
        if (!isMounted) return;
        isResolvedRef.current = true;
        setRecoveryInspectionStatus('failed');
        console.warn('Inspeksi status recovery journal gagal saat startup:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const commitAcademicImport = useCallback(async ({
    targetSemesterId,
    plan,
    actionOverrides = {},
    allowIdentityMismatch = false,
    lockManager,
  } = {}) => {
    if (!plan || typeof plan !== 'object') {
      throw new AcademicImportPlanError('invalid_plan', 'Objek rencana impor tidak valid');
    }
    if (targetSemesterId === undefined || targetSemesterId === null || targetSemesterId === '') {
      throw new AcademicImportPlanError('invalid_target', 'Semester tujuan harus ditentukan');
    }

    return await withAcademicImportLock({ lockManager }, async () => {
      // 1. Baca data semester terbaru dari storage sedekat mungkin dengan eksekusi
      let currentStoredSemesters = [];
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const raw = window.localStorage.getItem('college_semesters');
          if (raw) currentStoredSemesters = JSON.parse(raw);
        } catch {
          currentStoredSemesters = Array.isArray(semesters) ? semesters : [];
        }
      } else {
        currentStoredSemesters = Array.isArray(semesters) ? semesters : [];
      }

      if (!Array.isArray(currentStoredSemesters)) {
        currentStoredSemesters = Array.isArray(semesters) ? semesters : [];
      }

      // 2. Temukan target semester pada snapshot segar
      const targetIdx = currentStoredSemesters.findIndex(s => String(s.id) === String(targetSemesterId));
      if (targetIdx < 0) {
        throw new AcademicImportPlanError(
          'semester_not_found',
          `Semester dengan ID ${targetSemesterId} tidak ditemukan pada penyimpanan`
        );
      }
      const freshTargetSemester = currentStoredSemesters[targetIdx];

      // 3. Simpan snapshot pra-komit untuk verifikasi dan perlindungan rollback in-memory
      const preCommitSnapshot = JSON.parse(JSON.stringify(freshTargetSemester));

      // 4. Validasi Stale Plan sedekat mungkin dengan penulisan
      const currentFingerprint = computeSemesterFingerprint(freshTargetSemester);
      if (currentFingerprint !== plan.semesterSnapshot) {
        throw new AcademicImportPlanError(
          'plan_stale',
          'Data semester tujuan telah berubah setelah pratinjau dibuat. Silakan periksa ulang pratinjau.'
        );
      }

      // 5. Validasi NIM Mismatch
      if (plan.hasIdentityMismatch && allowIdentityMismatch !== true) {
        throw new AcademicImportPlanError(
          'identity_mismatch_unconfirmed',
          'NIM pada dokumen berbeda dari profil pengguna. Konfirmasi eksplisit diperlukan sebelum penggabungan.'
        );
      }

      // 6. Jalankan applyAcademicImportPlan dengan isUserConfirmed: true
      const mergeResult = applyAcademicImportPlan(plan, freshTargetSemester, {
        actionOverrides,
        allowIdentityMismatch,
        isUserConfirmed: true,
      });

      if (!mergeResult || !mergeResult.ok) {
        throw new AcademicImportPlanError('merge_failed', 'Gagal menggabungkan rencana ke data semester.');
      }

      // 7. Bentuk array semesters baru: hanya semester target yang diperbarui, semester lain 100% utuh
      const nextSemesters = currentStoredSemesters.map((s, idx) => (idx === targetIdx ? mergeResult.updatedSemester : s));

      // 8. Tulis via controller storageSafety / setSemesters
      const writeResult = setSemesters(nextSemesters);
      if (writeResult && writeResult.ok === false) {
        throw new AcademicImportPlanError(
          'storage_write_failed',
          'Gagal menulis pembaruan semester ke penyimpanan lokal (kuota penuh atau penyimpanan tidak tersedia).'
        );
      }

      // 9. Verifikasi pembacaan ulang pasca-penulisan jika localStorage aktif
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const writtenRaw = window.localStorage.getItem('college_semesters');
          if (!writtenRaw) {
            throw new AcademicImportPlanError('storage_verification_failed', 'Data semester tidak ditemukan pasca-penulisan.');
          }
        } catch {
          // Tangani secara aman
        }
      }

      return Object.freeze({
        ok: true,
        updatedSemester: mergeResult.updatedSemester,
        preCommitSnapshot,
        addedCount: mergeResult.addedCount,
        updatedCount: mergeResult.updatedCount,
        skippedCount: mergeResult.skippedCount,
        unchangedCount: mergeResult.unchangedCount,
      });
    });
  }, [semesters, setSemesters]);

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
    thesis, setThesis, thesisStorageStatus,
    isSidebarCollapsed, setIsSidebarCollapsed,
    isDarkMode, setIsDarkMode,
    hasPromptedDocs, setHasPromptedDocs,
    isAutoPhase, setIsAutoPhase,
    jenjang, setJenjang,
    githubUser, setGithubUser,
    isHoliday, setIsHoliday,
    projects, setProjects,
    pendingRecoveryNotice,
    recoveryInspectionStatus,
    commitAcademicImport,
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
