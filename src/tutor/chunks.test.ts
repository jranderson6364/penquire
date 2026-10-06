import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLine, snapSpan } from './chunks.ts';

const g = (x: number, w = 14, y = 100, h = 24) => ({ x, y, w, h });

test('strokes close together are one chunk; a wide gap splits', () => {
  // "2x" "+" "1" written as three groups with gaps
  const chunks = chunkLine([g(10), g(26), g(70, 16), g(120)]);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].x, 10);
  assert.equal(chunks[0].w, 30);
});

test('order of strokes does not matter; empty input is empty', () => {
  assert.deepEqual(chunkLine([g(120), g(10)]).map((c) => c.x), [10, 120]);
  assert.deepEqual(chunkLine([]), []);
});

const line = { x: 0, y: 100, w: 200, h: 24 };
const chunks = [g(0, 40), g(60, 20), g(100, 40), g(160, 40)]; // a b c d

test('a span snaps to whole chunks that are at least half inside it', () => {
  const box = snapSpan(line, chunks, 0.48, 0.72); // covers chunk c (100..140) fully, d barely
  assert.equal(box.x, 100);
  assert.equal(box.w, 40);
});

test('a span over several chunks returns their union', () => {
  const box = snapSpan(line, chunks, 0.25, 0.75);
  assert.equal(box.x, 60);
  assert.equal(box.x + box.w, 140);
});

test('a span that hits no chunk uses the nearest one; no span means the whole line', () => {
  const near = snapSpan(line, chunks, 0.41, 0.46); // the gap between b and c, centre 0.435 -> x=87
  assert.ok(near.x === 60 || near.x === 100);
  assert.deepEqual(snapSpan(line, chunks), line);
  assert.deepEqual(snapSpan(line, [], 0.1, 0.2), line);
});

test('a degenerate span falls back to the line, and out-of-range fractions are clamped', () => {
  assert.deepEqual(snapSpan(line, chunks, 0.5, 0.5), line);
  const all = snapSpan(line, chunks, -1, 2);
  assert.equal(all.x, 0);
  assert.equal(all.x + all.w, 200);
});
