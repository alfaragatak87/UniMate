---
name: unimate-scanner-qa
description: >-
  Gunakan skill ini saat memodifikasi, mengaudit, atau menguji modul pemindai dokumen offline (offlineDocumentEngine, offlineScanner, Tesseract OCR, PDF.js, dan parser KHS) pada Web, PWA, dan Electron di UniMate.
---

# UniMate Scanner QA & Validation Guide

Skill ini adalah prosedur baku pengujian dan audit mutu untuk sistem pemindaian dokumen offline, editor OCR, dan pembaca teks Course Vault di UniMate.

> [!IMPORTANT]
> **Prinsip Dasar**: Pemrosesan dokumen offline harus berjalan **100% lokal** di mesin pengguna untuk melindungi kerahasiaan dokumen akademik.

---

## 1. Klasifikasi Tipe Dokumen & Jalur Pemrosesan

Modul [src/services/offlineDocumentEngine.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/offlineDocumentEngine.js) dan [src/services/offlineScanner.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/offlineScanner.js) menangani kategori dokumen berikut:

1. **PDF Valid dengan Teks Asli (Direct Text Extraction):**
   * Teks diekstraksi langsung melalui layer digital PDF.js tanpa menjalankan Tesseract OCR, hemat CPU dan memori.
2. **Gambar Mandiri & PDF Scan (Local OCR Fallback):**
   * Diproses menggunakan worker Tesseract.js lokal ([public/offline-scanner/tesseract/](file:///d:/CODING/PERSONAL/APK/UniMate/public/offline-scanner/tesseract/)).
   * Dibatasi oleh `DEFAULT_MAX_PAGE_PIXELS = 10_000_000` per halaman untuk mencegah kehabisan memori.
3. **PDF Hybrid (Campuran Teks & Gambar Scan):**
   * Halaman dengan teks digital diekstraksi langsung; halaman murni gambar diproses via OCR lokal. Hasil digabungkan secara utuh pada `fullText`.
4. **PDF Rusak atau Terenkripsi Sandi:**
   * Wajib menghasilkan galat aman terprediksi (`OfflineDocumentEngineError` dengan kode aman seperti `pdf_invalid` atau `pdf_processing_failed`).
   * DILARANG melempar *unhandled exception* yang memicu layar putih (*white screen*).

---

## 2. Batasan Kritis, Editor OCR, & Larangan Asumsi

* 🚫 **Larangan Fallback Otomatis ke Cloud:** Jika pemindaian offline gagal, sistem **TIDAK BOLEH** otomatis mengirim berkas ke Google Gemini atau provider lain. Gemini Online hanya boleh diakses setelah pengguna secara sadar memilihnya dan memberikan persetujuan (*consent*) per dokumen.
* 📄 **Pembedaan Preview Karakter vs Teks Lengkap:**
  * `previewText`: Dibatasi maksimal 20.000 karakter (`MAX_PREVIEW_CHARACTERS`) hanya untuk kartu pratinjau ringkas antarmuka.
  * `fullText`: Menyimpan seluruh karakter dokumen tanpa pemotongan (teruji hingga 52.000+ karakter pada skripsi/silabus panjang) dan dialirkan ke Editor OCR serta `document_texts` di IndexedDB.
* ✍️ **Editor OCR & Course Vault Text Viewer (Tahap B5B-3):**
  * Pengguna dapat mengoreksi teks di AI Scanner sebelum disimpan, atau mengedit teks in-place di Course Vault.
  * Fitur pencarian kata di Course Vault mendukung penyorotan teks real-time (`<mark>`).
* ⚠️ **Larangan Klaim Semu (Unverified Features):**
  * **OCR Tulisan Tangan:** Belum terbukti akurat dan tidak boleh diklaim siap pakai.
  * **Dokumen Raksasa (>100 halaman):** Belum teruji performa DOM-nya; tetap wajib mematuhi batas ukuran scanner 10 MiB.
  * **Kesiapan Web/PWA Offline:** Keberhasilan build Vite bukan jaminan bahwa caching service worker untuk aset Tesseract (~15MB) sudah berjalan di seluruh browser. Hal ini wajib dilaporkan sebagai belum terverifikasi penuh jika belum diuji nyata.

---

## 3. Matriks Pengujian Terfokus (Node Test Runner)

Jalankan pengujian modul scanner dan persistensi teks:

```bash
# 1. Uji ekstraksi teks PDF langsung & OCR gambar
node --test tests/offline-pdf-text-extraction.test.mjs
node --test tests/offline-image-ocr-extraction.test.mjs

# 2. Uji integrasi pipeline scanner offline & pembatalan
node --test tests/offline-scanner-integration.test.mjs
node --test tests/offline-scanner.test.mjs
node --test tests/ai-cancellation.test.mjs

# 3. Uji persistensi OCR, editor teks, dan Course Vault
node --test tests/offline-ocr-persistence.test.mjs
node --test tests/offline-ocr-editor-vault.test.mjs

# 4. Uji alur review dan merge data KHS
node --test tests/ai-scanner-review.test.mjs
node --test tests/ai-scanner-merge.test.mjs
node --test tests/ai-scanner-save-flow.test.mjs
```

Untuk rincian kasus uji dan toleransi akurasi, lihat panduan [references/test-matrix.md](./references/test-matrix.md).
