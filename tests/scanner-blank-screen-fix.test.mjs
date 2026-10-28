import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve('.');

test('Regression Fix: App.jsx mendefinisikan rute alias dashboard dan wildcard agar tidak terjadi blank screen', () => {
  const appContent = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');

  // Must have dashboard route alias
  assert.ok(
    appContent.includes('<Route path="dashboard" element={<Dashboard />} />'),
    'App.jsx harus mendefinisikan alias path="dashboard" yang merender Dashboard'
  );

  // Must have wildcard route fallback
  assert.ok(
    appContent.includes('<Route path="*" element={<Dashboard />} />'),
    'App.jsx harus mendefinisikan wildcard fallback path="*" agar HashRouter tidak menghasilkan blank screen'
  );
});

test('Regression Fix: AIScanner.jsx menggunakan navigate("/") dan memiliki double-click guard', () => {
  const scannerContent = readFileSync(resolve(repoRoot, 'src/pages/AIScanner.jsx'), 'utf8');

  // Must use navigate('/')
  assert.ok(
    scannerContent.includes("navigate('/')"),
    'AIScanner.jsx harus menavigasikan ke "/" setelah penyimpanan berhasil'
  );
  assert.ok(
    !scannerContent.includes("navigate('/dashboard')"),
    'AIScanner.jsx tidak boleh menavigasikan ke "/dashboard" yang tidak cocok'
  );

  // Must have double-click guard
  assert.ok(
    scannerContent.includes('isSavingRef'),
    'AIScanner.jsx harus memiliki isSavingRef untuk mencegah duplikasi penekanan Simpan'
  );

  // Must guard 0 courses for KHS
  assert.ok(
    scannerContent.includes('Tidak ada mata kuliah yang terdeteksi dalam dokumen ini'),
    'AIScanner.jsx harus memvalidasi agar KHS dengan 0 mata kuliah tidak disimpan kosong'
  );
});

test('Regression Fix: Tasks.jsx mendukung pratinjau Teks Hasil OCR di modal dokumen Arsip File', () => {
  const tasksContent = readFileSync(resolve(repoRoot, 'src/pages/Tasks.jsx'), 'utf8');

  // Must resolve persistent document text
  assert.ok(
    tasksContent.includes('resolvePersistentDocumentText'),
    'Tasks.jsx harus mengimpor dan memanggil resolvePersistentDocumentText'
  );

  // Must have OCR tab
  assert.ok(
    tasksContent.includes('Teks Hasil OCR'),
    'Tasks.jsx harus menyediakan tab antarmuka "Teks Hasil OCR"'
  );

  // Must distinguish edited vs machine
  assert.ok(
    tasksContent.includes('Telah Diedit Pengguna'),
    'Tasks.jsx harus membedakan teks yang telah diedit dengan teks mesin asli'
  );

  // Must provide Copy and Download TXT
  assert.ok(
    tasksContent.includes('handleCopyOcr'),
    'Tasks.jsx harus menyediakan aksi Salin Teks OCR'
  );
  assert.ok(
    tasksContent.includes('handleDownloadOcr'),
    'Tasks.jsx harus menyediakan aksi Unduh Teks OCR sebagai .txt'
  );
});
