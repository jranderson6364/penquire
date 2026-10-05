import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeMarks, type PlaceItem } from './placeMarks.ts';

const item = (id: string, x: number, y: number, w: number, h: number, priority = false, size = 22): PlaceItem => ({ id, box: { x, y, w, h }, size, priority });
const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, s = 22) => a.x < b.x + s && a.x + s > b.x && a.y < b.y + s && a.y + s > b.y;

test('a lone line gets its mark just right of the line, vertically centred', () => {
  const [p] = placeMarks([item('L1', 100, 200, 300, 30)], 800, 1000);
  assert.deepEqual(p, { id: 'L1', x: 408, y: 200 + 15 - 11 });
});

test('a crowded stack of short lines: no two marks overlap', () => {
  const items = Array.from({ length: 8 }, (_, k) => item(`L${k + 1}`, 500, 100 + k * 14, 60, 12));
  const placed = placeMarks(items, 800, 1000);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlap(placed[i], placed[j]), `${placed[i].id} overlaps ${placed[j].id}`);
});

test('marks never cover another line\'s ink', () => {
  // L1's natural spot (right of it) is inside L2, which sits to its right on the same row
  const items = [item('L1', 100, 200, 100, 30), item('L2', 208, 195, 150, 40)];
  const placed = placeMarks(items, 800, 1000);
  const m1 = placed[0];
  assert.ok(!(m1.x < 358 && m1.x + 22 > 208 && m1.y < 235 && m1.y + 22 > 195), 'mark 1 sits on line 2');
});

test('flagged marks claim their natural spot before valid ones', () => {
  const items = [item('ok', 100, 200, 100, 30, false), item('bad', 100, 200, 100, 30, true)];
  const placed = placeMarks(items, 800, 1000);
  assert.deepEqual(placed.find((p) => p.id === 'bad'), { id: 'bad', x: 208, y: 204 });
  assert.notDeepEqual(placed.find((p) => p.id === 'ok'), { id: 'ok', x: 208, y: 204 });
});

test('marks stay inside the viewport, even for a line at the very edge', () => {
  const [p] = placeMarks([item('L1', 760, 990, 80, 30)], 800, 1000);
  assert.ok(p.x >= 0 && p.x + 22 <= 800 && p.y >= 0 && p.y + 22 <= 1000);
});

test('output keeps the input order, and empty input is fine', () => {
  const placed = placeMarks([item('b', 10, 300, 50, 20), item('a', 10, 100, 50, 20, true)], 800, 1000);
  assert.deepEqual(placed.map((p) => p.id), ['b', 'a']);
  assert.deepEqual(placeMarks([], 800, 1000), []);
});
