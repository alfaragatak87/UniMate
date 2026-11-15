# CLAUDE.md — UniMate

Baca `AGENTS.md` terlebih dahulu. Dokumen itu adalah kebijakan baku proyek dan menang jika ada pertentangan dengan file ini. File ini hanya ringkasan konteks dan panduan maintenance.

## Apa itu UniMate

UniMate adalah aplikasi manajemen kuliah all-in-one ("Pusat Komando & Asisten Produktivitas Mahasiswa") buatan Muhammad Alfatih. Bahasa antarmuka dan komunikasi: **Bahasa Indonesia**.

Fitur utama:
- Jadwal kuliah (`Timetable`), tugas dan deadline (`Tasks`), proyek (`Projects`)
- Semester dan pelacak IPS/IPK (`Semesters`)
- Kanban skripsi (`ThesisKanban`, `@dnd-kit`)
- AI Scanner: pindai KHS, silabus, jadwal dari PDF/gambar (OCR offline dengan `tesseract.js` dan `pdfjs-dist`, plus Gemini via gateway)
- AI Chat asisten belajar (`AIChat`, `AIChatWidget`)
- Analitik nilai (`DataAnalytics`, Recharts)
- Sinkronisasi antar perangkat (`DeviceSync`, PeerJS dan Firebase)
- Backup dan restore data akademik portabel
- Widget desktop melayang (`DesktopWidget`)

Tiga platform target: **Electron (Windows, installer NSIS)**, **Web**, dan **PWA**.

## Stack

React 19, Vite 8, Electron 43 + electron-builder, `react-router-dom` 7, Firebase, PeerJS, Recharts, `vite-plugin-pwa`, linter `oxlint`. Modul bertipe ESM (`"type": "module"`), proses main Electron memakai `.cjs`.

## Peta direktori

| Path | Isi |
|---|---|
| `src/pages` | Halaman (satu file per rute) |
| `src/components` | Komponen UI bersama dan modal |
| `src/services` | Logika non-UI: OCR/parser akademik, scanner, backup/restore, storage (`binaryFileStore`), klien AI/kredensial, device sync |
| `src/context/AppContext.jsx` | State aplikasi global |
| `electron/` | Proses main, `preload.cjs`, IPC, keamanan, kredensial, AI |
| `gateway/` | Gateway AI lokal (`createGateway.mjs`, `ai/`, `http/`, `security/`) |
| `shared/` | Kontrak dan validasi yang dipakai bersama renderer, Electron, gateway (`shared/ai`, `shared/credentials`) |
| `tests/` | Test `node:test` (`*.test.mjs`) dan `tests/fixtures` |
| `public/offline-scanner` | Aset OCR/PDF.js offline (~15 MB) |
| `scratch/`, `release*/`, `dist/`, `dev-dist/` | Artefak lokal dan build, di-ignore git. Jangan diubah |

## Perintah

| Tujuan | Perintah |
|---|---|
| Dev (Vite + Electron) | `npm run dev` |
| Lint | `npm run lint` |
| Build preload Electron | `npm run build:preload` |
| Validasi build Web/PWA | `npx vite build` |
| Test | `node --test tests/` (belum ada script `npm test`) |
| Test terfokus | `node --test tests/<nama>.test.mjs` |

**Jangan jalankan `npm run build` untuk pengecekan rutin.** Perintah itu menjalankan `electron-builder` dan membuat installer di `release/`.

## Aturan maintenance (inti dari AGENTS.md)

1. **Rencana dulu, ubah kemudian.** Sebelum mengubah file, sampaikan Masalah, Solusi, Risiko, dan Daftar Berkas Terdampak, lalu tunggu persetujuan. Temuan di luar scope hanya dilaporkan, tidak diperbaiki.
2. **Git.** Cek `git status` dulu. Perubahan yang belum di-commit milik pengguna. Jangan `reset`, `clean`, `restore`, `stash`, rebase. Jangan commit, buat branch, atau push tanpa diminta.
3. **Kredensial.** Jangan baca atau tampilkan `.env`, API key, token. Kredensial di Electron disimpan terenkripsi (SafeStorage) dan tidak boleh ikut paket rilis.
4. **Privasi akademik.** Data mahasiswa (NIM, KHS, nilai, jadwal, skripsi) tidak boleh dikirim ke layanan eksternal atau AI publik tanpa izin per dokumen. Jangan tambah telemetri atau koneksi eksternal baru.
5. **Test pakai data sintetis** di lingkungan terisolasi (`scratch/` atau profil sementara). Jangan sentuh data atau instalasi UniMate asli.
6. **Electron.** Pertahankan `contextIsolation: true` dan `nodeIntegration: false`. Komunikasi lewat preload dan IPC dengan validasi pengirim. Sediakan fallback bila `window.electronAPI` tidak ada, supaya Web/PWA tidak rusak.
7. **Data.** `localStorage` hanya untuk preferensi ringan. File biner dan teks OCR di IndexedDB (`binaryFileStore`). `rawText` tidak boleh diubah, koreksi pengguna disimpan di `editedText` (`null` = belum diedit, `""` = sengaja dikosongkan). Format baru harus bisa membaca format lama, dan data lama tidak dihapus sebelum migrasi terbukti berhasil.
8. **Tanpa izin khusus, dilarang:** menambah, menghapus, atau menaikkan dependensi, mengubah `package.json` atau `package-lock.json`, menjalankan `electron-builder`, mengubah isi `release/`, memanggil API AI berbayar atau jaringan eksternal.
9. **Jangan menghapus fitur, mengubah navigasi, tata letak, warna, atau pola interaksi** tanpa persetujuan eksplisit. Pertahankan komentar, gaya kode, dan line ending yang ada. Hindari refactor besar bila perbaikan lokal cukup.
10. **Laporan jujur.** Jangan klaim test, build, atau fitur berhasil tanpa menjalankannya. Build aset yang sukses bukan bukti fitur offline (Web Worker, service worker) jalan di browser. Laporkan jumlah test lulus/gagal dan apa yang belum diuji.

## Alur maintenance yang disarankan

1. `git status` dan baca `AGENTS.md`.
2. Pahami masalah: baca file terkait di `src/` atau `electron/`, cari test yang relevan di `tests/`.
3. Ajukan rencana (format di atas), tunggu persetujuan.
4. Ubah seminimal mungkin. Tambah atau perbarui test dengan fixture sintetis.
5. Jalankan test terfokus dulu, lalu `npm run lint`, baru regresi penuh `node --test tests/`.
6. Laporkan: ringkasan, file berubah, hasil test aktual, risiko tersisa, status git.

## Format laporan akhir

Ringkasan perubahan, berkas yang berubah, hasil pengujian aktual (perintah dan hasil), status kompatibilitas dan risiko tersisa, status git, rekomendasi tahap berikutnya (tanpa langsung dikerjakan).
