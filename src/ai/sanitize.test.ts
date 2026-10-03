import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCheck, sanitizeLines } from './sanitize.ts';

test('an unknown or missing verdict becomes unreadable, never valid', () => {
  const out = sanitizeLines([
    { id: 'L1', reading: 'x=1', verdict: 'correct', note: 'n' },
    { id: 'L2', reading: 'x=1', note: 'n' },
    { id: 'L3', reading: 'x=1', verdict: 'VALID ', note: 'n' }, // case/space tolerated
    { id: 'L4', reading: 'x=1', verdict: 5, note: 'n' },
  ]);
  assert.deepEqual(out.map((l) => l.verdict), ['unreadable', 'unreadable', 'valid', 'unreadable']);
  assert.match(out[0].note, /not understood/);
});

test('missing or wrong-typed fields are coerced, not crashed on', () => {
  const [l] = sanitizeLines([{ id: 'L1', verdict: 'valid' }]);
  assert.equal(l.reading, '');
  assert.equal(l.note, '');
  assert.equal(l.part, undefined);
});

test('bad line IDs, duplicates and junk items are dropped', () => {
  const out = sanitizeLines([null, 5, 'x', { id: 'line 1', verdict: 'valid' }, { id: 'L1', verdict: 'valid' }, { id: 'L1', verdict: 'incorrect' }]);
  assert.deepEqual(out.map((l) => [l.id, l.verdict]), [['L1', 'valid']]);
});

test('whole-object garbage yields an empty but well-formed result', () => {
  for (const bad of [{}, { lines: 'oops', parts: 7, feedback: null, still_open: 'a' }]) {
    const r = sanitizeCheck(bad as Record<string, unknown>, 'm');
    assert.deepEqual(r.lines, []);
    assert.deepEqual(r.parts, []);
    assert.equal(r.feedback, '');
    assert.deepEqual(r.stillOpen, []);
  }
});

test('part status falls back to in_progress; parts without a label are dropped', () => {
  const r = sanitizeCheck({ parts: [{ label: '1a', status: 'weird', missing: ['x', '', 3] }, { status: 'complete' }] }, 'm');
  assert.deepEqual(r.parts, [{ label: '1a', status: 'in_progress', missing: ['x', '3'] }]);
});
