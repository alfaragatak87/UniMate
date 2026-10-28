---
name: unimate-safety
description: >-
  Gunakan skill ini saat agen hendak menganalisis, merencanakan, atau melakukan perubahan kode yang bersinggungan dengan keamanan, kredensial AI, IPC Electron, data akademik mahasiswa, status Git, atau batas perizinan AGENTS.md di UniMate.
---

# UniMate Safety & Policy Guardrails

Skill ini adalah prosedur teknis agen AI untuk menegakkan kebijakan keamanan dan privasi yang didefinisikan pada [AGENTS.md](file:///d:/CODING/PERSONAL/APK/UniMate/AGENTS.md).

> [!IMPORTANT]
> **Batasan Kewenangan**: Skill ini berfungsi sebagai panduan operasional agen dan **BUKAN** pengganti penegakan izin sistem (*permission enforcement*), sandbox sistem operasi, atau pengganti persetujuan eksplisit pengguna. Persetujuan pengguna dan sandbox sistem operasi tetap merupakan otoritas tertinggi.

---

## 1. Perlindungan Status Git & Pekerjaan Pengguna

UniMate sering berada dalam kondisi kerja aktif dengan perubahan pengguna yang belum di-commit (*dirty state*).

1. **Prinsip Kepemilikan Pengguna:**
   * Seluruh perubahan yang belum di-commit adalah milik pengguna dan wajib dilindungi seutuhnya (lihat panduan utama di [AGENTS.md § Perlindungan Git, Kredensial, & Privasi Akademik](file:///d:/CODING/PERSONAL/APK/UniMate/AGENTS.md)).
   * Jalankan `git status` secara *read-only* sebelum memulai pekerjaan untuk memetakan file yang sedang aktif.
2. **Larangan Operasi Destruktif:**
   * DILARANG menjalankan `git reset`, `git clean`, `git restore`, `git checkout --`, `git stash`, atau `git rebase` tanpa instruksi eksplisit pengguna.
   * DILARANG membuat commit, branch, tag, atau melakukan `git push` tanpa permintaan khusus.
3. **Persetujuan Berbasis Scope & Hak Koreksi:**
   * Pengeditan berkas terikat pada ruang lingkup tahap kerja yang telah disetujui pengguna.
   * Agen berwenang memperbaiki masalah minor yang diakibatkan oleh kodenya sendiri pada file dan scope yang sama tanpa perlu izin baris per baris. Masalah baru di luar scope wajib dilaporkan terpisah.

---

## 2. Isolasi Kredensial & Kunci API

UniMate mendukung integrasi model AI lokal dan cloud eksternal melalui gateway terisolasi ([gateway/createGateway.mjs](file:///d:/CODING/PERSONAL/APK/UniMate/gateway/createGateway.mjs)).

1. **Pencegahan Kebocoran Rahasia:**
   * DILARANG menampilkan, mencatat, atau menyalin nilai API key, token, kredensial privat, atau isi berkas `.env` ke dalam percakapan, log, maupun artefak diff.
   * Jika membaca konfigurasi kredensial terenkripsi, tampilkan hanya nama variabel atau bentuk data yang telah disamarkan (*masked*).
2. **Kewajiban Fixture Sintetis dalam Pengujian:**
   * Gunakan konstanta sintetis dari [tests/fixtures/credentialFixtures.mjs](file:///d:/CODING/PERSONAL/APK/UniMate/tests/fixtures/credentialFixtures.mjs):
     * `SYNTHETIC_OPENAI_CREDENTIAL`
     * `SYNTHETIC_OPENAI_REPLACEMENT`
3. **Penyimpanan Kredensial Desktop:**
   * Pada Electron, kredensial disimpan terenkripsi via [electron/credentials/safeStorageAdapter.cjs](file:///d:/CODING/PERSONAL/APK/UniMate/electron/credentials/safeStorageAdapter.cjs).
   * Berkas `ai-credentials*.enc.json` dilarang keras dimasukkan ke dalam paket distribusi aplikasi (`app.asar`).

---

## 3. Perlindungan Data Akademik Mahasiswa

Data akademik (identitas mahasiswa, NIM, KHS, nilai, transkrip, jadwal kuliah, dan progres skripsi) diklasifikasikan sebagai data pribadi sensitif.

1. **Isolasi Jaringan & Tanpa Telemetri:**
   * DILARANG mengirimkan data akademik mahasiswa ke cloud publik atau layanan pihak ketiga tanpa persetujuan eksplisit per dokumen dari pengguna.
   * DILARANG menambahkan analitik eksternal, tracking, atau telemetri baru ke dalam kode sumber.
2. **Pengujian Menggunakan Lingkungan Terisolasi:**
   * Selalu gunakan data sintetis untuk pengujian fungsi backup, scanner, dan visualisasi:
     * [tests/fixtures/aiFixtures.mjs](file:///d:/CODING/PERSONAL/APK/UniMate/tests/fixtures/aiFixtures.mjs)
     * `SYNTHETIC_DATA` pada [tests/academic-backup.test.mjs](file:///d:/CODING/PERSONAL/APK/UniMate/tests/academic-backup.test.mjs)
   * DILARANG menguji langsung pada direktori data profil asli pengguna.

---

## 4. Keamanan Arsitektur Electron & Web

1. **Context Isolation & Preload Bridge:**
   * Arsitektur Electron wajib mempertahankan `contextIsolation: true` dan `nodeIntegration: false`.
   * Renderer process hanya boleh berkomunikasi dengan main process melalui bridge yang terdaftar di [electron/preload.cjs](file:///d:/CODING/PERSONAL/APK/UniMate/electron/preload.cjs).
2. **Validasi Pengirim IPC:**
   * Setiap handler IPC wajib memverifikasi asal pengirim menggunakan kebijakan keamanan pengirim di [electron/security/ipcSenderPolicy.cjs](file:///d:/CODING/PERSONAL/APK/UniMate/electron/security/ipcSenderPolicy.cjs).
3. **Fallback Aman Web/PWA:**
   * Kode antarmuka tidak boleh berasumsi bahwa `window.electronAPI` selalu tersedia. Wajib menyediakan fallback aman untuk browser/PWA.

---

## 5. Prosedur Verifikasi Keamanan

Jalankan perintah pengujian keamanan terfokus berikut:

```bash
# Validasi keamanan IPC dan kebijakan jendela
node --test tests/window-security-policy.test.mjs
node --test tests/gateway-security.test.mjs

# Validasi keamanan dokumen KHS dan backup
node --test tests/khs-document-security.test.mjs
node --test tests/ai-document-security.test.mjs
```

---

## 6. Tindakan Saat Terjadi Kegagalan

1. Hentikan pekerjaan seketika jika terjadi potensi pelanggaran isolasi data atau pengujian keamanan gagal.
2. Dilarang melakukan rollback otomatis yang berisiko merusak berkas pengguna.
3. Laporkan kegagalan secara transparan: perintah yang dijalankan, gejala, akar masalah, berkas terdampak, dan opsi penanganan untuk disetujui pengguna.
