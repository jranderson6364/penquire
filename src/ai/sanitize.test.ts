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

test('line parts are matched to the problem list; unknown labels and "none" become no part', () => {
  const known = ['1a', '2a', '3.10c'];
  const lines = sanitizeLines(
    [
      { id: 'L1', part: ' 2A ', reading: '', verdict: 'valid', note: '' },
      { id: 'L2', part: '(1a)', reading: '', verdict: 'valid', note: '' },
      { id: 'L3', part: 'none', reading: '', verdict: 'context', note: '' },
      { id: 'L4', part: '9z', reading: '', verdict: 'valid', note: '' },
      { id: 'L5', part: '3.10 c', reading: '', verdict: 'valid', note: '' },
    ],
    known
  );
  assert.deepEqual(lines.map((l) => l.part), ['2a', '1a', undefined, undefined, '3.10c']);
});

test('without a problem list the model part is kept as written', () => {
  assert.equal(sanitizeLines([{ id: 'L1', part: 'Q7', reading: '', verdict: 'valid', note: '' }])[0].part, 'Q7');
});

test('read confidence is kept only when recognised; uncertain text is trimmed and capped', () => {
  const [a, b] = sanitizeLines([
    { id: 'L1', reading: 'x=2', verdict: 'valid', note: '', read_confidence: 'LOW', uncertain: '  2  ' },
    { id: 'L2', reading: 'y=3', verdict: 'valid', note: '', read_confidence: 'sure', uncertain: '' },
  ]);
  assert.equal(a.readConfidence, 'low');
  assert.equal(a.uncertain, '2');
  assert.equal(b.readConfidence, undefined);
  assert.equal(b.uncertain, undefined);
});
