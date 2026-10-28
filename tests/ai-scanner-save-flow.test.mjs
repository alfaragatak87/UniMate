import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BinaryFileStoreError,
  createBinaryFileStore,
  createMemoryBinaryAdapter,
} from '../src/services/binaryFileStore.js';
import {
  PersistentDocumentError,
  persistScannerDocumentWithMetadata,
} from '../src/services/persistentDocument.js';

function createSyntheticFile(contents = 'scanner synthetic') {
  const file = new Blob([contents], { type: 'application/pdf' });
  Object.defineProperties(file, {
    name: { value: 'scanner-synthetic.pdf' },
    lastModified: { value: 1_700_000_000_000 },
  });
  return file;
}

function createStore(adapter = createMemoryBinaryAdapter()) {
  return createBinaryFileStore({
    adapter,
    cryptoImpl: { randomUUID: () => '00000000-0000-4000-8000-000000000201' },
    now: () => 1_800_000_000_000,
  });
}

test('metadata berhasil menyimpan referensi baru tanpa mengubah data lama', async () => {
  const store = createStore();
  const previous = Object.freeze([{ id: 'lama', name: 'Data Lama' }]);
  let nextMetadata = null;
  let successEffects = 0;

  const document = await persistScannerDocumentWithMetadata(
    createSyntheticFile(),
    'Dokumen KHS',
    storedDocument => {
      nextMetadata = [...previous, { id: 'baru', document: storedDocument }];
      return { ok: true, value: nextMetadata };
    },
    store,
  );
  successEffects += 1;

  assert.deepEqual(previous, [{ id: 'lama', name: 'Data Lama' }]);
  assert.equal(nextMetadata.length, 2);
  assert.equal((await store.get(document.binaryRef)).size, createSyntheticFile().size);
  assert.equal(successEffects, 1);
});

test('kegagalan metadata menghapus hanya binary baru dan tidak menjalankan efek sukses', async () => {
  const store = createStore();
  let stagedDocument = null;
  let successEffects = 0;

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticFile(),
      'Dokumen KHS',
      document => {
        stagedDocument = document;
        return { ok: false, code: 'write_failed' };
      },
      store,
    ),
    error => error instanceof PersistentDocumentError && error.code === 'metadata_write_failed',
  );

  assert.equal(successEffects, 0);
  await assert.rejects(
    store.get(stagedDocument.binaryRef),
    error => error instanceof BinaryFileStoreError && error.code === 'file_not_found',
  );
});

test('kegagalan IndexedDB mencegah commit metadata', async () => {
  let metadataCalls = 0;
  const store = createStore({
    async putMany() { throw new BinaryFileStoreError('write_failed'); },
    async get() { return null; },
    async remove() {},
  });

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticFile(),
      'Dokumen KHS',
      () => {
        metadataCalls += 1;
        return { ok: true };
      },
      store,
    ),
    error => error instanceof BinaryFileStoreError && error.code === 'write_failed',
  );
  assert.equal(metadataCalls, 0);
});

test('kegagalan rollback dilaporkan dan binary baru tidak disamarkan sebagai sukses', async () => {
  const memory = createMemoryBinaryAdapter();
  const store = createStore({
    putMany: records => memory.putMany(records),
    get: id => memory.get(id),
    async remove() { throw new BinaryFileStoreError('delete_failed'); },
  });
  let stagedDocument = null;

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticFile(),
      'Dokumen KHS',
      document => {
        stagedDocument = document;
        return { ok: false, code: 'write_failed' };
      },
      store,
    ),
    error => error instanceof PersistentDocumentError && error.code === 'cleanup_failed',
  );

  assert.equal((await store.get(stagedDocument.binaryRef)).size, createSyntheticFile().size);
});

test('hasil commit yang tidak dikenal tidak memicu penghapusan spekulatif', async () => {
  const store = createStore();
  let stagedDocument = null;

  await assert.rejects(
    persistScannerDocumentWithMetadata(
      createSyntheticFile(),
      'Dokumen KHS',
      document => {
        stagedDocument = document;
        return undefined;
      },
      store,
    ),
    error => error instanceof PersistentDocumentError && error.code === 'metadata_commit_unknown',
  );

  assert.equal((await store.get(stagedDocument.binaryRef)).size, createSyntheticFile().size);
});
