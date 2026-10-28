# Audit Eksklusi Berkas & Sanitasi Paket Electron

Dokumen ini adalah referensi teknis audit packaging untuk melengkapi [SKILL.md](../SKILL.md).

---

## 1. Matriks Inklusi vs Eksklusi Berkas Rilis

Berdasarkan konfigurasi `build.files` pada [package.json](file:///d:/CODING/PERSONAL/APK/UniMate/package.json#L24-L33):

| Pola Berkas | Status Distribusi | Alasan & Catatan Keamanan |
| :--- | :--- | :--- |
| `dist/**/*` | **Diikutsertakan** | Kompilasi antarmuka frontend React + Vite. |
| `electron/**/*` | **Diikutsertakan** | Skrip main process, modul security, dan bridge IPC. |
| `gateway/**/*` | **Diikutsertakan** | Gateway perantara AI lokal. |
| `shared/ai/**/*` | **Diikutsertakan** | Kontrak schema dan katalog model bersama. |
| `shared/credentials/**/*` | **Diikutsertakan** | Kontrak validasi kredensial (tanpa isi kredensial). |
| `package.json` | **Diikutsertakan** | Metadata aplikasi (name, version, main script). |
| `**/credentials/ai-credentials*.enc.json` | 🚫 **DIKECUALIKAN** | File rahasia terenkripsi lokal pengguna. Dilarang masuk paket. |
| `**/credentials/.*.tmp` | 🚫 **DIKECUALIKAN** | Berkas sementara penulisan atomik. |
| `.env*` | 🚫 **DIKECUALIKAN** | Variabel lingkungan lokal pengembang. |
| `tests/**/*` | 🚫 **DIKECUALIKAN** | Berkas pengujian dan fixtures tidak diperlukan saat runtime. |
| `.git/**/*` | 🚫 **DIKECUALIKAN** | Riwayat git dan metadata repositori. |
| `release/**/*` | 🚫 **DIKECUALIKAN** | Output installer sebelumnya. |

---

## 2. Cara Kerja Audit Otomatis Sanitasi Asar

Uji integritas packaging pada [tests/electron-credential-packaging.test.mjs](file:///d:/CODING/PERSONAL/APK/UniMate/tests/electron-credential-packaging.test.mjs) bekerja dengan tahapan:

1. **Pembuatan Lingkungan Uji Terisolasi**:
   * Membuat salinan minimal berkas aplikasi ke folder sementara.
   * Menyuntikkan kredensial rahasia sintetis ke dalam struktur direktori pengujian.
2. **Eksekusi Builder Mocking / Packing**:
   * Menjalankan proses pengemasan asar menggunakan library `@electron/asar`.
3. **Pemeriksaan Konten Asar**:
   * Membaca seluruh daftar berkas (*file listing*) di dalam arsip `app.asar`.
   * Memastikan tidak ada berkas dengan nama `ai-credentials*.enc.json` yang terdaftar.
4. **Pencarian String Biner (Hex Search)**:
   * Melakukan pemindaian terhadap seluruh konten byte biner arsip asar untuk mendeteksi apakah potongan token sintetis bocor ke dalam berkas apa pun di dalam paket.
   * Asersi berhasil jika token sama sekali tidak ditemukan (`assert.strictEqual(foundInAsar, false)`).

---

## 3. Checklist Kesiapan Sebelum Meminta Izin Rilis

Sebelum mengusulkan eksekusi `electron-builder` kepada pengguna, pastikan:

* [ ] Seluruh 390 pengujian baseline tetap berstatus **PASS**.
* [ ] Uji eksklusi paket `node --test tests/electron-credential-packaging.test.mjs` berstatus **PASS**.
* [ ] Kompilasi preload `npm run build:preload` berjalan tanpa peringatan sintaksis.
* [ ] Kompilasi frontend `npx vite build` selesai dengan aset path relatif.
* [ ] Periksa kembali bahwa tidak ada berkas `.enc.json` atau token pengembang di folder `electron/credentials/`.
