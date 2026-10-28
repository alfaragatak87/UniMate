/**
 * thesisDocumentReader.js — Pembaca & Parser Dokumen Skripsi Offline UniMate (B7A)
 *
 * Kebijakan & Prinsip:
 * 1. 100% Offline & Pure Functions: tanpa request jaringan atau AI eksternal.
 * 2. Integritas Teks: Membaca fullText utuh tanpa batasan preview 20.000 karakter.
 * 3. Hirarki Teks: editedText diutamakan jika ada. editedText === "" diperlakukan
 *    sebagai teks kosong yang disengaja oleh pengguna (tidak fallback ke rawText).
 *    rawText hanya digunakan jika editedText === null atau undefined.
 * 4. Anti-Halusinasi: Dilarang mengarang judul bab, kutipan ilmiah, kesimpulan, atau pustaka.
 * 5. Deteksi Bab & Sub-bab: Mendeteksi pola BAB I-V, 1-5, subbab numerik (1.1, 1.2),
 *    serta bagian khusus (Abstrak, Kata Pengantar, Daftar Pustaka).
 * 6. Pencarian Teks Akurat: Menghitung offset indeks, nomor baris, dan cuplikan konteks.
 */

// Pola Penomoran Romawi dan Angka Bab Skripsi
const ROMAN_NUMERALS = 'I|II|III|IV|V|VI|VII|VIII|IX|X';
const BAB_HEADER_REGEX = new RegExp(
  `^(?:BAB\\s+(${ROMAN_NUMERALS}|\\d+)|(KATA PENGANTAR|UCAPAN TERIMA KASIH|ABSTRAK|ABSTRACT|DAFTAR ISI|DAFTAR TABEL|DAFTAR GAMBAR|DAFTAR LAMPIRAN|DAFTAR PUSTAKA|LAMPIRAN))(?:[\\s:.-]+([^\r\n]*))?$`,
  'i'
);

const SUBBAB_NUMERIC_REGEX = /^(\d+\.\d+)(?:[.\s]+([^\r\n]*))?$/;
const SUBSUBBAB_NUMERIC_REGEX = /^(\d+\.\d+\.\d+)(?:[.\s]+([^\r\n]*))?$/;

/**
 * Menyelesaikan teks dokumen skripsi sesuai prioritas integritas B7A:
 * - editedText diprioritaskan bila ada.
 * - editedText === "" dihormati sebagai teks kosong yang disengaja.
 * - rawText hanya dipakai jika editedText === null || editedText === undefined.
 */
export function resolveThesisDocumentText(source) {
  if (source === null || source === undefined) {
    return {
      text: '',
      rawText: '',
      editedText: null,
      charCount: 0,
      isEdited: false,
    };
  }

  // Jika input berupa string langsung
  if (typeof source === 'string') {
    return {
      text: source,
      rawText: source,
      editedText: null,
      charCount: source.length,
      isEdited: false,
    };
  }

  const rawText = typeof source.rawText === 'string' ? source.rawText : '';
  const editedText = source.editedText !== undefined ? source.editedText : null;

  let resolvedText = '';
  let isEdited = false;

  if (editedText !== null && editedText !== undefined) {
    // editedText ada (termasuk string kosong "")
    resolvedText = String(editedText);
    isEdited = true;
  } else {
    // rawText digunakan karena editedText null
    resolvedText = rawText;
    isEdited = false;
  }

  return {
    text: resolvedText,
    rawText,
    editedText,
    charCount: resolvedText.length,
    isEdited,
  };
}

/**
 * Membersihkan spasi berlebih pada judul heading
 */
