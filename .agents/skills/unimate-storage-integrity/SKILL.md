---
name: unimate-storage-integrity
description: >-
  Gunakan skill ini saat memeriksa, mengaudit, atau memodifikasi persistensi data, skema localStorage, IndexedDB, cadangan akademik (academicBackup), dan binaryFileStore pada UniMate.
---

# UniMate Storage & Data Integrity Guide

Skill ini adalah prosedur baku untuk menjaga integritas data akademik mahasiswa dan mencegah terjadinya korupsi atau kehilangan data pada Web, PWA, dan Electron.

> [!CAUTION]
> **Larangan Operasi pada Profil Asli**: DILARANG melakukan uji coba migrasi, penghapusan kunci penyimpanan, atau restore langsung pada data profil/penyimpanan asli pengguna. Selalu gunakan *isolated test environment* atau *synthetic fixtures*.

---

## 1. Fakta Status Persistensi Tahap B5B-3 (Baseline Aktual)

Sebelum melakukan modifikasi atau analisis penyimpanan, agen wajib memahami status teknis nyata per akhir **Tahap B5B-3**:

1. **IndexedDB Versi 2 (`unimate-binary-vault`):**
   * Database beroperasi pada versi 2 dengan dua object stores utama:
     * `files`: Menyimpan berkas biner asli dokumen (PDF/gambar/arsip). Diacu oleh `binaryRef` (`{ kind: 'binary_file_ref', version: 1, id, name, size, mimeType }`).
     * `document_texts`: Menyimpan teks hasil ekstraksi dan koreksi OCR. Diacu oleh `textRef` (`{ kind: 'document_text_ref', version: 1, id, binaryId, charCount, hasEditedText }`).
2. **Pemisahan `rawText` dan `editedText`:**
   * `rawText`: Teks mesin permanen yang tidak boleh dimutasi.
   * `editedText`: Koreksi teks pengguna. Model penyimpanan membedakan `null` (belum diedit) dari `""` (pengguna sengaja mengosongkan teks).
   * Pengeditan teks menggunakan *Copy-on-Write Fork* jika satu `textRef` digunakan bersama oleh lebih dari satu referensi dokumen di Course Vault.
3. **Ekspor Cadangan Portabel (.unimate):**
   * Format cadangan portabel telah diperluas untuk menyertakan berkas biner dan teks OCR dengan checksum SHA-256.
4. **Status Fitur Restore (Tetap Dinonaktifkan):**
   * Fitur *Restore* pada antarmuka pengguna **tetap dinonaktifkan** (*disabled*) hingga audit skema impor dua arah diverifikasi secara khusus.
5. **Risiko Downgrade Versi Database:**
   * Jika aplikasi versi lama (yang masih mengunci IndexedDB v1) dibuka pada profil yang sudah bermigrasi ke v2, Chromium akan melempar `VersionError`. Data fisik di disk tidak rusak, namun database tidak dapat dibuka hingga aplikasi diperbarui kembali ke versi v2.

---

## 2. Prinsip Migrasi Skema Tanpa Kehilangan Data

Jika tugas mengharuskan penyesuaian skema penyimpanan:

1. **Aturan Backward-Compatibility:**
   * Format skema lama harus tetap dapat dibaca oleh pembaca versi baru. Dokumen lama tanpa `textRef` harus ditangani secara elegan tanpa crash.
   * Kunci lama tidak boleh dihapus seketika setelah migrasi.
2. **Serialisasi Aman:**
   * Jangan menyimpan objek yang tidak dapat diserialisasi (seperti fungsi, `Promise`, circular references) ke dalam `localStorage`.
   * Data biner wajib dialihkan ke IndexedDB via [src/services/binaryFileStore.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/binaryFileStore.js) dan dilarang disimpan sebagai Base64 raksasa di `localStorage`.
3. **Validasi Kuota Penyimpanan:**
   * Tangani `QuotaExceededError` dengan aman dan berikan umpan balik yang jujur kepada pengguna tanpa memalsukan status berhasil.

---

## 3. Matriks Pengujian Integritas Data

Jalankan suite pengujian integritas penyimpanan sintetis:

```bash
# 1. Uji cadangan dan pratinjau restore akademik
node --test tests/academic-backup.test.mjs
node --test tests/portable-academic-backup.test.mjs

# 2. Uji persistensi teks OCR, editor, dan Course Vault
node --test tests/offline-ocr-persistence.test.mjs
node --test tests/offline-ocr-editor-vault.test.mjs

# 3. Uji integritas local storage dan penyimpanan biner
node --test tests/data-integrity-regression.test.mjs
node --test tests/local-storage-safety.test.mjs
node --test tests/course-vault-storage.test.mjs
node --test tests/electron-indexeddb-storage.test.mjs
```

Rincian kontrak skema data dan format cadangan tersedia di [references/storage-contracts.md](./references/storage-contracts.md).

---

## 4. Langkah Pemulihan Jika Terjadi Anomali Data

1. Jika salah satu pengujian persistensi gagal:
   * Hentikan operasi penulisan data seketika.
   * Periksa apakah skema lama gagal diparsing oleh fungsi migrasi.
   * Jangan menjalankan kode perbaikan sebelum rencana migrasi tervalidasi dengan data contoh kosong, data normal, data skema lama, dan data rusak.
