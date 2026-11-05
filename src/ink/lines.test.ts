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

test('a sketch (cliff outline, arc, labels inside) is ONE line; equations below and beside it stay separate', () => {
  i = 0;
  const sketch = [
    glyph(40, 60, 60, 160), // cliff outline
    glyph(70, 30, 200, 90), // the ball's arc, overlapping the cliff
    glyph(20, 240, 300, 4), // the ground
    glyph(50, 120), glyph(66, 120), // "20 m" next to the cliff
    glyph(110, 40, 8, 40), // an up arrow
    glyph(90, 50, 10, 10), // the ball
  ];
  const beside = row(100, 6, 480); // work to the right, far from the sketch
  const below = [...row(300, 8), ...row(340, 5)];
  const lines = groupLines([...sketch, ...beside, ...below]);
  assert.equal(lines.length, 4, JSON.stringify(lines.map((l) => [l.x, l.y, l.w, l.h, l.strokes.length])));
  const fig = lines.find((l) => l.strokes.includes(0))!;
  assert.deepEqual([...fig.strokes].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test('the device cliff: straight-line cliff, dashed path up and down beside it, "v" label, equations to the right', () => {
  i = 0;
  const sketch = [
    glyph(20, 282, 66, 4), // cliff top (flat)
    glyph(24, 284, 6, 125), // cliff face (very tall)
    glyph(20, 405, 76, 4), // the ground
    ...[295, 311, 323, 340, 359, 372, 389, 399].map((y) => glyph(91, y, 4, 9)), // dashes down beside the cliff
    ...[270, 258, 246, 234].map((y) => glyph(84, y, 4, 9)), // dashes going up from the edge
    glyph(100, 236, 12, 16), // "v" label by the arrow
    glyph(96, 228, 4, 40), // up arrow shaft
  ];
  const equations = [...row(230, 8, 400), ...row(268, 3, 409)];
  const heading = row(160, 6, 40);
  const lines = groupLines([...heading, ...sketch, ...equations]);
  assert.equal(lines.length, 4, JSON.stringify(lines.map((l) => [l.x, l.y, l.w, l.h, l.strokes.length])));
  const fig = lines.find((l) => l.strokes.includes(sketch[1].i))!;
  assert.deepEqual([...fig.strokes].sort((a, b) => a - b), sketch.map((s) => s.i));
});

test('a 3-row column vector is not mistaken for a sketch', () => {
  i = 0;
  const bracket = (x: number) => glyph(x, 95, 8, 100);
  const strokes = [bracket(70), glyph(88, 100), glyph(88, 130), glyph(88, 160), bracket(112), glyph(140, 128), ...row(300, 5)];
  assert.equal(groupLines(strokes).length, 2);
});

test('tightly spaced lines (ruled paper) with a subscript between them stay separate', () => {
  i = 0;
  const strokes = [...row(100, 6), glyph(130, 116, 8, 10), ...row(132, 6), ...row(164, 4)];
  const lines = groupLines(strokes);
  assert.equal(lines.length, 3, JSON.stringify(lines.map((l) => [l.y, l.h, l.strokes.length])));
});
