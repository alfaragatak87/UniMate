import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

async function read(relativePath) {
  return fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
}

function extractCalls(source, marker) {
  const calls = [];
  let searchFrom = 0;
  while (true) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex < 0) return calls;
    const openIndex = markerIndex + marker.length - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let completed = false;
    for (let index = openIndex; index < source.length; index += 1) {
      const character = source[index];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(') depth += 1;
      if (character !== ')') continue;
      depth -= 1;
      if (depth === 0) {
        calls.push(source.slice(markerIndex, index + 1));
        searchFrom = index + 1;
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error(`Pemanggilan ${marker} tidak lengkap`);
  }
}

test('slot kosong dan replace memakai kontrak target eksplisit tanpa sentinel', async () => {
  const source = await read('../src/pages/Semesters.jsx');
  assert.equal(source.includes('handleReplaceFile(e, sem.id, 999)'), false);
  assert.match(source, /mode:\s*'create'/u);
  assert.match(source, /mode:\s*'replace'/u);
  assert.match(source, /documentType:\s*activeDoc\.type/u);
});

test('Scanner memvalidasi target navigasi dan menyediakan semester tujuan terlihat', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  assert.match(source, /parseAIScannerDocumentTarget/u);
  assert.match(source, /resolveAIScannerDocumentTarget/u);
  assert.match(source, /semesterDestination/u);
  assert.match(source, /Pilih semester tujuan/u);
});

test('review Scanner tidak memotong mata kuliah, operasi merge, atau tugas', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  const reviewStart = source.indexOf('{/* Manual Selection Modal */}');
  assert.notEqual(reviewStart, -1);
  const review = source.slice(reviewStart);
  assert.equal(review.includes('slice(0, 5)'), false);
  assert.match(review, /overflowY:\s*'auto'/u);
});

test('jalur sukses Scanner memeriksa hasil penyimpanan dan tidak menaruh side effect dalam updater', async () => {
  const source = await read('../src/pages/AIScanner.jsx');
  assert.match(source, /persistScannerDocumentWithMetadata/u);
  assert.match(source, /assertMetadataWriteSucceeded/u);
  const updaterCalls = [
    ...extractCalls(source, 'setSemesters('),
    ...extractCalls(source, 'setTasks('),
  ];
  assert.equal(updaterCalls.length > 0, true);
  for (const call of updaterCalls) {
    assert.equal(call.includes('toast.success'), false);
    assert.equal(call.includes("navigate('/dashboard')"), false);
  }
});
