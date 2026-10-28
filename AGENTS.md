# AGENTS.md — Panduan & Kebijakan Pengembangan UniMate

Dokumen ini adalah acuan kebijakan dan prosedur baku pengembangan untuk seluruh direktori dan berkas dalam repositori UniMate, kecuali terdapat `AGENTS.md` yang lebih spesifik pada subdirektori tertentu.

Instruksi dalam dokumen ini adalah panduan perilaku agen dan **tidak menggantikan pembatasan izin sistem, sandbox sistem operasi, maupun kebijakan keamanan aktual**. Jika terjadi pertentangan kewenangan, aturan dengan tingkat izin lebih tinggi yang berlaku.

---

## 1. Prinsip Pokok & Bahasa Komunikasi

- **Bahasa Komunikasi:** Seluruh komunikasi, penjelasan teknis, usulan rencana, laporan pengujian, dan dokumentasi wajib menggunakan **Bahasa Indonesia** yang jelas, profesional, dan tidak ambigu.
- **Istilah Teknis:** Nama pustaka, nama berkas, fungsi, identifier kode, API, dan istilah teknis baku tetap ditulis dalam bahasa aslinya (Bahasa Inggris).
- **Integritas Dokumentasi & Gaya Kode:** Pertahankan komentar kode, docstrings, indentasi, line ending, dan pola arsitektur yang sudah ada. Hindari refactor besar jika perbaikan lokal sudah mencukupi.
- **Konservatif terhadap Fitur & Desain:** Dilarang menghapus fitur yang sudah berfungsi, mengubah struktur navigasi, merombak tata letak visual, warna, maupun pola interaksi pengguna tanpa persetujuan eksplisit.

---

## 2. Persetujuan Berbasis Scope & Hak Koreksi Minor

Pengembangan UniMate dijalankan secara terarah melalui persetujuan ruang lingkup (*scope-based approval*):

1. **Persetujuan Awal Tahap Kerja:**
   - Sebelum mengubah berkas apa pun, agen wajib menyampaikan rencana kerja terstruktur (Masalah, Solusi, Risiko, dan Daftar Berkas Terdampak) dan menunggu persetujuan eksplisit pengguna.
   - Persetujuan terhadap suatu tahap kerja berlaku untuk berkas dan tujuan yang tercantum di dalam tahap tersebut.
2. **Kewenangan Perbaikan Minor dalam Scope:**
   - Agen **diberikan kewenangan penuh** untuk memperbaiki *bug* kecil, regresi minor, peringatan lint baru, atau ketidaksesuaian mock pengujian yang timbul akibat implementasi agen sendiri pada tahap yang sedang berjalan, **selama perbaikan tetap berada di dalam berkas dan batas ruang lingkup yang telah disetujui**.
   - Agen diperbolehkan menjalankan ulang pengujian terfokus (*focused tests*) untuk memvalidasi perbaikan minor tersebut tanpa perlu meminta izin baris per baris.
3. **Batasan & Temuan di Luar Scope:**
   - Masalah warisan (*legacy issues*) atau temuan baru di luar ruang lingkup yang disetujui **dilarang diperbaiki secara otomatis**. Masalah tersebut hanya boleh dilaporkan sebagai catatan terpisah.
   - Penambahan berkas baru di luar rencana, penambahan dependensi baru, perubahan skema database, atau modifikasi file di luar izin wajib meminta persetujuan baru.
4. **Kondisi Berhenti Seketika:**
   - Jika terdapat risiko kehilangan/kerusakan data atau ketidakpastian migrasi, agen wajib segera menghentikan eksekusi dan melapor.
   - **Dilarang melakukan rollback otomatis yang bersifat destruktif.** Pertahankan seluruh perubahan pengguna dan diskusikan langkah pemulihan.

---

## 3. Perlindungan Git, Kredensial, & Privasi Akademik

1. **Perlindungan Riwayat & Status Git:**
   - Selalu periksa `git status` sebelum memulai pekerjaan. Seluruh perubahan yang belum di-commit (*dirty state*) adalah milik pengguna yang wajib dilindungi.
   - **DILARANG KERAS** menjalankan perintah destruktif seperti `git reset`, `git clean`, `git restore`, `git checkout --`, `git stash`, rebase, atau manipulasi riwayat Git tanpa permintaan eksplisit.
   - **DILARANG KERAS** membuat commit, branch, tag, atau melakukan `git push` tanpa instruksi khusus pengguna.
