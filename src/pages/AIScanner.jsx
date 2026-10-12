import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Scan, Upload, Loader2, Sparkles, FileText, Calendar, Compass, HelpCircle, X, CheckSquare, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AIScanner() {
  const { apiKey, setSemesters, setTasks } = useAppContext();
  const location = useLocation();
  const [autoScanDone, setAutoScanDone] = useState(false);
  
  const [imagePreview, setImagePreview] = useState(null);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [fileType, setFileType] = useState('image'); // 'image' | 'pdf' | 'other'
  const [scanType, setScanType] = useState('auto'); // 'auto' | 'khs' | 'calendar'
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (location.state && location.state.prefillImage) {
      const dataUri = location.state.prefillImage;
      if (imagePreview !== dataUri) {
        setImagePreview(dataUri);
        
        fetch(dataUri)
          .then(res => res.blob())
          .then(blob => {
            const mime = dataUri.split(',')[0].match(/:(.*?);/)[1];
            const ext = mime.includes('pdf') ? 'pdf' : 'jpg';
            const file = new File([blob], `rescanned_document.${ext}`, { type: mime });
            setFileToUpload(file);
            setFileType(ext === 'pdf' ? 'pdf' : 'image');
          });
      }
    }
  }, [location.state, imagePreview]);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [manualDirection, setManualDirection] = useState('khs');
  
  // Smart Duplicate Document Detection State
  const [pendingOverwrite, setPendingOverwrite] = useState(null);
  const [userContext, setUserContext] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

  const handleFileSelection = (file) => {
    if (!file) return;
    setFileToUpload(file);
    
    if (file.type.startsWith('image/')) {
      setFileType('image');
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
      setFileType('pdf');
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    } else {
      setFileType('other');
      setImagePreview(null); // No visual preview for docx, xlsx, etc.
    }
  };

  const handleImageChange = (e) => {
    handleFileSelection(e.target.files[0]);
  };

  const handleRightClickPaste = async () => {
    setContextMenu(null);
    try {
      const items = await navigator.clipboard.read();
      let found = false;
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/') || type === 'application/pdf') {
            const blob = await item.getType(type);
            const ext = type === 'application/pdf' ? 'pdf' : type.split('/')[1];
            const file = new File([blob], `pasted-file.${ext}`, { type });
            handleFileSelection(file);
            toast.success('File ditempel dari Clipboard!');
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        toast.error('Tidak ada file gambar/PDF di clipboard!');
      }
    } catch (err) {
      toast.error('Gagal membaca clipboard. Pastikan Anda memberi izin browser.');
    }
  };

  useEffect(() => {
    const handlePaste = (e) => {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        handleFileSelection(e.clipboardData.files[0]);
        toast.success('File ditempel dari Clipboard!');
      }
    };
    const handleClick = () => setContextMenu(null);

    window.addEventListener('paste', handlePaste);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  async function fileToGenerativePart(file) {
    if (fileType === 'other') return null; // Can't send these binaries to inlineData
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          inlineData: {
            data: reader.result.split(',')[1],
            mimeType: file.type
          },
        });
      };
      reader.readAsDataURL(file);
    });
  }

  const handleScan = async () => {
    if (!apiKey) {
      toast.error('API Key Gemini belum diatur. Silakan isi di menu Settings.');
      return;
    }
    if (!fileToUpload) {
      toast.error('Pilih file terlebih dahulu.');
      return;
    }

    setIsScanning(true);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await res.json();
      
      let targetModel = "gemini-1.5-flash"; 
      if (data && data.models) {
        const validModels = data.models.filter(m => 
          m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent") &&
          (m.name.includes("flash") || m.name.includes("pro") || m.name.includes("vision"))
        );
        if (validModels.length > 0) {
          const flashModel = validModels.find(m => m.name.includes("flash"));
          targetModel = flashModel ? flashModel.name.replace('models/', '') : validModels[0].name.replace('models/', '');
        }
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: targetModel });
      const imagePart = await fileToGenerativePart(fileToUpload);
      
      let prompt = "";
      
      if (scanType === 'auto') {
        prompt = `
          Anda adalah asisten cerdas penganalisis dokumen/file universal untuk aplikasi manajemen kuliah.
          Tugas Anda adalah mendeteksi file ini, memberikan deskripsi singkat, dan menentukan ke mana file ini harus disimpan.
          
          Informasi File Input:
          Nama File: ${fileToUpload.name}
          Tipe File: ${fileToUpload.type}
          Ukuran: ${Math.round(fileToUpload.size / 1024)} KB
          Keterangan Tambahan dari User: ${userContext || 'Tidak ada keterangan tambahan'}

          Jika Anda bisa melihat isi konten visual (gambar/pdf disertakan), baca isinya dengan seksama.
          Jika tidak ada konten visual yang disediakan (hanya informasi nama file di atas), buat prediksi cerdas dari Nama Filenya.
          
          Aturan Arah (direction):
          - "khs" -> Jika ini dokumen akademik utama seperti KHS/KRS/Transkrip Nilai, Jadwal Kuliah Mingguan, ATAU Jadwal/Kartu Rencana Ujian (KRU UTS/UAS).
          - "task" -> Jika ini dokumen Tugas, makalah, tugas kelompok, presentasi.
          - "event" -> Jika ini kalender akademik umum, rapat, undangan, atau acara khusus satu kali.
          - "file" -> Jika ini materi kuliah biasa, modul, jurnal, e-book, atau dokumen umum.
          - "unknown" -> Jika Anda benar-benar tidak tahu apa ini atau meragukan arahnya.

          Kembalikan HASIL HANYA DALAM FORMAT JSON SEPERTI BERIKUT TANPA TEKS LAIN (tanpa markdown blok):
          {
            "description": "Deskripsi singkat tentang file ini (Gunakan bahasa Indonesia, max 2 kalimat. Jika tidak melihat isinya, sebutkan bahwa prediksi didasarkan pada nama file)",
            "direction": "khs" | "task" | "event" | "file" | "unknown",
            "extracted_data": { 
               "semester_name": "Semester 1 (Ganjil)", "status": "past" | "current" | "future", "gpa": "3.5",
               "courses": [
                 { 
                   "name": "Matematika", "day": "Senin", "timeStart": "08:00", "timeEnd": "10:00", 
                   "room": "Ruang 101", "lecturer": "Bapak Budi", "mode": "Online" | "Offline" | null,
                   "kehadiran_ujian": "Hadir" | "Belum" | null
                 }
               ],
               "title": "Judul tugas/dokumen/acara berdasarkan file", 
               "deadline": "YYYY-MM-DD",
               "course_name": "Nama mata kuliah (jika terdeteksi)",
               "exam_type": "UTS" | "UAS" | null,
               "task_type": "Individu" | "Kelompok" | null,
               "project_type": "Tugas Harian" | "Projek Akhir" | "Kuis" | null,
               "task_number": "Angka tugas ke-berapa (misal: 1, 2) atau null",
               "meeting_number": "Angka pertemuan/jadwal kelas matakuliah ke-berapa (misal: 1, 2, 3) atau null",
               "is_completed": true | false (apakah tugas ini sudah selesai/sudah dikerjakan),
               "semester": "Angka semester ke-berapa (misal: 1, 2, 3) atau null",
               "document_type": "KRS" | "KHS" | "KRU" | "Jadwal" | "Tugas" | "Lainnya"
            }
          }
          Catatan: Untuk KRU (Kartu Rencana Ujian), ekstrak jadwal ujian ke dalam "courses". Jika ada kolom kehadiran dan sudah terisi "Hadir" atau tanda tangan, set "kehadiran_ujian" menjadi "Hadir", jika kosong set "Belum".
        `;
      } else if (scanType === 'khs') {
        prompt = `
          Anda adalah asisten cerdas pengekstrak data akademik (KHS/KRS/Jadwal Kuliah).
          Ekstrak data dari dokumen KHS/KRS atau Gambar Jadwal Mingguan yang diberikan.
          Untuk jadwal, pastikan mengekstrak hari, jam, ruang, dan dosen jika ada.
          Kembalikan HASIL HANYA DALAM FORMAT JSON SEPERTI BERIKUT TANPA TEKS LAIN (tanpa markdown blok):
          {
            "direction": "khs",
            "extracted_data": {
               "semester_name": "Semester 1 (Ganjil)", "status": "past" | "current" | "future", 
               "gpa": "3.5",
               "courses": [
                 { 
                   "name": "Matematika", "sks": "3", "grade": "A", "day": "Senin" | "Selasa" | "Rabu" | "Kamis" | "Jumat" | "Sabtu", 
                   "timeStart": "08:00", "timeEnd": "10:00", "room": "Ruang 101", "lecturer": "Bapak Budi",
                   "mode": "Online" | "Offline" | null, "kehadiran_ujian": "Hadir" | "Belum" | null
                 }
               ],
               "document_type": "KRS" | "KHS" | "KRU" | "Jadwal" | "Lainnya"
            }
          }
          Catatan Penting: 
          1. Jika hanya jadwal biasa tanpa KHS/KRS, beri status "current" dan isi "courses". Jika informasi seperti day/timeStart tidak ada, isi null.
          2. Khusus untuk hari "Jumat", SET SELALU "mode" menjadi "Online", karena kampus mewajibkan kelas hari Jumat secara daring. Untuk hari lain biarkan null atau deteksi dari gambar.
          3. Untuk dokumen KRU, periksa kolom Kehadiran. Jika terisi teks "Hadir" atau tanda tangan, isi kehadiran_ujian dengan "Hadir", jika kosong isi "Belum".
        `;
      } else {
        prompt = `
          Anda adalah asisten cerdas pengekstrak jadwal akademik/tenggat waktu tugas dari gambar/kalender.
          Kembalikan HASIL HANYA DALAM FORMAT JSON SEPERTI BERIKUT TANPA TEKS LAIN (tanpa markdown blok):
          { "tasks": [{ 
              "title": "Nama Tugas/Acara", "deadline": "YYYY-MM-DD atau teks jadwal rutin (misal: 'Senin, 08:00 - 10:00')",
              "course_name": "Nama Matkul", "exam_type": "UTS" | "UAS" | null,
              "task_type": "Individu" | "Kelompok" | null, "project_type": "Tugas Harian" | "Projek Akhir" | null,
              "task_number": "1" | null, "meeting_number": "1" | null, "is_completed": true | false, "semester": "1" | null
          }] }
        `;
      }

      let payload = [prompt];
      if (imagePart) payload.push(imagePart);

      const result = await model.generateContent(payload);
      let text = result.response.text().trim();
      text = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      
      const parsedData = JSON.parse(text);

      if (scanType === 'auto') {
        handleAutoRouting(parsedData);
      } else if (scanType === 'khs') {
        saveKHS(parsedData);
      } else {
        saveEvent(parsedData, 'event');
      }

    } catch (error) {
      console.error(error);
      setAiSuggestion({
        description: "Gagal memproses file secara otomatis dengan AI. Mungkin karena limitasi format atau struktur data yang kompleks.",
        direction: "unknown",
        extracted_data: { title: fileToUpload.name }
      });
      setShowModal(true);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAutoRouting = (parsedData) => {
    if (parsedData.direction === 'unknown' || parsedData.direction === 'file' || !parsedData.direction) {
      // Jika AI tidak yakin, atau sekedar file biasa, tanya user untuk konfirmasi tujuan.
      setAiSuggestion(parsedData);
      setManualDirection(parsedData.direction === 'unknown' || !parsedData.direction ? 'file' : parsedData.direction);
      setShowModal(true);
    } else if (parsedData.direction === 'khs') {
      saveKHS(parsedData.extracted_data || parsedData);
    } else if (parsedData.direction === 'task' || parsedData.direction === 'event') {
      saveEvent({ tasks: [parsedData.extracted_data] }, parsedData.direction);
    }
  };

  const saveKHS = (data) => {
    const extractedCourses = (data.courses || []).map(c => ({
      id: Date.now().toString() + Math.random(),
      name: typeof c === 'string' ? c : c.name || 'Matkul',
      day: typeof c === 'object' ? c.day : null,
      timeStart: typeof c === 'object' ? c.timeStart : null,
      timeEnd: typeof c === 'object' ? c.timeEnd : null,
      room: typeof c === 'object' ? c.room : null,
      lecturer: typeof c === 'object' ? c.lecturer : null,
      mode: typeof c === 'object' ? c.mode : null,
      kehadiranUjian: typeof c === 'object' ? c.kehadiran_ujian : null
    }));
    
    setSemesters(prev => {
        const currentIndex = prev.findIndex(s => s.status === 'current');
        if (currentIndex >= 0) {
          const updated = [...prev];
          const currentSem = updated[currentIndex];
          
          const docTypeStr = data.document_type || 'Jadwal';
          const existingDocs = currentSem.documents || [];
          
          if (currentSem.originalFile && existingDocs.length === 0) {
             existingDocs.push({ type: currentSem.documentType || 'Dokumen Lama', file: currentSem.originalFile });
          }
          
          if (imagePreview) {
            const docIndex = existingDocs.findIndex(d => d.type === docTypeStr);
            if (docIndex >= 0) {
              setPendingOverwrite({
                semIndex: currentIndex,
                docIndex,
                oldDoc: existingDocs[docIndex],
                newDocType: docTypeStr,
                newDocFile: imagePreview,
                extractedCourses,
                data
              });
              return prev; 
            } else {
              existingDocs.push({ type: docTypeStr, file: imagePreview });
            }
          }
          
          updated[currentIndex] = {
             ...currentSem,
             courses: extractedCourses.length > 0 ? extractedCourses : currentSem.courses,
             originalFile: imagePreview || currentSem.originalFile,
             documentType: data.document_type || currentSem.documentType || 'Jadwal',
             documents: existingDocs
          };
          toast.success(`Berhasil! Dokumen (${data.document_type || 'Jadwal'}) diperbarui pada semester aktif.`);
          navigate('/dashboard');
          return updated;
        } else {
        const docTypeStr = data.document_type || 'Jadwal';
        const newSemester = {
          id: Date.now(),
          name: data.semester_name || 'Semester Baru',
          gpa: data.gpa || 0,
          courses: extractedCourses,
          status: 'current',
          originalFile: imagePreview,
          documentType: docTypeStr,
          documents: imagePreview ? [{ type: docTypeStr, file: imagePreview }] : []
        };
        toast.success(`Berhasil! Semester/Dokumen (${data.document_type || 'Jadwal'}) baru ditambahkan dan diaktifkan.`);
        navigate('/dashboard');
        return [...prev, newSemester];
      }
    });
  };

  const saveEvent = (data, forceType) => {
    const items = data.tasks || [data];
    setTasks(prev => {
      let currentTasks = [...prev];
      let newTasksToAdd = [];

      items.forEach(t => {
        const incomingTitle = t.title || fileToUpload.name;
        const cleanIncoming = incomingTitle.replace(/\.[a-zA-Z0-9]+$/, "").toLowerCase().trim();
        
        const existingIndex = currentTasks.findIndex(existing => {
          const cleanExisting = existing.title.replace(/\.[a-zA-Z0-9]+$/, "").toLowerCase().trim();
          return cleanExisting === cleanIncoming;
        });

        if (existingIndex >= 0) {
          currentTasks[existingIndex] = {
            ...currentTasks[existingIndex],
            originalFile: imagePreview || currentTasks[existingIndex].originalFile,
            fileType: fileType || currentTasks[existingIndex].fileType,
            course: t.course_name || currentTasks[existingIndex].course,
            exam_type: t.exam_type || currentTasks[existingIndex].exam_type,
            task_type: t.task_type || currentTasks[existingIndex].task_type,
            project_type: t.project_type || currentTasks[existingIndex].project_type,
            task_number: t.task_number || currentTasks[existingIndex].task_number,
            meeting_number: t.meeting_number || currentTasks[existingIndex].meeting_number,
            semester: t.semester || currentTasks[existingIndex].semester
          };
        } else {
          newTasksToAdd.push({
            id: Date.now() + Math.random(),
            title: incomingTitle,
            deadline: t.deadline || '',
            done: t.is_completed === true,
            status: t.is_completed === true ? 'done' : 'todo',
            type: forceType || 'event',
            course: t.course_name || '',
            exam_type: t.exam_type || null,
            task_type: t.task_type || null,
            project_type: t.project_type || null,
            task_number: t.task_number || null,
            meeting_number: t.meeting_number || null,
            semester: t.semester || null,
            originalFile: imagePreview,
            fileType: fileType
          });
        }
      });
      return [...newTasksToAdd, ...currentTasks];
    });
    toast.success(`Berhasil disimpan ke ${forceType === 'task' ? 'Tugas' : 'Agenda'}!`);
    navigate('/dashboard');
  };

  const saveManual = () => {
    if (manualDirection === 'khs') {
      saveKHS(aiSuggestion.extracted_data || aiSuggestion);
    } else {
      saveEvent({ tasks: [aiSuggestion.extracted_data || aiSuggestion] }, manualDirection);
    }
    setShowModal(false);
  };

  const confirmOverwrite = () => {
    if (!pendingOverwrite) return;
    
    setSemesters(prev => {
      const updated = [...prev];
      const currentSem = { ...updated[pendingOverwrite.semIndex] };
      const existingDocs = [...(currentSem.documents || [])];
      
      existingDocs[pendingOverwrite.docIndex] = { 
        type: pendingOverwrite.newDocType, 
        file: pendingOverwrite.newDocFile 
      };
      
      updated[pendingOverwrite.semIndex] = {
        ...currentSem,
        courses: pendingOverwrite.extractedCourses.length > 0 ? pendingOverwrite.extractedCourses : currentSem.courses,
        originalFile: pendingOverwrite.newDocFile || currentSem.originalFile,
        documentType: pendingOverwrite.data.document_type || currentSem.documentType || 'Jadwal',
        documents: existingDocs
      };
      
      toast.success(`Dokumen ${pendingOverwrite.newDocType} berhasil diperbarui di ${currentSem.name}.`);
      return updated;
    });
    
    setPendingOverwrite(null);
    navigate('/dashboard');
  };

  const cancelOverwrite = () => {
    setPendingOverwrite(null);
    toast('Unggahan dokumen dibatalkan.', { icon: '🛑' });
  };

  useEffect(() => {
    if (fileToUpload && location.state?.autoScan && !autoScanDone && !isScanning) {
      setAutoScanDone(true);
      handleScan();
    }
  }, [fileToUpload, location.state, autoScanDone, isScanning]);

  return (
    <div>
      <div className="page-header" style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ 
            width: '48px', height: '48px', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary-color) 0%, #a855f7 100%)',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
            boxShadow: '0 8px 16px rgba(99, 102, 241, 0.2)'
          }}>
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: '0.25rem', lineHeight: 1 }}>Smart AI Scanner</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>Unggah dokumen apapun! AI akan mendeteksi isi & arah file, dan bertanya jika ragu.</p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ backgroundColor: 'var(--primary-color)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>1</span>
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>Pilih Mode Deteksi</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <button 
              className={`btn ${scanType === 'auto' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setScanType('auto')}
              style={{ padding: '0.75rem', flexDirection: 'column', gap: '4px' }}
            >
              <Compass size={20} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Otomatis</div>
            </button>
            <button 
              className={`btn ${scanType === 'khs' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setScanType('khs')}
              style={{ padding: '0.75rem', flexDirection: 'column', gap: '4px' }}
            >
              <FileText size={20} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>KRS/Jadwal</div>
            </button>
            <button 
              className={`btn ${scanType === 'calendar' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setScanType('calendar')}
              style={{ padding: '0.75rem', flexDirection: 'column', gap: '4px' }}
            >
              <Calendar size={20} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Agenda Event</div>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', marginTop: '1.5rem' }}>
            <span style={{ backgroundColor: 'var(--primary-color)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>2</span>
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>Unggah File</h3>
          </div>
          <label 
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '2rem 1rem', marginBottom: '1.5rem',
              border: '2px dashed var(--border-color)', borderRadius: '12px',
              backgroundColor: 'var(--bg-color)', cursor: 'pointer', transition: 'all 0.2s ease',
              color: 'var(--text-muted)'
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--primary-color)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <Upload size={36} style={{ marginBottom: '1rem', color: 'var(--primary-color)' }} />
            <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>Klik untuk Memilih File</span>
            <span style={{ fontSize: '0.85rem' }}>Mendukung PDF, Word, Excel, JPG, PNG (Max 10MB)</span>
            {fileToUpload && (
              <span style={{ marginTop: '1rem', padding: '0.3rem 0.5rem 0.3rem 0.8rem', backgroundColor: 'var(--card-bg)', borderRadius: '8px', color: 'var(--primary-color)', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }}>
                <FileText size={14} /> {fileToUpload.name}
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileToUpload(null);
                    setImagePreview(null);
                  }}
                  style={{ 
                    background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px', borderRadius: '4px',
                    marginLeft: '4px'
                  }}
                  onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="Batal pilih file"
                >
                  <X size={14} />
                </button>
              </span>
            )}
            <input 
              type="file" 
              accept="*" 
              onChange={handleImageChange}
              style={{ display: 'none' }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', marginTop: '0.5rem' }}>
            <span style={{ backgroundColor: 'var(--primary-color)', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>3</span>
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>Keterangan Tambahan (Opsional)</h3>
          </div>
          <textarea 
            className="form-input" 
            placeholder="Ketik konteks untuk membantu AI (misal: 'Ini presentasi kuliah pertemuan 3')" 
            value={userContext}
            onChange={e => setUserContext(e.target.value)}
            rows="3"
            style={{ backgroundColor: 'var(--bg-color)', marginBottom: '1.5rem' }}
          />

          <button 
            className="btn btn-primary" 
            onClick={handleScan} 
            disabled={isScanning || !fileToUpload}
            style={{ 
              width: '100%', padding: '1rem', fontSize: '1.05rem', fontWeight: 600,
              background: isScanning || !fileToUpload ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--primary-color) 0%, #818cf8 100%)',
              border: 'none',
              boxShadow: isScanning || !fileToUpload ? 'none' : '0 4px 14px rgba(79, 70, 229, 0.4)',
              transition: 'all 0.3s ease',
              marginTop: '1rem'
            }}
          >
            {isScanning ? <><Loader2 className="animate-spin" /> Menganalisis File...</> : <><Sparkles size={20} /> Mulai Deteksi AI</>}
          </button>
          
          {!apiKey && (
            <p style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '1rem', textAlign: 'center' }}>
              ⚠️ API Key Gemini belum diatur. Buka menu Settings.
            </p>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Scan size={20} style={{ color: 'var(--primary-color)' }} />
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.1rem' }}>Pratinjau Dokumen</h3>
          </div>
          <div style={{ 
            width: '100%', flex: 1, minHeight: '350px', backgroundColor: 'var(--bg-color)', 
            borderRadius: 'var(--radius-md)', border: '2px dashed var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
          }}>
            {fileToUpload ? (
              fileType === 'pdf' ? (
                <iframe src={imagePreview} width="100%" height="100%" style={{ border: 'none', borderRadius: '16px' }} title="PDF Preview" />
              ) : fileType === 'image' ? (
                <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--primary-color)' }}>
                  <FileText size={48} style={{ margin: '0 auto 1rem' }} />
                  <h4>Dokumen Dipilih:</h4>
                  <p style={{ fontSize: '0.875rem' }}>{fileToUpload.name}</p>
                  <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>Pratinjau visual tidak tersedia untuk format ini.</p>
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
                  <FileText size={64} style={{ color: 'var(--border-color)' }} />
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '130%', height: '3px', backgroundColor: 'var(--primary-color)', opacity: 0.6, boxShadow: '0 0 10px var(--primary-color)', borderRadius: '2px' }}></div>
                </div>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-main)', fontSize: '1.1rem' }}>Area Pratinjau</h4>
                <p style={{ fontSize: '0.85rem', margin: 0, opacity: 0.8 }}>Unggah dokumen di sebelah kiri untuk melihat isinya di sini.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context Menu Paste */}
      {contextMenu && (
        <div 
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: '0.5rem',
            minWidth: '200px'
          }}
          onClick={e => e.stopPropagation()}
        >
          <button 
            onClick={handleRightClickPaste}
            style={{
              width: '100%',
              padding: '0.5rem 1rem',
              textAlign: 'left',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-main)',
              borderRadius: '4px',
              fontSize: '0.9rem'
            }}
            onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-light)'}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Paperclip size={16} /> Paste dari Clipboard
          </button>
        </div>
      )}

      {/* Smart AI Overwrite Confirmation Modal */}
      {pendingOverwrite && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', padding: '1.5rem', width: '100%', maxWidth: '600px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: '#eab308' }}>
              <div style={{ background: '#fef08a', padding: '0.5rem', borderRadius: '50%' }}>
                <Sparkles size={24} color="#854d0e" />
              </div>
              <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.25rem' }}>AI Mendeteksi Duplikasi Dokumen</h3>
            </div>
            
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Hai! AI menyadari bahwa Anda mencoba mengunggah <strong>{pendingOverwrite.newDocType}</strong>, namun dokumen dengan tipe yang sama <strong>sudah tersimpan sebelumnya</strong> di semester aktif Anda. 
              <br/><br/>
              Apakah Anda yakin ingin menimpa (overwrite) dokumen yang lama dengan yang baru ini? Anda bisa melihat perbandingannya di bawah:
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ flex: 1, backgroundColor: 'var(--bg-color)', borderRadius: '8px', padding: '0.75rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#9ca3af' }}></span>
                  Dokumen Lama (Akan Terhapus)
                </div>
                {(pendingOverwrite.oldDoc?.file || semesters[pendingOverwrite.semIndex]?.originalFile)?.startsWith('data:image') ? (
                  <img src={pendingOverwrite.oldDoc?.file || semesters[pendingOverwrite.semIndex]?.originalFile} alt="Lama" style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '4px', opacity: 0.8 }} />
                ) : (pendingOverwrite.oldDoc?.file || semesters[pendingOverwrite.semIndex]?.originalFile)?.startsWith('data:application/pdf') ? (
                  <iframe src={pendingOverwrite.oldDoc?.file || semesters[pendingOverwrite.semIndex]?.originalFile} title="Preview Lama" style={{ width: '100%', height: '150px', border: 'none', borderRadius: '4px', opacity: 0.8 }} />
                ) : (
                  <div style={{ width: '100%', height: '150px', backgroundColor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', opacity: 0.8, flexDirection: 'column', gap: '0.5rem' }}>
                    <FileText size={32} color="#9ca3af" />
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Bukan Gambar/PDF</span>
                  </div>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
              </div>

              <div style={{ flex: 1, backgroundColor: '#eff6ff', borderRadius: '8px', padding: '0.75rem', border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1d4ed8', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6', boxShadow: '0 0 5px #3b82f6' }}></span>
                  Dokumen Baru (Scan Saat Ini)
                </div>
                {pendingOverwrite.newDocFile?.startsWith('data:image') ? (
                  <img src={pendingOverwrite.newDocFile} alt="Baru" style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '4px' }} />
                ) : pendingOverwrite.newDocFile?.startsWith('data:application/pdf') ? (
                  <iframe src={pendingOverwrite.newDocFile} title="Preview Baru" style={{ width: '100%', height: '150px', border: 'none', borderRadius: '4px' }} />
                ) : (
                  <div style={{ width: '100%', height: '150px', backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', flexDirection: 'column', gap: '0.5rem' }}>
                    <FileText size={32} color="#3b82f6" />
                    <span style={{ fontSize: '0.75rem', color: '#2563eb' }}>Bukan Gambar/PDF</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button 
                onClick={cancelOverwrite} 
                style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-main)', fontWeight: 600, cursor: 'pointer' }}
              >
                Batalkan Upload
              </button>
              <button 
                onClick={confirmOverwrite} 
                style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
              >
                Ya, Timpa Dokumen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Selection Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>Konfirmasi Penyimpanan File</h3>
              <button className="btn-icon" onClick={() => setShowModal(false)}><X size={20}/></button>
            </div>
            
            <div className="modal-body">
              <div style={{ backgroundColor: 'rgba(79, 70, 229, 0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <HelpCircle size={24} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-main)' }}>Keterangan AI:</strong>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    "{aiSuggestion?.description || 'File ini terdeteksi namun AI tidak yakin di mana tempat yang paling cocok untuk menyimpannya.'}"
                  </p>
                </div>
              </div>

              <div className="form-group">
                <label>Pilih Tujuan Penyimpanan</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', border: `2px solid ${manualDirection === 'file' ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer' }}>
                    <input type="radio" name="direction" value="file" checked={manualDirection === 'file'} onChange={() => setManualDirection('file')} style={{ display: 'none' }} />
                    <Paperclip size={18} style={{ color: manualDirection === 'file' ? 'var(--primary-color)' : 'var(--text-muted)' }} /> Arsip File
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', border: `2px solid ${manualDirection === 'task' ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer' }}>
                    <input type="radio" name="direction" value="task" checked={manualDirection === 'task'} onChange={() => setManualDirection('task')} style={{ display: 'none' }} />
                    <CheckSquare size={18} style={{ color: manualDirection === 'task' ? 'var(--primary-color)' : 'var(--text-muted)' }} /> Daftar Tugas
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', border: `2px solid ${manualDirection === 'event' ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer' }}>
                    <input type="radio" name="direction" value="event" checked={manualDirection === 'event'} onChange={() => setManualDirection('event')} style={{ display: 'none' }} />
                    <Calendar size={18} style={{ color: manualDirection === 'event' ? 'var(--primary-color)' : 'var(--text-muted)' }} /> Agenda (Event)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', border: `2px solid ${manualDirection === 'khs' ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '8px', cursor: 'pointer' }}>
                    <input type="radio" name="direction" value="khs" checked={manualDirection === 'khs'} onChange={() => setManualDirection('khs')} style={{ display: 'none' }} />
                    <FileText size={18} style={{ color: manualDirection === 'khs' ? 'var(--primary-color)' : 'var(--text-muted)' }} /> Semesters (KHS)
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button className="btn btn-outline" onClick={() => setShowModal(false)} style={{ flex: 1 }}>Batal</button>
                <button className="btn btn-primary" onClick={handleManualSave} style={{ flex: 1 }}>Simpan & Selesai</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
