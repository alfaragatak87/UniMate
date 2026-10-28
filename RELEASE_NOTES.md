# Panduan Rilis & Dokumentasi Pengguna UniMate v1.0.0 (Release Candidate)

Selamat datang di **UniMate** — Pusat Komando & Asisten Produktivitas Mahasiswa Berbasis *Offline-First*.

Dokumen ini memuat panduan lengkap instalasi, penggunaan fitur harian, manajemen data akademik, dan kebijakan keamanan untuk versi Desktop Windows (Electron) serta Web/PWA.

---

## 1. Cara Menginstal & Membuka UniMate

### A. Pengguna Desktop Windows (Installer .exe)
1. Unduh berkas pemasang resmi: `UniMate Setup 1.0.0.exe` (arsitektur x64).
2. Jalankan installer. Pemasang menggunakan konfigurasi per-pengguna (tidak memerlukan hak akses Administrator penuh).
3. Anda dapat memilih direktori instalasi sesuai preferensi.
4. Setelah instalasi selesai, pintasan (shortcut) UniMate akan otomatis dibuat di Desktop dan Start Menu.
5. Klik ikon **UniMate** untuk membuka aplikasi.

### B. Pengguna Web / Progressive Web App (PWA)
1. Buka URL aplikasi UniMate pada peramban modern (Chrome, Edge, Firefox, Safari).
2. Klik ikon *Install UniMate* pada bilah alamat peramban untuk memasang aplikasi ke layar utama komputer atau smartphone Anda.
3. Aplikasi dapat berjalan secara offline berkat dukungan Service Worker lokal.

---

## 2. Fitur Utama: Offline vs Online

UniMate dibangun dengan filosofi **Offline-First**: seluruh data akademik esensial diproses dan disimpan di perangkat Anda sendiri tanpa ketergantungan koneksi internet.

| Fitur | Status Jaringan | Deskripsi & Batasan |
| :--- | :--- | :--- |
| **Jadwal Kuliah (Timetable)** | **100% Offline** | Pengaturan jadwal mingguan, multi-sesi (Teori & Praktikum), ruangan, dosen, dan ekspor jadwal ke PDF. |
| **Manajemen Semester & KHS** | **100% Offline** | Perhitungan IPS/IPK otomatis, target kelulusan, dan Course Vault dokumen akademik. |
| **Tugas & Proyek Mahasiswa** | **100% Offline** | Manajemen daftar tugas, prioritas deadline, dan checklist progres. |
| **Thesis Workspace & Kanban** | **100% Offline** | Reader dokumen skripsi, virtualisasi teks panjang, TOC Bab I–V, catatan bimbingan, snapshot versi, dan perbandingan diff. |
| **Scanner Dokumen KRS/KHS** | **100% Offline** | Ekstraksi teks OCR lokal (PDF.js + Tesseract WASM), parsing jadwal, deteksi bentrok, dan koreksi manual tanpa cloud. |
| **Pencadangan Data (.json)** | **100% Offline** | Ekspor metadata akademik dan paket portabel lengkap dengan berkas fisik biner ber-checksum SHA-256. |
| **AI Academic Chat (Opsional)**| **Online (Memerlukan API Key)** | Konsultasi materi dan produktivitas via Google Gemini API resmi. Kredensial tersimpan aman via Electron SafeStorage. |

---

## 3. Panduan Penggunaan Modul Akademik

### A. Menambahkan Semester & Mata Kuliah
1. Buka menu **Semesters** pada bilah navigasi samping.
2. Klik tombol **Tambah Semester** dan tentukan nama semester (misalnya `Semester 5 (Ganjil 2024/2025)`).
3. Tandai semester yang sedang berjalan sebagai **Aktif (Saat Ini)** agar jadwalnya tampil di halaman Jadwal Mingguan (Timetable).
4. Klik **Tambah Mata Kuliah** pada semester yang dipilih, masukkan nama mata kuliah, bobot SKS, dosen pengampu, dan jadwal kelas.
5. Jika mata kuliah telah selesai ditempuh, masukkan nilai huruf KHS untuk memperbarui IPS dan IPK secara otomatis.

### B. Menggunakan Pemindai Jadwal KRS / Transkrip KHS (Offline Scanner)
1. Buka menu **AI Scanner**.
2. Unggah berkas dokumen KRS atau KHS (format PDF atau gambar scan/foto).
3. Pemindai offline akan mengekstrak teks secara otomatis di browser/desktop tanpa mengirim dokumen ke server pihak ketiga.
4. Tinjau hasil ekstraksi pada modal **Pratinjau & Koreksi Manual**:
   - Periksa hari kuliah, jam mulai/selesai, ruangan, kelas, dan nama dosen.
   - Jika terdapat jadwal kuliah yang bertabrakan, sistem akan menampilkan **Peringatan Bentrok Jadwal**.
