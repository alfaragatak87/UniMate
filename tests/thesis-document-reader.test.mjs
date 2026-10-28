import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveThesisDocumentText,
  parseThesisStructure,
  searchThesisText,
  chunkTextForVirtualization,
} from '../src/services/thesisDocumentReader.js';

test('B7A.1: resolveThesisDocumentText memprioritaskan editedText di atas rawText', () => {
  const source = {
    rawText: 'BAB I PENDAHULUAN\nTeks mentah hasil OCR skripsi.',
    editedText: 'BAB I PENDAHULUAN\nTeks yang telah dikoreksi oleh mahasiswa.',
  };
  const resolved = resolveThesisDocumentText(source);
  assert.equal(resolved.text, source.editedText);
  assert.equal(resolved.isEdited, true);
  assert.equal(resolved.rawText, source.rawText);
  assert.equal(resolved.editedText, source.editedText);
});

test('B7A.2: resolveThesisDocumentText menghormati editedText === "" sebagai teks kosong disengaja', () => {
  const source = {
    rawText: 'BAB I PENDAHULUAN\nTeks mentah panjang skripsi.',
    editedText: '',
  };
  const resolved = resolveThesisDocumentText(source);
  assert.equal(resolved.text, '');
  assert.equal(resolved.isEdited, true);
  assert.equal(resolved.charCount, 0);
  assert.notEqual(resolved.text, source.rawText, 'Dilarang fallback ke rawText jika editedText string kosong');
});

test('B7A.3: resolveThesisDocumentText memakai rawText hanya jika editedText === null atau undefined', () => {
  const sourceWithNull = {
    rawText: 'BAB I PENDAHULUAN\nTeks OCR asli.',
    editedText: null,
  };
  const resolvedNull = resolveThesisDocumentText(sourceWithNull);
  assert.equal(resolvedNull.text, sourceWithNull.rawText);
  assert.equal(resolvedNull.isEdited, false);

  const sourceWithUndef = {
    rawText: 'BAB II TINJAUAN PUSTAKA\nTeks OCR.',
  };
  const resolvedUndef = resolveThesisDocumentText(sourceWithUndef);
  assert.equal(resolvedUndef.text, sourceWithUndef.rawText);
  assert.equal(resolvedUndef.isEdited, false);
});

test('B7A.4: Memproses teks skripsi panjang (> 20.000 karakter) tanpa pemotongan', () => {
  const longParagraph = 'Ini adalah analisis komparasi algoritma machine learning pada data akademik. '.repeat(400); // ~30.000 char
  const fullDocument = `BAB I PENDAHULUAN\n1.1 Latar Belakang\n${longParagraph}\nBAB II TINJAUAN PUSTAKA\n2.1 Teori Dasar\n${longParagraph}`;

  assert.ok(fullDocument.length > 50000, 'Dokumen harus lebih dari 50.000 karakter');

  const resolved = resolveThesisDocumentText({ rawText: fullDocument, editedText: null });
  assert.equal(resolved.charCount, fullDocument.length);
  assert.equal(resolved.text.length, fullDocument.length);

  const structure = parseThesisStructure(resolved.text);
  assert.equal(structure.hasStructure, true);
  assert.ok(structure.sections.length >= 4);
});

test('B7A.5: parseThesisStructure mendeteksi BAB, Sub-bab numerik, dan bagian khusus secara akurat', () => {
  const sampleThesis = [
    'JUDUL SKRIPSI SISTEM INFORMASI',
    'OLEH: MAHASISWA',
    '',
    'ABSTRAK',
    'Penelitian ini membahas mengenai pemantauan progres tugas akhir.',
    '',
    'KATA PENGANTAR',
    'Puji syukur kami panjatkan...',
    '',
    'BAB I PENDAHULUAN',
    '1.1 Latar Belakang Masalah',
    'Latar belakang tugas akhir ini didasari pada kebutuhan...',
    '1.2 Rumusan Masalah',
    'Bagaimana merancang sistem yang reliabel...',
    '',
    'BAB II TINJAUAN PUSTAKA',
    '2.1 Landasan Teori',
    '2.1.1 Definisi Web Storage',
    'Web storage terdiri atas localStorage dan IndexedDB.',
    '',
    'BAB III METODOLOGI PENELITIAN',
    'Metodologi yang digunakan adalah Research and Development.',
    '',
    'DAFTAR PUSTAKA',
    '1. Pressman, R. S. Software Engineering.',
  ].join('\n');

  const structure = parseThesisStructure(sampleThesis);

  assert.equal(structure.hasStructure, true);
  const titles = structure.sections.map(s => s.title);

  assert.ok(titles.some(t => t.includes('ABSTRAK')));
  assert.ok(titles.some(t => t.includes('KATA PENGANTAR')));
  assert.ok(titles.some(t => t.includes('BAB I')));
  assert.ok(titles.some(t => t.includes('1.1')));
  assert.ok(titles.some(t => t.includes('1.2')));
  assert.ok(titles.some(t => t.includes('BAB II')));
  assert.ok(titles.some(t => t.includes('2.1')));
  assert.ok(titles.some(t => t.includes('2.1.1')));
  assert.ok(titles.some(t => t.includes('BAB III')));
  assert.ok(titles.some(t => t.includes('DAFTAR PUSTAKA')));

  // Verifikasi level hirarki
  const bab1 = structure.sections.find(s => s.title.includes('BAB I'));
  assert.equal(bab1.level, 1);

  const sub1 = structure.sections.find(s => s.title.includes('1.1'));
  assert.equal(sub1.level, 2);

  const subsub = structure.sections.find(s => s.title.includes('2.1.1'));
  assert.equal(subsub.level, 3);
});

