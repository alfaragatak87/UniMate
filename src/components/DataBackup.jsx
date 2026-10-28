import { useRef, useState } from 'react';
import {
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  FileText,
  BookOpen,
  CheckSquare,
  Briefcase,
  GraduationCap,
  FileCode,
  Lock,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppContext } from '../context/AppContext';
import {
  createAcademicBackup,
  createAcademicRestorePreview,
} from '../services/academicBackup';
import {
  PORTABLE_BACKUP_MAX_BYTES,
  createPortableAcademicBackup,
  createPortableRestorePreview,
} from '../services/portableAcademicBackup';
import {
  createPortableRestorePlan,
} from '../services/portableAcademicRestorePlan';
import {
  executePortableRestore,
  PortableAcademicRestoreError,
} from '../services/portableAcademicRestoreEngine';
import { courseVaultBinaryStore } from '../services/binaryFileStore';

export default function DataBackup({
  storage = (typeof window !== 'undefined' ? window.localStorage : null),
  binaryStore = courseVaultBinaryStore,
  onExecuteRestore = null,
  isExecutionEnabled = false,
} = {}) {
  let appContext = null;
  try {
    appContext = useAppContext();
  } catch {
    // Toleran jika diuji di luar AppProvider
  }

  const pendingNotice = appContext?.pendingRecoveryNotice || null;

  const [restorePlan, setRestorePlan] = useState(null);
  const [_restorePreview, setRestorePreview] = useState(null);
  const [rawBackupContent, setRawBackupContent] = useState(null);
  const [isValidatingFile, setIsValidatingFile] = useState(false);
  const [isPortableExporting, setIsPortableExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreStage, setRestoreStage] = useState('idle'); // 'idle' | 'validating' | 'staging_binaries' | 'writing_metadata' | 'verifying' | 'completed' | 'error'
  const [restoreStageMessage, setRestoreStageMessage] = useState('');
  const [restoreResult, setRestoreResult] = useState(null);
  const [userConfirmedAddOnly, setUserConfirmedAddOnly] = useState(false);

  const fileInputRef = useRef(null);

  const handleExport = () => {
    try {
      const backup = storage && storage !== localStorage
        ? createAcademicBackup(storage)
        : createAcademicBackup(localStorage);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_kuliah_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data metadata berhasil diekspor.');
    } catch {
      toast.error('Gagal mencadangkan data metadata.');
    }
  };

  const handlePortableExport = async () => {
    if (isPortableExporting) return;
    setIsPortableExporting(true);
    try {
      const backup = storage && storage !== localStorage
        ? await createPortableAcademicBackup(storage, { binaryStore })
        : await createPortableAcademicBackup(localStorage);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_lengkap_unimate_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Cadangan lengkap (metadata + berkas lokal) berhasil diekspor.');
    } catch {
      toast.error('Gagal mengekspor cadangan lengkap. Pastikan berkas lokal tersedia.');
    } finally {
      setIsPortableExporting(false);
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    resetPreview();
    if (file.size > PORTABLE_BACKUP_MAX_BYTES) {
      toast.error(`Ukuran berkas (${(file.size / (1024 * 1024)).toFixed(1)}MB) melebihi batas ${PORTABLE_BACKUP_MAX_BYTES / (1024 * 1024)}MB.`);
      e.target.value = '';
      return;
    }

    setIsValidatingFile(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      const content = event.target.result;
      try {
        const effectiveStorage = storage || (typeof window !== 'undefined' ? window.localStorage : null);
        try {
          createPortableRestorePreview(content, effectiveStorage);
        } catch {
          createAcademicRestorePreview(content, effectiveStorage);
        }
        const plan = await createPortableRestorePlan(content, effectiveStorage, {
          binaryStore,
        });
        setRawBackupContent(content);
        setRestorePlan(plan);
        setRestorePreview(plan);
        setUserConfirmedAddOnly(false);
        setRestoreStage('idle');
        setRestoreResult(null);
        toast.success('Analisis cadangan berhasil. Data lokal belum dimodifikasi.');
      } catch (err) {
        resetPreview();
        const msg = err?.message || 'Format berkas cadangan tidak valid atau rusak.';
        toast.error(`Gagal menganalisis cadangan: ${msg}`);
      } finally {
        setIsValidatingFile(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      resetPreview();
      setIsValidatingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.error('Gagal membaca berkas dari media penyimpanan.');
    };

    reader.readAsText(file);
  };

  const resetPreview = () => {
    setRestorePlan(null);
    setRestorePreview(null);
    setRawBackupContent(null);
    setUserConfirmedAddOnly(false);
    setIsRestoring(false);
    setRestoreStage('idle');
    setRestoreStageMessage('');
    setRestoreResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const executeRestoreAction = async () => {
    if (!restorePlan || !rawBackupContent || isRestoring) return;
    if (!restorePlan.canRestoreClean) {
      toast.error('Pemulihan tidak dapat dilanjutkan karena terdapat konflik data.');
      return;
    }
    if (!userConfirmedAddOnly) {
      toast.error('Mohon centang konfirmasi pemulihan aditif terlebih dahulu.');
      return;
    }

    // Gating Keamanan Produksi
    if (!isExecutionEnabled) {
      toast.error('Jalur penulisan Restore dinonaktifkan pada profil produksi ini sesuai kebijakan bertahap UniMate.');
      return;
    }

    setIsRestoring(true);
    setRestoreStage('validating');
    setRestoreStageMessage('Memvalidasi rencana dan mengunci akses eksklusif...');

    try {
      const effectiveStorage = storage || (typeof window !== 'undefined' ? window.localStorage : null);

      let result;
      if (typeof onExecuteRestore === 'function') {
        result = await onExecuteRestore({
          rawBackupContent,
          restorePlan,
          storage: effectiveStorage,
          binaryStore,
          onStageChange: (stage, msg) => {
            setRestoreStage(stage);
            setRestoreStageMessage(msg);
          },
        });
      } else {
        setRestoreStage('staging_binaries');
        setRestoreStageMessage('Menyimpan berkas biner dan teks OCR ke vault...');

        result = await executePortableRestore(rawBackupContent, effectiveStorage, {
          binaryStore,
          expectedPlan: restorePlan,
        });

        setRestoreStage('verifying');
        setRestoreStageMessage('Memverifikasi integritas penulisan...');
      }

      setRestoreStage('completed');
      setRestoreStageMessage('Pemulihan aditif berhasil dikonfirmasi dan selesai.');
      setRestoreResult(result);
      toast.success('Pemulihan data aditif berhasil diselesaikan!');
    } catch (err) {
      setRestoreStage('error');
      const errCode = err?.code || 'unknown_error';
      let userFriendlyMessage = 'Terjadi kesalahan saat memulihkan data.';
      if (errCode === 'conflict_detected') {
        userFriendlyMessage = 'Ditemukan konflik data lokal yang membatalkan pemulihan.';
      } else if (errCode === 'plan_stale') {
        userFriendlyMessage = 'Penyimpanan lokal berubah sejak pratinjau dibuat. Harap analisis ulang.';
      } else if (errCode === 'restore_locked') {
        userFriendlyMessage = 'Operasi pemulihan lain sedang berjalan pada jendela lain.';
      } else if (errCode === 'quota_exceeded') {
        userFriendlyMessage = 'Media penyimpanan penuh saat memproses berkas.';
      } else if (err instanceof PortableAcademicRestoreError) {
        userFriendlyMessage = err.message;
      }
      setRestoreStageMessage(userFriendlyMessage);
      toast.error(`Pemulihan gagal: ${userFriendlyMessage}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem', width: '100%' }}>
      {/* Notifikasi Sesi Pemulihan Tertunda dari Startup */}
      {pendingNotice && pendingNotice.hasPending && (
        <div
          role="alert"
          style={{
            padding: '1rem',
            borderRadius: '10px',
            backgroundColor: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            color: 'var(--text-main)',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
            fontSize: '0.875rem',
          }}
        >
          <AlertTriangle size={20} color="#eab308" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Peringatan Pemulihan Tertunda ({pendingNotice.pendingCount} entri)</strong>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)' }}>
              Aplikasi mendeteksi adanya sesi pemulihan sebelumnya yang belum selesai sebelum aplikasi ditutup.
              Data lokal pengguna dilindungi dan tidak di-rollback otomatis demi keamanan.
            </p>
          </div>
        </div>
      )}

      {/* Tombol Aksi Ekspor dan Unggah Validasi */}
      <div style={{ display: 'flex', gap: '1rem', width: '100%', flexWrap: 'wrap' }}>
        <button
          onClick={handleExport}
          className="btn btn-outline"
          style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
        >
          <Download size={18} /> Ekspor Metadata (.json)
        </button>

        <button
          onClick={() => void handlePortableExport()}
          disabled={isPortableExporting}
          className="btn btn-outline"
          style={{ flex: 1, minWidth: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
        >
          <Download size={18} />
          {isPortableExporting ? 'Memverifikasi Berkas...' : 'Ekspor Lengkap + Berkas'}
        </button>

        <label
          className="btn btn-outline"
          style={{
            flex: 1,
            minWidth: '180px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            cursor: isValidatingFile ? 'not-allowed' : 'pointer',
            margin: 0,
            opacity: isValidatingFile ? 0.6 : 1,
          }}
        >
          <Upload size={18} />
          {isValidatingFile ? 'Menganalisis Cadangan...' : 'Validasi & Pratinjau Cadangan'}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            disabled={isValidatingFile}
            onChange={handleImport}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* Panel Rincian Pratinjau Rencana Pemulihan */}
      {restorePlan && (
        <div
          role="region"
          aria-label="Pratinjau Rencana Pemulihan Cadangan"
          style={{
            padding: '1.25rem',
            borderRadius: '12px',
            backgroundColor: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--border-color, #e5e7eb)',
            color: 'var(--text-main)',
            display: 'grid',
            gap: '1rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          }}
        >
          {/* Header Metadata Cadangan */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>
                  Pratinjau Cadangan: {restorePlan.portable ? 'Cadangan Lengkap Portabel' : 'Cadangan Metadata'}
                </h4>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: '#2563eb',
                    fontWeight: 500,
                  }}
                >
                  Versi {restorePlan.version}
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Lock size={12} /> Tidak Dienkripsi
                </span>
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Diekspor pada: {new Date(restorePlan.exportedAt).toLocaleString('id-ID')}
              </p>
            </div>

            {/* Badge Status Kesiapan Aditif */}
            <div>
              {restorePlan.canRestoreClean ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    color: '#16a34a',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                  }}
                >
                  <ShieldCheck size={16} /> Siap Dipulihkan Secara Aditif (0 Konflik)
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#dc2626',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                  }}
                >
                  <ShieldAlert size={16} /> Ditemukan {restorePlan.summary.conflicts} Konflik Data
                </span>
              )}
            </div>
          </div>

          {/* Peringatan Risiko Cadangan v1 */}
          {restorePlan.risks && restorePlan.risks.length > 0 && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                fontSize: '0.825rem',
                color: 'var(--text-main)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, marginBottom: '0.25rem', color: '#d97706' }}>
                <AlertTriangle size={16} /> Catatan Integritas & Risiko Cadangan
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {restorePlan.risks.map((risk, idx) => (
                  <li key={idx} style={{ marginTop: '0.2rem' }}>{risk}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Grid Rincian Entitas Akademik & Dokumen */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.75rem',
            }}
          >
            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <BookOpen size={14} /> Semester & Kuliah
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {restorePlan.entities.semesters.length} <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>semester</span>
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <CheckSquare size={14} /> Tugas Kuliah
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {restorePlan.entities.tasks.length}
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <Briefcase size={14} /> Proyek Kuliah
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {restorePlan.entities.projects.length}
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <GraduationCap size={14} /> Papan Skripsi
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.4rem' }}>
                {restorePlan.entities.thesis.status === 'add' ? 'Baru' : restorePlan.entities.thesis.status === 'unchanged' ? 'Identik' : 'Konflik'}
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <FileText size={14} /> Berkas Fisik
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {restorePlan.entities.binaries.length} <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>file</span>
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                <FileCode size={14} /> Teks OCR
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {restorePlan.entities.texts.length} <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>entri</span>
              </div>
            </div>
          </div>

          {/* Rangkuman Metrik Tindakan */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-color)',
              fontSize: '0.85rem',
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
            }}
          >
            <span>
              <strong>Akan Ditambahkan:</strong> <span style={{ color: '#16a34a', fontWeight: 600 }}>{restorePlan.summary.toAdd}</span> item baru
            </span>
            <span>
              <strong>Akan Dilewati (Identik):</strong> <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{restorePlan.summary.toSkip}</span> item
            </span>
            <span>
              <strong>Konflik Data:</strong> <span style={{ color: restorePlan.summary.conflicts > 0 ? '#dc2626' : 'var(--text-muted)', fontWeight: 600 }}>{restorePlan.summary.conflicts}</span> item
            </span>
          </div>

          {/* Rincian Konflik (jika ada) */}
          {restorePlan.summary.conflicts > 0 && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: '0.825rem',
              }}
            >
              <strong style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <XCircle size={16} /> Rincian Konflik yang Menghalangi Pemulihan:
              </strong>
              <div style={{ maxHeight: '140px', overflowY: 'auto', marginTop: '0.5rem', display: 'grid', gap: '0.35rem' }}>
                {restorePlan.entities.semesters.filter(s => s.status === 'conflict').map(s => (
                  <div key={s.id}>• Semester "{s.name}": {s.reason}</div>
                ))}
                {restorePlan.entities.courses.filter(c => c.status === 'conflict').map(c => (
                  <div key={c.id}>• Mata Kuliah "{c.name}": {c.reason}</div>
                ))}
                {restorePlan.entities.tasks.filter(t => t.status === 'conflict').map(t => (
                  <div key={t.id}>• Tugas "{t.title}": {t.reason}</div>
                ))}
                {restorePlan.entities.projects.filter(p => p.status === 'conflict').map(p => (
                  <div key={p.id}>• Proyek "{p.title}": {p.reason}</div>
                ))}
                {restorePlan.entities.thesis.status === 'conflict' && (
                  <div>• Skripsi / Kanban: {restorePlan.entities.thesis.reason}</div>
                )}
                {restorePlan.entities.binaries.filter(b => b.status === 'conflict').map(b => (
                  <div key={b.id}>• Berkas "{b.name}": {b.reason}</div>
                ))}
                {restorePlan.entities.texts.filter(t => t.status === 'conflict').map(t => (
                  <div key={t.id}>• Teks Dokumen #{t.id}: {t.reason}</div>
                ))}
              </div>
            </div>
          )}

          {/* Penegasan Kebijakan Additive Only */}
          <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
            <strong>Kebijakan Pemulihan Aditif:</strong> UniMate hanya mendukung penambahan data baru yang belum ada di profil lokal.
            Data yang sudah tersimpan di perangkat Anda tidak akan pernah ditimpa, dihapus, atau di-reset (opsi Overwrite dan Clean Slate tidak tersedia).
          </div>

          {/* Indikator Status Eksekusi / Gating Produksi */}
          {!isExecutionEnabled ? (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(107, 114, 128, 0.1)',
                border: '1px dashed var(--border-color)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--text-muted)',
              }}
            >
              <Info size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Restore tetap dinonaktifkan pada profil produksi</strong>
                <p style={{ margin: 0, fontSize: '0.775rem' }}>
                  Pratinjau rencana berhasil divalidasi. Restore tetap dinonaktifkan demi perlindungan data akademik sesuai kebijakan rilis bertahap.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {/* Konfirmasi Pengguna Eksplisit */}
              {restoreStage === 'idle' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={userConfirmedAddOnly}
                    onChange={(e) => setUserConfirmedAddOnly(e.target.checked)}
                    disabled={!restorePlan.canRestoreClean || isRestoring}
                  />
                  <span>Saya mengonfirmasi untuk menambahkan {restorePlan.summary.toAdd} data baru secara aditif ke penyimpanan lokal.</span>
                </label>
              )}

              {/* Progress Tahapan Nyata */}
              {restoreStage !== 'idle' && (
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    backgroundColor: restoreStage === 'completed' ? 'rgba(34, 197, 94, 0.1)' : restoreStage === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isRestoring && <RefreshCw size={16} className="animate-spin" />}
                  {restoreStage === 'completed' && <CheckCircle2 size={16} color="#16a34a" />}
                  {restoreStage === 'error' && <XCircle size={16} color="#dc2626" />}
                  <div>
                    <div>{restoreStageMessage}</div>
                    {restoreResult && restoreResult.summary && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                        Dipulihkan: {restoreResult.summary.binariesRestored ?? 0} berkas fisik, {restoreResult.summary.textsRestored ?? 0} teks OCR.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tombol Kontrol Bawah */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button
              className="btn btn-outline"
              onClick={resetPreview}
              disabled={isRestoring}
              style={{ padding: '0.6rem 1.2rem', fontSize: '0.85rem' }}
            >
              {restoreStage === 'completed' ? 'Selesai & Tutup' : 'Batalkan Pratinjau'}
            </button>

            {isExecutionEnabled && restoreStage !== 'completed' && (
              <button
                className="btn btn-primary"
                onClick={() => void executeRestoreAction()}
                disabled={!restorePlan.canRestoreClean || !userConfirmedAddOnly || isRestoring}
                style={{
                  padding: '0.6rem 1.25rem',
                  fontSize: '0.85rem',
                  opacity: (!restorePlan.canRestoreClean || !userConfirmedAddOnly || isRestoring) ? 0.6 : 1,
                  cursor: (!restorePlan.canRestoreClean || !userConfirmedAddOnly || isRestoring) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {isRestoring ? 'Sedang Memulihkan...' : 'Mulai Pemulihan Aditif'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
