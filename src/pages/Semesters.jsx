import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Plus, Trash2, Edit2, FileText, ChevronDown, ChevronUp, Info, CheckCircle2, AlertCircle, Download, Sparkles, Eye, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import CourseVaultModal from '../components/CourseVaultModal';
import ConfirmDialog from '../components/ConfirmDialog';
import html2pdf from 'html2pdf.js';
export default function Semesters() {
  const { semesters, setSemesters } = useAppContext();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: null, namePrefix: '', period: '', year: '', gpa: '', courses: '', status: 'current' });
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [isCourseVaultOpen, setIsCourseVaultOpen] = useState(false);
  const [selectedSemesterId, setSelectedSemesterId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [previewTitle, setPreviewTitle] = useState('Dokumen Asli');
  const [selectedDocIndex, setSelectedDocIndex] = useState({});
  const [expandedSemesters, setExpandedSemesters] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);
  
  // Auto-fill Semesters 1-8 if they don't exist
  useEffect(() => {
    setSemesters(prev => {
      let changed = false;
      let newSems = [...prev];
      
      // Try to infer the starting year from existing semesters
      let startYear = 2024;
      let yearFound = false;
      for (const sem of newSems) {
        const match = sem.name.match(/Semester (\d+).*?(\d{4})\/(\d{4})/i);
        if (match) {
          const semNum = parseInt(match[1]);
          const year1 = parseInt(match[2]);
          const yearOffset = Math.floor((semNum - 1) / 2);
          startYear = year1 - yearOffset;
          yearFound = true;
          break;
        }
      }
      
      // Retrofit existing semesters that don't have a year
      if (yearFound) {
        let didUpdate = false;
        newSems = newSems.map(s => {
          const numMatch = s.name.match(/^Semester\s+(\d+)$/i);
          if (numMatch) {
            didUpdate = true;
            const i = parseInt(numMatch[1]);
            const yearOffset = Math.floor((i - 1) / 2);
            const y1 = startYear + yearOffset;
            const y2 = y1 + 1;
            const term = i % 2 !== 0 ? 'Ganjil' : 'Genap';
            return { ...s, name: `Semester ${i} (${term} ${y1}/${y2})` };
          }
          return s;
        });
        if (didUpdate) changed = true;
      }

      for (let i = 1; i <= 8; i++) {
        const exists = newSems.some(s => {
          const match = s.name.match(/\d+/);
          return match && parseInt(match[0]) === i;
        });
        if (!exists) {
          const yearOffset = Math.floor((i - 1) / 2);
          const y1 = startYear + yearOffset;
          const y2 = y1 + 1;
          const term = i % 2 !== 0 ? 'Ganjil' : 'Genap';
          
          newSems.push({
            id: Date.now() + i,
            name: `Semester ${i} (${term} ${y1}/${y2})`,
            gpa: 0,
            courses: [],
            status: 'future'
          });
          changed = true;
        }
      }
      return changed ? newSems : prev;
    });
  }, [setSemesters]);

  const { academicPhase, setAcademicPhase, setIsAutoPhase } = useAppContext();
  const [showKruPopup, setShowKruPopup] = useState(false);
  const [kruNextPhase, setKruNextPhase] = useState(null);

  const toggleSemester = (id) => {
    setExpandedSemesters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Check for KRU completion
  useEffect(() => {
    const currentSem = semesters.find(s => s.status === 'current');
    if (!currentSem || !currentSem.courses) return;

    const hasKruData = currentSem.courses.some(c => typeof c === 'object' && c.kehadiranUjian);
    if (!hasKruData) return;

    const completed = currentSem.courses.filter(c => typeof c === 'object' && c.kehadiranUjian === 'Hadir').length;
    const total = currentSem.courses.length;

    if (total > 0 && completed === total) {
      if (academicPhase === 'uts') {
        setKruNextPhase('kuliah');
        setShowKruPopup(true);
      } else if (academicPhase === 'uas') {
        setKruNextPhase('khs');
        setShowKruPopup(true);
      }
    }
  }, [semesters, academicPhase]);

  const handleOpenModal = (sem = null) => {
    if (sem) {
      // Handle legacy string array or new object array
      const coursesString = sem.courses.map(c => typeof c === 'string' ? c : c.name).join(', ');
      let namePrefix = sem.name;
      let period = '';
      let year = '';
      const match = sem.name.match(/^(.*?)\s*\((Ganjil|Genap)?\s*(.*?)\)$/i);
      if (match) {
        namePrefix = match[1].trim();
        period = match[2] ? match[2].trim() : '';
        year = match[3] ? match[3].trim() : '';
      } else {
        // Fallback for older formats
        const fallbackMatch = sem.name.match(/^(.*?)\s*\((.*?)\)$/);
        if (fallbackMatch) {
          namePrefix = fallbackMatch[1].trim();
          year = fallbackMatch[2].trim();
        }
      }
      setFormData({ ...sem, courses: coursesString, status: sem.status || 'current', namePrefix, period, year });
    } else {
      setFormData({ id: null, namePrefix: '', period: '', year: '', gpa: '', courses: '', status: 'current' });
    }
    setIsModalOpen(true);
  };

  const handleNamePrefixChange = (e) => {
    const newPrefix = e.target.value;
    let newPeriod = formData.period;
    
    const match = newPrefix.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      newPeriod = num % 2 === 0 ? 'Genap' : 'Ganjil';
    } else {
      newPeriod = ''; // Clear if no number is found
    }
    
    setFormData({ ...formData, namePrefix: newPrefix, period: newPeriod });
  };

  const handleSave = (e) => {
    e.preventDefault();
    const coursesArr = formData.courses.split(',').map(c => c.trim()).filter(c => c);
    
    let suffixParts = [];
    if (formData.period) suffixParts.push(formData.period);
    if (formData.year) suffixParts.push(formData.year);
    
    const suffix = suffixParts.join(' ');
    
    let finalNamePrefix = formData.namePrefix.trim();
    // Auto-prepend "Semester " if they only typed a number
    if (/^\d+$/.test(finalNamePrefix)) {
      finalNamePrefix = `Semester ${finalNamePrefix}`;
    }
    
    const finalName = suffix ? `${finalNamePrefix} (${suffix})` : finalNamePrefix;
    
    const finalFormData = { ...formData, name: finalName };
    delete finalFormData.namePrefix;
    delete finalFormData.period;
    delete finalFormData.year;

    // Map existing objects if editing, or create new simple objects
    let newCourses = [];
    if (finalFormData.id) {
      const existingSem = semesters.find(s => s.id === formData.id);
      newCourses = coursesArr.map(courseName => {
        const existingCourse = existingSem.courses.find(c => (typeof c === 'string' ? c === courseName : c.name === courseName));
        return existingCourse || { id: Date.now().toString() + Math.random(), name: courseName };
      });
    } else {
      newCourses = coursesArr.map(courseName => ({ id: Date.now().toString() + Math.random(), name: courseName }));
    }

    if (finalFormData.id) {
      setSemesters(prev => prev.map(s => s.id === finalFormData.id ? { ...finalFormData, courses: newCourses } : s));
      toast.success('Semester berhasil diperbarui!');
    } else {
      setSemesters(prev => [...prev, { ...finalFormData, id: Date.now(), courses: newCourses }]);
      toast.success('Semester baru ditambahkan!');
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('Yakin ingin menghapus semester ini?')) {
      setSemesters(prev => prev.filter(s => s.id !== id));
      toast.success('Semester dihapus!');
    }
  };

  const handleOpenCourseVault = (course, semesterId) => {
    setSelectedCourse(course);
    setSelectedSemesterId(semesterId);
    setIsCourseVaultOpen(true);
  };

  const handleSaveCourseVault = (updatedCourse) => {
    setSemesters(prev => prev.map(sem => {
      if (sem.id === selectedSemesterId) {
        return {
          ...sem,
          courses: sem.courses.map(c =>
            (typeof c === 'string' && c === selectedCourse) || (c.id === updatedCourse.id) ? updatedCourse : c
          )
        };
      }
      return sem;
    }));
    setIsCourseVaultOpen(false);
    toast.success('Detail & Arsip matkul disimpan!');
  };

  const navigate = useNavigate();

  const generateKHSElement = (semester) => {
    const div = document.createElement('div');
    div.style.padding = '30px';
    div.style.fontFamily = 'Arial, sans-serif';
    div.style.color = '#333';
    div.style.width = '700px'; // Fit within A4 at 96 DPI (8.27 - 1 inch margin = 7.27 inches = 698px)
    div.style.maxWidth = '100%';
    div.style.backgroundColor = '#fff';
    
    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.borderBottom = '2px solid #333';
    header.style.paddingBottom = '20px';
    header.style.marginBottom = '30px';
    header.innerHTML = `
      <h1 style="margin: 0; font-size: 24px; text-transform: uppercase;">Kartu Hasil Studi (KHS)</h1>
      <h2 style="margin: 10px 0 0 0; font-size: 18px; color: #555;">${semester.name}</h2>
    `;
    div.appendChild(header);
    
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.marginBottom = '30px';
    table.innerHTML = `
      <thead>
        <tr style="background-color: #f3f4f6;">
          <th style="border: 1px solid #ccc; padding: 12px 8px; text-align: left;">No</th>
          <th style="border: 1px solid #ccc; padding: 12px 8px; text-align: left;">Mata Kuliah</th>
          <th style="border: 1px solid #ccc; padding: 12px 8px; text-align: center;">SKS</th>
          <th style="border: 1px solid #ccc; padding: 12px 8px; text-align: center;">Nilai</th>
        </tr>
      </thead>
      <tbody>
        ${(semester.courses || []).map((course, i) => {
          const courseName = typeof course === 'string' ? course : (course.name || '');
          let cleanName = courseName;
          let grade = typeof course === 'object' && course.grade ? course.grade : null;
          let sks = typeof course === 'object' && course.sks ? course.sks : '-';

          const gradeMatch = courseName.match(/(.*?)\s*\(Nilai:\s*([^)]+)\)/i);
          if (gradeMatch) {
            cleanName = gradeMatch[1].trim();
            if (!grade) grade = gradeMatch[2].trim().toUpperCase();
          }

          return `
          <tr>
            <td style="border: 1px solid #ccc; padding: 10px 8px;">${i + 1}</td>
            <td style="border: 1px solid #ccc; padding: 10px 8px;">${cleanName}</td>
            <td style="border: 1px solid #ccc; padding: 10px 8px; text-align: center;">${sks}</td>
            <td style="border: 1px solid #ccc; padding: 10px 8px; text-align: center; font-weight: bold;">${grade || '-'}</td>
          </tr>
          `;
        }).join('')}
      </tbody>
    `;
    div.appendChild(table);
    
    const totalSKS = (semester.courses || []).reduce((acc, course) => {
       const sksStr = typeof course === 'object' && course.sks ? course.sks : '0';
       const sks = parseInt(sksStr);
       return acc + (isNaN(sks) ? 0 : sks);
    }, 0);
    const summary = document.createElement('div');
    summary.style.display = 'flex';
    summary.style.justifyContent = 'flex-end';
    summary.innerHTML = `
      <div style="border: 1px solid #ccc; padding: 15px 25px; border-radius: 8px; background-color: #f9fafb;">
        <div style="margin-bottom: 8px;"><strong>Total SKS:</strong> ${totalSKS}</div>
        <div style="font-size: 18px;"><strong>Indeks Prestasi Semester (IPS):</strong> <span style="color: #166534;">${semester.gpa || '-'}</span></div>
      </div>
    `;
    div.appendChild(summary);
    
    return div;
  };

  const handleExportPDF = (semester, isPreview = false) => {
    const element = generateKHSElement(semester);

    const opt = {
      margin: 0.4,
      filename: `KHS_${semester.name.replace(/\s+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };
    
    if (isPreview) {
      toast.loading(`Menyiapkan Pratinjau KHS...`, { id: 'pdf-preview' });
      html2pdf().set(opt).from(element).outputPdf('datauristring').then((pdfString) => {
        toast.dismiss('pdf-preview');
        setPreviewTitle(`Laporan Rekap KHS ${semester.name}`);
        setPreviewImage(pdfString);
      }).catch((e) => {
        console.error(e);
        toast.dismiss('pdf-preview');
        toast.error('Gagal memuat pratinjau');
      });
    } else {
      toast.promise(
        html2pdf().set(opt).from(element).save(),
        {
          loading: 'Membuat PDF...',
          success: 'KHS Berhasil diunduh!',
          error: 'Gagal membuat PDF'
        }
      );
    }
  };

  const handleRenameDocument = (semesterId, docIndex) => {
    const sem = semesters.find(s => s.id === semesterId);
    if (!sem) return;
    let rawDocs = sem.documents || [];
    if (rawDocs.length === 0 && sem.originalFile) rawDocs = [{ type: sem.documentType || 'Dokumen Semester', file: sem.originalFile }];
    const doc = rawDocs[docIndex];
    if (!doc) return;
    const newName = window.prompt('Masukkan nama jenis dokumen baru (misal: KRS, KRU UTS, KRU UAS, KHS):', doc.type);
    if (newName && newName.trim() !== '') {
      const updatedSemesters = semesters.map(s => {
        if (s.id === semesterId) {
          const updatedDocs = [...rawDocs];
          updatedDocs[docIndex] = { ...doc, type: newName.trim() };
          return { ...s, documents: updatedDocs };
        }
        return s;
      });
      setSemesters(updatedSemesters);
      toast.success('Nama dokumen diperbarui');
    }
  };

  const handleDeleteDocument = (semesterId, docIndex) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus dokumen ini?')) return;
    const sem = semesters.find(s => s.id === semesterId);
    if (!sem) return;
    let rawDocs = sem.documents || [];
    if (rawDocs.length === 0 && sem.originalFile) rawDocs = [{ type: sem.documentType || 'Dokumen Semester', file: sem.originalFile }];
    const updatedSemesters = semesters.map(s => {
      if (s.id === semesterId) {
        const updatedDocs = rawDocs.filter((_, idx) => idx !== docIndex);
        return { 
          ...s, 
          documents: updatedDocs,
          ...(updatedDocs.length === 0 ? { originalFile: null, documentType: null } : {})
        };
      }
      return s;
    });
    setSemesters(updatedSemesters);
    setSelectedDocIndex(prev => ({ ...prev, [semesterId]: 0 }));
    toast.success('Dokumen dihapus');
  };

  const handleReplaceFile = (e, semesterId, docIndex) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const sem = semesters.find(s => s.id === semesterId);
    if (!sem) return;
    let rawDocs = sem.documents || [];
    if (rawDocs.length === 0 && sem.originalFile) rawDocs = [{ type: sem.documentType || 'Dokumen Semester', file: sem.originalFile }];
    const doc = rawDocs[docIndex];
    if (!doc) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      // Navigate to AIScanner with autoScan and replace metadata
      navigate('/ai-scanner', { 
        state: { 
          prefillImage: reader.result, 
          autoScan: true,
          replaceDoc: { semesterId, docIndex, oldType: doc.type }
        } 
      });
    };
    reader.readAsDataURL(file);
  };

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

  const getSemesterCompletionData = (sem) => {
    if (sem.status === 'future') return { status: 'none', missing: [] };
    
    let missing = [];
    if (!sem.courses || sem.courses.length === 0) missing.push('Daftar Mata Kuliah');
    if (sem.status === 'past' && (!sem.gpa || sem.gpa <= 0)) missing.push('Input Nilai IPS');
    
    const missingDocs = getMissingDocuments(sem);
    missingDocs.forEach(doc => missing.push(`Dokumen ${doc}`));

    let isCompletelyEmpty = (!sem.courses || sem.courses.length === 0) && (!sem.gpa || sem.gpa <= 0) && (!sem.documents || sem.documents.length === 0) && !sem.originalFile;

    if (missing.length === 0) return { status: 'green', missing: [] };
    if (isCompletelyEmpty) return { status: 'red', missing };
    return { status: 'yellow', missing };
  };

  return (
    <div>
      <div className="page-header" style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', borderRadius: '16px', background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)', color: 'white', boxShadow: '0 8px 16px rgba(37, 99, 235, 0.25)' }}>
            <BookOpen size={28} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="page-title" style={{ fontSize: '2.5rem', letterSpacing: '-0.5px' }}>Semesters</h1>
            <p className="page-subtitle" style={{ fontSize: '1rem' }}>Atur status tiap semester (Aktif/Lalu/Rencana).</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()} style={{ whiteSpace: 'nowrap' }}>
          <Plus size={18} /> Tambah Semester
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '2rem', marginBottom: '2rem', alignItems: 'start' }}>
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
             <div key={`skeleton-${i}`} className="pulse-anim" style={{ background: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border-color)', height: '140px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <div style={{ width: '150px', height: '22px', backgroundColor: 'var(--border-color)', borderRadius: '4px' }}></div>
                    <div style={{ width: '100px', height: '12px', backgroundColor: 'var(--border-color)', borderRadius: '4px', opacity: 0.5 }}></div>
                  </div>
                  <div style={{ width: '60px', height: '32px', backgroundColor: 'var(--border-color)', borderRadius: '6px' }}></div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                  <div style={{ width: '60px', height: '22px', backgroundColor: 'var(--border-color)', borderRadius: '4px', opacity: 0.7 }}></div>
                  <div style={{ width: '80px', height: '22px', backgroundColor: 'var(--border-color)', borderRadius: '4px', opacity: 0.7 }}></div>
                </div>
             </div>
          ))
        ) : (
          [...semesters].sort((a, b) => {
            const numA = parseInt(a.name.match(/\d+/) ? a.name.match(/\d+/)[0] : '999');
            const numB = parseInt(b.name.match(/\d+/) ? b.name.match(/\d+/)[0] : '999');
            if (numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name);
          }).map(sem => {
            const compData = getSemesterCompletionData(sem);
          let cardBorder = sem.status === 'future' ? '2px dashed var(--border-color)' : '1px solid var(--border-color)';
          let cardGlow = '0 2px 10px rgba(0,0,0,0.03)';
          
          if (compData.status === 'green') {
             cardBorder = '2px solid #22c55e';
             cardGlow = '0 8px 24px rgba(34, 197, 94, 0.15)';
          } else if (compData.status === 'yellow') {
             cardBorder = '2px solid #eab308';
             cardGlow = '0 8px 24px rgba(234, 179, 8, 0.15)';
          } else if (compData.status === 'red') {
             cardBorder = '2px solid #ef4444';
             cardGlow = '0 8px 24px rgba(239, 68, 68, 0.15)';
          } else if (sem.status === 'current') {
             cardBorder = '2px solid #3b82f6';
             cardGlow = '0 8px 24px rgba(59, 130, 246, 0.15)';
          }

          return (
          <div key={sem.id} id={`semester-card-${sem.id}`} className="card" style={{
            position: 'relative',
            padding: '0',
            border: cardBorder,
            backgroundColor: 'var(--card-bg)',
            boxShadow: cardGlow,
            transition: 'all 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            gridColumn: expandedSemesters[sem.id] ? '1 / -1' : 'auto'
          }}>
            {/* Header Section */}
            <div 
              onClick={() => toggleSemester(sem.id)}
              style={{ cursor: 'pointer', padding: '1.5rem 1.5rem 1rem 1.5rem', borderBottom: expandedSemesters[sem.id] ? '1px solid var(--border-color)' : 'none', backgroundColor: sem.status === 'future' ? 'var(--bg-color)' : 'var(--card-bg)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {/* Left Side: Title & Badges */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {(() => {
                      const match = sem.name.match(/^(.*?)\s*(\(.*?\))$/);
                      if (match) {
                        return (
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <h3 style={{ color: 'var(--text-main)', fontSize: '1.25rem', fontWeight: 800, margin: '0', lineHeight: 1, whiteSpace: 'nowrap' }}>
                              {match[1]}
                            </h3>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {match[2]}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <h3 style={{ color: 'var(--text-main)', fontSize: '1.25rem', fontWeight: 800, margin: '0', lineHeight: 1, whiteSpace: 'nowrap' }}>
                          {sem.name}
                        </h3>
                      );
                    })()}
                    
                    {/* Badges */}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {sem.status === 'current' && <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700 }}>AKTIF SAAT INI</span>}
                      {sem.status === 'future' && <span style={{ background: 'var(--bg-color)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700 }}>RENCANA</span>}
                      {sem.status === 'past' && <span style={{ background: 'var(--bg-color)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700 }}>SELESAI</span>}
                      
                      {compData.status === 'green' && <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}><Sparkles size={10} /> LENGKAP</span>}
                      {compData.status === 'yellow' && <span style={{ background: '#fef9c3', color: '#854d0e', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700 }}>BELUM LENGKAP</span>}
                      {compData.status === 'red' && <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 700 }}>KOSONG</span>}
                    </div>
                  </div>
                </div>

                {/* Right Side: Actions & IPS */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleOpenModal(sem); }} title="Edit Semester" style={{ width: '32px', height: '32px', padding: '0', background: 'transparent', border: 'none', color: 'var(--text-muted)' }}>
                      <Edit2 size={16} />
                    </button>
                    <button className="btn-icon btn-icon-danger" onClick={(e) => { e.stopPropagation(); handleDelete(sem.id); }} title="Hapus Semester" style={{ width: '32px', height: '32px', padding: '0', background: 'transparent', border: 'none' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  
                  {/* IPS Box */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', minWidth: '80px' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '4px', whiteSpace: 'nowrap' }}>IPS / IPK</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: sem.gpa >= 3.5 ? '#166534' : sem.gpa > 0 ? 'var(--text-main)' : 'var(--text-muted)', lineHeight: 1 }}>
                      {sem.gpa || '-'}
                    </div>
                  </div>
                  
                  <div style={{ color: 'var(--text-muted)' }}>
                    {expandedSemesters[sem.id] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>
              </div>
            </div>

            {compData.missing.length > 0 && expandedSemesters[sem.id] && (
              <div style={{ margin: '0 1.5rem 1rem 1.5rem', padding: '0.75rem', backgroundColor: compData.status === 'red' ? '#fef2f2' : '#fefce8', border: `1px solid ${compData.status === 'red' ? '#fca5a5' : '#fef08a'}`, borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <Sparkles size={16} color={compData.status === 'red' ? '#dc2626' : '#ca8a04'} style={{ marginTop: '2px', flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: compData.status === 'red' ? '#991b1b' : '#854d0e', fontWeight: 600 }}>Data Semester Belum Lengkap</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: compData.status === 'red' ? '#b91c1c' : '#a16207' }}>
                    Lengkapi data berikut agar kartu menjadi hijau:{' '}
                    {compData.missing.map((item, i) => {
                      const lower = item.toLowerCase();
                      let docIndex = -1;
                      if (lower.includes('krs')) docIndex = 0;
                      else if (lower.includes('mingguan')) docIndex = 1;
                      else if (lower.includes('ujian')) docIndex = 2;
                      else if (lower.includes('khs')) docIndex = 3;
                      
                      const isClickable = docIndex !== -1;
                      
                      return (
                        <span key={i}>
                          {isClickable ? (
                             <span 
                               onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDocIndex(prev => ({ ...prev, [sem.id]: docIndex }));
                                  
                                  // Optional: smoothly scroll to the toolbar if on a very small screen
                                  const toolbar = document.getElementById(`doc-toolbar-${sem.id}`);
                                  if (toolbar) toolbar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                               }}
                               style={{ cursor: 'pointer', fontWeight: 800, textDecoration: 'underline', color: 'inherit', textUnderlineOffset: '2px' }}
                               title={`Klik untuk membuka form upload ${item}`}
                             >
                               {item}
                             </span>
                          ) : (
                             <strong style={{color: 'inherit'}}>{item}</strong>
                          )}
                          {i < compData.missing.length - 1 ? ', ' : ''}
                        </span>
                      )
                    })}
                  </p>
                </div>
              </div>
            )}

            {expandedSemesters[sem.id] && (
              <div id={`doc-toolbar-${sem.id}`} style={{ padding: '0', backgroundColor: 'var(--bg-color)', borderTop: '1px solid var(--border-color)' }}>
                {/* Document Toolbar Header */}
                <div style={{ 
                  padding: '1rem 1.5rem',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  backgroundColor: 'rgba(59, 130, 246, 0.03)'
                }}>
                  {(() => {
                    let rawDocs = sem.documents || [];
                    if (rawDocs.length === 0 && sem.originalFile) {
                      rawDocs = [{ type: sem.documentType || 'Dokumen Semester', file: sem.originalFile }];
                    }
                    
                    const coreSlots = [
                      { type: 'Dokumen KRS', keys: ['krs'] },
                      { type: 'Jadwal Mingguan', keys: ['mingguan'] },
                      { type: 'Jadwal Ujian', keys: ['ujian', 'uts', 'uas'] },
                      { type: 'Dokumen KHS', keys: ['khs'] },
                    ];
                    
                    const builtDocs = [];
                    const usedRawDocs = new Set();
                    
                    coreSlots.forEach(slot => {
                      const matchIndex = rawDocs.findIndex(d => d.type && slot.keys.some(k => d.type.toLowerCase().includes(k)) && !d.type.toLowerCase().includes('rekap'));
                      if (matchIndex !== -1) {
                        builtDocs.push({ ...rawDocs[matchIndex], rawIndex: matchIndex });
                        usedRawDocs.add(matchIndex);
                      } else {
                        builtDocs.push({ type: slot.type, file: null, isEmpty: true, rawIndex: -1 });
                      }
                    });
                    
                    rawDocs.forEach((d, matchIndex) => {
                      if (!usedRawDocs.has(matchIndex)) builtDocs.push({ ...d, rawIndex: matchIndex });
                    });
                    
                    const finalDocs = builtDocs;
                    const idx = selectedDocIndex[sem.id] || 0;
                    const activeDoc = finalDocs[idx] || finalDocs[0];
                    
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.5rem' }}>
                           <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                             <FileText size={16} color="var(--primary-color)" /> Kelola Berkas Semester
                           </div>
                           <div style={{ display: 'flex', gap: '0.5rem' }}>
                             <button onClick={(e) => { e.stopPropagation(); handleExportPDF(sem, true); }} style={{ padding: '6px 14px', fontSize: '0.8rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', border: 'none', backgroundColor: 'var(--primary-color)', color: '#fff', boxShadow: '0 2px 6px rgba(59, 130, 246, 0.4)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s ease' }}>
                               <Eye size={16} /> Lihat Rekapan Semester
                             </button>
                           </div>
                        </div>

                        <div style={{ 
                          display: 'flex', 
                          gap: '0.5rem', 
                          flexWrap: 'wrap',
                          paddingBottom: '0.25rem'
                        }}>
                          {finalDocs.map((doc, i) => {
                            const isMissing = doc.isEmpty;
                            return (
                              <button
                                key={i}
                                onClick={(e) => { e.stopPropagation(); setSelectedDocIndex(prev => ({ ...prev, [sem.id]: i })); }}
                                style={{
                                  padding: '8px 16px',
                                  borderRadius: '20px',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  border: idx === i ? 'none' : isMissing ? '1px dashed #fca5a5' : '1px solid var(--border-color)',
                                  backgroundColor: idx === i ? 'var(--primary-color)' : isMissing ? '#fef2f2' : 'transparent',
                                  color: idx === i ? '#fff' : isMissing ? '#dc2626' : 'var(--text-main)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  transition: 'all 0.2s ease',
                                  boxShadow: idx === i ? '0 4px 10px rgba(59, 130, 246, 0.3)' : 'none'
                                }}
                              >
                                {isMissing ? <AlertCircle size={14} /> : <FileText size={14} />}
                                {doc.type}
                              </button>
                            );
                          })}
                        </div>
                        
                        {activeDoc && (
                          <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            padding: '0.75rem',
                            backgroundColor: '#fff',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color)'
                          }}>
                            {activeDoc.isEmpty ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontSize: '0.8rem', fontWeight: 700 }}>
                                <AlertCircle size={16} /> Belum Ada
                              </span>
                            ) : (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.8rem', fontWeight: 700 }}>
                                <CheckCircle2 size={16} /> Tersimpan
                              </span>
                            )}

                            {activeDoc.isEmpty ? (
                              <div style={{ display: 'flex' }}>
                                <label className="btn-icon" title={`Upload ${activeDoc.type}`} style={{ cursor: 'pointer', padding: '8px 16px', background: 'var(--primary-color)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', boxShadow: '0 2px 6px rgba(59, 130, 246, 0.4)' }}>
                                  <Plus size={16} /> Upload
                                  <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => handleReplaceFile(e, sem.id, 999)} />
                                </label>
                              </div>
                            ) : (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="btn-icon" onClick={() => { setPreviewTitle(activeDoc.type || 'Dokumen Asli'); setPreviewImage(activeDoc.file); }} title="Lihat Dokumen" style={{ width: '36px', height: '36px', padding: '0', background: 'var(--bg-color)', color: 'var(--primary-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                <Eye size={16} />
                              </button>
                              <a href={activeDoc.file} download={activeDoc.file.startsWith('data:application/pdf') ? `${(activeDoc.type||'Dokumen').replace(/\s+/g, '_')}.pdf` : `${(activeDoc.type||'Dokumen').replace(/\s+/g, '_')}.jpg`} className="btn-icon" title="Download Dokumen" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', padding: '0', background: 'var(--bg-color)', color: 'var(--primary-color)', border: '1px solid var(--border-color)', textDecoration: 'none', borderRadius: '8px' }}>
                                <Download size={16} />
                              </a>
                              <button className="btn-icon" onClick={() => handleRenameDocument(sem.id, activeDoc.rawIndex)} title="Ganti Nama Dokumen" style={{ width: '36px', height: '36px', padding: '0', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                <Edit2 size={16} />
                              </button>
                              <label className="btn-icon" title="Ganti File (Scan Ulang)" style={{ cursor: 'pointer', width: '36px', height: '36px', padding: '0', background: '#eff6ff', color: '#3b82f6', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}>
                                <Sparkles size={16} />
                                <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => handleReplaceFile(e, sem.id, activeDoc.rawIndex)} />
                              </label>
                              <button className="btn-icon" onClick={() => handleDeleteDocument(sem.id, activeDoc.rawIndex)} title="Hapus Dokumen" style={{ width: '36px', height: '36px', padding: '0', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px' }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Courses List */}
            <div style={{ padding: '1.5rem', flex: 1, backgroundColor: 'transparent' }}>
              {sem.courses && sem.courses.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  <Info size={14} /> Klik baris matkul untuk mengatur Arsip
                </div>
              )}
              
              {sem.courses && sem.courses.some(c => typeof c === 'object' && c.kehadiranUjian) && (() => {
                const completed = sem.courses.filter(c => typeof c === 'object' && c.kehadiranUjian === 'Hadir').length;
                const total = sem.courses.length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                return (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#1e3a8a' }}>
                      <span>Progress Ujian (Berdasarkan KRU)</span>
                      <span>{completed} / {total} Matkul</span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: '#dbeafe', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#3b82f6', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sem.courses.length > 0 ? (
                  sem.courses.map((course, idx) => {
                    const courseName = typeof course === 'string' ? course : course.name;
                    const hasFiles = typeof course === 'object' && course.files && course.files.length > 0;

                    let cleanName = courseName;
                    let grade = null;
                    const gradeMatch = courseName.match(/(.*?)\s*\(Nilai:\s*([^)]+)\)/i);
                    if (gradeMatch) {
                      cleanName = gradeMatch[1].trim();
                      grade = gradeMatch[2].trim().toUpperCase();
                    }

                    let gradeBg = 'var(--border-color)';
                    let gradeColor = '#475569';
                    if (grade) {
                      if (grade.startsWith('A')) { gradeBg = '#dcfce7'; gradeColor = '#166534'; }
                      else if (grade.startsWith('B')) { gradeBg = '#dbeafe'; gradeColor = '#1d4ed8'; }
                      else if (grade.startsWith('C')) { gradeBg = '#fef3c7'; gradeColor = '#b45309'; }
                      else if (grade.startsWith('D') || grade.startsWith('E')) { gradeBg = '#fee2e2'; gradeColor = '#b91c1c'; }
                    }

                    return (
                      <div key={idx}
                        onClick={() => handleOpenCourseVault(course, sem.id)}
                        style={{
                          backgroundColor: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          padding: '0.75rem 1rem',
                          borderRadius: '8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseOver={e => {
                          e.currentTarget.style.borderColor = '#93c5fd';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.08)';
                        }}
                        onMouseOut={e => {
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                          <div style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            backgroundColor: grade ? gradeColor : 'var(--text-muted)',
                            flexShrink: 0
                          }} />
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cleanName}>
                            {cleanName}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                          {hasFiles && (
                            <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, background: 'var(--bg-color)', padding: '2px 6px', borderRadius: '4px' }}>
                              <FileText size={12} style={{ marginRight: '4px' }} /> {course.files.length}
                            </div>
                          )}
                          {typeof course === 'object' && course.kehadiranUjian && (
                            <span style={{ 
                              background: course.kehadiranUjian === 'Hadir' ? '#dcfce7' : '#fee2e2', 
                              color: course.kehadiranUjian === 'Hadir' ? '#166534' : '#b91c1c', 
                              padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 
                            }}>
                              {course.kehadiranUjian === 'Hadir' ? '✓ Hadir' : '× Belum'}
                            </span>
                          )}
                          {grade && (
                            <span style={{ background: gradeBg, color: gradeColor, padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 800, minWidth: '32px', textAlign: 'center' }}>
                              {grade}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div style={{ width: '100%', padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <div style={{ marginBottom: '0.5rem' }}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, margin: '0 auto' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>
                    Belum ada mata kuliah
                  </div>
                )}
              </div>
            </div>
            </div>
            )}
          </div>
        );
        })
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={formData.id ? 'Edit Semester' : 'Tambah Semester'}>
        <form onSubmit={handleSave} className="semester-form">
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>Status Semester</label>
            <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-color)', padding: '0.35rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              {[
                { value: 'past', label: 'Sudah Selesai' },
                { value: 'current', label: 'Aktif' },
                { value: 'future', label: 'Rencana' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, status: opt.value })}
                  style={{
                    flex: 1, padding: '0.5rem', border: 'none', borderRadius: '8px',
                    background: formData.status === opt.value ? 'var(--primary-color)' : 'transparent',
                    color: formData.status === opt.value ? 'white' : 'var(--text-muted)',
                    fontWeight: formData.status === opt.value ? 600 : 500,
                    cursor: 'pointer', transition: 'all 0.2s ease', fontSize: '0.9rem'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.2fr', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                <span style={{ whiteSpace: 'nowrap' }}>Semester</span>
                {formData.period && (
                  <span style={{ fontSize: '0.7rem', background: 'var(--primary-color)', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                    {formData.period}
                  </span>
                )}
              </label>
              <input type="text" required className="form-input" placeholder="Smt 3" value={formData.namePrefix} onChange={handleNamePrefixChange} style={{ width: '100%' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem' }}>Tahun Ajaran</label>
              <input type="text" className="form-input" placeholder="2024/2025" value={formData.year} onChange={e => setFormData({ ...formData, year: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-main)', fontSize: '0.9rem' }}>Target IPS</label>
              <input type="number" step="0.01" className="form-input" placeholder="0.00" value={formData.gpa} onChange={e => setFormData({ ...formData, gpa: e.target.value })} style={{ width: '100%', textAlign: 'center' }} />
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Mata Kuliah
              <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>(pisahkan dengan koma)</span>
            </label>
            {!!formData.originalFile ? (
              <div style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '120px', overflowY: 'auto' }}>
                {formData.courses ? formData.courses.split(',').map((c, i) => (
                  <span key={i} style={{ background: 'white', border: '1px solid var(--border-color)', padding: '0.3rem 0.6rem', borderRadius: '99px', fontSize: '0.8rem', color: 'var(--text-main)' }}>
                    {c.trim()}
                  </span>
                )) : <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Tidak ada mata kuliah</span>}
              </div>
            ) : (
              <textarea
                className="form-input"
                placeholder="Matematika, Biologi, Kimia..."
                value={formData.courses}
                onChange={e => setFormData({ ...formData, courses: e.target.value })}
                rows={3}
                style={{ width: '100%', resize: 'vertical', lineHeight: '1.5' }}
              />
            )}
            
            {!!formData.originalFile && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <p style={{ fontSize: '0.8rem', color: '#b91c1c', margin: 0, lineHeight: 1.4 }}>
                  Daftar matkul dan nilai dari hasil scan AI bersifat <b>permanen</b> (orisinil) dan tidak dapat diubah manual.
                </p>
              </div>
            )}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>Batal</button>
            <button type="submit" className="btn btn-primary">Simpan</button>
          </div>
        </form>
      </Modal>

      <CourseVaultModal
        isOpen={isCourseVaultOpen}
        onClose={() => setIsCourseVaultOpen(false)}
        course={selectedCourse}
        semesterName={semesters.find(s => s.id === selectedSemesterId)?.name || ''}
        onSave={handleSaveCourseVault}
      />

      <ConfirmDialog
          isOpen={showKruPopup}
          title="Ujian Selesai! 🎉"
          message={`Hebat! Berdasarkan KRU terbaru, semua ujian Anda sudah berstatus Hadir (100%). Apakah Anda ingin beralih ke masa ${kruNextPhase === 'khs' ? 'Akhir Semester (KHS)' : 'Perkuliahan Aktif'} sekarang?`}
          icon={CheckCircle2}
          confirmText="Ya, Pindah Fase"
          cancelText="Nanti Saja"
          onConfirm={() => {
            setAcademicPhase(kruNextPhase);
            setIsAutoPhase(false);
            setShowKruPopup(false);
          }}
          onCancel={() => setShowKruPopup(false)}
        />

      <Modal isOpen={!!previewImage} onClose={() => { setPreviewImage(null); setPreviewTitle('Dokumen Asli'); }} title={previewTitle} width="800px">
        <div style={{ textAlign: 'center', height: '70vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {previewImage && previewImage.startsWith('data:application/pdf') ? (
              <iframe src={previewImage} width="100%" height="100%" style={{ border: '1px solid var(--border-color)', borderRadius: '12px' }} title="PDF Preview" />
            ) : (
              <img src={previewImage} alt="KHS Asli" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }} />
            )}
          </div>
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <button className="btn btn-outline" onClick={() => { setPreviewImage(null); setPreviewTitle('Dokumen Asli'); }}>Tutup</button>
            <a href={previewImage} download={previewImage && previewImage.startsWith('data:application/pdf') ? `${previewTitle.replace(/\s+/g, '_')}.pdf` : `${previewTitle.replace(/\s+/g, '_')}.jpg`} className="btn btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Download Dokumen
            </a>
          </div>
        </div>
      </Modal>
    </div>
  );
}