function cleanHeadingTitle(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Mendeteksi struktur BAB, sub-bab, dan bagian dokumen skripsi dari fullText.
 * Berjalan secara deterministik tanpa membuat data palsu.
 */
export function parseThesisStructure(fullText) {
  const safeText = typeof fullText === 'string' ? fullText : '';

  if (!safeText.trim()) {
    return {
      hasStructure: false,
      sections: [
        {
          id: 'sec_empty',
          level: 0,
          number: '',
          title: 'Dokumen Kosong',
          cleanTitle: 'Dokumen Kosong',
          startIndex: 0,
          endIndex: 0,
          lineStart: 1,
          lineEnd: 1,
          charCount: 0,
          content: '',
        },
      ],
      tableOfContents: [],
      totalSections: 0,
    };
  }

  const lines = safeText.split(/\r?\n/);
  const headingsFound = [];
  let currentOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmedLine = rawLine.trim();
    const lineLengthWithNewline = rawLine.length + 1; // estimasi baris + \n

    if (trimmedLine.length > 0) {
      // 1. Cek BAB atau Bagian Utama (Level 1)
      const babMatch = trimmedLine.match(BAB_HEADER_REGEX);
      if (babMatch) {
        const babNum = babMatch[1] ? babMatch[1].toUpperCase() : '';
        const specialName = babMatch[2] ? babMatch[2].toUpperCase() : '';
        const titleSuffix = babMatch[3] ? cleanHeadingTitle(babMatch[3]) : '';

        let displayTitle = '';
        let numberTag = '';

        if (babNum) {
          numberTag = `BAB ${babNum}`;
          displayTitle = titleSuffix ? `${numberTag} ${titleSuffix}` : numberTag;
        } else if (specialName) {
          numberTag = specialName;
          displayTitle = titleSuffix ? `${specialName} ${titleSuffix}` : specialName;
        }

        headingsFound.push({
          lineIndex,
          lineNumber: lineIndex + 1,
          startIndex: currentOffset,
          level: 1,
          number: numberTag,
          title: displayTitle,
          cleanTitle: titleSuffix || displayTitle,
        });
      } else {
        // 2. Cek Sub-sub-bab numerik (Level 3: misal 1.1.1)
        const subSubMatch = trimmedLine.match(SUBSUBBAB_NUMERIC_REGEX);
        if (subSubMatch) {
          const num = subSubMatch[1];
          const title = subSubMatch[2] ? cleanHeadingTitle(subSubMatch[2]) : '';
          headingsFound.push({
            lineIndex,
            lineNumber: lineIndex + 1,
            startIndex: currentOffset,
            level: 3,
            number: num,
            title: title ? `${num} ${title}` : num,
            cleanTitle: title || num,
          });
        } else {
          // 3. Cek Sub-bab numerik (Level 2: misal 1.1)
          const subMatch = trimmedLine.match(SUBBAB_NUMERIC_REGEX);
          if (subMatch) {
            const num = subMatch[1];
            const title = subMatch[2] ? cleanHeadingTitle(subMatch[2]) : '';
            headingsFound.push({
              lineIndex,
              lineNumber: lineIndex + 1,
              startIndex: currentOffset,
              level: 2,
              number: num,
              title: title ? `${num} ${title}` : num,
              cleanTitle: title || num,
            });
          }
        }
      }
    }

    currentOffset += lineLengthWithNewline;
  }

  // Jika tidak ditemukan pola heading sama sekali (OCR tidak berstruktur)
  if (headingsFound.length === 0) {
    return {
      hasStructure: false,
      sections: [
        {
          id: 'sec_full',
          level: 1,
          number: '',
          title: 'Teks Lengkap Dokumen',
          cleanTitle: 'Teks Lengkap Dokumen',
          startIndex: 0,
          endIndex: safeText.length,
          lineStart: 1,
          lineEnd: lines.length,
          charCount: safeText.length,
          content: safeText,
        },
      ],
      tableOfContents: [
        {
          id: 'sec_full',
          level: 1,
          number: '',
          title: 'Teks Lengkap Dokumen',
          cleanTitle: 'Teks Lengkap Dokumen',
          startIndex: 0,
          lineNumber: 1,
        },
      ],
      totalSections: 1,
    };
  }

  // Bangun seksi-seksi berdasarkan heading yang ditemukan
  const sections = [];

  // Jika ada teks pengantar sebelum heading pertama
  if (headingsFound[0].startIndex > 0) {
    const preambleText = safeText.slice(0, headingsFound[0].startIndex);
    if (preambleText.trim().length > 0) {
      sections.push({
        id: 'sec_preamble',
        level: 0,
        number: '',
        title: 'Bagian Awal / Sampul',
        cleanTitle: 'Bagian Awal / Sampul',
        startIndex: 0,
        endIndex: headingsFound[0].startIndex,
        lineStart: 1,
        lineEnd: headingsFound[0].lineNumber - 1,
        charCount: headingsFound[0].startIndex,
        content: preambleText,
      });
    }
  }

  for (let i = 0; i < headingsFound.length; i += 1) {
    const h = headingsFound[i];
    const nextHeading = headingsFound[i + 1];
    const endIndex = nextHeading ? nextHeading.startIndex : safeText.length;
    const lineEnd = nextHeading ? nextHeading.lineNumber - 1 : lines.length;
    const content = safeText.slice(h.startIndex, endIndex);

    sections.push({
      id: `sec_${i}_${h.level}_${h.number.replace(/\s+/g, '_')}`,
      level: h.level,
      number: h.number,
      title: h.title,
      cleanTitle: h.cleanTitle,
      startIndex: h.startIndex,
      endIndex,
      lineStart: h.lineNumber,
      lineEnd,
      charCount: content.length,
      content,
    });
  }

  const tableOfContents = sections.map(s => ({
    id: s.id,
    level: s.level,
    number: s.number,
    title: s.title,
    cleanTitle: s.cleanTitle,
    startIndex: s.startIndex,
    lineNumber: s.lineStart,
  }));

  return {
    hasStructure: true,
    sections,
    tableOfContents,
    totalSections: sections.length,
  };
}

/**
 * Escape karakter spesial regex
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mencari kata atau frasa dalam fullText skripsi secara menyeluruh.
 * Mengembalikan posisi, nomor baris, potongan konteks, dan seksi terkait.
 */
