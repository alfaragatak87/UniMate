import { Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export default function DataBackup() {
  const handleExport = () => {
    try {
      const data = {
        college_semesters: localStorage.getItem('college_semesters'),
        college_tasks: localStorage.getItem('college_tasks'),
        college_thesis: localStorage.getItem('college_thesis'),
      };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_kuliah_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data berhasil dicadangkan (Export)!');
    } catch {
      toast.error('Gagal mencadangkan data.');
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.college_semesters) localStorage.setItem('college_semesters', data.college_semesters);
        if (data.college_tasks) localStorage.setItem('college_tasks', data.college_tasks);
        if (data.college_thesis) localStorage.setItem('college_thesis', data.college_thesis);
        
        toast.success('Data berhasil dipulihkan (Import)! Halaman akan dimuat ulang...');
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        toast.error('File backup tidak valid!');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
      <button onClick={handleExport} className="btn btn-outline" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}>
        <Download size={18} /> Ekspor Data (.json)
      </button>
      <label className="btn btn-outline" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', cursor: 'pointer', margin: 0 }}>
        <Upload size={18} /> Pulihkan (Import)
        <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
      </label>
    </div>
  );
}