5. Pilih semester tujuan dan klik **Terapkan Impor**.
   - *Catatan Penting:* Nilai huruf KHS dan bobot SKS mata kuliah lama tidak akan pernah ditimpa atau dirusak oleh pembaruan jadwal KRS.

### C. Menggunakan Workspace Skripsi & Pelacak Revisi
1. Buka menu **Thesis Tracker**, lalu pilih tampilan **Workspace Dokumen & Revisi**.
2. Pilih dokumen draf skripsi dari Course Vault atau tempel teks draf penelitian Anda.
3. Fitur utama workspace:
   - **Daftar Isi Otomatis (TOC):** Klik Bab atau Sub-bab untuk melompat langsung ke bagian teks yang diinginkan.
   - **Pencarian Kata Cepat:** Cari kata kunci dengan nomor baris dan cuplikan konteks di sekitar kata.
   - **Catatan Revisi:** Buat catatan perbaikan bimbingan dosen dengan checklist progres.
   - **Snapshot Versi & Diff Viewer:** Simpan versi teks (misalnya Versi 1 vs Versi 2) dan bandingkan perubahan baris secara visual.
   - **Salin ke Kanban:** Klik tombol *Salin ke Kanban* pada catatan tertentu untuk mengubahnya menjadi kartu tugas skripsi.

---

## 4. Pencadangan Data & Status Pemulihan (Backup & Restore)

### A. Cara Membuat Cadangan Data Akademik
1. Buka menu **Pengaturan (Settings)**, lalu gulir ke bagian **Pencadangan Data**.
2. Terdapat dua pilihan ekspor:
   - **Ekspor Metadata (.json):** Mencadangkan seluruh data teks semester, nilai, jadwal, tugas, dan catatan skripsi (ukuran sangat ringan).
   - **Ekspor Lengkap + Berkas (.json Portabel):** Mencadangkan seluruh metadata **beserta seluruh berkas biner PDF/gambar** yang tersimpan di Course Vault dan hasil OCR.
3. Simpan berkas hasil unduhan di tempat yang aman (misalnya Google Drive pribadi atau flashdisk eksternal).

### B. Cara Membuat Cadangan Revisi Skripsi
1. Pada tampilan **Workspace Dokumen & Revisi**, klik tombol **Ekspor Cadangan Revisi**.
2. Berkas cadangan revisi mandiri berformat JSON akan diunduh dengan checksum integritas SHA-256.

### C. Keterbatasan Fitur Pemulihan (Restore) Saat Ini
> [!IMPORTANT]
> **Jalur Eksekusi Restore Produksi Masih Dinonaktifkan (DISABLED)**
> - Anda dapat mengunggah berkas cadangan ke tombol **Validasi & Pratinjau Cadangan** untuk memeriksa keabsahan struktur dan melihat ringkasan data lama vs data baru.
> - Namun, tombol penulisan pemulihan data produksi sengaja dikunci demi mencegah risiko penimpaan data yang tidak disengaja sebelum verifikasi pengguna dilakukan.
> - **Klarifikasi Checksum SHA-256:** Nilai checksum SHA-256 pada berkas cadangan adalah alat verifikasi integritas data terhadap kerusakan berkas lokal, **bukan enkripsi atau bukti keaslian anti-pemalsuan**.

---

## 5. Penyimpanan Data Lokal & Peringatan Keamanan

1. **Media Penyimpanan Lokal:**
   - Preferensi aplikasi, status tema, dan metadata semester disimpan di `localStorage` peramban / Electron.
   - Berkas dokumen asli (PDF, gambar) dan teks OCR disimpan di `IndexedDB` (`unimate-binary-vault` v2).
   - Catatan revisi skripsi dan riwayat snapshot disimpan di `IndexedDB` (`unimate-thesis-revisions` v1).
2. **Kredensial AI:**
   - Pada aplikasi desktop Windows, API key Google Gemini disimpan terenkripsi menggunakan Windows Data Protection API (DPAPI) via Electron `safeStorage`.
   - Kredensial tidak pernah disertakan dalam berkas cadangan portabel maupun bundel instalasi aplikasi.
3. **Peringatan Pemeliharaan Salinan Data:**
   - Karena UniMate adalah aplikasi lokal tanpa server database terpusat, **Anda bertanggung jawab penuh untuk menjaga salinan cadangan berkas `.json` Anda secara berkala**.
   - Menghapus data peramban (*Clear Browsing Data / Cache*) pada Web/PWA dapat menghapus penyimpanan lokal jika tidak dicadangkan sebelumnya.
