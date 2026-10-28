import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  BINARY_FILE_MAX_BYTES,
  BinaryFileStoreError,
  createBinaryFileStore,
  createMemoryBinaryAdapter,
  hasLegacyTransientBinary,
  isBinaryFileReference,
} from '../src/services/binaryFileStore.js';

function createSyntheticFile(name, type, contents = 'synthetic course material') {
  const blob = new Blob([contents], { type });
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: 1_700_000_000_000 },
  });
  return blob;
}

function createCrypto() {
  let index = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}` };
}

test('berkas biner tetap dapat dibaca dari instance repository baru setelah restart sintetis', async () => {
  const adapter = createMemoryBinaryAdapter();
  const cryptoImpl = createCrypto();
  const firstRuntime = createBinaryFileStore({ adapter, cryptoImpl, now: () => 1_800_000_000_000 });
  const original = createSyntheticFile('materi.pdf', 'application/pdf');
  const reference = await firstRuntime.put(original);
  const restartedRuntime = createBinaryFileStore({ adapter, cryptoImpl, now: () => 1_800_000_000_100 });

  const restored = await restartedRuntime.get(reference);

  assert.equal(isBinaryFileReference(reference), true);
  assert.equal(restored.size, original.size);
  assert.equal(Buffer.from(await restored.arrayBuffer()).toString(), 'synthetic course material');
  assert.equal(JSON.stringify(reference).includes('synthetic course material'), false);
});

test('batch menyimpan folder secara utuh dan metadata tidak memuat Blob', async () => {
  const store = createBinaryFileStore({
    adapter: createMemoryBinaryAdapter(),
    cryptoImpl: createCrypto(),
    now: () => 1_800_000_000_000,
  });
  const references = await store.putMany([
    createSyntheticFile('catatan.txt', 'text/plain', 'alpha'),
    createSyntheticFile('nilai.csv', 'text/csv', 'name,grade'),
  ]);

  assert.equal(references.length, 2);
  assert.equal(references.every(isBinaryFileReference), true);
  assert.equal(Object.hasOwn(references[0], 'blob'), false);
});

test('validasi menolak file kosong, terlalu besar, ekstensi asing, MIME palsu, dan nama path', async () => {
  const store = createBinaryFileStore({ adapter: createMemoryBinaryAdapter(), cryptoImpl: createCrypto() });
  const oversizedFile = {
    name: 'besar.pdf',
    type: 'application/pdf',
    size: BINARY_FILE_MAX_BYTES + 1,
    lastModified: 1_700_000_000_000,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
  const cases = [
    createSyntheticFile('kosong.txt', 'text/plain', ''),
    oversizedFile,
    createSyntheticFile('program.exe', 'application/octet-stream'),
    createSyntheticFile('foto.jpg', 'image/png'),
    createSyntheticFile('../rahasia.txt', 'text/plain'),
  ];

  for (const file of cases) {
    await assert.rejects(store.put(file), error => error instanceof BinaryFileStoreError);
  }
});

test('referensi rusak dan blob URL legacy ditandai tanpa klaim pemulihan', async () => {
  const store = createBinaryFileStore({ adapter: createMemoryBinaryAdapter(), cryptoImpl: createCrypto() });
  await assert.rejects(
    store.get({ kind: 'unimate-binary-file', version: 1, id: 'short' }),
    error => error instanceof BinaryFileStoreError && error.code === 'invalid_reference',
  );
  assert.equal(hasLegacyTransientBinary({ url: 'blob:http://localhost/expired' }), true);
  assert.equal(hasLegacyTransientBinary({ url: 'data:text/plain;base64,c2FmZQ==' }), false);
});

test('Course Vault menyimpan referensi dan membersihkan object URL sementara', async () => {
  const source = await fs.readFile(new URL('../src/components/CourseVaultModal.jsx', import.meta.url), 'utf8');
  assert.match(source, /binaryRef/u);
  assert.match(source, /URL\.revokeObjectURL/u);
  assert.equal(source.includes('URL.createObjectURL(fileObj)'), false);
  assert.equal(source.includes('fileObject: fileObj'), false);
});
