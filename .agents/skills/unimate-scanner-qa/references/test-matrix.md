# Matriks Kasus Uji Scanner Dokumen Offline

Dokumen ini adalah referensi pengujian terperinci untuk melengkapi [SKILL.md](../SKILL.md).

---

## 1. Matriks Skenario & Perilaku yang Diharapkan

| ID Kasus | Jenis Dokumen | Karakteristik Masukan | Jalur Eksekusi | Hasil yang Diharapkan |
| :--- | :--- | :--- | :--- | :--- |
| **TC-SCAN-01** | PDF Teks Asli | PDF digital ekspor sistem kampus (teks $\ge 10$ char/halaman). | PDF.js `getTextContent()` murni. | Teks diekstrak < 500ms; Worker OCR Tesseract **tidak dipanggil**. |
| **TC-SCAN-02** | PDF Scan Kertas | Dokumen hasil fotokopi/scan KHS (halaman berupa raster canvas). | PDF.js render ke canvas $\rightarrow$ Tesseract worker lokal. | Teks mentah terbaca; preview teks dibatasi `20_000` karakter; teks lengkap (`fullText`) utuh tersimpan di `document_texts` dan berkas biner di `files`. |
| **TC-SCAN-03** | Gambar Foto KHS | Foto kamera HP (`.png`, `.jpg`, `.webp`) miring atau berpencahayaan rendah. | Pipeline pra-pemrosesan gambar $\rightarrow$ OCR Tesseract bilingual (`ind+eng`). | Teks mentah diekstrak; peringatan kualitas jika resolusi terlalu rendah; teks lengkap tersimpan di `document_texts`. |
| **TC-SCAN-04** | PDF Terenkripsi | Dokumen dilindungi password (*user password* aktif). | PDF.js melempar galat keamanan password. | Ditangkap sebagai galat aman (`password_required` / `pdf_invalid`); tidak terjadi unhandled rejection; UI tetap interaktif. |
| **TC-SCAN-05** | Berkas Korup / Kosong | File 0-byte atau file biner yang bukan format PDF valid. | Pemeriksaan header awal (*magic bytes*). | Galat `pdf_invalid`; proses dihentikan seketika tanpa memakan memori. |
| **TC-SCAN-06** | Pembatalan Pengguna | Pengguna menekan tombol "Batal" saat OCR halaman berlangsung. | Sinyal `AbortSignal.abort()` dipicu. | Worker Tesseract segera dihentikan; kanvas dilepaskan; status kembali netral (`request_cancelled`). |
| **TC-SCAN-07** | PDF Hybrid | Halaman campuran (halaman 1 teks digital, halaman 2 scan gambar). | Pipeline hybrid: ekstraksi teks langsung untuk halaman digital + Tesseract OCR untuk halaman gambar. | Kedua teks digabungkan utuh ke `fullText` tanpa pemotongan antar halaman. |
| **TC-SCAN-08** | Editor Teks OCR | Pengguna mengedit hasil ekstraksi sebelum menyimpan di AI Scanner. | Tab Editor OCR di modal konfirmasi. | Perubahan terdeteksi (*dirty state*), chip status berubah, fitur undo/redo aktif, dan hasil disimpan ke `editedText` tanpa memutasi `rawText`. |
| **TC-SCAN-09** | Course Vault Viewer | Pengguna membuka arsip berkas di Course Vault. | Tab Teks OCR di pratinjau Course Vault. | Teks terbaca langsung dari IndexedDB tanpa scan ulang; pencarian kata real-time menyorot teks (`<mark>`); koreksi in-place didukung dengan *Copy-on-Write fork*. |

---

## 2. Verifikasi Isolasi Jaringan (Zero Network Leakage)

Untuk memastikan dokumen mahasiswa tidak bocor ke internet saat proses pemindaian:

1. **Pemeriksaan Content Security Policy (CSP)**:
   * Periksa [vite.config.js](file:///d:/CODING/PERSONAL/APK/UniMate/vite.config.js#L6-L34) untuk memastikan worker dan script hanya memuat aset dari `self` dan `blob:`.
2. **Pemeriksaan Mock Provider Jaringan**:
   * Jalankan uji transport dan keamanan:
     ```bash
     node --test tests/provider-http-transport.test.mjs
     node --test tests/web-pwa-security.test.mjs
     ```
3. **Verifikasi Jalur Aset Lokal**:
   * Pastikan berkas wasm dan model bahasa Tesseract dimuat dari direktori lokal:
     * `public/offline-scanner/tesseract/tesseract-core.wasm.js`
     * `public/offline-scanner/tesseract/tesseract.min.js`
     * `public/offline-scanner/tesseract/lang-data/ind.traineddata.gz`
     * `public/offline-scanner/tesseract/lang-data/eng.traineddata.gz`

---

## 3. Pembedaan Teks Mentah vs Data Akademik Terstruktur

Saat menguji alur review dan simpan ([src/services/aiScannerReview.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/aiScannerReview.js), [src/services/aiScannerMerge.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/aiScannerMerge.js)):

* Teks mentah OCR sering kali mengandung artefak pembacaan (misal huruf `O` terbaca `0`, pemisah tabel tergeser).
* Validasi skema harus memastikan bahwa mata kuliah hanya ditambahkan jika memiliki atribut minimum:
  * Nama Mata Kuliah (string, minimal 3 karakter)
  * Jumlah SKS (integer, 1 - 6)
  * Nilai / Huruf Mutu (`A`, `B`, `C`, `D`, `E` atau format skala yang diakui)
* Jika ekstraksi tidak memenuhi skema, antarmuka wajib menampilkan mode peninjauan manual (*review modal*) dan dilarang menulis langsung ke database semester.
