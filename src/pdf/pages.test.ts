import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from '@cantoo/pdf-lib';
import { MAX_SLICE_PAGES, parsePageRange, pdfPageCount, slicePdf } from './pages.ts';

async function makePdf(n: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([300, 300]).drawText(`synthetic page ${i + 1}`, { x: 20, y: 150 });
  return doc.saveAsBase64();
}

test('page ranges: singles, ranges, commas, spaces, en dashes', () => {
  assert.deepEqual(parsePageRange('80-82, 90').pages, [80, 81, 82, 90]);
  assert.deepEqual(parsePageRange('5').pages, [5]);
  assert.deepEqual(parsePageRange('3 - 5').pages, [3, 4, 5]); // spaces around the dash are fine
  assert.deepEqual(parsePageRange('3-5; 9 4').pages, [3, 4, 5, 9]);
  assert.deepEqual(parsePageRange('7–9').pages, [7, 8, 9]);
  assert.deepEqual(parsePageRange('2,2,2-3').pages, [2, 3]); // unique and sorted
});

test('page ranges: bad input gives a message, never a throw', () => {
  for (const bad of ['', '  ', 'abc', '0', '5-3', '1-', '-4', '1.5', '10-99999']) {
    const r = parsePageRange(bad, 700);
    assert.equal(r.pages, undefined, bad);
    assert.ok(r.error && r.error.length > 0, bad);
  }
  assert.match(parsePageRange('800', 739).error ?? '', /739/);
  assert.match(parsePageRange(`1-${MAX_SLICE_PAGES + 1}`, 739).error ?? '', /at most/);
  assert.match(parsePageRange('1-30, 40-60', 739).error ?? '', /at most/);
});

test('count and slice a real (synthetic) PDF', async () => {
  const pdf = await makePdf(12);
  assert.equal(await pdfPageCount(pdf), 12);
  const slice = await slicePdf(pdf, [3, 4, 9]);
  assert.equal(await pdfPageCount(slice), 3);
  assert.ok(slice.length < pdf.length);
});

test('slicing outside the document is a clear error', async () => {
  const pdf = await makePdf(3);
  await assert.rejects(slicePdf(pdf, [2, 9]), /outside this 3-page PDF/);
});
