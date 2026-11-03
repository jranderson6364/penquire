import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOutOfDate } from './stale.ts';

const check = { strokeCount: 9, sigs: ['9:abc'] };

test('the check is current while the ink is the same', () => {
  assert.equal(checkOutOfDate(check, { strokes: 9, sigs: ['9:abc'] }), false);
});

test('more strokes, a changed checked line (same count), or the pixel eraser: the check is out of date', () => {
  assert.equal(checkOutOfDate(check, { strokes: 14, sigs: ['9:abc', '5:def'] }), true);
  // "6x − 4" erased and rewritten as "6x − 8" with as many strokes
  assert.equal(checkOutOfDate(check, { strokes: 9, sigs: ['9:xyz'] }), true);
  assert.equal(checkOutOfDate(check, { strokes: 9, sigs: ['9:abc'] }, true), true);
});

test('no check is never stale; lines saved without signatures fall back to the stroke count', () => {
  assert.equal(checkOutOfDate(undefined, { strokes: 3, sigs: ['3:a'] }), false);
  assert.equal(checkOutOfDate({ strokeCount: 3, sigs: [undefined] }, { strokes: 3, sigs: ['3:zz'] }), false);
  assert.equal(checkOutOfDate({ strokeCount: 3, sigs: [undefined] }, { strokes: 4, sigs: ['4:zz'] }), true);
});
