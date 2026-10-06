import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ring, rng, toSegments, underline, wash } from './handdrawn.ts';

const box = { x: 100, y: 200, w: 160, h: 30 };

test('the generator is deterministic per seed and differs between seeds', () => {
  const a = rng('m1');
  const b = rng('m1');
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(rng('m1')(), rng('m2')());
});

test('a ring is the same every time for one mark, and different for another', () => {
  assert.deepEqual(ring(box, 'a'), ring(box, 'a'));
  assert.notDeepEqual(ring(box, 'a').pts[5], ring(box, 'b').pts[5]);
});

test('a ring clears the box it circles and overshoots past a full turn', () => {
  const s = ring(box, 'k');
  const xs = s.pts.map((p) => p.x);
  const ys = s.pts.map((p) => p.y);
  assert.ok(Math.min(...xs) < box.x && Math.max(...xs) > box.x + box.w, 'wider than the box');
  assert.ok(Math.min(...ys) < box.y && Math.max(...ys) > box.y + box.h, 'taller than the box');
  assert.equal(s.pts.length, s.th.length);
  const first = s.pts[0];
  const last = s.pts[s.pts.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.y - last.y) > 1, 'the end is not welded to the start');
});

test('an underline sits just below the box and a little past both ends', () => {
  const s = underline(box, 'u');
  assert.ok(s.pts[0].x < box.x && s.pts[s.pts.length - 1].x > box.x + box.w);
  for (const p of s.pts) assert.ok(p.y > box.y + box.h && p.y < box.y + box.h + 14);
});

test('a wash covers the text, is nearly level, and never collapses', () => {
  const w = wash(box, 'w');
  assert.ok(w.x < box.x && w.x + w.w > box.x + box.w);
  assert.ok(Math.abs(w.rotateDeg) < 1);
  assert.ok(wash({ x: 0, y: 0, w: 4, h: 2 }, 'w').h >= 10);
});

test('segments chain the points, with positive lengths and thickness', () => {
  const segs = toSegments(ring(box, 'r'), 3);
  assert.ok(segs.length > 40);
  for (const s of segs) assert.ok(s.len > 0 && s.th > 0);
  assert.deepEqual(toSegments({ pts: [{ x: 0, y: 0 }, { x: 0, y: 0 }], th: [1, 1] }, 3), []);
});
