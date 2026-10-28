import { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  GitCompare,
  Save,
  FileText,
  CheckSquare,
  Square,
  Download,
  ShieldCheck,
  LayoutDashboard,
  AlertCircle,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import {
  resolveThesisDocumentText,
  parseThesisStructure,
  searchThesisText,
  chunkTextForVirtualization,
  createStableDocumentIdentity,
} from '../services/thesisDocumentReader';
import {
  thesisRevisionStore,
  computeTextDiff,
  REVISION_STATUS,
} from '../services/thesisRevisionStore';
import {
  createThesisRevisionBackup,
  downloadThesisRevisionBackupFile,
  exportSnapshotToTxt,
  exportSnapshotToMarkdown,
  validateThesisRevisionBackup,
} from '../services/thesisRevisionBackup';
import {
  isNoteAlreadyInKanban,
  formatKanbanTaskFromNote,
  commitTaskToBoard,
  KANBAN_COLUMNS,
} from '../services/thesisKanbanLink';
import { useAppContext } from '../context/AppContext';

// Contoh dokumen skripsi sintetis untuk default demo jika belum ada dokumen
const SAMPLE_SYNTHETIC_THESIS = `JUDUL SKRIPSI: RANCANG BANGUN APLIKASI UNIMATE DENGAN ARSITEKTUR OFFLINE-FIRST
OLEH: MAHASISWA TEKNIK INFORMATIKA

ABSTRAK
Penelitian ini bertujuan untuk merancang sistem pendamping akademik mahasiswa bernama UniMate yang mengedepankan keamanan data pribadi dan kapabilitas pemrosesan dokumen akademik secara lokal tanpa ketergantungan pada koneksi jaringan internet. Pendekatan offline-first memastikan integritas dokumen, nilai KHS, dan progres tugas akhir mahasiswa tetap aman di perangkat lokal.

KATA PENGANTAR
Puji syukur penulis panjatkan ke hadirat Tuhan Yang Maha Esa atas rahmat dan karunia-Nya sehingga penulisan skripsi ini dapat diselesaikan dengan baik. Penulis menyampaikan terima kasih yang tulus kepada dosen pembimbing dan seluruh civitas akademika.

BAB I PENDAHULUAN
1.1 Latar Belakang Masalah
Kebutuhan mahasiswa akan pencatatan akademik yang reliabel semakin krusial di era digital. Banyak aplikasi manajemen akademik berbasis cloud yang menimbulkan kekhawatiran terhadap privasi data pribadi, kebocoran nilai, dan ketidaktersediaan sistem saat akses internet terbatas. Oleh karena itu, pendekatan penyimpanan lokal dan pemrosesan offline menjadi solusi yang relevan.

1.2 Rumusan Masalah
1. Bagaimana mengimplementasikan penyimpanan dokumen skripsi secara persisten pada browser dan desktop tanpa kebocoran data?
2. Bagaimana membangun parser struktur bab dan sistem pelacakan revisi skripsi yang sepenuhnya deterministik dan aman?

1.3 Batasan Masalah
Penelitian ini berfokus pada ekosistem Progressive Web App dan Electron Windows, dengan penyimpanan IndexedDB berisolasi dan pembacaan teks dokumen OCR secara lokal.

BAB II TINJAUAN PUSTAKA
2.1 Landasan Teori
2.1.1 Arsitektur Offline-First
Arsitektur offline-first memprioritaskan pemrosesan dan penyimpanan data di sisi klien pengguna sebelum melakukan sinkronisasi opsional.

2.1.2 Penyimpanan Klien Web Storage
IndexedDB menyediakan kapasitas penyimpanan berkas terstruktur yang lebih besar dibandingkan batas 5MB pada localStorage konvensional.

BAB III METODOLOGI PENELITIAN
3.1 Metode Pengembangan Sistem
Metodologi yang digunakan adalah Research and Development (R&D) yang mencakup tahap analisis kebutuhan, perancangan arsitektur, implementasi modul pembaca skripsi, serta pengujian terisolasi.

3.2 Desain Alur Revisi Skripsi
Pelacakan revisi skripsi menggunakan model append-only snapshot sehingga setiap perubahan teks dapat dibandingkan dengan versi sebelumnya tanpa risiko kehilangan riwayat bimbingan.

DAFTAR PUSTAKA
1. Pressman, R. S. (2014). Software Engineering: A Practitioner's Approach. McGraw-Hill.
2. Fowler, M. (2018). Refactoring: Improving the Design of Existing Code. Addison-Wesley.`;

export default function ThesisWorkspace() {
  const { semesters, thesis: thesisBoard, setThesis: setThesisBoard } = useAppContext();

  // State Dokumen Aktif
  const [activeDoc, setActiveDoc] = useState({
    id: 'doc_synthetic_sample',
    title: 'Draf Skripsi Utama (Sintetis)',
    isDemo: true,
    sourceType: 'demo',
  });

  const [docTextSource, setDocTextSource] = useState({
    rawText: SAMPLE_SYNTHETIC_THESIS,
    editedText: null,
  });

  // Modal Input Dokumen Kustom / Tempel Draf
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [customDocTitle, setCustomDocTitle] = useState('');
  const [customDocContent, setCustomDocContent] = useState('');

  // Selesaikan teks dokumen skripsi
  const resolvedDoc = useMemo(() => {
    return resolveThesisDocumentText(docTextSource);
  }, [docTextSource]);

  // Parsing Struktur BAB dan Sub-bab
  const thesisStructure = useMemo(() => {
    return parseThesisStructure(resolvedDoc.text);
  }, [resolvedDoc.text]);

  // Tab Samping Navigasi Dokumen: 'toc' | 'search' | 'snapshots'
  const [sidebarTab, setSidebarTab] = useState('toc');

  // State Pencarian Teks
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const searchResults = useMemo(() => {
    return searchThesisText(resolvedDoc.text, searchQuery, {
      sections: thesisStructure.sections,
      snippetLength: 40,
    });
  }, [resolvedDoc.text, searchQuery, thesisStructure.sections]);

  // Reset match index saat query berubah
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  // State Catatan Revisi & Filter Status
  const [notes, setNotes] = useState([]);
  const [noteStatusFilter, setNoteStatusFilter] = useState('all'); // 'all' | 'todo' | 'in_progress' | 'done'
  const [isNewNoteModalOpen, setIsNewNoteModalOpen] = useState(false);
  const [newNoteForm, setNewNoteForm] = useState({
    title: '',
    content: '',
    sectionTitle: '',
    supervisorNote: '',
    checklistText: '',
  });

  // State Konfirmasi Hapus Catatan
  const [deleteConfirmNoteId, setDeleteConfirmNoteId] = useState(null);

  // State Snapshot Versi
  const [snapshots, setSnapshots] = useState([]);
  const [isSaveSnapshotModalOpen, setIsSaveSnapshotModalOpen] = useState(false);
  const [snapshotForm, setSnapshotForm] = useState({ label: '', summary: '' });

  // State Perbandingan Dua Versi (Diff Viewer)
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [diffOldSnapId, setDiffOldSnapId] = useState('');
  const [diffNewSnapId, setDiffNewSnapId] = useState('');
  const [computedDiffResult, setComputedDiffResult] = useState(null);

  // State Validasi Cadangan Revisi (B8B)
  const [isValidatingBackup, setIsValidatingBackup] = useState(false);
  const [validationResultModal, setValidationResultModal] = useState(null);
  const backupFileInputRef = useRef(null);

  // State Konversi Catatan ke Tugas Kanban (B8C)
  const [convertingNote, setConvertingNote] = useState(null);
  const [kanbanConvertForm, setKanbanConvertForm] = useState({
    title: '',
    desc: '',
    targetColumn: 'todo',
    includeChecklist: true,
  });

  // Memuat Catatan dan Snapshots dari IndexedDB (dengan dukungan array alias ID dokumen)
  const refreshNotesAndSnapshots = async (docId, docAliases = null) => {
    try {
      const queryTarget = Array.isArray(docAliases) && docAliases.length > 0 ? docAliases : docId;
      const [fetchedNotes, fetchedSnapshots] = await Promise.all([
        thesisRevisionStore.getNotesByDocument(queryTarget),
        thesisRevisionStore.getSnapshotsByDocument(queryTarget),
      ]);
      setNotes(fetchedNotes);
      setSnapshots(fetchedSnapshots);
    } catch {
      // Abaikan jika store belum siap
    }
  };

  useEffect(() => {
    refreshNotesAndSnapshots(activeDoc.id, activeDoc.aliases);
  }, [activeDoc.id, activeDoc.aliases]);

  // Daftar dokumen yang tersedia dari Course Vault semester (B9A: ID persisten kanonikal + alias legacy)
  const availableVaultDocs = useMemo(() => {
    const list = [];
    if (Array.isArray(semesters)) {
      semesters.forEach(sem => {
        sem.courses?.forEach(course => {
          course.files?.forEach((file, fileIdx) => {
            if (file.name && (file.binaryRef || file.textRef || file.file)) {
              const identity = createStableDocumentIdentity({
                courseId: course.id,
                semesterId: sem.id,
                file,
                fileIndex: fileIdx,
              });
              list.push({
                id: identity.canonicalId,
                aliases: identity.aliases,
                isPersistent: identity.isPersistent,
                title: `${file.name} (${course.name || sem.name})`,
                isDemo: false,
                sourceType: 'vault',
                fileRecord: file,
              });
            }
          });
        });
      });
    }
    return list;
  }, [semesters]);

  // Handler Ganti Dokumen
  const handleSelectVaultDoc = (doc) => {
    setActiveDoc(doc);
    if (doc.fileRecord?.textRef) {
      setDocTextSource({
        rawText: doc.fileRecord.textRef.rawText || '',
        editedText: doc.fileRecord.textRef.editedText ?? null,
      });
    } else {
      setDocTextSource({
        rawText: `[Dokumen: ${doc.title}]\nTeks sedang dimuat dari arsip vault...`,
        editedText: null,
      });
    }
    toast.success(`Dokumen "${doc.title}" dimuat ke workspace.`);
  };

  // Handler Simpan Dokumen Kustom Baru
  const handleSaveCustomDoc = (e) => {
    e.preventDefault();
    if (!customDocTitle.trim() || !customDocContent.trim()) {
      toast.error('Judul dan draf teks tidak boleh kosong');
      return;
    }
    const newDoc = {
      id: `doc_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: customDocTitle.trim(),
      isDemo: false,
      sourceType: 'custom',
    };
    setActiveDoc(newDoc);
    setDocTextSource({ rawText: customDocContent, editedText: null });
    setIsDocModalOpen(false);
    setCustomDocTitle('');
    setCustomDocContent('');
    toast.success('Draf teks baru berhasil dibuka di Workspace!');
  };

  // Handler Scroll ke Seksi BAB saat diklik pada TOC
  const readerScrollRef = useRef(null);
  const handleJumpToSection = (sectionId) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Handler Navigasi Hasil Pencarian
  const handleNextMatch = () => {
    if (searchResults.totalMatches === 0) return;
    const nextIdx = (activeMatchIndex + 1) % searchResults.totalMatches;
    setActiveMatchIndex(nextIdx);
    const match = searchResults.matches[nextIdx];
    if (match?.section?.id) handleJumpToSection(match.section.id);
  };

  const handlePrevMatch = () => {
    if (searchResults.totalMatches === 0) return;
    const prevIdx = (activeMatchIndex - 1 + searchResults.totalMatches) % searchResults.totalMatches;
    setActiveMatchIndex(prevIdx);
    const match = searchResults.matches[prevIdx];
    if (match?.section?.id) handleJumpToSection(match.section.id);
  };

  // Handler Tambah Catatan Revisi Baru
  const handleCreateNote = async (e) => {
    e.preventDefault();
    if (!newNoteForm.title.trim()) {
      toast.error('Judul catatan wajib diisi');
      return;
    }

    if (activeDoc.isDemo) {
      toast('Catatan disimpan pada dokumen contoh sintetis.', { icon: 'ℹ️' });
    }

    const checklistItems = newNoteForm.checklistText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(text => ({ text, done: false }));

    try {
      await thesisRevisionStore.createNote({
        documentId: activeDoc.id,
        title: newNoteForm.title,
        content: newNoteForm.content,
        sectionTitle: newNoteForm.sectionTitle,
        supervisorNote: newNoteForm.supervisorNote,
        status: REVISION_STATUS.TODO,
        checklist: checklistItems,
      });

      toast.success('Catatan revisi berhasil disimpan!');
      setIsNewNoteModalOpen(false);
      setNewNoteForm({
        title: '',
        content: '',
        sectionTitle: '',
        supervisorNote: '',
        checklistText: '',
      });
      refreshNotesAndSnapshots(activeDoc.id);
    } catch {
      toast.error('Gagal menyimpan catatan revisi');
    }
  };

  // Handler Update Status Catatan
  const handleToggleNoteStatus = async (note) => {
    const nextStatus = note.status === REVISION_STATUS.TODO
      ? REVISION_STATUS.IN_PROGRESS
      : note.status === REVISION_STATUS.IN_PROGRESS
        ? REVISION_STATUS.DONE
        : REVISION_STATUS.TODO;

    try {
      await thesisRevisionStore.updateNote(note.id, { status: nextStatus });
      refreshNotesAndSnapshots(activeDoc.id);
      toast.success(`Status revisi diubah menjadi: ${nextStatus.toUpperCase()}`);
    } catch {
      toast.error('Gagal memperbarui status revisi');
    }
  };

  // Handler Centang Checklist
  const handleToggleChecklist = async (note, checkIdx) => {
    const updatedChecklist = note.checklist.map((c, idx) =>
      idx === checkIdx ? { ...c, done: !c.done } : c
    );

    try {
      await thesisRevisionStore.updateNote(note.id, { checklist: updatedChecklist });
      refreshNotesAndSnapshots(activeDoc.id);
    } catch {
      toast.error('Gagal memperbarui checklist');
    }
  };

  // Handler Konfirmasi Hapus Catatan
  const executeDeleteNote = async () => {
    if (!deleteConfirmNoteId) return;
    try {
      await thesisRevisionStore.deleteNote(deleteConfirmNoteId, { confirmed: true });
      toast.success('Catatan revisi telah dihapus.');
      setDeleteConfirmNoteId(null);
      refreshNotesAndSnapshots(activeDoc.id);
    } catch {
      toast.error('Gagal menghapus catatan');
    }
  };

  // Handler Simpan Snapshot Versi Teks
  const handleSaveSnapshot = async (e) => {
    e.preventDefault();
    try {
      const snap = await thesisRevisionStore.saveSnapshot({
        documentId: activeDoc.id,
        text: resolvedDoc.text,
        label: snapshotForm.label || `Versi ${snapshots.length + 1}`,
        summary: snapshotForm.summary,
      });
      toast.success(`Snapshot ${snap.label} berhasil disimpan!`);
      setIsSaveSnapshotModalOpen(false);
      setSnapshotForm({ label: '', summary: '' });
      refreshNotesAndSnapshots(activeDoc.id);
    } catch {
      toast.error('Gagal menyimpan snapshot versi teks');
    }
  };

  // Handler Ekspor Snapshot ke TXT / Markdown (B8B)
  const handleExportTxt = (snap) => {
    try {
      const result = exportSnapshotToTxt(snap);
      toast.success(`Berhasil mengunduh "${result.filename}" (${result.charCount.toLocaleString('id-ID')} karakter)`);
    } catch {
      toast.error('Gagal mengekspor snapshot ke TXT');
    }
  };

  const handleExportMarkdown = (snap) => {
    try {
      const result = exportSnapshotToMarkdown(snap, { documentTitle: activeDoc.title });
      toast.success(`Berhasil mengunduh "${result.filename}"`);
    } catch {
      toast.error('Gagal mengekspor snapshot ke Markdown');
    }
  };

  // Handler Unduh Backup Mandiri Revisi Skripsi (B8B)
  const handleDownloadBackup = async () => {
    try {
      toast.loading('Menyiapkan berkas cadangan revisi...', { id: 'backup_gen' });
      const backupPayload = await createThesisRevisionBackup({
        documentId: activeDoc.id,
        documentTitle: activeDoc.title,
        notes,
        snapshots,
      });
      toast.dismiss('backup_gen');
      const dlResult = downloadThesisRevisionBackupFile(backupPayload);
      toast.success(`Cadangan revisi berhasil diunduh (${dlResult.filename})! Checksum: ${dlResult.checksum.slice(0, 16)}...`);
    } catch {
      toast.dismiss('backup_gen');
      toast.error('Gagal membuat berkas cadangan revisi');
    }
  };

  // Handler Validasi Berkas Cadangan (B8B - Read-Only)
  const handleTriggerFileValidation = () => {
    if (backupFileInputRef.current) {
      backupFileInputRef.current.value = '';
      backupFileInputRef.current.click();
    }
  };

  const handleValidateBackupFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsValidatingBackup(true);
      const text = await file.text();
      const validation = await validateThesisRevisionBackup(text);
      setValidationResultModal(validation);
      setIsValidatingBackup(false);
    } catch {
      setIsValidatingBackup(false);
      toast.error('Gagal membaca berkas cadangan');
    }
  };

  // Handler Buka Modal Konversi Catatan ke Tugas Kanban (B8C)
  const handleOpenConvertToKanban = (note) => {
    const alreadyLinked = isNoteAlreadyInKanban(thesisBoard, note.id);
    if (alreadyLinked.exists) {
      toast(`Catatan ini sudah pernah dimasukkan ke kolom "${alreadyLinked.columnId}". Anda dapat membuat task tambahan jika diinginkan.`, {
        icon: 'ℹ️',
      });
    }

    setConvertingNote(note);
    const initialMapping = formatKanbanTaskFromNote({
      note,
      targetColumn: note.status === REVISION_STATUS.DONE ? 'done' : note.status === REVISION_STATUS.IN_PROGRESS ? 'inProgress' : 'todo',
      includeChecklist: true,
    });

    setKanbanConvertForm({
      title: initialMapping.newTask.title,
      desc: initialMapping.newTask.desc,
      targetColumn: initialMapping.targetColumn,
      includeChecklist: true,
    });
  };

  // Handler Konfirmasi Tambah Task ke Papan Kanban (B8C)
  const handleConfirmConvertToKanban = (e) => {
    e.preventDefault();
    if (!convertingNote) return;

    if (!kanbanConvertForm.title.trim()) {
      toast.error('Judul tugas tidak boleh kosong');
      return;
    }

    const { newTask, targetColumn } = formatKanbanTaskFromNote({
      note: convertingNote,
      targetColumn: kanbanConvertForm.targetColumn,
      includeChecklist: kanbanConvertForm.includeChecklist,
      customTitle: kanbanConvertForm.title,
      customDesc: kanbanConvertForm.desc,
    });

    try {
      const commitResult = commitTaskToBoard(thesisBoard, { newTask, targetColumn });
      setThesisBoard(commitResult.board);

      const colTitle = KANBAN_COLUMNS.find(c => c.id === targetColumn)?.title || targetColumn;
      toast.success(`Tugas "${newTask.title}" berhasil ditambahkan ke kolom ${colTitle} pada papan Kanban!`);
      setConvertingNote(null);
    } catch {
      toast.error('Gagal menambahkan tugas ke papan Kanban');
    }
  };

  // Handler Buka Diff Viewer
  const handleOpenDiff = async () => {
    if (snapshots.length < 2) {
      toast.error('Minimal dibutuhkan 2 versi snapshot untuk dibandingkan');
      return;
    }
    const oldSnap = snapshots[snapshots.length - 2];
    const newSnap = snapshots[snapshots.length - 1];

    setDiffOldSnapId(oldSnap.id);
    setDiffNewSnapId(newSnap.id);

    const diff = computeTextDiff(oldSnap.text, newSnap.text);
    setComputedDiffResult(diff);
    setIsDiffModalOpen(true);
  };

  const handleChangeDiffSnapshots = async (oldId, newId) => {
    setDiffOldSnapId(oldId);
    setDiffNewSnapId(newId);
    const oldSnap = snapshots.find(s => s.id === oldId);
    const newSnap = snapshots.find(s => s.id === newId);
    if (oldSnap && newSnap) {
      const diff = computeTextDiff(oldSnap.text, newSnap.text);
      setComputedDiffResult(diff);
    }
  };

  // Perhitungan Progres Revisi
  const progressStats = useMemo(() => {
    let totalItems = 0;
    let completedItems = 0;
    let todoCount = 0;
    let inProgressCount = 0;
    let doneCount = 0;

    notes.forEach(note => {
      if (note.status === REVISION_STATUS.TODO) todoCount += 1;
      else if (note.status === REVISION_STATUS.IN_PROGRESS) inProgressCount += 1;
      else if (note.status === REVISION_STATUS.DONE) doneCount += 1;

      if (Array.isArray(note.checklist) && note.checklist.length > 0) {
        note.checklist.forEach(item => {
          totalItems += 1;
          if (item.done) completedItems += 1;
        });
      } else {
        totalItems += 1;
        if (note.status === REVISION_STATUS.DONE) completedItems += 1;
      }
    });

    const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
    return { totalItems, completedItems, percent, todoCount, inProgressCount, doneCount };
  }, [notes]);

  // Filter Catatan
  const filteredNotes = useMemo(() => {
    if (noteStatusFilter === 'all') return notes;
    return notes.filter(n => n.status === noteStatusFilter);
  }, [notes, noteStatusFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem' }}>
      {/* 1. Header Bar Workspace & Pemilih Dokumen */}
      <div
        className="card"
        style={{
          padding: '0.875rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          background: 'var(--card-bg)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: '240px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, var(--primary-color) 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {activeDoc.title}
              </h4>
              {activeDoc.isDemo && (
                <span className="badge" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>
                  Dokumen Contoh (Sintetis)
                </span>
              )}
              {resolvedDoc.isEdited && (
                <span className="badge badge-warning" style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                  Teks Terkoreksi
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {resolvedDoc.charCount.toLocaleString('id-ID')} karakter · {thesisStructure.totalSections} bagian terdeteksi
            </p>
          </div>
        </div>

        {/* Indikator Progres Revisi */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
            padding: '0.4rem 0.875rem',
            background: 'var(--bg-color)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-main)' }}>Progres Revisi</span>
              <span style={{ color: 'var(--primary-color)' }}>{progressStats.percent}%</span>
            </div>
            <div style={{ width: '120px', height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressStats.percent}%`,
                  height: '100%',
                  background: 'var(--primary-color)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.7rem' }}>
            <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
              {progressStats.todoCount} To Do
            </span>
            <span className="badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
              {progressStats.inProgressCount} Proses
            </span>
            <span className="badge" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
              {progressStats.doneCount} Selesai
            </span>
          </div>
        </div>

        {/* Tombol Aksi Dokumen & Cadangan (B8B) */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setIsDocModalOpen(true)}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <FileText size={15} /> Ganti Dokumen
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleDownloadBackup}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            title="Unduh seluruh catatan dan versi skripsi ini sebagai file JSON mandiri"
          >
            <Download size={15} /> Backup Revisi (.json)
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleTriggerFileValidation}
            disabled={isValidatingBackup}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            title="Periksa integritas file backup revisi secara aman (read-only)"
          >
            <ShieldCheck size={15} /> {isValidatingBackup ? 'Memeriksa...' : 'Validasi Cadangan'}
          </button>
          <input
            type="file"
            ref={backupFileInputRef}
            style={{ display: 'none' }}
            accept=".json,application/json"
            onChange={handleValidateBackupFile}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsSaveSnapshotModalOpen(true)}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Save size={15} /> Simpan Snapshot
          </button>
        </div>
      </div>

      {/* 2. Grid Utama Workspace: Sisi Kiri (TOC/Cari/Versi), Tengah (Pembaca Teks), Kanan (Catatan Revisi) */}
      <div
        className="thesis-workspace-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 240px) minmax(380px, 1fr) minmax(260px, 320px)',
          gap: '1rem',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* PANEL KIRI: Navigasi Dokumen (TOC, Cari, Snapshot Versi) */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--card-bg)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* Tab Samping */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-color)',
            }}
          >
            <button
              type="button"
              onClick={() => setSidebarTab('toc')}
              style={{
                flex: 1,
                padding: '0.6rem 0.4rem',
                border: 'none',
                background: sidebarTab === 'toc' ? 'var(--card-bg)' : 'transparent',
                borderBottom: sidebarTab === 'toc' ? '2px solid var(--primary-color)' : 'none',
                fontWeight: sidebarTab === 'toc' ? 600 : 400,
                color: sidebarTab === 'toc' ? 'var(--primary-color)' : 'var(--text-muted)',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              Daftar Isi
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('search')}
              style={{
                flex: 1,
                padding: '0.6rem 0.4rem',
                border: 'none',
                background: sidebarTab === 'search' ? 'var(--card-bg)' : 'transparent',
                borderBottom: sidebarTab === 'search' ? '2px solid var(--primary-color)' : 'none',
                fontWeight: sidebarTab === 'search' ? 600 : 400,
                color: sidebarTab === 'search' ? 'var(--primary-color)' : 'var(--text-muted)',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              Pencarian
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('snapshots')}
              style={{
                flex: 1,
                padding: '0.6rem 0.4rem',
                border: 'none',
                background: sidebarTab === 'snapshots' ? 'var(--card-bg)' : 'transparent',
                borderBottom: sidebarTab === 'snapshots' ? '2px solid var(--primary-color)' : 'none',
                fontWeight: sidebarTab === 'snapshots' ? 600 : 400,
                color: sidebarTab === 'snapshots' ? 'var(--primary-color)' : 'var(--text-muted)',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              Versi ({snapshots.length})
            </button>
          </div>

          {/* Konten Tab Samping */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
            {/* 1. Tab Daftar Isi (TOC) */}
            {sidebarTab === 'toc' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {thesisStructure.tableOfContents.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1rem' }}>
                    Tidak ada bab atau sub-bab terdeteksi.
                  </p>
                ) : (
                  thesisStructure.tableOfContents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleJumpToSection(item.id)}
                      style={{
                        textAlign: 'left',
                        padding: '0.4rem 0.6rem',
                        paddingLeft: item.level === 3 ? '1.5rem' : item.level === 2 ? '1rem' : '0.6rem',
                        fontSize: item.level === 1 ? '0.8rem' : '0.75rem',
                        fontWeight: item.level === 1 ? 600 : 400,
                        borderRadius: '6px',
                        border: 'none',
                        background: 'transparent',
                        color: item.level === 1 ? 'var(--text-main)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        lineHeight: 1.3,
                        transition: 'background 0.2s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-color)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {item.title}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* 2. Tab Pencarian Teks */}
            {sidebarTab === 'search' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Cari kata / frasa..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ fontSize: '0.8rem', paddingLeft: '2rem' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '0.65rem', color: 'var(--text-muted)' }} />
                </div>

                {searchQuery.trim() && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {searchResults.totalMatches} kecocokan
                    </span>
                    {searchResults.totalMatches > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>
                          {activeMatchIndex + 1} / {searchResults.totalMatches}
                        </span>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={handlePrevMatch}
                          style={{ padding: '0.2rem' }}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={handleNextMatch}
                          style={{ padding: '0.2rem' }}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Daftar Cuplikan Hasil Pencarian */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
                  {searchResults.matches.map((m, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setActiveMatchIndex(idx);
                        if (m.section?.id) handleJumpToSection(m.section.id);
                      }}
                      style={{
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: activeMatchIndex === idx ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-color)',
                        border: activeMatchIndex === idx ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '0.2rem', fontSize: '0.7rem' }}>
                        <span>Baris {m.lineNumber}</span>
                        {m.section && <span>{m.section.number || 'Bab'}</span>}
                      </div>
                      <p style={{ margin: 0, color: 'var(--text-main)', lineHeight: 1.3 }}>
                        ...{m.beforeSnippet}
                        <mark style={{ background: '#fef08a', color: '#854d0e', padding: '0 2px', borderRadius: '2px', fontWeight: 600 }}>
                          {m.matchedText}
                        </mark>
                        {m.afterSnippet}...
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Tab Snapshot Versi (B8B: Lengkap dengan Ekspor TXT & MD) */}
            {sidebarTab === 'snapshots' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    RIWAYAT VERSI
                  </span>
                  {snapshots.length >= 2 && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={handleOpenDiff}
                      style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <GitCompare size={12} /> Bandingkan
                    </button>
                  )}
                </div>

                {snapshots.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1rem' }}>
                    Belum ada versi yang disimpan. Klik "Simpan Snapshot" untuk mencatat draf saat ini.
                  </p>
                ) : (
                  snapshots.map((snap) => (
                    <div
                      key={snap.id}
                      style={{
                        padding: '0.6rem',
                        borderRadius: '8px',
                        background: 'var(--bg-color)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.35rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {snap.label}
                        </span>
                        <span className="badge badge-primary" style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}>
                          v{snap.versionNumber}
                        </span>
                      </div>
                      {snap.summary && (
                        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {snap.summary}
                        </p>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        <span>{new Date(snap.createdAt).toLocaleDateString('id-ID')}</span>
                        <span>{snap.charCount.toLocaleString('id-ID')} char</span>
                      </div>

                      {/* Tombol Ekspor TXT & Markdown Lokal (B8B) */}
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.3rem' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => handleExportTxt(snap)}
                          style={{ flex: 1, fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                          title="Unduh snapshot ini sebagai teks murni (.txt)"
                        >
                          Ekspor TXT
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => handleExportMarkdown(snap)}
                          style={{ flex: 1, fontSize: '0.68rem', padding: '0.2rem 0.4rem' }}
                          title="Unduh snapshot ini sebagai dokumen Markdown (.md)"
                        >
                          Ekspor MD
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* PANEL TENGAH: Pembaca Teks Dokumen Skripsi (B8A: Chunked Rendering) */}
        <div
          ref={readerScrollRef}
          className="card thesis-reader-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            background: 'var(--card-bg)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            padding: '1.5rem',
            position: 'relative',
            minWidth: 0,
          }}
        >
          {thesisStructure.sections.map((section) => {
            // Virtualisasi chunking untuk seksi sangat panjang (> 8000 karakter)
            const isVeryLongSection = section.content.length > 8000;
            const contentChunks = isVeryLongSection
              ? chunkTextForVirtualization(section.content, 4000)
              : [{ chunkIndex: 0, content: section.content }];

            return (
              <div
                key={section.id}
                id={section.id}
                style={{
                  marginBottom: '1.75rem',
                  borderBottom: '1px dashed var(--border-color)',
                  paddingBottom: '1.25rem',
                  contentVisibility: 'auto',
                  containIntrinsicSize: '1px 300px',
                }}
              >
                {section.title && section.title !== 'Dokumen Kosong' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    {section.level === 1 ? (
                      <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary-color)' }}>
                        {section.title}
                      </h3>
                    ) : section.level === 2 ? (
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {section.title}
                      </h4>
                    ) : (
                      <h5 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                        {section.title}
                      </h5>
                    )}
                  </div>
                )}

                {/* Teks Isi Seksi (Dirender per chunk aman untuk stabilitas render) */}
                {contentChunks.map((chunk) => (
                  <div
                    key={chunk.chunkIndex}
                    style={{
                      fontSize: '0.875rem',
                      lineHeight: '1.7',
                      color: 'var(--text-main)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'inherit',
                      marginBottom: isVeryLongSection ? '0.5rem' : '0',
                    }}
                  >
                    {chunk.content}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* PANEL KANAN: Catatan & Checklist Revisi (B8C: Tombol Konversi Kanban) */}
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--card-bg)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* Header Panel Catatan */}
          <div
            style={{
              padding: '0.75rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Catatan Revisi ({notes.length})
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsNewNoteModalOpen(true)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Plus size={14} /> Catatan Baru
              </button>
            </div>

            {/* Filter Status Catatan */}
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {['all', 'todo', 'in_progress', 'done'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setNoteStatusFilter(st)}
                  style={{
                    flex: 1,
                    fontSize: '0.68rem',
                    padding: '0.25rem 0.2rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: noteStatusFilter === st ? 'var(--primary-color)' : 'transparent',
                    color: noteStatusFilter === st ? '#ffffff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontWeight: noteStatusFilter === st ? 600 : 400,
                  }}
                >
                  {st === 'all' ? 'Semua' : st === 'todo' ? 'To Do' : st === 'in_progress' ? 'Proses' : 'Selesai'}
                </button>
              ))}
            </div>
          </div>

          {/* Daftar Catatan Revisi */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredNotes.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '1.5rem' }}>
                Tidak ada catatan revisi pada kategori ini.
              </p>
            ) : (
              filteredNotes.map((note) => {
                const kanbanLinkInfo = isNoteAlreadyInKanban(thesisBoard, note.id);
                return (
                  <div
                    key={note.id}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      background: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div>
                        <h5 style={{ margin: 0, fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {note.title}
                        </h5>
                        {note.sectionTitle && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)', fontWeight: 600 }}>
                            {note.sectionTitle}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-icon btn-icon-danger"
                        onClick={() => setDeleteConfirmNoteId(note.id)}
                        style={{ padding: '0.15rem' }}
                        title="Hapus Catatan"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {note.content && (
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                        {note.content}
                      </p>
                    )}

                    {note.supervisorNote && (
                      <div
                        style={{
                          padding: '0.4rem 0.5rem',
                          borderRadius: '6px',
                          background: 'rgba(234, 179, 8, 0.1)',
                          borderLeft: '3px solid #eab308',
                          fontSize: '0.72rem',
                          color: 'var(--text-main)',
                        }}
                      >
                        <strong>Catatan Dosen:</strong> {note.supervisorNote}
                      </div>
                    )}

                    {/* Checklist Items */}
                    {Array.isArray(note.checklist) && note.checklist.length > 0 && (
                      <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {note.checklist.map((chk, cIdx) => (
                          <div
                            key={chk.id || cIdx}
                            onClick={() => handleToggleChecklist(note, cIdx)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              fontSize: '0.73rem',
                              cursor: 'pointer',
                              color: chk.done ? 'var(--text-muted)' : 'var(--text-main)',
                              textDecoration: chk.done ? 'line-through' : 'none',
                            }}
                          >
                            {chk.done ? (
                              <CheckSquare size={13} style={{ color: 'var(--success)' }} />
                            ) : (
                              <Square size={13} style={{ color: 'var(--text-muted)' }} />
                            )}
                            <span>{chk.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tombol Konversi Catatan ke Tugas Kanban (B8C) */}
                    <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => handleOpenConvertToKanban(note)}
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.25rem 0.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          background: kanbanLinkInfo.exists ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        }}
                        title="Buat kartu tugas di papan Kanban skripsi dari catatan ini"
                      >
                        <LayoutDashboard size={12} />
                        {kanbanLinkInfo.exists ? 'Salin Ulang ke Kanban' : 'Jadikan Tugas Kanban'}
                      </button>

                      {kanbanLinkInfo.exists && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--primary-color)', fontWeight: 600 }}>
                          ✓ di {kanbanLinkInfo.columnId}
                        </span>
                      )}
                    </div>

                    {/* Footer Status Catatan */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.3rem', paddingTop: '0.35rem', borderTop: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {new Date(note.createdAt).toLocaleDateString('id-ID')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleNoteStatus(note)}
                        className={`badge ${
                          note.status === REVISION_STATUS.DONE
                            ? 'badge-success'
                            : note.status === REVISION_STATUS.IN_PROGRESS
                              ? 'badge-primary'
                              : 'badge-danger'
                        }`}
                        style={{ border: 'none', cursor: 'pointer', fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}
                        title="Klik untuk ubah status"
                      >
                        {note.status === REVISION_STATUS.DONE
                          ? 'Selesai'
                          : note.status === REVISION_STATUS.IN_PROGRESS
                            ? 'Dikerjakan'
                            : 'Belum Dikerjakan'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* --- MODAL 1: Ganti Dokumen / Tempel Draf (B8A: dengan ID stabil) --- */}
      <Modal isOpen={isDocModalOpen} onClose={() => setIsDocModalOpen(false)} title="Pilih atau Tempel Dokumen Skripsi">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', fontWeight: 600 }}>
              Dokumen Contoh Sintetis
            </h5>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setActiveDoc({
                  id: 'doc_synthetic_sample',
                  title: 'Draf Skripsi Utama (Sintetis)',
                  isDemo: true,
                  sourceType: 'demo',
                });
                setDocTextSource({ rawText: SAMPLE_SYNTHETIC_THESIS, editedText: null });
                setIsDocModalOpen(false);
                toast.success('Dokumen contoh sintetis dimuat.');
              }}
              style={{ textAlign: 'left', fontSize: '0.78rem', padding: '0.4rem 0.6rem', width: '100%' }}
            >
              Draf Skripsi Utama (Sintetis Demo)
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', fontWeight: 600 }}>
              Dokumen dari Course Vault / Semester
            </h5>
            {availableVaultDocs.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Belum ada berkas skripsi di Course Vault. Anda dapat menempel draf teks baru di bawah.
              </p>
            ) : (
              <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {availableVaultDocs.map(doc => (
                  <button
                    key={doc.id}
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      handleSelectVaultDoc(doc);
                      setIsDocModalOpen(false);
                    }}
                    style={{ textAlign: 'left', fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
                  >
                    {doc.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', fontWeight: 600 }}>
              Tempel Draf Teks Skripsi Manual
            </h5>
            <form onSubmit={handleSaveCustomDoc} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Judul Dokumen (contoh: Draf Skripsi Bab 1-3)"
                value={customDocTitle}
                onChange={e => setCustomDocTitle(e.target.value)}
                required
              />
              <textarea
                className="form-input"
                placeholder="Tempel teks skripsi di sini (lengkap dengan BAB dan sub-bab)..."
                rows={5}
                value={customDocContent}
                onChange={e => setCustomDocContent(e.target.value)}
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsDocModalOpen(false)}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Buka di Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      </Modal>

      {/* --- MODAL 2: Tambah Catatan Revisi Baru --- */}
      <Modal isOpen={isNewNoteModalOpen} onClose={() => setIsNewNoteModalOpen(false)} title="Tambah Catatan Revisi">
        <form onSubmit={handleCreateNote} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Judul Catatan
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Contoh: Perjelas batasan masalah Bab 1"
              value={newNoteForm.title}
              onChange={e => setNewNoteForm({ ...newNoteForm, title: e.target.value })}
              required
            />
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Kaitkan ke Bab / Seksi (Opsional)
            </label>
            <select
              className="form-input"
              value={newNoteForm.sectionTitle}
              onChange={e => setNewNoteForm({ ...newNoteForm, sectionTitle: e.target.value })}
            >
              <option value="">-- Tanpa Seksi Spesifik --</option>
              {thesisStructure.sections.map(s => (
                <option key={s.id} value={s.title}>{s.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Deskripsi Catatan
            </label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Keterangan perbaikan yang perlu dilakukan..."
              value={newNoteForm.content}
              onChange={e => setNewNoteForm({ ...newNoteForm, content: e.target.value })}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Catatan Dosen Pembimbing
            </label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Umpan balik langsung dari dosen..."
              value={newNoteForm.supervisorNote}
              onChange={e => setNewNoteForm({ ...newNoteForm, supervisorNote: e.target.value })}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Daftar Checklist (satu per baris)
            </label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Perbaiki kalimat pertama&#10;Tambahkan diagram relasi"
              value={newNoteForm.checklistText}
              onChange={e => setNewNoteForm({ ...newNoteForm, checklistText: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setIsNewNoteModalOpen(false)}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary">
              Simpan Catatan
            </button>
          </div>
        </form>
      </Modal>

      {/* --- MODAL 3: Simpan Snapshot Versi Teks --- */}
      <Modal isOpen={isSaveSnapshotModalOpen} onClose={() => setIsSaveSnapshotModalOpen(false)} title="Simpan Snapshot Versi Teks">
        <form onSubmit={handleSaveSnapshot} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Label Versi
            </label>
            <input
              type="text"
              className="form-input"
              placeholder={`Contoh: Versi ${snapshots.length + 1} - Setelah Bimbingan Bab 1`}
              value={snapshotForm.label}
              onChange={e => setSnapshotForm({ ...snapshotForm, label: e.target.value })}
            />
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
              Ringkasan Perubahan
            </label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Apa saja yang telah diubah pada draf ini..."
              value={snapshotForm.summary}
              onChange={e => setSnapshotForm({ ...snapshotForm, summary: e.target.value })}
            />
          </div>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Snapshot disimpan secara append-only di IndexedDB lokal. Versi lama tidak akan terhapus atau tertimpa.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-outline" onClick={() => setIsSaveSnapshotModalOpen(false)}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary">
              Simpan Snapshot
            </button>
          </div>
        </form>
      </Modal>

      {/* --- MODAL 4: Perbandingan Dua Versi (Diff Viewer) --- */}
      <Modal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        title="Perbandingan Dua Versi Teks Skripsi"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '75vh' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                Versi Lama (Basis)
              </label>
              <select
                className="form-input"
                value={diffOldSnapId}
                onChange={e => handleChangeDiffSnapshots(e.target.value, diffNewSnapId)}
              >
                {snapshots.map(s => (
                  <option key={s.id} value={s.id}>{s.label} (v{s.versionNumber})</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                Versi Baru (Pembanding)
              </label>
              <select
                className="form-input"
                value={diffNewSnapId}
                onChange={e => handleChangeDiffSnapshots(diffOldSnapId, e.target.value)}
              >
                {snapshots.map(s => (
                  <option key={s.id} value={s.id}>{s.label} (v{s.versionNumber})</option>
                ))}
              </select>
            </div>
          </div>

          {computedDiffResult && (
            <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
              <span className="badge" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
                +{computedDiffResult.addedCount} Baris Ditambahkan
              </span>
              <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                -{computedDiffResult.removedCount} Baris Dihapus
              </span>
              <span className="badge" style={{ background: 'var(--bg-color)', color: 'var(--text-muted)' }}>
                {computedDiffResult.unchangedCount} Baris Tidak Berubah
              </span>
            </div>
          )}

          {/* Diff Box */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '380px',
              background: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '0.5rem',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              lineHeight: 1.5,
            }}
          >
            {computedDiffResult?.diffLines.map((line, lIdx) => (
              <div
                key={lIdx}
                style={{
                  padding: '0.15rem 0.4rem',
                  borderRadius: '3px',
                  background:
                    line.type === 'added'
                      ? 'rgba(34, 197, 94, 0.15)'
                      : line.type === 'removed'
                        ? 'rgba(239, 68, 68, 0.15)'
                        : 'transparent',
                  color:
                    line.type === 'added'
                      ? '#22c55e'
                      : line.type === 'removed'
                        ? '#ef4444'
                        : 'var(--text-main)',
                  display: 'flex',
                  gap: '0.5rem',
                }}
              >
                <span style={{ width: '15px', color: 'var(--text-muted)', userSelect: 'none' }}>
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                </span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line.text}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => setIsDiffModalOpen(false)}>
              Tutup
            </button>
          </div>
        </div>
      </Modal>

      {/* --- MODAL 5: Hasil Validasi Berkas Cadangan Revisi (B8B - Read-Only) --- */}
      <Modal
        isOpen={Boolean(validationResultModal)}
        onClose={() => setValidationResultModal(null)}
        title="Laporan Validasi Cadangan Revisi Skripsi"
      >
        {validationResultModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              style={{
                padding: '0.75rem',
                borderRadius: '8px',
                background: validationResultModal.valid ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderLeft: `4px solid ${validationResultModal.valid ? '#22c55e' : '#ef4444'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
              }}
            >
              {validationResultModal.valid ? (
                <ShieldCheck size={24} style={{ color: '#22c55e' }} />
              ) : (
                <AlertCircle size={24} style={{ color: '#ef4444' }} />
              )}
              <div>
                <h5 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {validationResultModal.valid ? 'Integritas Berkas Valid & Aman' : 'Berkas Cadangan Tidak Valid'}
                </h5>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {validationResultModal.message || (validationResultModal.valid ? 'Checksum SHA-256 dan struktur format terverifikasi 100% cocok.' : 'Terjadi kegagalan validasi.')}
                </p>
              </div>
            </div>

            {validationResultModal.valid && (
              <div
                style={{
                  background: 'var(--bg-color)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  fontSize: '0.78rem',
                }}
              >
                <div><strong>Dokumen:</strong> {validationResultModal.documentTitle}</div>
                <div><strong>Jumlah Catatan:</strong> {validationResultModal.noteCount} catatan</div>
                <div><strong>Jumlah Snapshot:</strong> {validationResultModal.snapshotCount} versi draf</div>
                <div><strong>Tanggal Ekspor:</strong> {new Date(validationResultModal.exportedAt).toLocaleString('id-ID')}</div>
                <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <strong>Checksum:</strong> {validationResultModal.checksum}
                </div>
              </div>
            )}

            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                background: 'rgba(234, 179, 8, 0.1)',
                padding: '0.5rem',
                borderRadius: '6px',
                borderLeft: '3px solid #eab308',
              }}
            >
              🛡️ <strong>Kebijakan Integritas:</strong> Inspeksi dilakukan secara 100% read-only. Sesuai kebijakan keamanan, jalur impor/pemulihan otomatis ke profil produksi saat ini dinonaktifkan (DISABLED) untuk menjaga keutuhan data skripsi asli.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setValidationResultModal(null)}>
                Tutup Laporan
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- MODAL 6: Konversi Catatan Revisi ke Tugas Kanban (B8C) --- */}
      <Modal
        isOpen={Boolean(convertingNote)}
        onClose={() => setConvertingNote(null)}
        title="Jadikan Catatan sebagai Tugas Kanban"
      >
        {convertingNote && (
          <form onSubmit={handleConfirmConvertToKanban} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                Judul Tugas di Kanban
              </label>
              <input
                type="text"
                className="form-input"
                value={kanbanConvertForm.title}
                onChange={e => setKanbanConvertForm({ ...kanbanConvertForm, title: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                Kolom Tujuan Kanban
              </label>
              <select
                className="form-input"
                value={kanbanConvertForm.targetColumn}
                onChange={e => setKanbanConvertForm({ ...kanbanConvertForm, targetColumn: e.target.value })}
              >
                {KANBAN_COLUMNS.map(col => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                Deskripsi Tugas
              </label>
              <textarea
                className="form-input"
                rows={4}
                value={kanbanConvertForm.desc}
                onChange={e => setKanbanConvertForm({ ...kanbanConvertForm, desc: e.target.value })}
              />
            </div>

            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              ℹ️ Catatan revisi sumber tidak akan terhapus. Kartu tugas baru akan muncul pada kolom yang dipilih di papan Kanban.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-outline" onClick={() => setConvertingNote(null)}>
                Batal
              </button>
              <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Check size={15} /> Tambah ke Kanban
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* --- CONFIRM DIALOG: Hapus Catatan Revisi --- */}
      <ConfirmDialog
        isOpen={Boolean(deleteConfirmNoteId)}
        title="Hapus Catatan Revisi"
        message="Apakah Anda yakin ingin menghapus catatan revisi ini? Tindakan ini tidak dapat dibatalkan."
        confirmText="Ya, Hapus Catatan"
        cancelText="Batal"
        confirmColor="#ef4444"
        onConfirm={executeDeleteNote}
        onCancel={() => setDeleteConfirmNoteId(null)}
      />
    </div>
  );
}
