import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneMarks, resolveMarks, sanitizeMarks } from './marks.ts';

const known = new Set(['L1', 'L2', 'L3']);

test('only known kinds on known lines survive; case and spacing are forgiven', () => {
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
    { kind: 'circle', line: 'L2' },
    { kind: 'underline', line: 'L3', note: 'look here' },
  ]);
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

test('marks are placed from the line boxes, in page space, with fresh ids', () => {
  let n = 0;
  const lines = [{ id: 'L2', x: 10, y: 20, w: 100, h: 30, strokes: [] }];
  const out = resolveMarks([{ kind: 'circle', line: 'L2' }, { kind: 'circle', line: 'L7' }], lines, 3, () => `m${++n}`);
  assert.deepEqual(out, [{ id: 'm1', turn: 3, kind: 'circle', lineId: 'L2', box: { x: 10, y: 20, w: 100, h: 30 } }]);
});

test('only the latest turns keep their marks', () => {
  const m = (turn: number) => ({ id: `m${turn}`, turn, kind: 'circle' as const, lineId: 'L1', box: { x: 0, y: 0, w: 1, h: 1 } });
  assert.deepEqual(pruneMarks([m(1), m(2), m(3)], 3).map((x) => x.turn), [2, 3]);
  assert.deepEqual(pruneMarks([m(1)], 1).length, 1);
});
