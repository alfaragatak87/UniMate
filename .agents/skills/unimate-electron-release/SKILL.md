---
name: unimate-electron-release
description: >-
  Gunakan skill ini saat memeriksa kesiapan rilis Electron, mengaudit sanitasi berkas paket (app.asar), memverifikasi build preload, dan menjalankan uji eksklusi kredensial di UniMate.
---

# UniMate Electron Packaging & Release Audit Guide

Skill ini adalah prosedur baku audit pra-rilis aplikasi desktop UniMate untuk menjamin keamanan bundel paket sebelum didistribusikan.

> [!WARNING]
> **Persetujuan Khusus untuk Pembuatan Installer**: Skill ini HANYA berwenang melakukan pemeriksaan kesiapan, sanitasi berkas, dan menjalankan pengujian packaging. **Pembuatan berkas installer NSIS akhir (`.exe`), pemaketan rilis penuh, atau pembaruan terhadap aplikasi UniMate yang terinstal di sistem Windows tetap MEMERLUKAN persetujuan khusus terpisah dari pengguna.**

---

## 1. Verifikasi Rantai Build Preload & Frontend

Aplikasi Electron UniMate memerlukan file preload terpisah yang dikompilasi secara khusus:

1. **Build Script Preload**:
   * Preload dikompilasi melalui konfigurasi [vite.preload.config.js](file:///d:/CODING/PERSONAL/APK/UniMate/vite.preload.config.js):
     ```bash
     npm run build:preload
     ```
   * Memastikan output `electron/preload.cjs` valid tanpa memicu sintaksis yang merusak sandbox Electron.
2. **Build Aset Web**:
   * Kompilasi frontend React ke folder `dist/`:
     ```bash
     npx vite build
     ```
   * Memastikan base path disetel relatif (`base: './'`) pada [vite.config.js](file:///d:/CODING/PERSONAL/APK/UniMate/vite.config.js#L89) agar aset HTML/CSS/JS dapat dibuka langsung oleh protokol `file://` di Electron.

---

## 2. Audit Eksklusi Berkas Sensitif (Sanitasi `app.asar`)

Sebelum bundel aplikasi dibuat, pastikan tidak ada data sensitif yang masuk ke dalam arsip `app.asar`:

1. **Aturan Eksklusi Wajib pada [package.json](file:///d:/CODING/PERSONAL/APK/UniMate/package.json#L24-L33)**:
   * Arsip rilis **DILARANG** memuat:
     * `!**/credentials/ai-credentials*.enc.json` (kredensial AI terenkripsi lokal)
     * `!**/credentials/.*.tmp` (berkas penulisan atomik sementara)
     * `.env` atau berkas token pengembang lainnya
2. **Eksekusi Pengujian Otomatis Sanitasi**:
   Jalankan uji integrasi packaging yang mengekstrak dan memindai arsip asar secara terisolasi:
   ```bash
   node --test tests/electron-credential-packaging.test.mjs
   ```
   *Pengujian ini memverifikasi bahwa kredensial sintetis tidak dapat ditemukan di dalam berkas hasil build.*

Rincian daftar berkas yang wajib dieksklusi dan panduan audit asar tersedia di [references/packaging-exclusion-audit.md](./references/packaging-exclusion-audit.md).

---

## 3. Pemeriksaan Konfigurasi NSIS & Ikon Aplikasi

1. **Kelengkapan Aset Ikon**:
   * Ikon aplikasi untuk Windows wajib tersedia di [public/icon.ico](file:///d:/CODING/PERSONAL/APK/UniMate/public/icon.ico) dan [build/icon.ico](file:///d:/CODING/PERSONAL/APK/UniMate/build/icon.ico).
2. **Konfigurasi Pemasang NSIS**:
   * Konfigurasi di [package.json](file:///d:/CODING/PERSONAL/APK/UniMate/package.json#L45-L52) disetel ke mode per-user yang aman:
     * `oneClick: false`
     * `perMachine: false`
     * `allowToChangeInstallationDirectory: true`
3. **Penghentian Sebelum Eksekusi Builder**:
   * Setelah audit selesai, agen harus melaporkan status kesiapan kepada pengguna dan **berhenti**. Jangan mengeksekusi `electron-builder` tanpa permintaan eksplisit.
