import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_CAPABILITIES } from '../shared/ai/contracts.mjs';
import { validateCapabilityResult } from '../shared/ai/validation.mjs';
import {
  OfflineScannerError,
  processOfflineScannerFile,
} from '../src/services/offlineScanner.js';

function textFile(content, name = 'catatan.txt', type = 'text/plain') {
  return new File([content], name, { type });
}

async function expectOfflineError(promise, code) {
  await assert.rejects(promise, error => (
    error instanceof OfflineScannerError
    && error.code === code
    && !error.message.includes('script')
  ));
}

test('TXT UTF-8 diproses lokal sebagai teks review tanpa mengarang data akademik', async () => {
  const review = await processOfflineScannerFile(textFile('Catatan kuliah lokal\nBaris kedua'));

  assert.equal(review.source, 'offline');
  assert.equal(review.parser, 'text');
  assert.equal(review.structured, false);
  assert.equal(review.direction, 'file');
  assert.equal(review.textPreview.text, 'Catatan kuliah lokal\nBaris kedua');
  assert.deepEqual(review.suggestion.extracted_data.courses, []);
  assert.deepEqual(review.suggestion.extracted_data.tasks, []);
  assert.equal(review.suggestion.extracted_data.semester_name, null);
  assert.equal(
    validateCapabilityResult(AI_CAPABILITIES.DOCUMENT_SCAN, review.suggestion).valid,
    true,
  );
  assert.equal(Object.isFrozen(review.suggestion.extracted_data), true);
});

test('TXT kosong, encoding rusak, MIME salah, dan ukuran aktual tidak cocok ditolak aman', async () => {
  await expectOfflineError(
    processOfflineScannerFile(textFile('   \r\n\t')),
    'empty_content',
  );
  await expectOfflineError(
    processOfflineScannerFile(new File([Uint8Array.from([0xc3, 0x28])], 'rusak.txt', { type: 'text/plain' })),
    'invalid_encoding',
  );
  await expectOfflineError(
    processOfflineScannerFile(new File(['GIF89a'], 'animasi.gif', { type: 'image/gif' })),
    'unsupported_file',
  );
  await expectOfflineError(
    processOfflineScannerFile(new File(['GAMBAR'], 'dokumen.jpg', { type: 'image/jpeg' })),
    'invalid_image',
  );
  await expectOfflineError(
    processOfflineScannerFile(new File(['PDF'], 'dokumen.pdf', { type: 'application/pdf' })),
    'pdf_invalid',
  );
  const mismatched = {
    name: 'ukuran.txt',
    type: 'text/plain',
    size: 20,
    async arrayBuffer() {
      return new TextEncoder().encode('pendek').buffer;
    },
  };
  await expectOfflineError(processOfflineScannerFile(mismatched), 'file_size_mismatch');
});

test('CSV mata kuliah yang jelas dipetakan konservatif dan tervalidasi', async () => {
  const csv = [
    'mata kuliah,sks,nilai,hari,jam mulai,jam selesai,ruang,dosen,mode,kehadiran ujian',
    'Algoritma,3,A,Senin,08:00,09:40,R101,Dosen Contoh,Offline,Hadir',
    'Basis Data,2,,Selasa,10:00,11:40,R202,Dosen Dua,Online,Belum',
  ].join('\n');
  const review = await processOfflineScannerFile(textFile(csv, 'jadwal.csv', 'text/csv'), { scanType: 'khs' });

  assert.equal(review.parser, 'csv');
  assert.equal(review.structured, true);
  assert.equal(review.direction, 'khs');
  assert.equal(review.suggestion.extracted_data.courses.length, 2);
  assert.deepEqual(review.suggestion.extracted_data.courses[0], {
    name: 'Algoritma',
    sks: 3,
    grade: 'A',
    day: 'Senin',
    timeStart: '08:00',
    timeEnd: '09:40',
    room: 'R101',
    lecturer: 'Dosen Contoh',
    mode: 'Offline',
    kehadiran_ujian: 'Hadir',
  });
  assert.equal(review.suggestion.extracted_data.semester_name, null);
  assert.equal(review.suggestion.extracted_data.gpa, null);
});

test('CSV tugas hanya dipetakan jika judul dan status selesai tersedia jelas', async () => {
  const csv = [
    'judul,deadline,selesai,mata kuliah',
    'Tugas Sintetis,2026-11-02,tidak,Algoritma',
  ].join('\n');
  const review = await processOfflineScannerFile(textFile(csv, 'agenda.csv', 'text/csv'), { scanType: 'calendar' });

  assert.equal(review.structured, true);
  assert.equal(review.direction, 'event');
  assert.deepEqual(review.suggestion.extracted_data.tasks[0], {
    title: 'Tugas Sintetis',
    deadline: '2026-11-02',
    course_name: 'Algoritma',
    exam_type: null,
    task_type: null,
    project_type: null,
    task_number: null,
    meeting_number: null,
    is_completed: false,
    semester: null,
    document_type: 'Tugas',
  });
});

test('CSV generik tetap menjadi teks review dan HTML berbahaya tidak diinterpretasikan', async () => {
  const dangerousText = 'kode,catatan\n1,"<img src=x onerror=alert(1)>"';
  const review = await processOfflineScannerFile(textFile(dangerousText, 'umum.csv', 'text/csv'));

  assert.equal(review.structured, false);
  assert.equal(review.direction, 'file');
  assert.equal(review.textPreview.text.includes('<img src=x onerror=alert(1)>'), true);
  assert.deepEqual(review.suggestion.extracted_data.courses, []);
  assert.deepEqual(review.suggestion.extracted_data.tasks, []);
});

test('CSV malformed dan formula pada field akademik ditolak tanpa hasil parsial', async () => {
  await expectOfflineError(
    processOfflineScannerFile(textFile('name,sks\n"Tidak selesai,3', 'rusak.csv', 'text/csv')),
    'invalid_csv',
  );
  await expectOfflineError(
    processOfflineScannerFile(textFile('name,sks\n=HYPERLINK("x"),3', 'formula.csv', 'text/csv'), { scanType: 'khs' }),
    'unsafe_csv_content',
  );
});

test('pemrosesan Offline tidak memanggil fetch atau bridge Electron', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network_forbidden');
  };
  try {
    const review = await processOfflineScannerFile(textFile('Nol jaringan'));
    assert.equal(review.direction, 'file');
    assert.equal(fetchCalls, 0);
    assert.equal(typeof globalThis.window, 'undefined');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AbortController membatalkan pembacaan Offline tanpa menghasilkan review', async () => {
  const bytes = new TextEncoder().encode('data tertunda');
  const file = {
    name: 'tertunda.txt',
    type: 'text/plain',
    size: bytes.byteLength,
    stream() {
      return new ReadableStream({});
    },
  };
  const controller = new AbortController();
  const pending = processOfflineScannerFile(file, { signal: controller.signal });
  controller.abort();
  await expectOfflineError(pending, 'request_cancelled');
});
