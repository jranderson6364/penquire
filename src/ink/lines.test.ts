import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLines, type StrokeLike } from './lines.ts';

let i = 0;
const glyph = (x: number, y: number, w = 14, h = 20): StrokeLike => ({ i: i++, x, y, w, h });
const row = (y: number, n: number, x0 = 20) => Array.from({ length: n }, (_, k) => glyph(x0 + k * 18, y + (k % 3) * 2));

test('empty input', () => {
  assert.deepEqual(groupLines([]), []);
});

test('three separate rows of text become three lines in order', () => {
  i = 0;
  const strokes = [...row(300, 6), ...row(100, 8), ...row(200, 5)];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.id), ['L1', 'L2', 'L3']);
  assert.ok(lines[0].y < lines[1].y && lines[1].y < lines[2].y);
  assert.equal(lines[0].strokes.length, 8);
});

test('stacked fraction merges into a single line with its neighbours', () => {
  i = 0;
  // "x = a/b + 1" : x, =, then numerator above bar, denominator below, then + 1 at baseline
  const strokes = [
    glyph(20, 110), // x
    glyph(45, 118, 14, 3), // '=' top bar (flat)
    glyph(45, 124, 14, 3), // '=' bottom bar (flat)
    glyph(80, 92), // numerator a
    glyph(76, 119, 24, 2), // fraction bar
    glyph(80, 126), // denominator b
    glyph(110, 110), // +
    glyph(130, 110), // 1
  ];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.equal(lines[0].strokes.length, 8);
});

test('tall integral sign attaches to its line, not a new one', () => {
  i = 0;
  const strokes = [...row(100, 5, 60), glyph(30, 80, 12, 64), ...row(220, 4)];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].strokes.includes(5));
});

test('subscripts and superscripts stay on the line', () => {
  i = 0;
  const strokes = [glyph(20, 100), glyph(36, 112, 8, 10), glyph(50, 100), glyph(66, 92, 8, 10), glyph(80, 100)];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 1);
});

test('a matrix equation (bracket pairs with rows inside) is ONE line, not one line per matrix row', () => {
  i = 0;
  const bracket = (x: number) => glyph(x, 95, 8, 100);
  const column = (x: number) => [bracket(x), glyph(x + 18, 100), glyph(x + 18, 130), glyph(x + 18, 160), bracket(x + 42)];
  const equation = [glyph(20, 128), glyph(38, 134, 18, 4), ...column(70), glyph(135, 128), glyph(160, 134, 18, 4), ...column(190)];
  const lines = groupLines([...row(20, 6), ...equation]);
  assert.equal(lines.length, 2, JSON.stringify(lines.map((l) => [l.y, l.h, l.strokes.length])));
  const matrixLine = lines[1];
  assert.equal(matrixLine.strokes.length, equation.length);
  assert.ok(matrixLine.h >= 100, 'the line box covers the whole matrix');
});

test('a bracket without a partner does not merge unrelated lines', () => {
  i = 0;
  const strokes = [...row(100, 6), glyph(150, 90, 8, 100) /* a lone tall stroke, e.g. an integral sign */, ...row(180, 6)];
  assert.equal(groupLines(strokes).length, 2);
});

test('tightly spaced lines (ruled paper) with a subscript between them stay separate', () => {
  i = 0;
  const strokes = [...row(100, 6), glyph(130, 116, 8, 10), ...row(132, 6), ...row(164, 4)];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 3, JSON.stringify(lines.map((l) => [l.y, l.h, l.strokes.length])));
});
