import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marksToShow } from './verdictMarks.ts';
import { outlinePath, verdictStrokes } from '../tutor/handdrawn.ts';
import type { LineVerdict } from '../ai/types.ts';

const V = (id: string, verdict: LineVerdict['verdict'], part?: string): LineVerdict => ({ id, verdict, part, reading: '', note: '' });

test('a complete part gets one tick, on its answer line; problems are always marked', () => {
  const shown = marksToShow(
    [V('L1', 'valid', '1a'), V('L2', 'valid', '1a'), V('L3', 'valid', '1a'), V('L4', 'incorrect', '1b'), V('L5', 'valid', '1b'), V('L6', 'context')],
    [
      { label: '1a', status: 'complete', missing: [] },
      { label: '1b', status: 'in_progress', missing: [] },
    ]
  );
  assert.deepEqual(shown.map((v) => v.id), ['L3', 'L4']);
});

test('no tick while a part is still in progress, or for a line with no part', () => {
  const shown = marksToShow([V('L1', 'valid', '2a'), V('L2', 'valid')], [{ label: '2a', status: 'in_progress', missing: [] }]);
  assert.deepEqual(shown, []);
});

test('the last line decides: a wrong answer line gets its cross and no tick', () => {
  const shown = marksToShow([V('L1', 'valid', '3'), V('L2', 'partial', '3')], [{ label: '3', status: 'complete', missing: [] }]);
  assert.deepEqual(shown.map((v) => [v.id, v.verdict]), [['L2', 'partial']]);
});

test('verdict strokes are finite, deterministic pen shapes', () => {
  const box = { x: 10, y: 20, w: 24, h: 24 };
  for (const kind of ['valid', 'incorrect', 'partial'] as const) {
    const s = verdictStrokes(kind, box, 'L4');
    assert.equal(s.length, kind === 'incorrect' ? 2 : 1);
    for (const st of s) assert.doesNotMatch(outlinePath(st, 3), /NaN|Infinity/);
    assert.deepEqual(verdictStrokes(kind, box, 'L4'), s);
  }
});
