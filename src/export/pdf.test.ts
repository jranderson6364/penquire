import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfRequest } from './pdf.ts';

test('every page in order with its ink and its placed blocks, math as Unicode', () => {
  const req = buildPdfRequest(
    {
      title: '  PS3  ',
      pageIds: ['p1', 'p2'],
      blocks: { p2: [{ id: 'b', kind: 'part', label: '1a', heading: '1a', lines: ['Find $\\theta$ when $x^2 = 4$.'], x: 40, y: 60, w: 500 }] },
    } as never,
    (id) => (id === 'p1' ? 'INK1' : '')
  );
  assert.equal(req.title, 'PS3');
  assert.deepEqual(req.pages.map((p) => p.drawing), ['INK1', '']);
  assert.equal(req.pages[0].blocks.length, 0);
  const b = req.pages[1].blocks[0];
  assert.deepEqual([b.x, b.y, b.w, b.heading], [40, 60, 500, '1a']);
  assert.doesNotMatch(b.lines[0], /\$|\\theta/);
  assert.match(b.lines[0], /θ/);
});

test('an untitled assignment still gets a file name', () => {
  assert.equal(buildPdfRequest({ title: ' ', pageIds: [], blocks: {} } as never, () => '').title, 'Penquire');
});
