import { useState, useMemo } from 'react';
import {
  X,
  Check,
  AlertTriangle,
  CheckCircle,
  Sparkles,
  Eye,
} from 'lucide-react';
import { VALID_LETTER_GRADES, STANDARD_DAYS, detectScheduleClashes } from '../services/offlineAcademicParser';

/**
 * Normalisasi string perbandingan identitas.
 */
function cleanIdentity(str) {
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * Validasi SKS: angka bulat antara 1 dan 12.
 */
function isValidSksValue(val) {
  const num = Number(val);
  return Number.isInteger(num) && num >= 1 && num <= 12;
}

export default function AcademicCandidateReviewModal({
  isOpen,
  candidate,
  ocrText,
  userProfile = {},
  semesters = [],
  onClose,
  onCompleteReview,
}) {
  const candidateSafe = candidate || {};
  const isKrs = candidateSafe.documentType === 'KRS';
  const isKhs = candidateSafe.documentType === 'KHS';

  // Inisialisasi draft mata kuliah dengan deep clone agar tidak memutasi kandidat asli.
  const [coursesDraft, setCoursesDraft] = useState(() => {
    const sourceCourses = Array.isArray(candidate?.courses) ? candidate.courses : [];
    return sourceCourses.map((c, idx) => {
      const rawPoint = c.point ?? c.gradePoint ?? null;
      const safePoint = (rawPoint !== null && rawPoint >= 0 && rawPoint <= 4.0) ? rawPoint : null;
      const initialReasons = Array.isArray(c.reviewReasons) ? [...c.reviewReasons] : [];
      if (rawPoint !== null && rawPoint > 4.0 && !initialReasons.includes('ambiguous_grade_point_or_total_mutu')) {
        initialReasons.push('ambiguous_grade_point_or_total_mutu');
      }

      return {
        ...c,
        id: c.id || `candidate-${idx + 1}`,
        code: c.code || '',
        name: c.name || '',
        sks: c.sks ?? '',
        grade: c.grade || '',
        sourceGrade: c.grade || '',
        point: safePoint,
        gradePoint: safePoint,
        sourcePoint: safePoint,
        class: c.class || '',
        day: c.day || '',
        timeStart: c.timeStart || '',
        timeEnd: c.timeEnd || '',
        room: c.room || '',
        lecturer: c.lecturer || '',
        mode: c.mode || '',
        schedules: Array.isArray(c.schedules) ? [...c.schedules] : [],
        included: c.included !== false,
        needsReview: initialReasons.length > 0 || (c.needsReview ?? false),
        reviewReasons: initialReasons,
        evidence: c.evidence ? { ...c.evidence } : { rawLine: '' },
      };
    });
  });

  const [plannedSemesterId, setPlannedSemesterId] = useState(() => {
    // Cari semester yang cocok dengan semesterNumber atau semesterName jika ada
    if (candidate.semesterNumber) {
      const match = semesters.find(s => s.name && s.name.includes(String(candidate.semesterNumber)));
      if (match) return match.id;
    }
    const current = semesters.find(s => s.status === 'current');
    return current ? current.id : (semesters[0]?.id || '');
  });

  const [activeCourseIndex, setActiveCourseIndex] = useState(0);
  const [filterOnlyReview, setFilterOnlyReview] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Verifikasi Identitas Mahasiswa vs userProfile
  const identityCheck = useMemo(() => {
    const docNim = candidate.student?.nim || '';
    const docName = candidate.student?.name || '';
    const profNim = userProfile?.nim || '';
    const profName = userProfile?.fullName || userProfile?.userName || '';

    const nimMismatch = Boolean(
      docNim.trim() && profNim.trim() && cleanIdentity(docNim) !== cleanIdentity(profNim)
    );
    const nameMismatch = Boolean(
      docName.trim() && profName.trim() && cleanIdentity(docName) !== cleanIdentity(profName)
    );

    const hasWarning = nimMismatch || nameMismatch;
    const isMatched = Boolean(
      (docNim && profNim && !nimMismatch) || (docName && profName && !nameMismatch)
    );

    return {
      docNim,
      docName,
      profNim,
      profName,
      nimMismatch,
      nameMismatch,
      hasWarning,
      isMatched,
    };
  }, [candidate.student, userProfile]);

  // Statistik pilihan mata kuliah
  const stats = useMemo(() => {
    const total = coursesDraft.length;
    const includedCount = coursesDraft.filter(c => c.included).length;
    const reviewCount = coursesDraft.filter(c => c.needsReview).length;
    const totalSks = coursesDraft
      .filter(c => c.included && isValidSksValue(c.sks))
      .reduce((acc, c) => acc + Number(c.sks), 0);
    return { total, includedCount, reviewCount, totalSks };
  }, [coursesDraft]);

  // Teks sumber OCR yang diproses: utamakan ocrText
  const sourceText = typeof ocrText === 'string' ? ocrText : '';

  // Baris bukti aktif
  const activeCourse = coursesDraft[activeCourseIndex] || null;
  const activeRawLine = activeCourse?.evidence?.rawLine?.trim() || '';

  // Handler koreksi field mata kuliah
  const handleCourseFieldChange = (index, field, value) => {
    setCoursesDraft(prev => {
      const next = [...prev];
      const target = { ...next[index] };

      if (field === 'sks') {
        target.sks = value;
        // Validasi SKS real-time
        if (value === '' || !isValidSksValue(value)) {
          if (!target.reviewReasons.includes('sks_invalid')) {
            target.reviewReasons = [...target.reviewReasons, 'sks_invalid'];
          }
          target.needsReview = true;
        } else {
          target.reviewReasons = target.reviewReasons.filter(r => r !== 'sks_invalid');
          target.needsReview = target.reviewReasons.length > 0;
        }
      } else if (field === 'grade') {
        const upperGrade = value.trim().toUpperCase();
        target.grade = upperGrade;
        if (upperGrade && !VALID_LETTER_GRADES.has(upperGrade)) {
          if (!target.reviewReasons.includes('grade_unrecognized')) {
            target.reviewReasons = [...target.reviewReasons, 'grade_unrecognized'];
          }
          target.needsReview = true;
          target.point = null;
          target.gradePoint = null;
        } else {
          target.reviewReasons = target.reviewReasons.filter(r => r !== 'grade_unrecognized');
          if (upperGrade && upperGrade === target.sourceGrade) {
            // Nilai dikembalikan ke nilai awal dokumen: pulihkan bobot bersumber asli
            target.point = target.sourcePoint;
            target.gradePoint = target.sourcePoint;
            target.reviewReasons = target.reviewReasons.filter(r => r !== 'unverified_grade_point');
          } else if (upperGrade) {
            // Nilai diubah oleh pengguna: jangan berasumsi bobot tanpa aturan skala resmi universitas
            target.point = null;
            target.gradePoint = null;
            if (!target.reviewReasons.includes('unverified_grade_point')) {
              target.reviewReasons = [...target.reviewReasons, 'unverified_grade_point'];
            }
          } else {
            target.point = null;
            target.gradePoint = null;
            target.reviewReasons = target.reviewReasons.filter(r => r !== 'unverified_grade_point');
          }
          target.needsReview = target.reviewReasons.length > 0;
        }
      } else if (field === 'name') {
        target.name = value;
        if (!value.trim()) {
          if (!target.reviewReasons.includes('course_name_empty')) {
            target.reviewReasons = [...target.reviewReasons, 'course_name_empty'];
          }
          target.needsReview = true;
        } else {
          target.reviewReasons = target.reviewReasons.filter(r => r !== 'course_name_empty');
          target.needsReview = target.reviewReasons.length > 0;
        }
      } else if (field === 'point' || field === 'gradePoint') {
        const parsed = (value === '' || value === null) ? null : Number.parseFloat(value);
        target.point = parsed;
        target.gradePoint = parsed;
        if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 4.0)) {
          if (!target.reviewReasons.includes('invalid_gradepoint_range')) {
            target.reviewReasons = [...target.reviewReasons, 'invalid_gradepoint_range'];
          }
          target.needsReview = true;
        } else {
          target.reviewReasons = target.reviewReasons.filter(
            r => r !== 'invalid_gradepoint_range' && r !== 'ambiguous_grade_point_or_total_mutu'
          );
          target.needsReview = target.reviewReasons.length > 0;
        }
      } else {
        target[field] = value;
      }

      next[index] = target;
      return next;
    });
    setIsDirty(true);
  };

  const toggleCourseIncluded = (index) => {
    setCoursesDraft(prev => {
      const next = [...prev];
      next[index] = { ...next[index], included: !next[index].included };
      return next;
    });
    setIsDirty(true);
  };

  const handleSelectAll = (select) => {
    setCoursesDraft(prev => prev.map(c => ({ ...c, included: select })));
    setIsDirty(true);
  };

  const handleClose = () => {
    if (isDirty) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Terdapat perubahan draft koreksi yang belum diselesaikan. Anda yakin ingin membatalkan?')) {
          return;
        }
      }
    }
    onClose();
  };

  const handleSaveReview = () => {
    // Validasi baris yang di-include
    const activeSelected = coursesDraft.filter(c => c.included);
    if (activeSelected.length === 0 && coursesDraft.length > 0) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Tidak ada mata kuliah yang dipilih. Lanjutkan menyelesaikan review dengan 0 mata kuliah?')) {
          return;
        }
      }
    }

    // Format output kandidat terperbarui
    const updatedCandidate = {
      ...candidate,
      courses: coursesDraft.map(c => ({
        ...c,
        sks: c.sks !== '' && isValidSksValue(c.sks) ? Number(c.sks) : (c.sks === '' ? null : c.sks),
        grade: isKrs ? null : (c.grade || null),
        point: isKrs ? null : (c.point ?? null),
        gradePoint: isKrs ? null : (c.gradePoint ?? null),
        class: c.class || null,
        day: c.day || null,
        timeStart: c.timeStart || null,
        timeEnd: c.timeEnd || null,
        room: c.room || null,
        lecturer: c.lecturer || null,
        mode: c.mode || null,
        schedules: Array.isArray(c.schedules) ? c.schedules : [],
      })),
      selectedCourses: coursesDraft.filter(c => c.included),
      plannedSemesterId,
      isReviewed: true,
      summary: {
        ...candidate.summary,
        totalSks: stats.totalSks,
      },
    };

    onCompleteReview({
      updatedCandidate,
      plannedSemesterId,
      coursesDraft,
    });
  };

  // Deteksi Bentrok Jadwal Antara Mata Kuliah Kandidat
  const scheduleClashes = useMemo(() => {
    return detectScheduleClashes(coursesDraft.filter(c => c.included));
  }, [coursesDraft]);

  // Kursus existing pada semester target untuk pembanding
  const plannedSemester = useMemo(() => {
    return semesters.find(s => String(s.id) === String(plannedSemesterId)) || null;
  }, [semesters, plannedSemesterId]);

  // Filter daftar tampilan
  const displayedCourses = filterOnlyReview
    ? coursesDraft.filter(c => c.needsReview)
    : coursesDraft;

  if (!isOpen || !candidate) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        overflowY: 'auto',
      }}
      onClick={handleClose}
    >
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '1100px',
          maxHeight: '92vh',
          backgroundColor: 'var(--card-bg, #ffffff)',
          color: 'var(--text-main, #0f172a)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--border-color, #e2e8f0)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-color, #f8fafc)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: isKrs ? '#3b82f6' : '#8b5cf6',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Review &amp; Koreksi Kandidat {candidate.documentType}
                </h3>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '6px',
                    backgroundColor: isKrs ? '#dbeafe' : '#ede9fe',
                    color: isKrs ? '#1e40af' : '#6b21a8',
                  }}
                >
                  {candidate.documentType} OFFLINE
                </span>
                {stats.reviewCount > 0 && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      backgroundColor: '#fef3c7',
                      color: '#92400e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <AlertTriangle size={12} /> {stats.reviewCount} Perlu Diperiksa
                  </span>
                )}
              </div>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                Periksa bukti teks OCR di sebelah kiri dan koreksi kandidat data di sebelah kanan sebelum menyelesaikan review.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={handleClose}
            title="Tutup Review"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.4rem',
              borderRadius: '8px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body: Two-Panel Layout */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(300px, 1.05fr) minmax(400px, 1.45fr)',
            gap: '1rem',
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            maxHeight: 'calc(92vh - 160px)',
          }}
        >
          {/* PANEL KIRI: Bukti OCR & Info Dokumen */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              borderRight: '1px solid var(--border-color, #e2e8f0)',
              paddingRight: '1rem',
            }}
          >
            {/* Banner Verifikasi Identitas Mahasiswa */}
            {identityCheck.hasWarning && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fef3c7',
                  color: '#92400e',
                  fontSize: '0.82rem',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  <AlertTriangle size={15} color="#d97706" /> Perhatian Identitas Dokumen
                </div>
                <div>
                  NIM/Nama pada dokumen ({identityCheck.docNim || 'tanpa NIM'} - {identityCheck.docName || 'tanpa nama'}) berbeda dengan profil Anda ({identityCheck.profNim || 'profil kosong'} - {identityCheck.profName || 'profil kosong'}). Pastikan dokumen ini memang milik Anda.
                </div>
              </div>
            )}

            {identityCheck.isMatched && !identityCheck.hasWarning && (
              <div
                style={{
                  padding: '0.6rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontWeight: 600,
                }}
              >
                <CheckCircle size={15} color="#16a34a" /> Identitas Dokumen Sesuai Profil Mahasiswa
              </div>
            )}

            {/* Kartu Ringkasan Dokumen */}
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                backgroundColor: 'var(--bg-color, #f8fafc)',
                border: '1px solid var(--border-color, #e2e8f0)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                fontSize: '0.84rem',
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                Metadata Dokumen Terdeteksi
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Semester:</span>{' '}
                  <strong>{candidate.semesterName || 'Tidak Terbaca'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tahun Akademik:</span>{' '}
                  <strong>{candidate.academicYear || '-'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>NIM:</span>{' '}
                  <strong>{candidate.student?.nim || 'Tidak Terbaca'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Nama:</span>{' '}
                  <strong>{candidate.student?.name || 'Tidak Terbaca'}</strong>
                </div>
              </div>

              {/* Ringkasan Nilai KHS / SKS KRS */}
              <div
                style={{
                  marginTop: '0.25rem',
                  paddingTop: '0.4rem',
                  borderTop: '1px dashed var(--border-color)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Total SKS Dokumen:</span>{' '}
                  <strong style={{ color: 'var(--primary-color)' }}>{candidate.summary?.totalSks ?? stats.totalSks} SKS</strong>
                </div>
                {isKhs && (
                  <>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>IPS Tercetak:</span>{' '}
                      <strong>{candidate.summary?.ips ?? '-'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>IPK Tercetak:</span>{' '}
                      <strong>{candidate.summary?.ipk ?? '-'}</strong>
                    </div>
                  </>
                )}
              </div>
              {isKhs && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  * IPS/IPK di atas adalah teks asli yang tercetak pada KHS, bukan hasil perhitungan otomatis aplikasi.
                </div>
              )}
            </div>

            {/* Bukti Baris OCR Terpilih */}
            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Eye size={14} /> Bukti Baris OCR Terpilih
                </span>
                <span style={{ fontSize: '0.75rem', color: '#3b82f6' }}>
                  {activeCourse ? `Baris #${activeCourseIndex + 1}` : 'Tidak ada'}
                </span>
              </div>
              <div
                style={{
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                  backgroundColor: '#ffffff',
                  padding: '0.5rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid #93c5fd',
                  color: '#1e3a8a',
                  wordBreak: 'break-all',
                }}
              >
                {activeRawLine || '(Pilih mata kuliah di panel kanan untuk melihat bukti teks OCR)'}
              </div>
            </div>

            {/* Teks OCR Lengkap (Scrollable Viewer) */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '180px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  Teks OCR Sumber ({sourceText.length.toLocaleString('id-ID')} karakter)
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  maxHeight: '260px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-color, #f8fafc)',
                  padding: '0.65rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text-main)',
                }}
              >
                {sourceText || '(Teks OCR kosong)'}
              </div>
            </div>
          </div>

          {/* PANEL KANAN: Tabel Kandidat & Koreksi Interaktif */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Toolbar Kontrol Tabel */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'var(--bg-color, #f8fafc)',
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem' }}>
                <span>
                  <strong>{stats.includedCount}</strong> dari <strong>{stats.total}</strong> mata kuliah dipilih
                </span>
                <span style={{ color: 'var(--text-muted)' }}>· Total {stats.totalSks} SKS</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => handleSelectAll(true)}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                >
                  Pilih Semua
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => handleSelectAll(false)}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                >
                  Abaikan Semua
                </button>
                {stats.reviewCount > 0 && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '6px',
                      backgroundColor: filterOnlyReview ? '#fef3c7' : 'transparent',
                      color: filterOnlyReview ? '#92400e' : 'var(--text-muted)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={filterOnlyReview}
                      onChange={e => setFilterOnlyReview(e.target.checked)}
                      style={{ margin: 0 }}
                    />
                    <span>Hanya Perlu Diperiksa</span>
                  </label>
                )}
              </div>
            </div>

            {/* Peringatan Bentrok Jadwal Realtime */}
            {scheduleClashes.length > 0 && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  fontSize: '0.78rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                  <AlertTriangle size={15} color="#dc2626" />
                  <span>Peringatan: Terdapat {scheduleClashes.length} bentrok jadwal perkuliahan terdeteksi!</span>
                </div>
                {scheduleClashes.map((clash, cIdx) => (
                  <div key={cIdx} style={{ marginLeft: '1.4rem' }}>
                    • {clash.message}
                  </div>
                ))}
              </div>
            )}

            {/* List / Tabel Mata Kuliah */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                maxHeight: '380px',
                overflowY: 'auto',
                paddingRight: '0.25rem',
              }}
            >
              {displayedCourses.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Tidak ada mata kuliah yang cocok dengan filter saat ini.
                </div>
              ) : (
                displayedCourses.map((c, index) => {
                  const actualIndex = coursesDraft.findIndex(orig => orig.id === c.id);
                  const isCurrentActive = actualIndex === activeCourseIndex;

                  return (
                    <div
                      key={c.id || index}
                      onClick={() => setActiveCourseIndex(actualIndex)}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: isCurrentActive
                          ? '2px solid var(--primary-color, #4f46e5)'
                          : '1px solid var(--border-color, #e2e8f0)',
                        backgroundColor: !c.included
                          ? 'rgba(241, 245, 249, 0.6)'
                          : isCurrentActive
                            ? 'rgba(79, 70, 229, 0.04)'
                            : 'var(--card-bg, #ffffff)',
                        opacity: c.included ? 1 : 0.65,
                        transition: 'all 0.15s ease',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      {/* Baris Atas: Checkbox, Kode, Nama, Status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <input
                          type="checkbox"
                          checked={c.included}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleCourseIncluded(actualIndex);
                          }}
                          title={c.included ? 'Abaikan baris ini' : 'Gunakan baris ini'}
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />

                        {/* Input Kode MK */}
                        <input
                          type="text"
                          placeholder="Kode"
                          value={c.code || ''}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleCourseFieldChange(actualIndex, 'code', e.target.value)}
                          style={{
                            width: '90px',
                            padding: '0.35rem 0.5rem',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-color)',
                            color: 'var(--text-main)',
                          }}
                        />

                        {/* Input Nama MK */}
                        <input
                          type="text"
                          placeholder="Nama Mata Kuliah"
                          value={c.name || ''}
                          onClick={e => e.stopPropagation()}
                          onChange={e => handleCourseFieldChange(actualIndex, 'name', e.target.value)}
                          style={{
                            flex: 1,
                            padding: '0.35rem 0.5rem',
                            fontSize: '0.84rem',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: !c.name.trim() ? '1px solid #ef4444' : '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-color)',
                            color: 'var(--text-main)',
                          }}
                        />

                        {/* Input SKS */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <input
                            type="number"
                            min="1"
                            max="12"
                            placeholder="SKS"
                            value={c.sks}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'sks', e.target.value)}
                            style={{
                              width: '54px',
                              padding: '0.35rem 0.4rem',
                              fontSize: '0.8rem',
                              textAlign: 'center',
                              borderRadius: '6px',
                              border: !isValidSksValue(c.sks) ? '1px solid #ef4444' : '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-color)',
                              color: 'var(--text-main)',
                            }}
                          />
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SKS</span>
                        </div>

                        {/* Input Nilai KHS (Hanya jika KHS) */}
                        {isKhs ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input
                              type="text"
                              maxLength="4"
                              placeholder="Nilai"
                              value={c.grade || ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => handleCourseFieldChange(actualIndex, 'grade', e.target.value)}
                              style={{
                                width: '56px',
                                padding: '0.35rem 0.4rem',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                textAlign: 'center',
                                borderRadius: '6px',
                                border: c.grade && !VALID_LETTER_GRADES.has(c.grade)
                                  ? '1px solid #ef4444'
                                  : '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-color)',
                                color: 'var(--text-main)',
                              }}
                            />
                            {c.point !== null && c.point !== undefined && (
                              <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>
                                ({c.point})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                              padding: '0.2rem 0.4rem',
                              backgroundColor: 'var(--bg-color)',
                              borderRadius: '4px',
                            }}
                            title="KRS tidak memiliki nilai huruf"
                          >
                            KRS (-)
                          </span>
                        )}
                      </div>

                      {/* Sub-baris Editor Jadwal Perkuliahan */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.4rem',
                          marginLeft: '26px',
                          padding: '0.35rem 0.5rem',
                          backgroundColor: 'var(--bg-color, #f8fafc)',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color, #e2e8f0)',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Hari:</span>
                          <select
                            value={c.day || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'day', e.target.value || null)}
                            style={{
                              padding: '0.2rem 0.35rem',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          >
                            <option value="">-</option>
                            {STANDARD_DAYS.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Jam:</span>
                          <input
                            type="text"
                            placeholder="08:00"
                            value={c.timeStart || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'timeStart', e.target.value)}
                            style={{
                              width: '48px',
                              padding: '0.2rem 0.25rem',
                              fontSize: '0.75rem',
                              textAlign: 'center',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          />
                          <span>-</span>
                          <input
                            type="text"
                            placeholder="10:30"
                            value={c.timeEnd || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'timeEnd', e.target.value)}
                            style={{
                              width: '48px',
                              padding: '0.2rem 0.25rem',
                              fontSize: '0.75rem',
                              textAlign: 'center',
                              fontFamily: 'monospace',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Kls:</span>
                          <input
                            type="text"
                            placeholder="A"
                            value={c.class || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'class', e.target.value)}
                            style={{
                              width: '42px',
                              padding: '0.2rem 0.25rem',
                              fontSize: '0.75rem',
                              textAlign: 'center',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Ruang:</span>
                          <input
                            type="text"
                            placeholder="R.301 / Lab"
                            value={c.room || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'room', e.target.value)}
                            style={{
                              width: '85px',
                              padding: '0.2rem 0.35rem',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1, minWidth: '120px' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Dosen:</span>
                          <input
                            type="text"
                            placeholder="Nama Dosen"
                            value={c.lecturer || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => handleCourseFieldChange(actualIndex, 'lecturer', e.target.value)}
                            style={{
                              flex: 1,
                              padding: '0.2rem 0.35rem',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--card-bg)',
                              color: 'var(--text-main)',
                            }}
                          />
                        </div>
                      </div>

                      {/* Pembanding Jadwal Existing di Semester Tujuan */}
                      {(() => {
                        const existingCourses = Array.isArray(plannedSemester?.courses) ? plannedSemester.courses : [];
                        const matched = existingCourses.find(ec => {
                          if (typeof ec === 'string') {
                            return ec.toLowerCase().includes((c.name || '').toLowerCase());
                          }
                          return (c.code && ec.code && c.code.trim().toUpperCase() === ec.code.trim().toUpperCase())
                            || (c.name && ec.name && c.name.trim().toLowerCase() === ec.name.trim().toLowerCase());
                        });
                        if (!matched || typeof matched === 'string') return null;
                        const existSchedStr = [
                          matched.day,
                          matched.timeStart ? `${matched.timeStart}${matched.timeEnd ? `-${matched.timeEnd}` : ''}` : null,
                          matched.room ? `(${matched.room})` : null,
                        ].filter(Boolean).join(' ');

                        if (!existSchedStr) return null;

                        return (
                          <div style={{ marginLeft: '26px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            Jadwal existing di {plannedSemester?.name || 'semester'}: <strong>{existSchedStr}</strong>
                          </div>
                        );
                      })()}

                      {/* Baris Bawah: Peringatan Ambigu & Alasan */}
                      {c.needsReview && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            fontSize: '0.75rem',
                            color: '#b45309',
                            backgroundColor: '#fffbeb',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            marginLeft: '26px',
                          }}
                        >
                          <AlertTriangle size={12} color="#d97706" />
                          <span>
                            Perlu Diperiksa:{' '}
                            {c.reviewReasons
                              .map(r => {
                                if (r === 'sks_invalid') return 'SKS tidak valid (harus 1-12)';
                                if (r === 'grade_unrecognized') return 'Nilai huruf tidak dikenal';
                                if (r === 'course_name_empty') return 'Nama mata kuliah kosong';
                                if (r === 'unverified_grade_point') return 'Bobot nilai belum diverifikasi';
                                return r;
                              })
                              .join(' · ') || 'Informasi baris ambigu'}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Pemilihan Rencana Semester Tujuan */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                Rencana Semester Tujuan
              </label>
              <select
                className="form-input"
                value={plannedSemesterId}
                onChange={e => {
                  setPlannedSemesterId(e.target.value);
                  setIsDirty(true);
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-color)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {semesters.length === 0 ? (
                  <option value="">Belum ada semester dibuat</option>
                ) : (
                  semesters.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status === 'current' ? '· (Semester Aktif)' : ''}
                    </option>
                  ))
                )}
              </select>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                * Pilihan semester di sini disimpan sebagai rencana penempatan. Pada Tahap B6B, data{' '}
                <strong>tidak akan ditulis otomatis</strong> ke Semester. Integrasi penyimpanan ke Semester akan dilanjutkan pada Tahap B6C dengan persetujuan sadar Anda.
              </div>
            </div>

            {/* Modal Footer: Action Buttons */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleClose}
                style={{ padding: '0.6rem 1.25rem', fontSize: '0.88rem' }}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveReview}
                style={{
                  padding: '0.6rem 1.5rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Check size={16} /> Selesaikan Review
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