2. **Kerahasiaan Kredensial & Kunci API:**
   - Dilarang membaca, menyalin, mencatat, atau menampilkan API key, token otentikasi, kredensial privat, atau berkas `.env` ke dalam pesan percakapan, log, artefak diff, maupun source code.
   - Jika pembacaan konfigurasi sensitif diizinkan pengguna, tampilkan nilai hanya dalam bentuk tersamar (*masked*).
   - Pada Electron, kredensial wajib disimpan terenkripsi menggunakan SafeStorage dan dilarang disertakan dalam paket rilis.
3. **Privasi Data Akademik Mahasiswa:**
   - Seluruh data mahasiswa (identitas, NIM, KHS, transkrip, nilai, jadwal kuliah, progres tesis, dan berkas arsip) adalah data pribadi sensitif.
   - Dilarang mengirimkan data akademik ke layanan cloud, provider AI publik, atau endpoint eksternal tanpa izin dan persetujuan sadar (*consent*) per dokumen dari pengguna.
   - Dilarang menambahkan telemetri, analitik pelacakan pengguna, atau koneksi eksternal baru.
4. **Isolasi Pengujian (Synthetic Fixtures):**
   - Seluruh pengujian wajib menggunakan data sintetis tiruan (*synthetic fixtures*) dan lingkungan terisolasi (misalnya `scratch/` atau profil pengujian sementara).
   - **DILARANG KERAS** menyentuh, menguji, atau memodifikasi direktori data pengguna asli maupun database aplikasi UniMate yang terinstal di sistem operasi.

---

## 4. Strategi Tiga Platform & Kompatibilitas Bertahap

UniMate menargetkan tiga platform sekaligus: **Desktop (Electron Windows)**, **Web (Browser)**, dan **PWA (Progressive Web App)**.

1. **Pendekatan Bertahap (Electron-First):**
   - Proyek mengizinkan strategi implementasi bertahap (*staged roadmap*) yang memprioritaskan fitur desktop (misalnya *Electron-first*) sesuai arahan pengguna.
   - Perubahan untuk Electron tidak boleh merusak fungsionalitas Web/PWA yang sudah berjalan. Kode wajib menyediakan fallback aman jika `window.electronAPI` tidak tersedia.
2. **Integritas Pelaporan & Anti-Klaim Semu:**
   - Dilarang menyatakan suatu fitur siap produksi pada Web/PWA jika fitur tersebut belum pernah diuji secara nyata pada platform tersebut.
   - Keberhasilan proses build bundel aset **bukan bukti** bahwa fitur runtime offline (seperti Web Worker, service worker caching aset OCR/PDF.js sebesar ~15MB) sudah berjalan di browser. Status yang belum diverifikasi wajib dilaporkan apa adanya.
3. **Arsitektur Keamanan Electron:**
   - Wajib mempertahankan `contextIsolation: true` dan `nodeIntegration: false`.
   - Komunikasi renderer dan main process wajib melalui bridge preload resmi dan memvalidasi kebijakan pengirim IPC (*sender policy*).

---

## 5. Integritas Data & Penyimpanan Lokal

1. **Pemisahan Media Penyimpanan:**
   - `localStorage`: Hanya untuk preferensi ringan dan state sederhana yang dapat diserialisasi JSON. Dilarang menyimpan file biner atau string Base64 raksasa di `localStorage`.
   - `IndexedDB` (`binaryFileStore`): Digunakan untuk berkas biner dokumen (`files`) dan teks ekstraksi/koreksi OCR (`document_texts`).
2. **Kaidah Skema & Immutability:**
   - Pertahankan hasil pembacaan mesin (`rawText`) sebagai data permanen yang tidak boleh dimutasi. Hasil koreksi pengguna wajib disimpan terpisah pada `editedText`.
   - Bedakan dengan tegas antara `editedText === null` (belum pernah diedit) dan `editedText === ""` (pengguna sengaja mengosongkan teks).
   - Pengeditan teks OCR tidak boleh memicu pembuatan ulang atau modifikasi pada berkas biner asli dokumen.
3. **Kompatibilitas Mundur & Prosedur Migrasi:**
   - Format penyimpanan baru wajib dapat membaca format versi sebelumnya (*backward-compatible*).
   - Jangan menghapus data atau kunci lama sebelum proses migrasi terverifikasi berhasil sepenuhnya.
   - Periksa konsekuensi downgrade: jika database dinaikkan versinya (misalnya IndexedDB v1 ke v2), laporkan dampaknya terhadap biner aplikasi versi lama sebelum mendistribusikan pembaruan.
   - Selalu uji logika migrasi dengan variasi data sintetis: data kosong, data normal, data skema lama, dan data rusak.

---

## 6. Standar Pengujian & Validasi Berbasis Bukti