test('B7A.6: parseThesisStructure menangani dokumen kosong dan OCR berantakan tanpa crash', () => {
  // 1. Teks kosong
  const emptyRes = parseThesisStructure('');
  assert.equal(emptyRes.hasStructure, false);
  assert.equal(emptyRes.sections.length, 1);
  assert.equal(emptyRes.sections[0].title, 'Dokumen Kosong');

  // 2. Whitespace saja
  const wsRes = parseThesisStructure('   \n\t  \n  ');
  assert.equal(wsRes.hasStructure, false);

  // 3. OCR berantakan tanpa heading baku
  const messyOcr = 'paragraf tanpa nomor bab lorem ipsum dolor sit amet teks skripsi yang tercampur aduk';
  const messyRes = parseThesisStructure(messyOcr);
  assert.equal(messyRes.hasStructure, false);
  assert.equal(messyRes.sections.length, 1);
  assert.equal(messyRes.sections[0].title, 'Teks Lengkap Dokumen');
  assert.equal(messyRes.sections[0].content, messyOcr);
});

test('B7A.7: searchThesisText mencari kata dan frasa dengan offset akurat, nomor baris, dan cuplikan konteks', () => {
  const document = [
    'BAB I PENDAHULUAN',
    'Penelitian ini mengevaluasi performa algoritma A.',
    'Algoritma A memiliki kompleksitas waktu yang efisien.',
    'BAB II TINJAUAN PUSTAKA',
    'Banyak studi terdahulu yang membandingkan Algoritma A dengan Algoritma B.',
  ].join('\n');

  const structure = parseThesisStructure(document);
  const searchResult = searchThesisText(document, 'Algoritma A', {
    sections: structure.sections,
    snippetLength: 20,
  });

  assert.equal(searchResult.totalMatches, 3);
  assert.equal(searchResult.matches[0].matchNumber, 1);
  assert.equal(searchResult.matches[0].lineNumber, 2);
  assert.equal(searchResult.matches[0].section?.title.includes('BAB I'), true);

  assert.equal(searchResult.matches[1].matchNumber, 2);
  assert.equal(searchResult.matches[1].lineNumber, 3);

  assert.equal(searchResult.matches[2].matchNumber, 3);
  assert.equal(searchResult.matches[2].lineNumber, 5);
  assert.equal(searchResult.matches[2].section?.title.includes('BAB II'), true);
});

test('B7A.8: searchThesisText menangani query spesial regex dan query kosong secara aman', () => {
  const document = 'Data penelitian menunjukkan nilai (r = 0.85) pada sampel [N=100] dengan p < 0.05.';

  // Query dengan karakter spesial regex () [] = .
  const specialRes = searchThesisText(document, '(r = 0.85)');
  assert.equal(specialRes.totalMatches, 1);
  assert.equal(specialRes.matches[0].matchedText, '(r = 0.85)');

  // Query kosong atau spasi
  const emptyRes = searchThesisText(document, '   ');
  assert.equal(emptyRes.totalMatches, 0);
  assert.equal(emptyRes.matches.length, 0);
});

test('B7A.9: chunkTextForVirtualization membagi teks secara tepat dan deterministik', () => {
  const text = '1234567890'.repeat(100); // 1000 karakter
  const chunks = chunkTextForVirtualization(text, 500);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].startIndex, 0);
  assert.equal(chunks[0].endIndex, 500);
  assert.equal(chunks[1].startIndex, 500);
  assert.equal(chunks[1].endIndex, 1000);
  assert.equal(chunks[0].content + chunks[1].content, text);
});

test('B7A.10: Anti-Halusinasi: tidak mengarang bab atau konten yang tidak ada di teks sumber', () => {
  const simpleText = 'BAB I PENDAHULUAN\nHanya ada Bab satu.';
  const structure = parseThesisStructure(simpleText);

  const sectionTitles = structure.sections.map(s => s.title);
  assert.ok(!sectionTitles.some(t => t.includes('BAB II')), 'Dilarang mengarang BAB II');
  assert.ok(!sectionTitles.some(t => t.includes('BAB III')), 'Dilarang mengarang BAB III');
  assert.ok(!sectionTitles.some(t => t.includes('KESIMPULAN')), 'Dilarang mengarang Kesimpulan');
  assert.ok(!sectionTitles.some(t => t.includes('DAFTAR PUSTAKA')), 'Dilarang mengarang Daftar Pustaka');
});
