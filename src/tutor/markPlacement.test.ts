import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCLE_MAX_ASPECT, plainMath, quoteSpan, resolveMarks, sanitizeMarks } from './marks.ts';
import { snapSymbol } from './chunks.ts';
import { arrow } from './handdrawn.ts';

const known = new Set(['L1', 'L2', 'L3']);
let n = 0;
const id = () => `m${++n}`;

test('C: positions are measured on the written form, not the LaTeX source', () => {
  assert.equal(plainMath('15t - \\frac{10}{2}t^2 = 0').includes('frac'), false);
  const s = quoteSpan('15t - \\frac{10}{2}t^2 = 0', '0')!;
  // the "= 0" is at the right end, not somewhere in the middle of a long \frac command
  assert.ok(s.from > 0.8, `from ${s.from}`);
});

test('E: a repeated symbol picks the whole token, then the occurrence nearest the model\'s rough position', () => {
  const a = quoteSpan('20 + 15t - 5t^2 = 0', '0')!;
  assert.ok(a.from > 0.9, 'the 0 on the right, not the 0 of 20');
  const twice = 't = 4, t = -1';
  const left = quoteSpan(twice, 't', 0.05)!;
  const right = quoteSpan(twice, 't', 0.6)!;
  assert.ok(left.from < 0.1 && right.from > 0.4);
});

test('B: a quote that cannot be found never becomes a mark over the whole line; it becomes an arrow at the line', () => {
  const [m] = sanitizeMarks([{ kind: 'circle', line: 'L1', line_text: '15t - 5t^2 = 0', quote: '+20' }], known);
  assert.equal(m.unplaced, true);
  assert.equal(m.from, undefined);
  const lines = [{ id: 'L1', x: 100, y: 50, w: 200, h: 30, strokes: [] }];
  const [r] = resolveMarks([m], lines, {}, 1, id);
  assert.equal(r.kind, 'arrow');
  assert.ok(r.box.w <= 30 && r.box.x === 100, 'a thin slice at the start of the line');
  // a whole-line mark the model asked for on purpose (no quote) is not "unplaced"
  assert.equal(sanitizeMarks([{ kind: 'highlight', line: 'L2' }], known)[0].unplaced, undefined);
});

test('D: a single-symbol quote snaps to that symbol\'s own strokes, not the chunk around it', () => {
  const [m] = sanitizeMarks([{ kind: 'circle', line: 'L1', line_text: '5t^2=0', quote: '0' }], known);
  assert.equal(m.symbol, true);
  // tight handwriting: "=" and "0" touch, so chunking would join them
  const strokes = [
    { x: 0, y: 0, w: 12, h: 20 }, { x: 13, y: 0, w: 10, h: 20 }, { x: 24, y: 0, w: 12, h: 12 },
    { x: 38, y: 8, w: 12, h: 2 }, { x: 38, y: 12, w: 12, h: 2 }, { x: 51, y: 0, w: 14, h: 20 },
  ];
  const line = { id: 'L1', x: 0, y: 0, w: 65, h: 20, strokes: [0, 1, 2, 3, 4, 5] };
  const [r] = resolveMarks([m], [line], { L1: [{ x: 0, y: 0, w: 65, h: 20 }] }, 1, id, { L1: strokes });
  assert.deepEqual(r.box, { x: 51, y: 0, w: 14, h: 20 });
  assert.deepEqual(snapSymbol({ x: 0, y: 0, w: 100, h: 20 }, [], 0.1, 0.2), { x: 0, y: 0, w: 100, h: 20 });
});

test('F: a circle around a long stretch is drawn as an underline; a small circle stays a circle', () => {
  const lines = [{ id: 'L1', x: 0, y: 0, w: 300, h: 30, strokes: [] }];
  const [wide] = resolveMarks([{ kind: 'circle', line: 'L1', tag: 1 }], lines, {}, 1, id);
  assert.equal(wide.kind, 'underline');
  const chunks = { L1: [{ x: 0, y: 0, w: 40, h: 30 }, { x: 260, y: 0, w: 40, h: 30 }] };
  const [small] = resolveMarks([{ kind: 'circle', line: 'L1', tag: 1, from: 0.88, to: 1 }], lines, chunks, 1, id);
  assert.equal(small.kind, 'circle');
  assert.ok(small.box.w <= CIRCLE_MAX_ASPECT * small.box.h);
});

test('G: at most two marks per reply', () => {
  const many = ['L1', 'L2', 'L3'].map((line) => ({ kind: 'underline', line }));
  assert.equal(sanitizeMarks(many, known).length, 2);
});

test('A: an arrow is a known kind, and its stroke ends at the tip with two barbs', () => {
  const [m] = sanitizeMarks([{ kind: 'arrow', line: 'L1' }], known);
  assert.equal(m.kind, 'arrow');
  const box = { x: 100, y: 40, w: 18, h: 30 };
  const s = arrow(box, 'x');
  const tip = s.pts[12];
  assert.ok(Math.abs(tip.x - 95) < 0.01 && Math.abs(tip.y - 55) < 0.01, 'tip just left of the box, at mid height');
  assert.ok(s.pts[0].x < tip.x, 'comes in from the left');
  assert.equal(s.pts.length, 17);
  const up = arrow(box, 'x', 1, true);
  assert.ok(up.pts[0].y > up.pts[12].y, 'from below, pointing up');
});
