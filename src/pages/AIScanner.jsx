import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Scan, Upload, Loader2, Sparkles, FileText, Calendar, Compass, HelpCircle, X, CheckSquare, Paperclip, Folder, Undo, Redo, RotateCcw, Copy, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { AI_DOCUMENT_MIME_TYPES, AI_LIMITS } from '../../shared/ai/contracts.mjs';
import {
  getPreferredAIDocumentExtension,
  isAIDocumentNameMimeMatch,
  validateAIDocumentPayload,
} from '../../shared/ai/documentValidation.mjs';
import { FrontendAIError, formatAIProviderStatus, frontendAIClient } from '../services/aiClient';
import { createAIScannerReview } from '../services/aiScannerReview';
import { applyCourseMergePlan, createCourseMergePlan } from '../services/aiScannerMerge';
import {
  OfflineScannerError,
  SCANNER_PROCESSING_SOURCES,
  isImageOfflineScannerMimeType,
  isOfflineScannerMimeType,
  isPdfOfflineScannerMimeType,
  processOfflineScannerFile,
} from '../services/offlineScanner';
import {
  PersistentDocumentError,
  persistScannerDocumentWithMetadata,
  resolvePersistentDocument,
} from '../services/persistentDocument';
import {
  AIScannerTargetError,
  parseAIScannerDocumentTarget,
  resolveAIScannerDocumentTarget,
  resolveAIScannerSemesterById,
} from '../services/aiScannerTargeting';
import AIModelSelector, { useAISelection } from '../components/AIModelSelector';
import AcademicCandidateReviewModal from '../components/AcademicCandidateReviewModal';
import {
  createAcademicImportPlan,
  createAcademicImportCommitSummary,
} from '../services/academicImportPlan';

const NEW_SEMESTER_DESTINATION = '__new_semester__';

function semesterDocuments(semester) {
  const documents = Array.isArray(semester?.documents) ? semester.documents : [];
  if (documents.length > 0 || !semester?.originalFile) return documents;
  return [{ type: semester.documentType || 'Dokumen Semester', file: semester.originalFile }];
}

function semesterOptionValue(semesterId) {
  return `${typeof semesterId}:${String(semesterId)}`;
}

function assertMetadataWriteSucceeded(result) {
  if (result?.ok === true) return result;
  throw new PersistentDocumentError(result?.ok === false ? 'metadata_write_failed' : 'metadata_commit_unknown');
}

function scannerSaveErrorMessage(error) {
  if (error instanceof AIScannerTargetError) {
    return 'Target semester atau dokumen sudah berubah. Tidak ada data yang disimpan.';
  }
  if (error instanceof PersistentDocumentError && error.code === 'cleanup_failed') {
    return 'Metadata gagal disimpan dan binary baru tidak dapat dibersihkan. Data lama tetap dipertahankan.';
  }
  return 'Dokumen gagal disimpan secara lokal. Data akademik tidak diubah.';
}

function offlineScannerErrorMessage(error) {
  if (!(error instanceof OfflineScannerError)) {
    return 'Dokumen gagal diproses secara Offline. File tetap tersedia untuk dicoba lagi.';
  }
  const messages = {
    request_cancelled: 'Pemrosesan Offline dibatalkan. Tidak ada data yang diubah.',
    unsupported_file: 'Format tidak didukung untuk pemrosesan Offline saat ini.',
    empty_content: 'Dokumen tidak berisi teks yang dapat ditinjau.',
    invalid_encoding: 'Encoding dokumen tidak valid. Gunakan TXT atau CSV UTF-8.',
    invalid_csv: 'Struktur CSV tidak valid atau tidak konsisten.',
    ambiguous_csv: 'Header CSV ambigu sehingga tidak aman dipetakan otomatis.',
    invalid_csv_content: 'Isi CSV tidak sesuai format akademik yang didukung.',
    unsafe_csv_content: 'CSV mengandung formula atau nilai yang tidak aman untuk dipetakan.',
    invalid_text_content: 'Dokumen mengandung karakter kontrol yang tidak didukung.',
    file_size_mismatch: 'Ukuran dokumen berubah saat dibaca. Silakan pilih ulang file.',
    pdf_invalid: 'File PDF tidak valid, kosong, atau terenkripsi.',
    pdf_processing_failed: 'PDF gagal diproses secara lokal. File tetap tersedia.',
    pdf_asset_error: 'Aset PDF.js lokal tidak dapat dimuat. Pastikan aplikasi berjalan dengan benar.',
    invalid_image: 'File gambar rusak atau bukan format gambar yang valid.',
    image_dimension_limit_exceeded: 'Resolusi gambar melebihi batas keamanan lokal (maksimal 25 juta piksel).',
    ocr_processing_failed: 'OCR gambar gagal diproses secara lokal. File tetap tersedia.',
    ocr_canvas_unavailable: 'Canvas tidak tersedia untuk merender halaman PDF ke gambar.',
    ocr_asset_error: 'Aset OCR Tesseract lokal tidak dapat dimuat. Pastikan aplikasi berjalan dengan benar.',
  };
  return messages[error.code] || 'Dokumen gagal diproses secara Offline. File tetap tersedia untuk dicoba lagi.';
}

