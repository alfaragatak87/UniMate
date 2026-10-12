<div align="center">

# 🎓 UniMate
### *Pusat Komando & Asisten Produktivitas Mahasiswa*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.1-646cff?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Electron](https://img.shields.io/badge/Electron-43.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

UniMate adalah aplikasi manajemen kuliah all-in-one yang dirancang untuk membantu mahasiswa mengorganisir jadwal, tugas, skripsi, serta performa akademik secara cerdas dan modern.

</div>

---

## ✨ Fitur Unggulan

- 📅 **Jadwal Kuliah Dinamis (Timetable)**
  - Pengaturan jadwal harian dan mingguan lengkap dengan ruang kelas, dosen, dan jam mata kuliah.
  - Tampilan visual yang bersih dengan penanda jadwal aktif hari ini.

- 🎓 **Semester & Pelacak IPK (GPA Tracker)**
  - Hitung IP Semester (IPS) dan Indeks Prestasi Kumulatif (IPK) otomatis.
  - Simulasi target IPK dan kalkulasi total SKS yang telah ditempuh.

- 📋 **Thesis & Skripsi Kanban Board**
  - Pantau tahapan riset dan penyusunan tugas akhir/skripsi (To-Do, In Progress, Review, Done).
  - Drag-and-drop interaktif bertenaga `@dnd-kit`.

- 🤖 **AI Scanner & Academic Chat Assistant**
  - Didukung integrasi **Google Gemini Generative AI**.
  - Pindai silabus, catatan, atau jadwal perkuliahan secara otomatis.
  - Chatbot asisten belajar untuk konsultasi materi dan produktivitas studi.

- ✅ **Manajemen Tugas & Deadline (Task Management)**
  - Filter tugas berdasarkan mata kuliah, prioritas, dan tenggat waktu.
  - Sistem centang progress agar tidak ada tugas yang terlewat.

- 📊 **Data Analytics & Wawasan Studi**
  - Visualisasi grafik tren nilai dan distribusi SKS interaktif menggunakan **Recharts**.

- 🖥️ **Desktop Floating Widget**
  - Mode widget ringkas melayang di layar desktop Windows untuk melihat jadwal tanpa membuka aplikasi penuh.

- 🔄 **Sinkronisasi Perangkat (Device Sync)**
  - Sinkronisasi instan antar perangkat melalui koneksi P2P (PeerJS) dan Firebase Cloud.

- 📦 **Tersedia untuk Web (PWA) & Windows Desktop (.exe)**
  - Dapat diakses dari browser, diinstal sebagai PWA di smartphone, atau diinstal langsung sebagai aplikasi Windows desktop (installer NSIS).

---

## 🛠️ Teknologi yang Digunakan

| Kategori | Teknologi |
|---|---|
| **Frontend Framework** | [React 19](https://react.dev/) |
| **Build Tool & Bundler** | [Vite 8](https://vitejs.dev/) |
| **Desktop Wrapper** | [Electron 43](https://www.electronjs.org/) & [electron-builder](https://www.electron.build/) |
| **Artificial Intelligence** | [Google Generative AI (Gemini)](https://ai.google.dev/) |
| **Database & Sync** | [Firebase](https://firebase.google.com/) & [PeerJS](https://peerjs.com/) |
| **Icons & Charts** | [Lucide React](https://lucide.dev/) & [Recharts](https://recharts.org/) |
| **Drag & Drop** | [@dnd-kit](https://dndkit.com/) |
| **Styling** | Modern CSS Variables, Glassmorphism, Responsive Grid/Flexbox |

---

## 🚀 Memulai (Panduan Instalasi & Penggunaan)

### 1. Prasyarat
- Pastikan [Node.js](https://nodejs.org/) (versi 18 ke atas) sudah terpasang di komputer Anda.

### 2. Kloning Repository
```bash
git clone https://github.com/USERNAME/UniMate.git
cd UniMate
```

### 3. Pasang Dependensi
```bash
npm install
```

### 4. Jalankan Mode Pengembangan (Development)
Menjalankan Vite dev server sekaligus jendela Electron:
```bash
npm run dev
```
Aplikasi akan otomatis terbuka pada jendela Electron dan dapat diakses di browser melalui `http://localhost:3000`.

### 5. Build Aplikasi Desktop Windows (.exe Installer)
Untuk mem-build installer desktop (.exe):
```bash
npm run build
```
File installer siap pakai akan berada di dalam folder:
`release/UniMate Setup 1.0.0.exe`

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah lisensi **MIT License** - lihat berkas [LICENSE](LICENSE) untuk rincian lengkap.

---

<div align="center">
Dibuat dengan ❤️ oleh <b>Muhammad Alfatih</b>
</div>
