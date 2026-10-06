import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTagged, pruneMarks, resolveMarks, sanitizeMarks, stripTags, tagColor } from './marks.ts';

const known = new Set(['L1', 'L2', 'L3']);

test('only known kinds on known lines survive; case and spacing are forgiven; tags are filled in', () => {
  const out = sanitizeMarks(
    [
      { kind: 'Circle', line: ' l2 ' },
      { kind: 'sparkle', line: 'L1' },
      { kind: 'highlight', line: 'L9' },
      { kind: 'underline', line: 'L3', note: '  look   here ' },
      null,
      'nope',
    ],
    known
  );
  assert.deepEqual(out, [
    { kind: 'circle', line: 'L2', tag: 1 },
    { kind: 'underline', line: 'L3', tag: 2, note: 'look here' },
  ]);
});

test('tags stay unique: a clash or an invalid tag gets the lowest free one', () => {
  const out = sanitizeMarks(
    [
      { kind: 'circle', line: 'L1', tag: 2 },
      { kind: 'circle', line: 'L2', tag: 2 },
      { kind: 'circle', line: 'L3', tag: 9 },
    ],
    known
  );
  assert.deepEqual(out.map((m) => m.tag), [2, 1, 3]);
});

test('a span is kept only when it is a real stretch; fractions are clamped', () => {
  const out = sanitizeMarks(
    [
      { kind: 'circle', line: 'L1', from: 0.4, to: 0.7 },
      { kind: 'highlight', line: 'L2', from: 0.5, to: 0.51 },
      { kind: 'underline', line: 'L3', from: -2, to: 3 },
      { kind: 'underline', line: 'L1', from: 'a', to: 1 },
    ],
    known
  );
  assert.deepEqual(out[0], { kind: 'circle', line: 'L1', tag: 1, from: 0.4, to: 0.7 });
  assert.equal(out[1].from, undefined);
  assert.deepEqual([out[2].from, out[2].to], [0, 1]);
  assert.equal(out[3].from, undefined);
});

test('duplicates are dropped, the count is capped, notes are trimmed, empty notes are not drawn', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: i % 2 ? 'circle' : 'highlight', line: `L${(i % 3) + 1}` }));
  assert.ok(sanitizeMarks(many, known).length <= 4);
  assert.equal(sanitizeMarks([{ kind: 'circle', line: 'L1' }, { kind: 'circle', line: 'L1' }], known).length, 1);
  assert.equal(sanitizeMarks([{ kind: 'note', line: 'L1' }], known).length, 0);
  assert.equal(sanitizeMarks([{ kind: 'note', line: 'L1', note: 'x'.repeat(500) }], known)[0].note!.length, 140);
});

test('garbage input is an empty list', () => {
  for (const g of [undefined, null, 5, 'x', {}, [[]]]) assert.deepEqual(sanitizeMarks(g, known), []);
});

test('a span is snapped to the chunks of its line; without a span the whole line is marked', () => {
  let n = 0;
  const lines = [{ id: 'L2', x: 0, y: 20, w: 200, h: 30, strokes: [] }];
  const chunks = { L2: [{ x: 0, y: 20, w: 40, h: 30 }, { x: 60, y: 22, w: 20, h: 26 }, { x: 100, y: 20, w: 40, h: 30 }, { x: 160, y: 20, w: 40, h: 30 }] };
  const out = resolveMarks(
    [
      { kind: 'circle', line: 'L2', tag: 2, from: 0.48, to: 0.72 },
      { kind: 'highlight', line: 'L2', tag: 1 },
      { kind: 'circle', line: 'L7', tag: 3 },
    ],
    lines,
    chunks,
    3,
    () => `m${++n}`
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'm1', turn: 3, tag: 2, kind: 'circle', lineId: 'L2', box: { x: 100, y: 20, w: 40, h: 30 } });
  assert.deepEqual(out[1].box, { x: 0, y: 20, w: 200, h: 30 });
});

test('only the latest turns keep their marks', () => {
  const m = (turn: number) => ({ id: `m${turn}`, turn, tag: 1, kind: 'circle' as const, lineId: 'L1', box: { x: 0, y: 0, w: 1, h: 1 } });
  assert.deepEqual(pruneMarks([m(1), m(2), m(3)], 3).map((x) => x.turn), [2, 3]);
  assert.deepEqual(pruneMarks([m(1)], 1).length, 1);
});

test('the message splits into plain and colored phrases; unknown tags are shown as plain words', () => {
  const segs = parseTagged('Look at [[1|this sign]] and then [[2|the product]], not [[4|that]].', new Set([1, 2]));
  assert.deepEqual(segs, [
    { text: 'Look at ' },
    { text: 'this sign', tag: 1 },
    { text: ' and then ' },
    { text: 'the product', tag: 2 },
    { text: ', not that.' },
  ]);
  assert.equal(stripTags('a [[1|b]] c'), 'a b c');
  assert.deepEqual(parseTagged('no markup', new Set([1])), [{ text: 'no markup' }]);
  assert.deepEqual(parseTagged('', new Set()), []);
});

test('every tag has its own color, and out-of-range tags are clamped', () => {
  const pens = new Set([1, 2, 3, 4].map((t) => tagColor(t).pen));
  assert.equal(pens.size, 4);
  assert.equal(tagColor(0).pen, tagColor(1).pen);
  assert.equal(tagColor(99).pen, tagColor(4).pen);
});

test('a quoted expression becomes the stretch of the line it sits in', async () => {
  const { quoteSpan } = await import('./marks.ts');
  assert.deepEqual(quoteSpan('det A = 2·4 + 1·3 = 11', '+'), { from: 8 / 15, to: 9 / 15 });
  assert.equal(quoteSpan('abc', 'zzz'), undefined);
  assert.equal(quoteSpan('abc', 'abc'), undefined);
  assert.equal(quoteSpan('', 'a'), undefined);
  const out = sanitizeMarks([{ kind: 'circle', line: 'L1', line_text: 'x = 2 + 3', quote: '2 + 3' }], known);
  assert.ok(out[0].from! > 0.3 && out[0].to === 1);
});