export default function AIScanner() {
  const {
    semesters,
    setSemesters,
    tasks: academicTasks,
    setTasks,
    nim: profileNim,
    fullName: profileFullName,
    userName: profileUserName,
    commitAcademicImport,
  } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [autoScanDone, setAutoScanDone] = useState(false);
  
  const [imagePreview, setImagePreview] = useState(null);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [fileType, setFileType] = useState('image'); // 'image' | 'pdf' | 'other'
  const [scanType, setScanType] = useState('auto'); // 'auto' | 'khs' | 'calendar'
  const [isScanning, setIsScanning] = useState(false);
  const [activeScanRequestId, setActiveScanRequestId] = useState(null);
  const [isCancellingScan, setIsCancellingScan] = useState(false);
  const activeScanRequestRef = useRef(null);
  const activeScanSourceRef = useRef(null);
  const offlineAbortControllerRef = useRef(null);
  const { selection, setSelection, preferenceStatus } = useAISelection();

  useEffect(() => {
    if (location.state && location.state.prefillImage) {
      const dataUri = location.state.prefillImage;
      if (imagePreview !== dataUri) {
        setImagePreview(dataUri);
        
        fetch(dataUri)
          .then(res => res.blob())
          .then(blob => {
            const mime = dataUri.split(',')[0].match(/:(.*?);/)?.[1] || blob.type;
            if (!AI_DOCUMENT_MIME_TYPES.includes(mime) || blob.size > AI_LIMITS.DOCUMENT_BYTES) {
              toast.error('Dokumen tidak didukung atau melebihi batas 10MB.');
              return;
            }
            const ext = getPreferredAIDocumentExtension(mime);
            if (!ext) {
              toast.error('Dokumen tidak didukung oleh AI Scanner.');
              return;
            }
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
  const [aiProviderStatus, setAiProviderStatus] = useState('');
  const [confirmCourseReplacements, setConfirmCourseReplacements] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [oldDocumentPreview, setOldDocumentPreview] = useState({ url: '', mimeType: '' });
  const [semesterDestination, setSemesterDestination] = useState({ mode: 'none', semesterId: null });
  const [processingSource, setProcessingSource] = useState(SCANNER_PROCESSING_SOURCES.OFFLINE);
  const [onlineDocumentConsent, setOnlineDocumentConsent] = useState(false);
  const [offlineTextPreview, setOfflineTextPreview] = useState(null);
  const [activeOcrPayload, setActiveOcrPayload] = useState(null);
  const [ocrEditText, setOcrEditText] = useState('');
  const [ocrHistory, setOcrHistory] = useState([]);
  const [ocrHistoryIndex, setOcrHistoryIndex] = useState(-1);
  const [activeReviewTab, setActiveReviewTab] = useState('data');
  const [academicCandidate, setAcademicCandidate] = useState(null);
  const [showAcademicReviewModal, setShowAcademicReviewModal] = useState(false);
  const [importActionOverrides, setImportActionOverrides] = useState({});
  const [confirmIdentityMismatch, setConfirmIdentityMismatch] = useState(false);
  const [showImportConfirmModal, setShowImportConfirmModal] = useState(false);
  const [importCommitResult, setImportCommitResult] = useState(null);
  // pdfProgress: null = idle, object = sedang memproses PDF
  // { currentPage, totalPages, percent, stage }
  const [pdfProgress, setPdfProgress] = useState(null);

  const navigationTargetState = useMemo(() => {
    if (!Object.hasOwn(location.state || {}, 'replaceDoc')) {
      return Object.freeze({ present: false, target: null });
    }
    try {
      return Object.freeze({
        present: true,
        target: parseAIScannerDocumentTarget(location.state.replaceDoc),
      });
    } catch {
      return Object.freeze({ present: true, target: null });
    }
  }, [location.state]);

  const resolvedNavigationTarget = useMemo(() => {
    if (navigationTargetState.target === null) return null;
    try {
      return resolveAIScannerDocumentTarget(semesters, navigationTargetState.target);
    } catch {
      return null;
    }
  }, [navigationTargetState.target, semesters]);

  useEffect(() => () => {
    const requestId = activeScanRequestRef.current;
    if (!requestId) return;
    if (activeScanSourceRef.current === SCANNER_PROCESSING_SOURCES.OFFLINE) {
      offlineAbortControllerRef.current?.abort();
      return;
    }
    void frontendAIClient.cancel(requestId).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    let release = () => {};
    setOldDocumentPreview({ url: '', mimeType: '' });
    if (!pendingOverwrite?.oldDoc) return undefined;
    void resolvePersistentDocument(pendingOverwrite.oldDoc)
      .then(resolved => {
        release = resolved.release;
        if (active) setOldDocumentPreview({ url: resolved.url, mimeType: resolved.mimeType });
        else release();
      })
      .catch(() => {});
    return () => {
      active = false;
      release();
    };
  }, [pendingOverwrite]);

  const handleFileSelection = (file) => {
    if (!file) return false;
    if (!AI_DOCUMENT_MIME_TYPES.includes(file.type)) {
      toast.error('Format tidak didukung. Gunakan PDF, BMP, JPG, PNG, WebP, CSV, atau TXT.');
      return false;
    }
    if (!isAIDocumentNameMimeMatch(file.name, file.type)) {
      toast.error('Ekstensi nama file tidak sesuai dengan tipe dokumen.');
      return false;
    }
    if (file.size < 1 || file.size > AI_LIMITS.DOCUMENT_BYTES) {
      toast.error('Ukuran file harus lebih dari 0 byte dan maksimal 10MB.');
      return false;
    }
    if (activeOcrPayload && ocrEditText !== activeOcrPayload.rawText) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Terdapat perubahan teks OCR pada dokumen saat ini yang belum disimpan. Lanjutkan memilih file baru?')) {
          return false;
        }
      }
    }
    setFileToUpload(file);
    setOnlineDocumentConsent(false);
    setOfflineTextPreview(null);
    setActiveOcrPayload(null);
    setOcrEditText('');
    setOcrHistory([]);
    setOcrHistoryIndex(-1);
    setActiveReviewTab('data');
    setAiProviderStatus('');
    setAcademicCandidate(null);
    setShowAcademicReviewModal(false);
    
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
      setImagePreview(null);
    }
    return true;
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
          if (AI_DOCUMENT_MIME_TYPES.includes(type)) {
            const blob = await item.getType(type);
            const ext = getPreferredAIDocumentExtension(type);
            if (!ext) continue;
            const file = new File([blob], `pasted-file.${ext}`, { type });
            found = handleFileSelection(file);
            if (found) toast.success('File ditempel dari Clipboard!');
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        toast.error('Tidak ada file gambar/PDF di clipboard!');
      }
    } catch {
      toast.error('Gagal membaca clipboard. Pastikan Anda memberi izin browser.');
    }
  };

  useEffect(() => {
    const handlePaste = (e) => {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        if (handleFileSelection(e.clipboardData.files[0])) {
          toast.success('File ditempel dari Clipboard!');
        }
      }
    };
    const handleClick = () => setContextMenu(null);

    window.addEventListener('paste', handlePaste);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('click', handleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  async function fileToAIInput(file) {
    if (
      !AI_DOCUMENT_MIME_TYPES.includes(file?.type)
      || file.size < 1
      || file.size > AI_LIMITS.DOCUMENT_BYTES
    ) throw new Error('invalid_file');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = typeof reader.result === 'string' ? reader.result.split(',')[1] : null;
        if (!base64) {
          reject(new Error('invalid_file'));
          return;
        }
        const payload = {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          base64,
        };
        if (!validateAIDocumentPayload(payload).valid) {
          reject(new Error('invalid_file_content'));
          return;
        }
        resolve(payload);
      };
      reader.onerror = () => reject(new Error('file_read_failed'));
      reader.readAsDataURL(file);
    });
  }

  const presentScannerReview = (review, providerStatus, textPreview = null) => {
    const defaultSemester = resolvedNavigationTarget?.semester
      ?? semesters.find(semester => semester.status === 'current')
      ?? null;
    setAiSuggestion(review.suggestion);
    setManualDirection(review.direction);
    setConfirmCourseReplacements(false);
    setSemesterDestination(defaultSemester
      ? { mode: 'existing', semesterId: defaultSemester.id }
      : { mode: 'none', semesterId: null });
    setAiProviderStatus(providerStatus);
    setOfflineTextPreview(textPreview);

    const fullText = review.fullText || textPreview?.fullText || textPreview?.text || null;
    if (fullText && typeof fullText === 'string' && fullText.trim().length > 0) {
      setActiveOcrPayload({
        rawText: fullText,
        editedText: null,
        documentType: review.suggestion?.extracted_data?.document_type || fileToUpload?.name || 'Dokumen',
        pageCount: review.meta?.pageCount ?? null,
        confidence: review.confidence ?? review.meta?.confidence ?? null,
        parser: review.parser ?? null,
      });
      setOcrEditText(fullText);
      setOcrHistory([fullText]);
      setOcrHistoryIndex(0);
    } else {
      setActiveOcrPayload(null);
      setOcrEditText('');
      setOcrHistory([]);
      setOcrHistoryIndex(-1);
    }
    setActiveReviewTab('data');

    const candidate = review.academicInfo
      || (review.suggestion?.extracted_data?.documentType && ['KRS', 'KHS'].includes(review.suggestion.extracted_data.documentType)
        ? review.suggestion.extracted_data
        : null);
    setAcademicCandidate(candidate);
    setShowAcademicReviewModal(false);

    setShowModal(true);
  };

  const handleScan = async () => {
    if (!fileToUpload) {
      toast.error('Pilih file terlebih dahulu.');
      return;
    }
    if (navigationTargetState.present && resolvedNavigationTarget === null) {
      toast.error('Target dokumen sudah berubah atau tidak tersedia. Pilih kembali dokumen dari halaman Semester.');
      return;
    }
    if (fileToUpload.size < 1 || fileToUpload.size > AI_LIMITS.DOCUMENT_BYTES) {
      toast.error('Ukuran file harus lebih dari 0 byte dan maksimal 10MB.');
      return;
    }
    if (!AI_DOCUMENT_MIME_TYPES.includes(fileToUpload.type)) {
      toast.error('Format file tidak didukung oleh AI Scanner.');
      return;
    }
    if (processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE) {
      if (!isOfflineScannerMimeType(fileToUpload.type)) {
        toast.error('OCR Offline untuk PDF dan gambar belum tersedia. Pilih Gemini Online secara manual jika ingin mengirim dokumen.');
        return;
      }
    } else {
      if (!selection.freeTierDataConsent || !onlineDocumentConsent) {
        toast.error('Persetujuan eksplisit pengiriman dokumen ini ke Gemini diperlukan.');
        return;
      }
    }

    setIsScanning(true);
    setAiProviderStatus('');
    setOfflineTextPreview(null);
    setPdfProgress(null);
    activeScanSourceRef.current = processingSource;
    try {
      if (processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE) {
        const controller = new AbortController();
        const localRequestId = `offline-${Date.now()}`;
        offlineAbortControllerRef.current = controller;
        activeScanRequestRef.current = localRequestId;
        setActiveScanRequestId(localRequestId);

        // Callback progress aktif untuk PDF dan gambar (OCR).
        const handleOfflineProgress = (isPdfOfflineScannerMimeType(fileToUpload.type) || isImageOfflineScannerMimeType(fileToUpload.type))
          ? (update) => setPdfProgress(update)
          : undefined;

        const review = await processOfflineScannerFile(fileToUpload, {
          scanType,
          signal: controller.signal,
          baseUrl: document.baseURI,
          onProgress: handleOfflineProgress,
        });
        presentScannerReview(
          review,
          review.structured
            ? 'Offline lokal · data terstruktur menunggu konfirmasi'
            : review.parser === 'pdf'
              ? 'Offline lokal · ekstraksi teks PDF, tanpa analisis AI'
              : review.parser === 'ocr'
                ? 'Offline lokal · OCR gambar (Tesseract), tanpa analisis AI'
                : 'Offline lokal · ekstraksi teks saja, tanpa analisis AI',
          review.textPreview,
        );
        return;
      }

      const aiFile = await fileToAIInput(fileToUpload);
      
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

      void prompt;
      const operation = frontendAIClient.startDocumentScan({
        scanType: scanType === 'calendar' ? 'event' : scanType,
        file: aiFile,
        userContext,
        selection,
      });
      activeScanRequestRef.current = operation.requestId;
      setActiveScanRequestId(operation.requestId);
      const response = await operation.result;
      if (!response.success) {
        const safeError = new FrontendAIError(response.error?.code);
        toast.error(`${safeError.message} Tidak ada data yang diubah.`);
        return;
      }

      const review = createAIScannerReview(response, scanType);
      presentScannerReview(review, formatAIProviderStatus(review.meta));
    } catch (error) {
      if (error instanceof OfflineScannerError) {
        const notify = error.code === 'request_cancelled' ? toast : toast.error;
        notify(offlineScannerErrorMessage(error));
      } else if (error instanceof FrontendAIError) {
        const notify = error.code === 'request_cancelled' ? toast : toast.error;
        notify(`${error.message} Tidak ada data yang diubah.`);
      } else {
        toast.error('File gagal dibaca atau kontennya tidak sesuai. Tidak ada data yang diubah.');
      }
    } finally {
      activeScanRequestRef.current = null;
      activeScanSourceRef.current = null;
      offlineAbortControllerRef.current = null;
      setActiveScanRequestId(null);
      setIsCancellingScan(false);
      setIsScanning(false);
      setPdfProgress(null);
    }
  };

  const handleCancelScan = async () => {
    const requestId = activeScanRequestRef.current;
    if (!requestId || isCancellingScan) return;
    setIsCancellingScan(true);
    try {
      if (activeScanSourceRef.current === SCANNER_PROCESSING_SOURCES.OFFLINE) {
        offlineAbortControllerRef.current?.abort();
        return;
      }
      const cancelled = await frontendAIClient.cancel(requestId);
      if (!cancelled) toast('Permintaan sudah selesai dan tidak dapat dibatalkan.');
    } catch (error) {
      const message = error instanceof FrontendAIError
        ? error.message
        : 'Pembatalan permintaan AI tidak tersedia.';
      toast.error(message);
      setIsCancellingScan(false);
    }
  };

  const createMergePlan = (courses, incomingCourses) => createCourseMergePlan(
    courses || [],
    incomingCourses || [],
    { idFactory: index => `${Date.now()}-${index}-${Math.random()}` },
  );

  const getEffectiveOcrPayload = (basePayload) => {
    const target = basePayload || activeOcrPayload;
    if (!target || typeof target.rawText !== 'string') return null;
    return {
      ...target,
      editedText: (typeof ocrEditText === 'string' && ocrEditText !== target.rawText) ? ocrEditText : target.editedText ?? null,
    };
  };

  const resolveSaveDestination = (sourceSemesters) => {
    if (navigationTargetState.present) {
      if (navigationTargetState.target === null) throw new AIScannerTargetError('invalid_target');
      return resolveAIScannerDocumentTarget(sourceSemesters, navigationTargetState.target);
    }
    if (semesterDestination.mode === 'existing') {
      const resolved = resolveAIScannerSemesterById(sourceSemesters, semesterDestination.semesterId);
      return {
        mode: 'append',
        semesterId: semesterDestination.semesterId,
        semesterIndex: resolved.semesterIndex,
        semester: resolved.semester,
        documents: semesterDocuments(resolved.semester),
      };
    }
    if (semesterDestination.mode === 'new') {
      if (sourceSemesters.some(semester => semester.status === 'current')) {
        throw new AIScannerTargetError('target_changed');
      }
      return { mode: 'new' };
    }
    throw new AIScannerTargetError('invalid_target');
  };

  const saveKHS = async (data, allowCourseReplacements) => {
    const initialTarget = resolveSaveDestination(semesters);
    const docTypeStr = ['create', 'replace'].includes(initialTarget.mode)
      ? initialTarget.documentType
      : data.document_type || 'Jadwal';
    if (initialTarget.mode !== 'new') {
      const existingDocs = initialTarget.documents;
      const docIndex = initialTarget.mode === 'replace'
        ? initialTarget.documentIndex
        : existingDocs.findIndex(document => document.type === docTypeStr);
      if (fileToUpload && docIndex >= 0 && initialTarget.mode !== 'create') {
        const overwriteTarget = initialTarget.mode === 'replace'
          ? navigationTargetState.target
          : parseAIScannerDocumentTarget({
              mode: 'replace',
              semesterId: initialTarget.semesterId,
              docIndex,
              oldType: existingDocs[docIndex].type,
            });
        setPendingOverwrite({
          target: overwriteTarget,
          semesterName: initialTarget.semester.name,
          oldDoc: existingDocs[docIndex],
          newDocType: docTypeStr,
          newDocPreview: imagePreview,
          newFile: fileToUpload,
          data,
          allowCourseReplacements,
          ocrPayload: getEffectiveOcrPayload(activeOcrPayload),
        });
        return { status: 'pending' };
      }
    }

    await persistScannerDocumentWithMetadata(
      fileToUpload,
      docTypeStr,
      storedDocument => setSemesters(previous => {
        const target = resolveSaveDestination(previous);
        if (target.mode === 'replace') throw new AIScannerTargetError('target_changed');
        if (target.mode === 'new') {
          const courseMergePlan = createMergePlan([], data.courses);
          return [...previous, {
            id: Date.now(),
            name: data.semester_name || 'Semester Baru',
            gpa: data.gpa || 0,
            courses: applyCourseMergePlan(courseMergePlan),
            status: 'current',
            originalFile: storedDocument.binaryRef,
            documentType: docTypeStr,
            documents: [storedDocument],
          }];
        }

        const updated = [...previous];
        const targetSemester = updated[target.semesterIndex];
        const existingDocs = [...semesterDocuments(targetSemester)];
        if (
          target.mode === 'append'
          && existingDocs.some(document => document.type === docTypeStr)
        ) throw new AIScannerTargetError('target_changed');
        existingDocs.push(storedDocument);
        const courseMergePlan = createMergePlan(targetSemester.courses, data.courses);
        updated[target.semesterIndex] = {
          ...targetSemester,
          courses: applyCourseMergePlan(courseMergePlan, { allowReplacements: allowCourseReplacements }),
          originalFile: storedDocument.binaryRef,
          documentType: docTypeStr,
          documents: existingDocs,
        };
        return updated;
      }),
      { ocrPayload: getEffectiveOcrPayload(activeOcrPayload) },
    );

    const message = initialTarget.mode === 'new'
      ? `Berhasil! Semester/Dokumen (${docTypeStr}) baru ditambahkan dan diaktifkan.`
      : `Berhasil! Dokumen (${docTypeStr}) disimpan di ${initialTarget.semester.name}.`;
    return { status: 'saved', message };
  };

  const saveEvent = (data, forceType, storedDocument) => {
    const items = data.tasks || [data];
    return setTasks(prev => {
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
            originalFile: currentTasks[existingIndex].originalFile || storedDocument?.binaryRef || null,
            textRef: currentTasks[existingIndex].textRef || storedDocument?.textRef || null,
            fileType: currentTasks[existingIndex].fileType || fileType,
            course: currentTasks[existingIndex].course || t.course_name,
            exam_type: currentTasks[existingIndex].exam_type || t.exam_type,
            task_type: currentTasks[existingIndex].task_type || t.task_type,
            project_type: currentTasks[existingIndex].project_type || t.project_type,
            task_number: currentTasks[existingIndex].task_number || t.task_number,
            meeting_number: currentTasks[existingIndex].meeting_number || t.meeting_number,
            semester: currentTasks[existingIndex].semester || t.semester,
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
            originalFile: storedDocument?.binaryRef || null,
            textRef: storedDocument?.textRef || null,
            fileType: fileType
          });
        }
      });
      return [...newTasksToAdd, ...currentTasks];
    });
  };

  const handleCompleteAcademicReview = ({ updatedCandidate, plannedSemesterId }) => {
    setAcademicCandidate(updatedCandidate);
    if (aiSuggestion?.extracted_data) {
      setAiSuggestion(prev => {
        if (!prev) return prev;
        const currentExtracted = prev.extracted_data || {};
        return {
          ...prev,
          extracted_data: {
            ...currentExtracted,
            courses: updatedCandidate.selectedCourses || updatedCandidate.courses || [],
            summary: updatedCandidate.summary || currentExtracted.summary,
            document_type: updatedCandidate.documentType,
            documentType: updatedCandidate.documentType,
          },
        };
      });
    }
    if (plannedSemesterId) {
      setSemesterDestination({ mode: 'existing', semesterId: plannedSemesterId });
    }
    setShowAcademicReviewModal(false);
    toast.success('Review kandidat akademik selesai! Perubahan draft tersimpan. Silakan periksa pratinjau penggabungan ke Semester.');
  };

  const saveManual = async () => {
    if (!aiSuggestion?.extracted_data || isSaving || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      let successMessage;
      if (manualDirection === 'khs') {
        if (academicCandidate && processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE) {
          setShowModal(false);
          setAiSuggestion(null);
          setAcademicCandidate(null);
          setShowAcademicReviewModal(false);
          setAiProviderStatus('');
          toast.success('Review kandidat akademik selesai! Pratinjau penggabungan selesai dan jalur tulis ke data Semester pada profil asli tetap digate demi perlindungan data. Tahap B6C.');
          return;
        }

        if (academicCandidate && (!academicCandidate.courses || academicCandidate.courses.length === 0)) {
          toast.error('Tidak ada mata kuliah yang terdeteksi dalam dokumen ini. Pilih tujuan "Arsip File" jika ingin menyimpan sebagai arsip dokumen, atau perbaiki teks di Editor OCR.');
          return;
        }

        if (courseMergePreview?.requiresReplacementConfirmation && !confirmCourseReplacements) {
          toast.error('Konfirmasi penggantian field mata kuliah diperlukan. Tidak ada data yang diubah.');
          return;
        }
        const result = await saveKHS(aiSuggestion.extracted_data, confirmCourseReplacements);
        if (result.status === 'pending') {
          setShowModal(false);
          setAiSuggestion(null);
          return;
        }
        successMessage = result.message;
      } else {
        const extractedData = aiSuggestion.extracted_data;
        const incomingTasks = extractedData.tasks.length > 0 ? extractedData.tasks : [extractedData];
        const documentNeeded = incomingTasks.some(task => {
          const incomingTitle = task.title || fileToUpload?.name || '';
          const normalized = incomingTitle.replace(/\.[a-zA-Z0-9]+$/u, '').toLowerCase().trim();
          const existing = academicTasks.find(item => (
            typeof item.title === 'string'
            && item.title.replace(/\.[a-zA-Z0-9]+$/u, '').toLowerCase().trim() === normalized
          ));
          return !existing?.originalFile;
        });
        if (fileToUpload && documentNeeded) {
          await persistScannerDocumentWithMetadata(
            fileToUpload,
            extractedData.document_type || fileToUpload.name,
            storedDocument => saveEvent({ tasks: incomingTasks }, manualDirection, storedDocument),
            { ocrPayload: getEffectiveOcrPayload(activeOcrPayload) },
          );
        } else {
          assertMetadataWriteSucceeded(saveEvent({ tasks: incomingTasks }, manualDirection, null));
        }
        const destinationLabel = manualDirection === 'task'
          ? 'Tugas'
          : manualDirection === 'file'
            ? 'Arsip File'
            : 'Agenda';
        successMessage = `Berhasil disimpan ke ${destinationLabel}!`;
      }
      setShowModal(false);
      setAiSuggestion(null);
      setAcademicCandidate(null);
      setAiProviderStatus('');
      toast.success(successMessage);
      navigate('/');
    } catch (error) {
      toast.error(scannerSaveErrorMessage(error));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const confirmOverwrite = async () => {
    if (!pendingOverwrite || isSaving || isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await persistScannerDocumentWithMetadata(
        pendingOverwrite.newFile,
        pendingOverwrite.newDocType,
        storedDocument => setSemesters(previous => {
          const target = resolveAIScannerDocumentTarget(previous, pendingOverwrite.target);
          const updated = [...previous];
          const targetSemester = { ...updated[target.semesterIndex] };
          const existingDocs = [...target.documents];
          const courseMergePlan = createMergePlan(targetSemester.courses, pendingOverwrite.data.courses);
          existingDocs[target.documentIndex] = storedDocument;
          updated[target.semesterIndex] = {
            ...targetSemester,
            courses: applyCourseMergePlan(courseMergePlan, { allowReplacements: pendingOverwrite.allowCourseReplacements }),
            originalFile: storedDocument.binaryRef,
            documentType: pendingOverwrite.newDocType,
            documents: existingDocs,
          };
          return updated;
        }),
        { ocrPayload: getEffectiveOcrPayload(pendingOverwrite.ocrPayload) },
      );
      setPendingOverwrite(null);
      toast.success(`Dokumen ${pendingOverwrite.newDocType} berhasil diperbarui di ${pendingOverwrite.semesterName}.`);
      navigate('/');
    } catch (error) {
      toast.error(scannerSaveErrorMessage(error));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const cancelOverwrite = () => {
    setPendingOverwrite(null);
    toast('Unggahan dokumen dibatalkan.', { icon: 'ðŸ›‘' });
  };

  useEffect(() => {
    if (
      fileToUpload
      && selection.freeTierDataConsent
      && location.state?.autoScan
      && !autoScanDone
      && !isScanning
      && processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE
      && isOfflineScannerMimeType(fileToUpload.type)
    ) {
      setAutoScanDone(true);
      handleScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileToUpload, location.state, autoScanDone, isScanning, processingSource]);

  const previewData = aiSuggestion?.extracted_data;
  const currentSemester = semesters.find(semester => semester.status === 'current');
  const selectedReviewSemester = navigationTargetState.present
    ? resolvedNavigationTarget?.semester ?? null
    : semesterDestination.mode === 'existing'
      ? semesters.find(semester => Object.is(semester.id, semesterDestination.semesterId)) ?? null
      : null;
  const semesterDestinationReady = navigationTargetState.present
    ? resolvedNavigationTarget !== null
    : selectedReviewSemester !== null
      || (semesterDestination.mode === 'new' && !currentSemester);
  const courseMergePreview = previewData?.courses
    ? createCourseMergePlan(selectedReviewSemester?.courses || [], previewData.courses)
    : null;
  const academicImportPlan = useMemo(() => {
    if (!academicCandidate || !selectedReviewSemester) return null;
    try {
      return createAcademicImportPlan(selectedReviewSemester, academicCandidate, {
        userProfile: { nim: profileNim, fullName: profileFullName, userName: profileUserName },
      });
    } catch {
      return null;
    }
  }, [academicCandidate, selectedReviewSemester, profileNim, profileFullName, profileUserName]);

  const importCommitSummary = useMemo(() => {
    if (!academicImportPlan || !selectedReviewSemester) return null;
    try {
      return createAcademicImportCommitSummary(academicImportPlan, selectedReviewSemester, importActionOverrides);
    } catch {
      return null;
    }
  }, [academicImportPlan, selectedReviewSemester, importActionOverrides]);

  const handleExecuteCommitAcademicImport = async () => {
    if (!academicImportPlan || !selectedReviewSemester || isSaving || !commitAcademicImport) return;
    setIsSaving(true);
    try {
      const result = await commitAcademicImport({
        targetSemesterId: selectedReviewSemester.id,
        plan: academicImportPlan,
        actionOverrides: importActionOverrides,
        allowIdentityMismatch: confirmIdentityMismatch,
      });

      setImportCommitResult(result);
      setShowImportConfirmModal(false);
      toast.success(
        `Berhasil menyimpan ke ${selectedReviewSemester.name}: ${result.addedCount} ditambahkan, ${result.updatedCount} ditimpa, dan ${result.unchangedCount} dipertahankan!`,
        { duration: 5000 }
      );
    } catch (err) {
      if (err.code === 'plan_stale') {
        toast.error('Data semester tujuan telah berubah di latar belakang. Pratinjau diperbarui ulang.', { duration: 6000 });
        setImportActionOverrides({});
        setShowImportConfirmModal(false);
      } else if (err.code === 'import_locked') {
        toast.error('Operasi impor sedang berlangsung pada jendela/tab lain. Silakan tunggu.', { duration: 5000 });
      } else if (err.code === 'identity_mismatch_unconfirmed') {
        toast.error('Konfirmasi ketidaksesuaian NIM diperlukan sebelum penggabungan.', { duration: 5000 });
      } else if (err.code === 'storage_write_failed') {
        toast.error('Penyimpanan lokal penuh atau tidak tersedia. Data lama tetap utuh.', { duration: 6000 });
      } else {
        toast.error(`Gagal menyimpan ke semester: ${err.message || err.code}`, { duration: 5000 });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const semesterDestinationValue = semesterDestination.mode === 'new'
    ? NEW_SEMESTER_DESTINATION
    : semesterDestination.mode === 'existing'
      ? semesterOptionValue(semesterDestination.semesterId)
      : '';
  const handleSemesterDestinationChange = event => {
    setImportActionOverrides({});
    setImportCommitResult(null);
    setConfirmIdentityMismatch(false);
    if (event.target.value === NEW_SEMESTER_DESTINATION) {
      setSemesterDestination({ mode: 'new', semesterId: null });
      return;
    }
    const semester = semesters.find(item => semesterOptionValue(item.id) === event.target.value);
    setSemesterDestination(semester
      ? { mode: 'existing', semesterId: semester.id }
      : { mode: 'none', semesterId: null });
  };
  const handleProcessingSourceChange = source => {
    if (isScanning || source === processingSource) return;
    setProcessingSource(source);
    setOnlineDocumentConsent(false);
    setAiProviderStatus('');
  };
  const closeReview = () => {
    if (activeOcrPayload && ocrEditText !== activeOcrPayload.rawText) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Perubahan teks OCR belum disimpan. Anda yakin ingin membatalkan dan membuang perubahan?')) {
          return;
        }
      }
    }
    setShowModal(false);
    setAiSuggestion(null);
    setAiProviderStatus('');
    setConfirmCourseReplacements(false);
    setSemesterDestination({ mode: 'none', semesterId: null });
    setOfflineTextPreview(null);
    setActiveOcrPayload(null);
    setOcrEditText('');
    setOcrHistory([]);
    setOcrHistoryIndex(-1);
    setActiveReviewTab('data');
    setAcademicCandidate(null);
    setShowAcademicReviewModal(false);
    setImportCommitResult(null);
    setShowImportConfirmModal(false);
    setConfirmIdentityMismatch(false);
    setImportActionOverrides({});
  };

  const handleOcrTextChange = (e) => {
    const newText = e.target.value;
    setOcrEditText(newText);
    setOcrHistory(prev => {
      const updated = prev.slice(0, ocrHistoryIndex + 1);
      updated.push(newText);
      if (updated.length > 50) updated.shift();
      return updated;
    });
    setOcrHistoryIndex(prev => Math.min(prev + 1, 49));
    setActiveOcrPayload(prev => {
      if (!prev) return null;
      return {
        ...prev,
        editedText: newText === prev.rawText ? null : newText,
      };
    });
  };

  const handleOcrUndo = () => {
    if (ocrHistoryIndex <= 0) return;
    const newIndex = ocrHistoryIndex - 1;
    const targetText = ocrHistory[newIndex];
    setOcrHistoryIndex(newIndex);
    setOcrEditText(targetText);
    setActiveOcrPayload(prev => {
      if (!prev) return null;
      return {
        ...prev,
        editedText: targetText === prev.rawText ? null : targetText,
      };
    });
  };

  const handleOcrRedo = () => {
    if (ocrHistoryIndex >= ocrHistory.length - 1) return;
    const newIndex = ocrHistoryIndex + 1;
    const targetText = ocrHistory[newIndex];
    setOcrHistoryIndex(newIndex);
    setOcrEditText(targetText);
    setActiveOcrPayload(prev => {
      if (!prev) return null;
      return {
        ...prev,
        editedText: targetText === prev.rawText ? null : targetText,
      };
    });
  };

  const handleOcrReset = () => {
    if (!activeOcrPayload) return;
    const raw = activeOcrPayload.rawText;
    setOcrEditText(raw);
    setOcrHistory(prev => {
      const updated = prev.slice(0, ocrHistoryIndex + 1);
      updated.push(raw);
      return updated;
    });
    setOcrHistoryIndex(prev => prev + 1);
    setActiveOcrPayload(prev => ({
      ...prev,
      editedText: null,
    }));
    toast.success('Teks dikembalikan ke hasil OCR asli (rawText).');
  };

  const handleOcrCopy = async () => {
    try {
      await navigator.clipboard.writeText(ocrEditText);
      toast.success('Teks OCR berhasil disalin ke clipboard.');
    } catch {
      toast.error('Gagal menyalin teks ke clipboard.');
    }
  };

  const handleOcrDownloadTxt = () => {
    try {
      const blob = new Blob([ocrEditText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const baseName = (fileToUpload?.name || 'dokumen').replace(/\.[^.]+$/, '');
      anchor.href = url;
      anchor.download = `${baseName}-ocr.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Teks OCR berhasil diunduh sebagai file .txt');
    } catch {
      toast.error('Gagal mengunduh teks OCR.');
    }
  };
  const offlineFileSupported = fileToUpload ? isOfflineScannerMimeType(fileToUpload.type) : true;
  // PDF didukung Offline untuk ekstraksi teks asli, BUKAN OCR foto.
  const offlinePdfFile = fileToUpload ? isPdfOfflineScannerMimeType(fileToUpload.type) : false;
  const offlineImageFile = fileToUpload ? isImageOfflineScannerMimeType(fileToUpload.type) : false;
  const scanPermissionReady = processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE
    ? offlineFileSupported
    : selection.freeTierDataConsent && onlineDocumentConsent;

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
            <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>Sumber Pemrosesan</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button
              className={`btn ${processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => handleProcessingSourceChange(SCANNER_PROCESSING_SOURCES.OFFLINE)}
              disabled={isScanning}
              style={{ padding: '0.75rem', flexDirection: 'column', gap: '4px' }}
            >
              <FileText size={20} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Offline (Lokal)</div>
            </button>
            <button
              className={`btn ${processingSource === SCANNER_PROCESSING_SOURCES.GEMINI ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => handleProcessingSourceChange(SCANNER_PROCESSING_SOURCES.GEMINI)}
              disabled={isScanning}
              style={{ padding: '0.75rem', flexDirection: 'column', gap: '4px' }}
            >
              <Sparkles size={20} />
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Gemini Online</div>
            </button>
          </div>
          <div style={{ padding: '0.75rem', marginBottom: '1.5rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
            {processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE
              ? 'TXT, CSV, PDF (teks asli, scan, & campuran), serta OCR gambar (JPG, PNG, WebP, BMP) diproses secara lokal tanpa jaringan.'
              : 'Gateway Gemini baru dihubungi setelah Anda menyetujui pengiriman dokumen dan menekan tombol mulai. Status tidak diuji otomatis.'}
          </div>
          {processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE && fileToUpload && !offlineFileSupported && (
            <div style={{ padding: '0.75rem', marginBottom: '1.5rem', borderRadius: '8px', backgroundColor: '#fff7ed', color: '#9a3412', fontSize: '0.82rem', lineHeight: 1.5 }}>
              Format ini belum dapat diproses Offline. Pilih Gemini Online secara manual jika Anda ingin mengirim dokumen ini.
            </div>
          )}
          {processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE && offlinePdfFile && (
            <div style={{ padding: '0.75rem', marginBottom: '1.5rem', borderRadius: '8px', backgroundColor: '#f0fdf4', color: '#166534', fontSize: '0.82rem', lineHeight: 1.5, border: '1px solid #bbf7d0' }}>
              PDF Offline aktif: teks asli diekstrak langsung, halaman gambar/scan dikenali via OCR lokal (Indonesia &amp; Inggris).
            </div>
          )}
          {processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE && offlineImageFile && (
            <div style={{ padding: '0.75rem', marginBottom: '1.5rem', borderRadius: '8px', backgroundColor: '#f0fdf4', color: '#166534', fontSize: '0.82rem', lineHeight: 1.5, border: '1px solid #bbf7d0' }}>
              OCR Gambar Offline aktif. Teks akan dibaca secara lokal dengan Tesseract (Indonesia & Inggris). Utamakan tulisan ketik/cetak yang jelas.
            </div>
          )}

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
            <span style={{ fontSize: '0.85rem' }}>Mendukung PDF, BMP, JPG, PNG, WebP, CSV, dan TXT (Max 10MB)</span>
            {fileToUpload && (
              <span style={{ marginTop: '1rem', padding: '0.3rem 0.5rem 0.3rem 0.8rem', backgroundColor: 'var(--card-bg)', borderRadius: '8px', color: 'var(--primary-color)', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }}>
                <FileText size={14} /> {fileToUpload.name}
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFileToUpload(null);
                    setImagePreview(null);
                    setOnlineDocumentConsent(false);
                    setOfflineTextPreview(null);
                    setAiProviderStatus('');
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
              accept={AI_DOCUMENT_MIME_TYPES.join(',')}
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
            maxLength={AI_LIMITS.DOCUMENT_CONTEXT_CHARACTERS}
            rows="3"
            style={{ backgroundColor: 'var(--bg-color)', marginBottom: '1.5rem' }}
          />

          {processingSource === SCANNER_PROCESSING_SOURCES.GEMINI ? (
            <div style={{ marginBottom: '1rem' }}>
              <AIModelSelector
                capability="document_scan"
                input={{
                  scanType: scanType === 'calendar' ? 'event' : scanType,
                  file: fileToUpload ? { mimeType: fileToUpload.type, size: fileToUpload.size } : null,
                }}
                selection={selection}
                onChange={setSelection}
                preferenceStatus={preferenceStatus}
                requireConsent
              />
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={onlineDocumentConsent}
                  onChange={event => setOnlineDocumentConsent(event.target.checked)}
                />
                <span>Saya setuju dokumen yang dipilih dikirim ke Gemini untuk pemrosesan Online.</span>
              </label>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Pemrosesan Offline tidak menggunakan model AI, API key, Gateway, atau kuota Gemini.
            </div>
          )}

          <button 
            className="btn btn-primary" 
            onClick={handleScan} 
            disabled={isScanning || !fileToUpload || !scanPermissionReady}
            style={{ 
              width: '100%', padding: '1rem', fontSize: '1.05rem', fontWeight: 600,
              background: isScanning || !fileToUpload || !scanPermissionReady ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--primary-color) 0%, #818cf8 100%)',
              border: 'none',
              boxShadow: isScanning || !fileToUpload || !scanPermissionReady ? 'none' : '0 4px 14px rgba(79, 70, 229, 0.4)',
              transition: 'all 0.3s ease',
              marginTop: '1rem'
            }}
          >
            {isScanning
              ? <><Loader2 className="animate-spin" /> Memproses File...</>
              : processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE
                ? <><FileText size={20} /> Proses Offline</>
                : <><Sparkles size={20} /> Mulai Deteksi Gemini</>}
          </button>
          {isScanning && (
            <>
              {/* Progress bar — menampilkan tahapan modul, dokumen, halaman, atau OCR gambar */}
              {pdfProgress && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <span>
                      {pdfProgress.stage === 'reading_image'
                        ? 'Membaca file gambar...'
                        : pdfProgress.stage === 'preparing_ocr'
                          ? 'Menyiapkan engine OCR lokal (Tesseract)...'
                          : pdfProgress.stage === 'recognizing_text'
                            ? 'Mengenali teks pada gambar...'
                            : pdfProgress.stage === 'rendering_page'
                              ? `Memproses halaman ${pdfProgress.currentPage} dari ${pdfProgress.totalPages} — Merender halaman scan...`
                              : pdfProgress.stage === 'recognizing_ocr'
                                ? `Memproses halaman ${pdfProgress.currentPage} dari ${pdfProgress.totalPages} — Mengenali teks via OCR...`
                                : pdfProgress.stage === 'loading_module' || pdfProgress.stage === 'loading_document'
                                  ? 'Memuat modul dan dokumen PDF...'
                                  : pdfProgress.stage === 'document_loaded'
                                    ? `Dokumen dimuat (${pdfProgress.totalPages} halaman)`
                                    : pdfProgress.stage === 'completed'
                                      ? 'Ekstraksi selesai'
                                      : pdfProgress.totalPages > 0
                                        ? `Memproses halaman ${pdfProgress.currentPage} dari ${pdfProgress.totalPages} — Mengekstrak teks`
                                        : 'Memproses dokumen secara lokal...'}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>{pdfProgress.percent ?? 0}%</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', backgroundColor: 'var(--border-color)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pdfProgress.percent ?? 0}%`,
                      backgroundColor: 'var(--primary-color)',
                      borderRadius: '3px',
                      transition: 'width 0.2s ease',
                    }} />
                  </div>
                </div>
              )}
              <button
                className="btn btn-outline"
                onClick={handleCancelScan}
                disabled={!activeScanRequestId || isCancellingScan}
                style={{ width: '100%', marginTop: '0.75rem' }}
              >
                {isCancellingScan ? 'Membatalkan...' : 'Batalkan Analisis'}
              </button>
            </>
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
                {oldDocumentPreview.url && oldDocumentPreview.mimeType.startsWith('image/') ? (
                  <img src={oldDocumentPreview.url} alt="Lama" style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '4px', opacity: 0.8 }} />
                ) : oldDocumentPreview.url && oldDocumentPreview.mimeType === 'application/pdf' ? (
                  <iframe src={oldDocumentPreview.url} title="Preview Lama" style={{ width: '100%', height: '150px', border: 'none', borderRadius: '4px', opacity: 0.8 }} />
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
                {pendingOverwrite.newDocPreview?.startsWith('data:image') ? (
                  <img src={pendingOverwrite.newDocPreview} alt="Baru" style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '4px' }} />
                ) : pendingOverwrite.newDocPreview?.startsWith('data:application/pdf') ? (
                  <iframe src={pendingOverwrite.newDocPreview} title="Preview Baru" style={{ width: '100%', height: '150px', border: 'none', borderRadius: '4px' }} />
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
                disabled={isSaving}
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
        <div className="modal-overlay" onClick={closeReview}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: activeReviewTab === 'ocr' ? '820px' : '650px', transition: 'max-width 0.2s ease' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ margin: 0 }}>Konfirmasi Penyimpanan File</h3>
              </div>
              <button className="btn-icon" onClick={closeReview}><X size={20}/></button>
            </div>

            {activeOcrPayload && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 1.5rem', gap: '0.5rem', background: 'var(--card-bg)' }}>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('data')}
                  style={{
                    padding: '0.75rem 1rem',
                    border: 'none',
                    background: 'transparent',
                    borderBottom: activeReviewTab === 'data' ? '2px solid var(--primary-color)' : '2px solid transparent',
                    color: activeReviewTab === 'data' ? 'var(--primary-color)' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <Folder size={16} /> Data Terdeteksi &amp; Tujuan
                </button>
                <button
                  type="button"
                  onClick={() => setActiveReviewTab('ocr')}
                  style={{
                    padding: '0.75rem 1rem',
                    border: 'none',
                    background: 'transparent',
                    borderBottom: activeReviewTab === 'ocr' ? '2px solid var(--primary-color)' : '2px solid transparent',
                    color: activeReviewTab === 'ocr' ? 'var(--primary-color)' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <FileText size={16} /> Editor Teks OCR
                  {ocrEditText !== activeOcrPayload.rawText ? (
                    <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', background: '#fef3c7', color: '#b45309' }}>Diedit</span>
                  ) : (
                    <span style={{ fontSize: '0.7rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>Mesin</span>
                  )}
                </button>
              </div>
            )}
            
            <div className="modal-body">
              {activeReviewTab === 'ocr' && activeOcrPayload && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  {/* Toolbar */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-color)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        backgroundColor: ocrEditText !== activeOcrPayload.rawText ? 'rgba(234, 179, 8, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        color: ocrEditText !== activeOcrPayload.rawText ? '#ca8a04' : '#16a34a',
                      }}>
                        {ocrEditText !== activeOcrPayload.rawText ? 'Telah Diedit' : 'Sesuai Hasil Mesin'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {ocrEditText.length.toLocaleString('id-ID')} karakter
                      </span>
                      {(activeOcrPayload.confidence !== null && activeOcrPayload.confidence !== undefined) && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          · Keyakinan: ~{Math.round(activeOcrPayload.confidence)}%
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleOcrUndo}
                        disabled={ocrHistoryIndex <= 0}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Urungkan perubahan (Undo)"
                      >
                        <Undo size={13} /> Undo
                      </button>
                      <button
                        type="button"
                        onClick={handleOcrRedo}
                        disabled={ocrHistoryIndex >= ocrHistory.length - 1}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Ulangi perubahan (Redo)"
                      >
                        <Redo size={13} /> Redo
                      </button>
                      <button
                        type="button"
                        onClick={handleOcrReset}
                        disabled={ocrEditText === activeOcrPayload.rawText}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Kembalikan teks ke hasil OCR asli mesin"
                      >
                        <RotateCcw size={13} /> Reset
                      </button>
                      <button
                        type="button"
                        onClick={handleOcrCopy}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Salin seluruh teks ke clipboard"
                      >
                        <Copy size={13} /> Salin
                      </button>
                      <button
                        type="button"
                        onClick={handleOcrDownloadTxt}
                        className="btn btn-outline"
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        title="Unduh teks sebagai file .txt"
                      >
                        <Download size={13} /> Unduh .txt
                      </button>
                    </div>
                  </div>

                  {/* Textarea Editor */}
                  <textarea
                    value={ocrEditText}
                    onChange={handleOcrTextChange}
                    rows={12}
                    placeholder="Hasil teks OCR kosong..."
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-color)',
                      color: 'var(--text-main)',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      lineHeight: 1.5,
                      resize: 'vertical',
                      minHeight: '220px',
                      maxHeight: '400px',
                    }}
                  />

                  <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    Koreksi teks akan disimpan sebagai editedText saat Anda menekan Simpan &amp; Selesai. Hasil rawText mesin dan file asli tetap dilindungi dan tidak akan dimutasi.
                  </small>
                </div>
              )}

              {activeReviewTab === 'data' && (
                <>
                  <div style={{ backgroundColor: 'rgba(79, 70, 229, 0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                    <HelpCircle size={24} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-main)' }}>
                        {processingSource === SCANNER_PROCESSING_SOURCES.OFFLINE ? 'Keterangan pemrosesan lokal:' : 'Keterangan AI:'}
                      </strong>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                        "{aiSuggestion?.description || 'File ini terdeteksi namun AI tidak yakin di mana tempat yang paling cocok untuk menyimpannya.'}"
                      </p>
                      {aiProviderStatus && <small style={{ display: 'block', marginTop: '0.5rem', color: 'var(--text-muted)' }}>{aiProviderStatus}</small>}
                    </div>
                  </div>

                  {activeOcrPayload && (
                    <div style={{ padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '1.25rem', backgroundColor: 'var(--bg-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FileText size={18} style={{ color: 'var(--primary-color)' }} />
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>Teks OCR Tersedia ({ocrEditText.length.toLocaleString('id-ID')} karakter)</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {ocrEditText !== activeOcrPayload.rawText ? 'Koreksi teks telah diterapkan' : 'Hasil ekstraksi mesin lengkap siap disimpan'}
                            {offlineTextPreview?.pageCount > 1 && (
                              <span> · {offlineTextPreview.pageCount} halaman</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setActiveReviewTab('ocr')}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <FileText size={14} /> Buka Editor OCR
                      </button>
                    </div>
                  )}

                  {offlineTextPreview && (
                    <div style={{ marginBottom: '1.25rem', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <strong style={{ fontSize: '0.85rem' }}>Pratinjau Hasil Ekstraksi:</strong>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => setActiveReviewTab('ocr')}
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <FileText size={12} /> Edit Teks Lengkap
                        </button>
                      </div>
                      <pre
                        style={{
                          maxHeight: '120px',
                          overflowY: 'auto',
                          fontSize: '0.8rem',
                          backgroundColor: 'var(--card-bg, #ffffff)',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          margin: 0,
                        }}
                      >
                        {offlineTextPreview.text}
                      </pre>
                    </div>
                  )}

                  {academicCandidate && (
                    <div
                      style={{
                        padding: '1rem',
                        borderRadius: '10px',
                        backgroundColor: academicCandidate.documentType === 'KRS' ? '#eff6ff' : '#f5f3ff',
                        border: `1px solid ${academicCandidate.documentType === 'KRS' ? '#bfdbfe' : '#ddd6fe'}`,
                        marginBottom: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.65rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.6rem',
                              borderRadius: '6px',
                              backgroundColor: academicCandidate.documentType === 'KRS' ? '#3b82f6' : '#8b5cf6',
                              color: '#ffffff',
                            }}
                          >
                            {academicCandidate.documentType} TERDETEKSI
                          </span>
                          <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>
                            Dokumen Akademik Offline
                          </strong>
                        </div>
                        {academicCandidate.needsReview && (
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              padding: '0.2rem 0.5rem',
                              borderRadius: '6px',
                              backgroundColor: '#fef3c7',
                              color: '#92400e',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                            }}
                          >
                            Perlu Diperiksa
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.45rem', fontSize: '0.83rem' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Semester:</span>{' '}
                          <strong>{academicCandidate.semesterName || 'Tidak Terbaca'}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Tahun:</span>{' '}
                          <strong>{academicCandidate.academicYear || '-'}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Mata Kuliah:</span>{' '}
                          <strong>{academicCandidate.courses?.length || 0} matkul</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Total SKS:</span>{' '}
                          <strong>{academicCandidate.summary?.totalSks ?? '-'} SKS</strong>
                        </div>
                        {academicCandidate.documentType === 'KHS' && (
                          <>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>IPS Tercetak:</span>{' '}
                              <strong>{academicCandidate.summary?.ips ?? '-'}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>IPK Tercetak:</span>{' '}
                              <strong>{academicCandidate.summary?.ipk ?? '-'}</strong>
                            </div>
                          </>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.25rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => setShowAcademicReviewModal(true)}
                          style={{
                            padding: '0.45rem 1rem',
                            fontSize: '0.84rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            boxShadow: '0 2px 8px rgba(79, 70, 229, 0.25)',
                          }}
                        >
                          <Sparkles size={15} /> Buka Review Kandidat Akademik
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', marginBottom: '1.25rem', color: 'var(--text-main)' }}>
                    <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Pratinjau data yang terdeteksi</strong>
                    {previewData?.semester_name && <div style={{ fontSize: '0.9rem' }}>Semester: {previewData.semester_name}</div>}
                    {previewData?.gpa !== null && previewData?.gpa !== undefined && <div style={{ fontSize: '0.9rem' }}>GPA/IPS: {String(previewData.gpa)}</div>}
                    {previewData?.title && <div style={{ fontSize: '0.9rem' }}>Judul: {previewData.title}</div>}
                    {academicCandidate && academicImportPlan ? (
                      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                            Pratinjau Penggabungan: {academicImportPlan.targetSemesterName}
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Tipe: {academicImportPlan.documentType}
                          </span>
                        </div>

                        {/* Banner Keamanan & Status Impor B6D */}
                        {importCommitResult ? (
                          <div style={{ padding: '0.65rem 0.85rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '0.8rem', color: '#166534', lineHeight: 1.4 }}>
                            ✅ <strong>Penggabungan Berhasil Disimpan:</strong> Sebanyak {importCommitResult.addedCount} ditambahkan, {importCommitResult.updatedCount} ditimpa, dan {importCommitResult.unchangedCount} dipertahankan pada {importCommitResult.updatedSemester.name}. Data akademik aman dan tervalidasi.
                          </div>
                        ) : (
                          <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '0.78rem', color: '#1e40af', lineHeight: 1.4 }}>
                            🛡️ <strong>Alur Impor Terverifikasi (B6D):</strong> Penggabungan hanya akan dieksekusi setelah Anda memeriksa rincian dan mengonfirmasi secara sadar pada dialog konfirmasi akhir. Data existing di luar pilihan Anda 100% terlindungi.
                          </div>
                        )}

                        {/* Peringatan Identitas jika NIM Berbeda */}
                        {academicImportPlan.hasIdentityMismatch && (
                          <div style={{ padding: '0.6rem 0.75rem', backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '6px', fontSize: '0.78rem', color: '#92400e', lineHeight: 1.4, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <div>
                              ⚠️ <strong>Perhatian Identitas Mahasiswa:</strong> NIM pada dokumen ({academicImportPlan.student.docNim || 'tanpa NIM'}) berbeda dari profil Anda ({academicImportPlan.student.profNim || 'profil kosong'}).
                            </div>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', marginTop: '0.2rem' }}>
                              <input
                                type="checkbox"
                                checked={confirmIdentityMismatch}
                                onChange={(e) => setConfirmIdentityMismatch(e.target.checked)}
                                style={{ marginTop: '2px' }}
                              />
                              <span>Saya mengonfirmasi bahwa dokumen ini adalah milik saya dan menyetujui penggabungan ke semester ini.</span>
                            </label>
                          </div>
                        )}

                        {/* Ringkasan Status Badge */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.75rem' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#dcfce7', color: '#166534', fontWeight: 700 }}>
                            +{academicImportPlan.summary.addCount} Baru
                          </span>
                          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                            {academicImportPlan.summary.unchangedCount} Identik
                          </span>
                          {academicImportPlan.summary.updateCount > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>
                              {academicImportPlan.summary.updateCount} Lengkapi Field
                            </span>
                          )}
                          {academicImportPlan.summary.conflictCount > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#991b1b', fontWeight: 700 }}>
                              {academicImportPlan.summary.conflictCount} Konflik Data
                            </span>
                          )}
                          {academicImportPlan.summary.skippedCount > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f3e8ff', color: '#6b21a8', fontWeight: 600 }}>
                              {academicImportPlan.summary.skippedCount} Dilewati
                            </span>
                          )}
                          {academicImportPlan.summary.invalidCount > 0 && (
                            <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#b91c1c', fontWeight: 700 }}>
                              {academicImportPlan.summary.invalidCount} Invalid
                            </span>
                          )}
                        </div>

                        {/* Peringatan Bentrok Jadwal Terdeteksi */}
                        {academicImportPlan.scheduleClashes && academicImportPlan.scheduleClashes.length > 0 && (
                          <div style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.78rem' }}>
                            <strong>Peringatan Bentrok Jadwal ({academicImportPlan.scheduleClashes.length}):</strong>
                            {academicImportPlan.scheduleClashes.map((clash, cIdx) => (
                              <div key={`clash-${cIdx}`} style={{ marginTop: '2px' }}>• {clash.message}</div>
                            ))}
                          </div>
                        )}

                        {/* Rincian Komparatif Mata Kuliah */}
                        <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {academicImportPlan.items.map((item) => {
                            const currentAction = importActionOverrides[item.index] || item.proposedAction;
                            const isConflict = item.status === 'conflict';
                            const isAdd = item.status === 'add';
                            const isUpdate = item.status === 'update';

                            return (
                              <div
                                key={`import-item-${item.index}`}
                                style={{
                                  padding: '0.45rem 0.6rem',
                                  borderRadius: '6px',
                                  border: isConflict ? '1px solid #fca5a5' : '1px solid var(--border-color)',
                                  backgroundColor: isConflict ? '#fff5f5' : isAdd ? '#f0fdf4' : 'var(--bg-color)',
                                  fontSize: '0.82rem',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '0.3rem',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <span
                                      style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        backgroundColor: isAdd ? '#dcfce7' : isConflict ? '#fee2e2' : isUpdate ? '#dbeafe' : '#f1f5f9',
                                        color: isAdd ? '#166534' : isConflict ? '#991b1b' : isUpdate ? '#1d4ed8' : '#475569',
                                      }}
                                    >
                                      {isAdd ? 'BARU' : isConflict ? 'KONFLIK' : isUpdate ? 'UPDATE' : item.status.toUpperCase()}
                                    </span>
                                    <strong>
                                      {item.candidateCourse.code ? `[${item.candidateCourse.code}] ` : ''}{item.candidateCourse.name}
                                    </strong>
                                  </div>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {[
                                      item.candidateCourse.sks ? `${item.candidateCourse.sks} SKS` : null,
                                      item.candidateCourse.grade ? `Nilai: ${item.candidateCourse.grade}` : null,
                                      item.candidateCourse.class ? `Kls: ${item.candidateCourse.class}` : null,
                                      item.candidateCourse.day,
                                      item.candidateCourse.timeStart && item.candidateCourse.timeEnd ? `${item.candidateCourse.timeStart}-${item.candidateCourse.timeEnd}` : item.candidateCourse.timeStart,
                                      item.candidateCourse.room ? `(${item.candidateCourse.room})` : null,
                                    ].filter(Boolean).join(' · ')}
                                  </span>
                                </div>

                                {/* Perbedaan Data (jika ada) */}
                                {item.differences.length > 0 && (
                                  <div style={{ fontSize: '0.75rem', color: '#475569', backgroundColor: 'rgba(0,0,0,0.02)', padding: '0.25rem 0.4rem', borderRadius: '4px' }}>
                                    {item.differences.map((diff, dIdx) => (
                                      <div key={`diff-${dIdx}`} style={{ color: diff.severity === 'conflict' ? '#b91c1c' : '#1e40af' }}>
                                        • {diff.label}: Semester saat ini [{String(diff.existingValue ?? '-')}] vs Dokumen [{String(diff.candidateValue ?? '-')}]
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Pilihan Aksi Granular jika Konflik */}
                                {isConflict && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem', fontSize: '0.75rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Pilihan:</span>
                                    <button
                                      type="button"
                                      onClick={() => setImportActionOverrides(prev => ({ ...prev, [item.index]: 'keep_existing' }))}
                                      style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        border: currentAction === 'keep_existing' ? '1px solid #475569' : '1px solid #cbd5e1',
                                        backgroundColor: currentAction === 'keep_existing' ? '#e2e8f0' : '#ffffff',
                                        fontWeight: currentAction === 'keep_existing' ? 700 : 400,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Pertahankan Data Lama
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setImportActionOverrides(prev => ({ ...prev, [item.index]: 'overwrite' }))}
                                      style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        border: currentAction === 'overwrite' ? '1px solid #dc2626' : '1px solid #cbd5e1',
                                        backgroundColor: currentAction === 'overwrite' ? '#fee2e2' : '#ffffff',
                                        color: currentAction === 'overwrite' ? '#991b1b' : '#334155',
                                        fontWeight: currentAction === 'overwrite' ? 700 : 400,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Terapkan Dokumen
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setImportActionOverrides(prev => ({ ...prev, [item.index]: 'skip' }))}
                                      style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        border: currentAction === 'skip' ? '1px solid #6b21a8' : '1px solid #cbd5e1',
                                        backgroundColor: currentAction === 'skip' ? '#f3e8ff' : '#ffffff',
                                        color: currentAction === 'skip' ? '#6b21a8' : '#334155',
                                        fontWeight: currentAction === 'skip' ? 700 : 400,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Lewati
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Tombol Aksi Simpan Manual ke Semester (B6D) */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem', marginTop: '0.65rem' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={
                              isSaving ||
                              Boolean(importCommitResult) ||
                              !selectedReviewSemester ||
                              (academicImportPlan.hasIdentityMismatch && !confirmIdentityMismatch) ||
                              ((importCommitSummary?.totalPlannedActions || 0) === 0)
                            }
                            onClick={() => setShowImportConfirmModal(true)}
                            style={{
                              padding: '0.5rem 1.1rem',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                            }}
                          >
                            <CheckSquare size={16} /> {importCommitResult ? `Sudah Disimpan ke ${selectedReviewSemester?.name || ''}` : `Simpan ke Semester ${selectedReviewSemester?.name ? `(${selectedReviewSemester.name})` : ''}`}
                          </button>
                        </div>
                      </div>
                    ) : previewData?.courses?.length > 0 ? (
                      <>
                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                          Mata kuliah ({previewData.courses.length}):
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '0.4rem', paddingRight: '0.25rem' }}>
                          {previewData.courses.map((course, index) => (
                            <div key={`${course.name}-${index}`} style={{ padding: '0.35rem 0', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)' }}>
                              <strong>{course.name}</strong>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {[course.sks ? `${course.sks} SKS` : null, course.grade ? `Nilai ${course.grade}` : null, course.day, course.timeStart].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          ))}
                        </div>
                        {courseMergePreview && (
                          <>
                            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              Perubahan: {courseMergePreview.summary.additions} penambahan, {courseMergePreview.summary.updates} pembaruan field kosong, {courseMergePreview.summary.replacements} penggantian field, {courseMergePreview.summary.unchanged} tanpa perubahan, dan {courseMergePreview.summary.conflicts} konflik yang akan dipertahankan.
                            </div>
                            <div style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '0.35rem', paddingRight: '0.25rem' }}>
                              {courseMergePreview.operations.map((operation, index) => (
                                <div key={`${operation.name}-${index}`} style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  {operation.name}: {operation.type === 'add' ? 'ditambahkan' : operation.type === 'update' ? 'field kosong dilengkapi' : operation.type === 'replace' ? `mengganti ${operation.replacements.join(', ')}` : operation.type === 'conflict' ? 'konflik, data lama dipertahankan' : 'tidak berubah'}
                                </div>
                              ))}
                            </div>
                            {courseMergePreview.requiresReplacementConfirmation && (
                              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                <input
                                  type="checkbox"
                                  checked={confirmCourseReplacements}
                                  onChange={event => setConfirmCourseReplacements(event.target.checked)}
                                />
                                Izinkan penggantian field mata kuliah yang disebutkan di atas. Mata kuliah lain tidak akan dihapus.
                              </label>
                            )}
                          </>
                        )}
                      </>
                    ) : null}
                    {previewData?.tasks?.length > 0 && (
                      <>
                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>Tugas/agenda ({previewData.tasks.length}):</div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '0.35rem', paddingRight: '0.25rem' }}>
                          {previewData.tasks.map((task, index) => (
                            <div key={`${task.title}-${index}`} style={{ padding: '0.35rem 0', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)' }}>
                              <strong>{task.title}</strong>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {[task.course_name, task.deadline].filter(Boolean).join(' · ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <small style={{ display: 'block', marginTop: '0.75rem', color: 'var(--text-muted)' }}>Data belum disimpan. Perubahan hanya dilakukan setelah tombol Simpan &amp; Selesai ditekan.</small>
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
                    {manualDirection === 'khs' && (
                      <div style={{ marginTop: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Pilih semester tujuan</label>
                        {navigationTargetState.present ? (
                          <div style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: resolvedNavigationTarget ? 'var(--text-main)' : '#dc2626', backgroundColor: 'var(--bg-color)' }}>
                            {resolvedNavigationTarget
                              ? `${resolvedNavigationTarget.semester.name} · ${resolvedNavigationTarget.mode === 'replace' ? 'Ganti' : 'Tambah'} ${resolvedNavigationTarget.documentType}`
                              : 'Target dokumen sudah berubah atau tidak tersedia. Pilih kembali dokumen dari halaman Semester.'}
                          </div>
                        ) : (
                          <select
                            className="form-input"
                            value={semesterDestinationValue}
                            onChange={handleSemesterDestinationChange}
                          >
                            <option value="">Pilih semester</option>
                            {semesters.map(semester => (
                              <option key={semesterOptionValue(semester.id)} value={semesterOptionValue(semester.id)}>
                                {semester.name}{semester.status === 'current' ? ' · Aktif' : ''}
                              </option>
                            ))}
                            {!currentSemester && (
                              <option value={NEW_SEMESTER_DESTINATION}>
                                Buat semester baru: {previewData?.semester_name || 'Semester Baru'} · Aktif
                              </option>
                            )}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button className="btn btn-outline" onClick={closeReview} style={{ flex: 1 }}>Batal</button>
                <button
                  className="btn btn-primary"
                  onClick={saveManual}
                  disabled={isSaving || (manualDirection === 'khs' && !academicCandidate && (!semesterDestinationReady || (courseMergePreview?.requiresReplacementConfirmation && !confirmCourseReplacements)))}
                  style={{ flex: 1 }}
                >
                  {academicCandidate && manualDirection === 'khs' ? 'Selesai Tinjau (Draft Disimpan di Scanner)' : 'Simpan & Selesai'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Academic Candidate Review Modal */}
      {academicCandidate && (
        <AcademicCandidateReviewModal
          isOpen={showAcademicReviewModal}
          candidate={academicCandidate}
          ocrText={ocrEditText || activeOcrPayload?.rawText || offlineTextPreview?.text || ''}
          userProfile={{ nim: profileNim, fullName: profileFullName, userName: profileUserName }}
          semesters={semesters}
          onClose={() => setShowAcademicReviewModal(false)}
          onCompleteReview={handleCompleteAcademicReview}
        />
      )}

      {/* Dialog Konfirmasi Akhir Penggabungan Akademik (B6D) */}
      {showImportConfirmModal && importCommitSummary && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--card-bg, #ffffff)', borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '580px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckSquare size={20} style={{ color: 'var(--primary-color)' }} />
                  Konfirmasi Penggabungan ke Semester
                </h3>
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  Periksa ringkasan perubahan sebelum disimpan ke Semester tujuan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImportConfirmModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Semester Tujuan:</span>
                <strong>{importCommitSummary.targetSemesterName}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.82rem' }}>
                <div style={{ padding: '0.5rem', borderRadius: '6px', backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                  <strong>+{importCommitSummary.addCount} Baru</strong>
                  <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>Mata kuliah baru ditambahkan</div>
                </div>
                <div style={{ padding: '0.5rem', borderRadius: '6px', backgroundColor: importCommitSummary.overwriteCount > 0 ? '#fee2e2' : '#f8fafc', color: importCommitSummary.overwriteCount > 0 ? '#991b1b' : '#64748b', border: importCommitSummary.overwriteCount > 0 ? '1px solid #fecaca' : '1px solid #e2e8f0' }}>
                  <strong>{importCommitSummary.overwriteCount} Timpa (Overwrite)</strong>
                  <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>Konflik data disetujui ditimpa</div>
                </div>
                <div style={{ padding: '0.5rem', borderRadius: '6px', backgroundColor: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0' }}>
                  <strong>{importCommitSummary.keepCount} Dipertahankan</strong>
                  <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>Data semester lama tetap utuh</div>
                </div>
                <div style={{ padding: '0.5rem', borderRadius: '6px', backgroundColor: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}>
                  <strong>{importCommitSummary.skipCount} Dilewati</strong>
                  <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>Tidak disertakan dalam simpan</div>
                </div>
              </div>
            </div>

            {/* Rincian Mata Kuliah yang Ditimpa (jika ada) */}
            {importCommitSummary.overwrites.length > 0 && (
              <div>
                <strong style={{ fontSize: '0.82rem', color: '#991b1b', display: 'block', marginBottom: '0.35rem' }}>
                  Rincian Mata Kuliah yang Akan Ditimpa ({importCommitSummary.overwrites.length}):
                </strong>
                <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.5rem', backgroundColor: '#fff5f5', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.78rem' }}>
                  {importCommitSummary.overwrites.map((ov, oIdx) => (
                    <div key={`confirm-ov-${oIdx}`} style={{ borderBottom: oIdx < importCommitSummary.overwrites.length - 1 ? '1px solid #fee2e2' : 'none', paddingBottom: '0.3rem' }}>
                      <strong>{ov.code ? `[${ov.code}] ` : ''}{ov.name}</strong>
                      <div style={{ color: '#b91c1c', marginTop: '0.15rem' }}>
                        {ov.differences.map((d, dIdx) => (
                          <div key={`ov-diff-${dIdx}`}>
                            • {d.label}: [{String(d.existingValue ?? '-')}] ➔ [{String(d.candidateValue ?? '-')}]
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              🛡️ <strong>Perlindungan Data:</strong> Operasi ini memvalidasi sidik jari semester terbaru dan tidak akan mengubah semester lain, tugas, atau kanban skripsi.
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowImportConfirmModal(false)}
                disabled={isSaving}
                style={{ flex: 1 }}
              >
                Batal &amp; Periksa Lagi
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecuteCommitAcademicImport}
                disabled={isSaving}
                style={{ flex: 1, backgroundColor: 'var(--primary-color)' }}
              >
                {isSaving ? 'Menyimpan...' : 'Konfirmasi & Simpan Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
