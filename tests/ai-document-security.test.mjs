import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPreferredAIDocumentExtension,
  isAIDocumentNameMimeMatch,
  validateAIDocumentPayload,
} from '../shared/ai/documentValidation.mjs';
import { validateAIRequest } from '../shared/ai/validation.mjs';
import { SYNTHETIC_DOCUMENT_REQUEST } from './fixtures/aiFixtures.mjs';

function payload(name, mimeType, bytes) {
  return {
    name,
    mimeType,
    size: bytes.length,
    base64: Buffer.from(bytes).toString('base64'),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('validator menerima signature format Scanner yang didukung', () => {
  const documents = [
    payload('contoh.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nsynthetic\n%%EOF')),
    payload('contoh.bmp', 'image/bmp', Uint8Array.from([0x42, 0x4d, 0, 0])),
    payload('contoh.jpg', 'image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])),
    payload('contoh.png', 'image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    payload('contoh.webp', 'image/webp', Buffer.from('RIFF0000WEBP')),
    payload('contoh.csv', 'text/csv', Buffer.from('mata_kuliah,nilai\nSintetis,A')),
    payload('contoh.txt', 'text/plain', Buffer.from('dokumen sintetis')),
  ];

  for (const document of documents) {
    assert.deepEqual(validateAIDocumentPayload(document), { valid: true, code: null });
    assert.equal(isAIDocumentNameMimeMatch(document.name, document.mimeType), true);
    assert.equal(getPreferredAIDocumentExtension(document.mimeType) !== null, true);
  }
});

test('validator menolak spoofing MIME, ekstensi, ukuran, path, dan konten biner sebagai teks', () => {
  const executable = payload('dokumen.pdf', 'application/pdf', Uint8Array.from([0x4d, 0x5a, 0x90, 0]));
  assert.equal(validateAIDocumentPayload(executable).code, 'signature_mismatch');

  const wrongExtension = payload('dokumen.txt', 'application/pdf', Buffer.from('%PDF-1.7'));
  assert.equal(validateAIDocumentPayload(wrongExtension).code, 'name_mime_mismatch');

  const wrongSize = { ...payload('dokumen.pdf', 'application/pdf', Buffer.from('%PDF-1.7')), size: 99 };
  assert.equal(validateAIDocumentPayload(wrongSize).code, 'size_mismatch');

  const unsafePath = payload('../dokumen.pdf', 'application/pdf', Buffer.from('%PDF-1.7'));
  assert.equal(validateAIDocumentPayload(unsafePath).code, 'name_mime_mismatch');

  const binaryText = payload('dokumen.txt', 'text/plain', Uint8Array.from([0x41, 0, 0x42]));
  assert.equal(validateAIDocumentPayload(binaryText).code, 'signature_mismatch');
});

test('kontrak request menolak dokumen dengan signature palsu sebelum provider', () => {
  const request = clone(SYNTHETIC_DOCUMENT_REQUEST);
  request.input.file = payload('dokumen.pdf', 'application/pdf', Uint8Array.from([0x4d, 0x5a, 0x90, 0]));
  const validation = validateAIRequest(request);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(error => error.path === '$.input.file'), true);
  assert.equal(JSON.stringify(validation).includes(request.input.file.base64), false);
});
