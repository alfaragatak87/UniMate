import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  createBinaryFileStore,
  createMemoryBinaryAdapter,
  isBinaryFileReference,
} from '../src/services/binaryFileStore.js';
import {
  PersistentDocumentError,
  persistScannerDocument,
  resolvePersistentDocument,
} from '../src/services/persistentDocument.js';

function createSyntheticFile(contents = 'synthetic scanner document') {
  const file = new Blob([contents], { type: 'application/pdf' });
  Object.defineProperties(file, {
    name: { value: 'scanner-sintetis.pdf' },
    lastModified: { value: 1_700_000_000_000 },
  });
  return file;
}

function createStore(adapter) {
  return createBinaryFileStore({
    adapter,
    cryptoImpl: { randomUUID: () => '00000000-0000-4000-8000-000000000071' },
    now: () => 1_800_000_000_000,
  });
}

test('Scanner menyimpan referensi biner tanpa data URL dan dapat membacanya setelah restart sintetis', async () => {
  const adapter = createMemoryBinaryAdapter();
  const record = await persistScannerDocument(createSyntheticFile(), 'Dokumen KHS', createStore(adapter));
  const revoked = [];
  const resolved = await resolvePersistentDocument(record, {
    store: createStore(adapter),
    urlApi: {
      createObjectURL: blob => `blob:synthetic-${blob.size}`,
      revokeObjectURL: url => revoked.push(url),
    },
  });

  assert.equal(isBinaryFileReference(record.binaryRef), true);
  assert.deepEqual(Object.keys(record).sort(), ['binaryRef', 'type']);
  assert.equal(JSON.stringify(record).includes('synthetic scanner document'), false);
  assert.equal(resolved.url, 'blob:synthetic-26');
  assert.equal(resolved.mimeType, 'application/pdf');
  resolved.release();
  resolved.release();
  assert.deepEqual(revoked, ['blob:synthetic-26']);
});

test('data URL legacy tetap dapat dibaca tetapi URL berbahaya ditolak', async () => {
  const legacy = await resolvePersistentDocument({
    type: 'Dokumen Lama',
    file: 'data:application/pdf;base64,c3ludGhldGlj',
  });
  assert.equal(legacy.persistent, false);
  assert.equal(legacy.mimeType, 'application/pdf');

  for (const value of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'blob:http://localhost/expired']) {
    await assert.rejects(
      resolvePersistentDocument(value),
      error => error instanceof PersistentDocumentError && error.code === 'invalid_document',
    );
  }
});

test('file hilang gagal tertutup tanpa mengubah referensi metadata', async () => {
  const reference = {
    kind: 'unimate-binary-file',
    version: 1,
    id: '00000000-0000-4000-8000-000000000099',
    name: 'hilang.pdf',
    mimeType: 'application/pdf',
    size: 10,
    lastModified: 0,
  };
  const before = structuredClone(reference);
  await assert.rejects(
    resolvePersistentDocument(reference, { store: createStore(createMemoryBinaryAdapter()) }),
    error => error instanceof PersistentDocumentError && error.code === 'file_unavailable',
  );
  assert.deepEqual(reference, before);
});

test('jalur UI Scanner tidak menyimpan imagePreview ke metadata akademik', async () => {
  const [scanner, semesters, tasks] = await Promise.all([
    fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/Semesters.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/pages/Tasks.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(scanner, /persistScannerDocument/u);
  assert.equal(scanner.includes('file: imagePreview'), false);
  assert.equal(scanner.includes('originalFile: imagePreview'), false);
  assert.match(scanner, /newFile:\s*fileToUpload/u);
  assert.match(semesters, /resolvePersistentDocument\(document\)/u);
  assert.match(tasks, /resolvePersistentDocument\(item\.originalFile\)/u);
});

test('pembatalan overwrite tidak memiliki jalur penulisan biner atau akademik', async () => {
  const source = await fs.readFile(new URL('../src/pages/AIScanner.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const cancelOverwrite =');
  const end = source.indexOf('\n\n  useEffect(', start);
  const cancellation = source.slice(start, end);
  assert.equal(start >= 0 && end > start, true);
  assert.equal(cancellation.includes('persistScannerDocument'), false);
  assert.equal(cancellation.includes('setSemesters'), false);
  assert.equal(cancellation.includes('setTasks'), false);
});
