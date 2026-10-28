---
name: unimate-ui-testing
description: >-
  Gunakan skill ini saat menguji antarmuka pengguna (UI/UX), verifikasi layout responsif Web/PWA, jendela Electron, navigasi HashRouter, drag-and-drop jadwal, dan modal di UniMate.
---

# UniMate UI & Cross-Platform Testing Guide

Skill ini adalah prosedur baku pengujian antarmuka pengguna pada UniMate dengan memprioritaskan alat bawaan Antigravity dan pengujian skrip lokal.

> [!IMPORTANT]
> **Klarifikasi Konsumsi Token AI**: Eksekusi skrip pengujian lokal di terminal memang berjalan tanpa memanggil API model. Namun, proses perancangan skrip, pemanggilan perintah oleh agen, serta pembacaan dan evaluasi log hasil pengujian oleh agen tetap menggunakan token konteks AI.

---

## 1. Verifikasi Port, URL, dan Rute Aktual

Sebelum membuka browser atau menjalankan pengujian antarmuka, agen **WAJIB** memverifikasi konfigurasi aktif:

1. **Pemeriksaan Port dan Host**:
   * Jangan mengunci alamat `localhost:3000` secara membabi buta.
   * Periksa [vite.config.js](file:///d:/CODING/PERSONAL/APK/UniMate/vite.config.js#L55-L62) dan skrip `npm run dev` pada [package.json](file:///d:/CODING/PERSONAL/APK/UniMate/package.json#L13).
   * Verifikasi apakah dev server aktif pada `http://127.0.0.1:3000` atau port lain jika menggunakan `npm run preview`.
2. **Pemeriksaan Rute Aktual (`HashRouter`)**:
   * UniMate menggunakan `HashRouter` untuk kompatibilitas build Electron ([src/App.jsx](file:///d:/CODING/PERSONAL/APK/UniMate/src/App.jsx)).
   * Rute resmi yang terdaftar:
     * `#/` (Dashboard Utama)
     * `#/semesters` (Manajemen Semester & Course Vault)
     * `#/timetable` (Jadwal Perkuliahan)
     * `#/tasks` (Daftar Tugas Mahasiswa)
     * `#/projects` (Manajemen Proyek Akademik)
     * `#/thesis` (Kanban Tugas Akhir / Skripsi)
     * `#/analytics` (Analisis Performa Akademik & IPK)
     * `#/ai-scanner` (Pemindai Dokumen KHS/PDF/OCR)
     * `#/sync` (Sinkronisasi Perangkat P2P)
     * `#/settings` (Pengaturan Aplikasi & Penyimpanan)
     * `#/profile` (Data Identitas Mahasiswa)

---

## 2. Penggunaan Browser Bawaan Antigravity (`browser_subagent`)

Antigravity menyediakan subagent browser yang siap pakai tanpa instalasi tambahan.

### Kapan Menggunakan `browser_subagent`:
* **Inspeksi Visual Responsif**: Memeriksa kerapian tata letak pada viewport desktop (misal 1280x800) dan viewport seluler (misal 375x667).
* **Verifikasi Tema**: Memastikan kontras warna teks dan elemen UI terbaca dengan jelas pada mode terang dan gelap.
* **Perekaman Bukti Visual**: `browser_subagent` secara otomatis menyimpan rekaman sesi interaksi ke dalam format video WebP di folder artefak, sangat berguna sebagai bukti demonstrasi kepada pengguna.

### Batasan `browser_subagent`:
* Setiap aksi klik/ketik/analisis visual membutuhkan evaluasi model LLM yang mengonsumsi kredit AI.
* Hindari menggunakan subagent browser untuk pengujian regresi berulang ratusan kali; gunakan skrip asersi lokal untuk skenario tersebut.

---

## 3. Strategi Pengujian Otomatis Mandiri (Playwright / Skrip Lokal)

Untuk pengujian regresi deterministik:
* Gunakan skrip pengujian lokal berbasis Node.js yang mengecek render komponen atau DOM state.
* Jika Playwright CLI digunakan pada tahap lanjutan proyek, ikuti pedoman implementasi dan isolasi lingkungan pada [references/playwright-guidelines.md](./references/playwright-guidelines.md).

---

## 4. Checklist Pengujian UI Bebas Regresi

1. **Navigasi & HashRouter**:
   * Memastikan perpindahan antar menu navigasi samping (*sidebar*) memperbarui URL hash dan tidak memicu reload halaman penuh.
2. **Interaktivitas Modal**:
   * Modal (seperti Course Vault Modal, Preview Scanner Modal, Backup Modal) harus dapat dibuka dan ditutup dengan tombol Escape atau tombol batal tanpa merusak state halaman belakangnya.
3. **Pemberitahuan Toast**:
   * Notifikasi berhasil/gagal via `react-hot-toast` tampil di posisi kanan atas (`top-right`) tanpa menutupi tombol penting.
