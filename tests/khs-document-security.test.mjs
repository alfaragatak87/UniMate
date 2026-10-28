import test from 'node:test';
import assert from 'node:assert/strict';

import { createKHSElement } from '../src/utils/khsDocument.js';

class SyntheticElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.children = [];
    this.value = '';
  }

  set textContent(value) {
    this.value = String(value);
    this.children = [];
  }

  get textContent() {
    return this.value + this.children.map(child => child.textContent).join('');
  }

  set innerHTML(_value) {
    throw new Error('innerHTML tidak boleh digunakan');
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

const syntheticDocument = Object.freeze({
  createElement(tagName) {
    return new SyntheticElement(tagName);
  },
});

function walk(element) {
  return [element, ...element.children.flatMap(walk)];
}

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function serialize(element) {
  const tagName = element.tagName.toLowerCase();
  return `<${tagName}>${escapeText(element.value)}${element.children.map(serialize).join('')}</${tagName}>`;
}

test('dokumen KHS mempertahankan struktur, nilai, dan perhitungan SKS', () => {
  const semester = {
    name: 'Semester 5 (Ganjil 2026/2027)',
    gpa: '3.75',
    courses: [
      { name: 'Keamanan Aplikasi', sks: '3', grade: 'A' },
      'Analisis Data (Nilai: B+)',
    ],
  };
  const snapshot = structuredClone(semester);
  const element = createKHSElement(semester, syntheticDocument);
  const nodes = walk(element);

  assert.deepEqual(semester, snapshot);
  assert.deepEqual(nodes.filter(node => node.tagName === 'TH').map(node => node.textContent), ['No', 'Mata Kuliah', 'SKS', 'Nilai']);
  assert.equal(nodes.filter(node => node.tagName === 'TR').length, 3);
  assert.match(element.textContent, /Total SKS: 3/u);
  assert.match(element.textContent, /Indeks Prestasi Semester \(IPS\): 3\.75/u);
  assert.match(element.textContent, /Analisis Data-B\+/u);
});

test('data KHS berbahaya selalu menjadi teks dan tidak membentuk node aktif', () => {
  delete globalThis.unimateCompromised;
  const payload = '<img src=x onerror="globalThis.unimateCompromised=true">';
  const semester = {
    name: payload,
    gpa: '<svg onload="globalThis.unimateCompromised=true">',
    courses: [{
      name: '<script>globalThis.unimateCompromised=true</script>',
      sks: '<iframe src="javascript:globalThis.unimateCompromised=true">',
      grade: payload,
    }],
  };

  const element = createKHSElement(semester, syntheticDocument);
  const nodes = walk(element);
  const markup = serialize(element);

  assert.equal(nodes.some(node => ['IMG', 'SCRIPT', 'SVG', 'IFRAME'].includes(node.tagName)), false);
  assert.equal(markup.includes('<img'), false);
  assert.equal(markup.includes('<script'), false);
  assert.equal(markup.includes('<svg'), false);
  assert.equal(markup.includes('<iframe'), false);
  assert.match(markup, /&lt;img/u);
  assert.match(markup, /&lt;script/u);
  assert.equal(globalThis.unimateCompromised, undefined);
});
