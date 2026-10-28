# Kontrak Penyimpanan & Skema Data UniMate

Dokumen ini adalah referensi teknis struktur penyimpanan data untuk melengkapi [SKILL.md](../SKILL.md).

---

## 1. Kunci Utama Penyimpanan Lokal (`localStorage`)

UniMate mengelola data akademik relasional ringan di dalam browser `localStorage` melalui skema validasi 21 kunci (`STORAGE_SCHEMA` pada [src/services/academicBackup.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/academicBackup.js#L5-L28)):

| Kunci Penyimpanan | Tipe Data | Deskripsi & Batasan |
| :--- | :--- | :--- |
| `profile_name` | String | Nama panggilan mahasiswa. |
| `profile_fullname` | String | Nama lengkap resmi mahasiswa. |
| `profile_picture` | String | Avatar atau foto profil (Base64 ringan atau URL lokal). |
| `profile_nim` | String | Nomor Induk Mahasiswa (identifikasi akademik). |
| `profile_instansi` | String | Nama perguruan tinggi / universitas. |
| `profile_instansi_nickname` | String | Singkatan instansi (misal: ITB, UI, UGM). |
| `profile_jurusan` | String | Program studi atau jurusan mahasiswa. |
| `profile_jenjang` | String | Jenjang studi (D3, S1, S2, Profesi). |
| `profile_semester` | Number | Semester aktif saat ini (1 - 14). |
| `profile_academic_phase` | String | Fase semester aktif (`krs`, `kuliah`, `uts`, `uas`, `libur`). |
| `profile_academic_phase_auto` | Boolean | Otomatisasi penentuan fase akademik berbasis tanggal. |
| `profile_next_date` | String | Tanggal agenda akademik berikutnya (ISO date string). |
| `profile_academic_calendar` | Object | Jadwal tanggal penting kalender akademik (`krs`, `uts`, `uas`, `libur`). |
| `college_semesters` | Array<Object> | Daftar semester, memuat dokumen KHS (`originalFile`, `documents`), daftar mata kuliah (`courses` beserta SKS, nilai huruf, hari, jam, ruang, dan berkas silabus Course Vault). |
| `college_tasks` | Array<Object> | Daftar tugas kuliah, prioritas, deadline, dan status penyelesaian. |
| `college_projects` | Array<Object> | Proyek akademik, milestone, dan deliverable mahasiswa. |
| `college_thesis` | Object | Status kanban tugas akhir / skripsi (`todo`, `inProgress`, `review`, `done`). |
| `sidebar_collapsed` | Boolean | Preferensi tampilan bilah sisi antarmuka. |
| `dark_mode` | Boolean | Preferensi mode gelap antarmuka. |
| `prompted_docs_phase` | String | Penanda riwayat prompt dokumen akademik. |
| `github_username` | String | Tautan akun GitHub mahasiswa untuk repositori proyek. |
| `holiday_mode` | Boolean | Mode jeda libur semester untuk mematikan notifikasi tugas. |

> [!NOTE]
> Jadwal perkuliahan mingguan (*timetable*) tidak disimpan pada kunci terpisah, melainkan terintegrasi langsung di dalam array `courses` pada masing-masing entitas semester di `college_semesters` (memuat atribut `day`, `timeStart`, `timeEnd`, dan `room`).

---

## 2. Struktur Penyimpanan Berkas Biner & Teks OCR (`IndexedDB`)

Untuk dokumen berukuran besar (PDF, gambar KHS, file materi Course Vault, dan teks hasil ekstraksi OCR), UniMate menggunakan IndexedDB melalui [src/services/binaryFileStore.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/binaryFileStore.js):

* **Database Name**: `unimate-binary-vault`
* **Database Version**: `2`
* **Object Stores**:
  1. `files`: Menyimpan berkas biner asli (PDF, gambar, berkas arsip).
     * `keyPath`: `id` (UUID v4)
     * Struktur Record: `{ id, name, mimeType, size, lastModified, createdAt, blob }`
     * Diacu oleh pointer biner `binaryRef`:
       ```json
       {
         "kind": "binary_file_ref",
         "version": 1,
         "id": "uuid-v4",
         "name": "khs_semester_3.pdf",
         "mimeType": "application/pdf",
         "size": 245120,
         "lastModified": 1700000000000
       }
       ```
  2. `document_texts`: Menyimpan teks hasil ekstraksi dan koreksi OCR.
     * `keyPath`: `id` (UUID v4)
     * Index: `by_binary_id` pada field `binaryId` (non-unique)
     * Struktur Record: `{ id, binaryId, documentType, rawText, editedText, charCount, pageCount, confidence, createdAt, updatedAt }`
     * Diacu oleh pointer teks `textRef`:
       ```json
       {
         "kind": "document_text_ref",
         "version": 1,
         "id": "uuid-v4",
         "binaryId": "uuid-v4",
         "charCount": 52140,
         "hasEditedText": true,
         "updatedAt": 1800000000000
       }
       ```

### Kaidah Immutability & Pemisahan Koreksi:
* `rawText`: Teks mesin permanen hasil ekstraksi offline yang tidak boleh dimutasi.
* `editedText`: Menyimpan koreksi pengguna. Nilai `null` menandakan dokumen belum pernah diedit, sedangkan string kosong `""` menandakan pengguna sengaja mengosongkan teks.
* **Copy-on-Write Fork**: Jika dua berkas di Course Vault berbagi `textRef` yang sama (misal hasil duplikasi dokumen), pengeditan teks akan memicu pembuatan ID teks baru (`forkEditedText`) tanpa mengubah dokumen pasangannya.

---

## 3. Format Cadangan Akademik (`.unimate` / `.json`)

UniMate menyediakan dua format cadangan melalui [src/services/academicBackup.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/academicBackup.js) dan [src/services/portableAcademicBackup.js](file:///d:/CODING/PERSONAL/APK/UniMate/src/services/portableAcademicBackup.js):

### A. Format 1: Ekspor Metadata Sederhana (`unimate-academic-backup`)
* `format`: `"unimate-academic-backup"`
* `version`: `1`
* `maxBytes`: 16 MiB
* Memuat salinan tervalidasi dari 21 kunci `localStorage`. Tidak menyertakan blob berkas biner maupun teks OCR penuh.

### B. Format 2: Ekspor Portabel Lengkap (`unimate-portable-academic-backup`)
* `format`: `"unimate-portable-academic-backup"`
* `version`: `1`
* `maxBytes`: 64 MiB (maksimal 36 MiB biner, 25 MiB teks, dan maksimal 250 berkas)
* Struktur JSON:
  ```json
  {
    "format": "unimate-portable-academic-backup",
    "version": 1,
    "exportedAt": "2026-10-25T14:00:00.000Z",
    "academic": {
      "format": "unimate-academic-backup",
      "version": 1,
      "exportedAt": "2026-10-25T14:00:00.000Z",
      "data": { ... }
    },
    "binaries": [
      {
        "reference": { "kind": "binary_file_ref", "version": 1, "id": "...", ... },
        "encoding": "base64",
        "sha256": "checksum-hex-64-char",
        "data": "Base64PayloadString..."
      }
    ],
    "texts": [
      {
        "reference": { "kind": "document_text_ref", "version": 1, "id": "...", ... },
        "sha256": "checksum-hex-64-char-raw-text",
        "rawText": "Teks mentah...",
        "editedText": "Koreksi pengguna atau null",
        "documentType": "KHS",
        "pageCount": 3,
        "confidence": 98.4
      }
    ]
  }
  ```

---

## 4. Keamanan & Prosedur Validasi Restore

1. **Integritas vs Enkripsi:**
   * Pemeriksaan SHA-256 pada `binaries` dan `texts` adalah validasi integritas data (*tamper-detection*), **BUKAN enkripsi**. Berkas cadangan adalah plaintext JSON yang wajib dijaga kerahasiaannya oleh pengguna.
2. **Keterbatasan Checksum Teks Saat Ini:**
   * Checksum `sha256` pada entri `texts` saat ini dihitung dari byte `rawText`. Mutasi pada `editedText` tidak terdeteksi oleh checksum tersebut dan wajib diperiksa secara struktural pada fase validasi.
3. **Status Fitur Restore:**
   * Fitur *Restore* di antarmuka produksi **TETAP DINONAKTIFKAN** (`restoreEnabled: false`) hingga seluruh mesin deteksi konflik, validasi restore plan, dan mekanisme recovery disetujui secara bertahap pada Tahap B5B-4b.