1. **Larangan Klaim Tanpa Bukti:**
   - Agen dilarang menyatakan suatu pengujian, build, atau fitur berhasil tanpa benar-benar menjalankan perintah verifikasinya dan memeriksa output sebenarnya.
   - Laporkan hasil sebenarnya secara transparan, termasuk jumlah pengujian yang lolos/gagal, peringatan lint, dan aspek yang belum dapat diuji.
2. **Klasifikasi Jenis Pengujian:**
   - **Operasi Read-Only:** Pemeriksaan kode, audit statis, pemeriksaan `git status`, dan `git diff` yang tidak mengubah lingkungan kerja.
   - **Pengujian dengan Operasi Tulis:** Pembuatan berkas fixture di folder scratch, peluncuran browser pengujian yang menyimpan ke IndexedDB sementara, dan kompilasi build aset. Pengujian ini hanya boleh dilakukan dengan izin yang sesuai dan wajib menggunakan profil/lokasi terisolasi.
3. **Urutan Pengujian yang Efisien:**
   - Jalankan pemeriksaan spesifik atau pengujian terfokus (*focused test*) terlebih dahulu sebelum menjalankan regresi menyeluruh (*full regression*), guna menghemat waktu dan beban proses.
4. **Penanganan Kegagalan Uji:**
   - Jika pengujian gagal, hentikan tahap kerja. Analisis akar masalah, laporkan kondisi workspace saat ini, dan mintalah persetujuan sebelum mengubah pendekatan atau melakukan modifikasi besar.

---

## 7. Batasan Perintah Eksekusi, Build, & Packaging

1. **Perhatian Khusus `npm run build`:**
   - Perintah `npm run build` pada UniMate menjalankan rantai: `vite build && npm run build:preload && electron-builder`.
   - **DILARANG** menggunakan `npm run build` sebagai perintah pemeriksaan rutin karena akan otomatis memicu pembuatan installer/paket Electron.
   - Untuk memvalidasi hasil build Web/PWA: gunakan `npx vite build` (hanya jika diizinkan).
   - Untuk memvalidasi build script preload Electron: gunakan `npm run build:preload` (hanya jika diizinkan).
2. **Perintah yang Dilarang Keras Tanpa Persetujuan Khusus:**
   - Menjalankan `electron-builder`, membuat installer Windows (`.exe`/NSIS), atau memodifikasi isi folder `release/` dan `release/win-unpacked`.
   - Mengubah aplikasi UniMate yang terinstal di sistem operasi pengguna.
   - Menginstal, menghapus, atau menaikkan versi dependensi (`npm install`, `npm update`, atau mengubah `package.json`/`package-lock.json`).
   - Menjalankan formatter otomatis dengan mode tulis di luar berkas yang disetujui.
   - Menjalankan migrasi langsung pada database atau profil asli pengguna.
   - Mengirim request ke jaringan eksternal atau memanggil API model AI nyata yang berbayar.
3. **Kewaspadaan Menjalankan Perintah:**
   - Selalu periksa definisi script di `package.json` sebelum mengeksekusi perintah npm baru.
   - Jangan pernah mengasumsikan perintah build bersifat *read-only*.

---

## 8. Format Usulan & Laporan Akhir

### A. Format Usulan Perubahan (Sebelum Pengerjaan)
Setiap usulan pekerjaan baru wajib memuat:
- **Masalah:** Gejala bug, keterbatasan saat ini, dan bukti kode yang terdampak.
- **Solusi:** Pendekatan teknis yang diusulkan dan alasan pemilihannya.
- **Risiko & Mitigasi:** Tingkat risiko (rendah/sedang/tinggi), dampak ke data/platform, dan langkah pencegahan regresi.
- **Daftar Berkas Terdampak:** Berkas yang akan diubah atau dibuat baru (tidak boleh menyentuh file di luar daftar ini).

### B. Format Laporan Akhir (Setelah Pengerjaan Selesai)
Setiap laporan penutupan tahap wajib memuat:
- **Ringkasan Perubahan:** Apa saja yang berhasil diimplementasikan.
- **Berkas yang Berubah:** Daftar berkas yang dimodifikasi.
- **Hasil Pengujian Aktual:** Perintah yang dijalankan, output jumlah test lulus/gagal, dan hasil lint.
- **Bukti & Verifikasi Nyata:** Log eksekusi, screenshot/video pengujian (jika relevan), atau rekaman profil terisolasi.
- **Status Kompatibilitas & Risiko Tersisa:** Hal-hal yang belum teruji atau batasan yang masih ada.
- **Status Git Terkini:** Bukti kebersihan `git status` dan konfirmasi bahwa pekerjaan pengguna tidak terganggu.
- **Rekomendasi Tahap Berikutnya:** Langkah logis selanjutnya tanpa langsung mengerjakannya secara sepihak.