export function searchThesisText(fullText, query, options = {}) {
  const safeText = typeof fullText === 'string' ? fullText : '';
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';

  if (!trimmedQuery) {
    return {
      query: '',
      totalMatches: 0,
      matches: [],
    };
  }

  const maxMatches = Number.isSafeInteger(options.maxMatches) && options.maxMatches > 0
    ? options.maxMatches
    : 1000;
  const contextSnippetLength = Number.isSafeInteger(options.snippetLength) && options.snippetLength > 0
    ? options.snippetLength
    : 45;

  const sections = Array.isArray(options.sections) ? options.sections : [];
  const regex = new RegExp(escapeRegex(trimmedQuery), 'gi');

  const matches = [];
  let match;

  while ((match = regex.exec(safeText)) !== null) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    // Hitung nomor baris (1-indexed)
    const textBefore = safeText.slice(0, startIndex);
    const lineBreaks = textBefore.match(/\r?\n/g);
    const lineNumber = (lineBreaks ? lineBreaks.length : 0) + 1;

    // Cuplikan teks sebelum dan sesudah
    const snippetStart = Math.max(0, startIndex - contextSnippetLength);
    const snippetEnd = Math.min(safeText.length, endIndex + contextSnippetLength);

    const beforeSnippet = safeText.slice(snippetStart, startIndex);
    const matchedText = safeText.slice(startIndex, endIndex);
    const afterSnippet = safeText.slice(endIndex, snippetEnd);

    // Temukan seksi terkait jika ada
    let associatedSection = null;
    if (sections.length > 0) {
      for (let sIdx = sections.length - 1; sIdx >= 0; sIdx -= 1) {
        if (startIndex >= sections[sIdx].startIndex) {
          associatedSection = {
            id: sections[sIdx].id,
            title: sections[sIdx].title,
            number: sections[sIdx].number,
          };
          break;
        }
      }
    }

    matches.push({
      matchIndex: matches.length,
      matchNumber: matches.length + 1,
      startIndex,
      endIndex,
      lineNumber,
      beforeSnippet,
      matchedText,
      afterSnippet,
      section: associatedSection,
    });

    if (matches.length >= maxMatches) break;
  }

  return {
    query: trimmedQuery,
    totalMatches: matches.length,
    matches,
  };
}

/**
 * Membagi teks panjang menjadi potongan-potongan aman untuk virtualisasi render
 */
export function chunkTextForVirtualization(text, chunkSize = 5000) {
  const safeText = typeof text === 'string' ? text : '';
  if (!safeText) return [];

  const size = Math.max(500, chunkSize);
  const chunks = [];
  let currentStart = 0;

  while (currentStart < safeText.length) {
    const nextEnd = Math.min(safeText.length, currentStart + size);
    chunks.push({
      chunkIndex: chunks.length,
      startIndex: currentStart,
      endIndex: nextEnd,
      content: safeText.slice(currentStart, nextEnd),
    });
    currentStart = nextEnd;
  }

  return chunks;
}

/**
 * Menghasilkan identitas kanonikal persisten untuk dokumen skripsi serta
 * daftar alias backward-compatible guna mencegah putusnya relasi catatan legacy.
 */
export function createStableDocumentIdentity({
  courseId = '',
  semesterId = '',
  file = {},
  fileIndex = 0,
  allowPositionalFallback = false,
} = {}) {
  const persistentKey = file?.binaryRef?.id || file?.id || null;
  const safeName = String(file?.name || 'dokumen').trim();
  const safeCourse = String(courseId || semesterId || 'c').trim();

  // ID Kanonikal: diutamakan dari ID biner/file unik persisten yang tidak terpengaruh urutan atau rename
  const canonicalId = persistentKey
    ? `doc_file_${persistentKey}`
    : `doc_vault_${safeCourse}_${safeName}`;

  const aliases = new Set([canonicalId]);

  if (persistentKey) {
    // Alias persisten berbasis ID fisik biner (kebal terhadap nama, posisi, dan rename)
    aliases.add(`doc_ref_${persistentKey}`);
    aliases.add(`doc_vault_${safeCourse}_${persistentKey}`);

    // Jika berkas secara spesifik memiliki relasi historis yang tercatat
    if (file?.legacyDocumentId && typeof file.legacyDocumentId === 'string') {
      aliases.add(file.legacyDocumentId.trim());
    }

    // Hanya masukkan alias posisional jika diizinkan secara eksplisit (misal untuk pengujian backward-compatibility)
    // Berkas baru dengan ID persisten mandiri TIDAK mewarisi alias posisional demi mencegah collision
    if (allowPositionalFallback === true || file?.allowPositionalFallback === true) {
      aliases.add(`doc_vault_${safeCourse}_${fileIndex}_${safeName}`);
      aliases.add(`doc_vault_${safeCourse}_${safeName}`);
    }
  } else {
    // Berkas legacy murni (tanpa binaryRef maupun ID fisik)
    aliases.add(`doc_vault_${safeCourse}_${fileIndex}_${safeName}`);
    aliases.add(`doc_vault_${safeCourse}_${safeName}`);
  }

  return {
    canonicalId,
    aliases: Array.from(aliases).filter(Boolean),
    isPersistent: Boolean(persistentKey),
  };
}
