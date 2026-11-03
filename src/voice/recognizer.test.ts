import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATH_TERMS, MAX_CONTEXTUAL_STRINGS, contextualStrings, createRecognizerChoice, isServerFailure } from './recognizer.ts';

test('contextual strings carry the spoken-math words the recognizer mis-heard ("subtract eight", "six x")', () => {
  const c = contextualStrings([]);
  for (const w of ['six x', 'x', 'y', 'eight', 'minus', 'plus', 'equals', 'times', 'divide', 'distribute', 'parentheses', 'both sides', 'subtract', 'fraction'])
    assert.ok(c.includes(w), w);
});

test("the assignment's own words come first, then the math vocabulary", () => {
  const c = contextualStrings(['3.10c', 'theta']);
  assert.deepEqual(c.slice(0, 3), ['3.10c', 'theta', MATH_TERMS[0]]);
});

test('contextual strings drop blanks and case-insensitive duplicates and stay within the cap', () => {
  const c = contextualStrings(['  Minus ', '', 'minus', 'X']);
  assert.equal(c.filter((s) => s.toLowerCase() === 'minus').length, 1);
  assert.equal(c[0], 'Minus');
  assert.ok(!c.includes(''));
  assert.ok(!c.includes('x'), 'the student-side "X" already covers "x"');
  const many = contextualStrings(Array.from({ length: 150 }, (_, i) => `part ${i}`));
  assert.equal(many.length, MAX_CONTEXTUAL_STRINGS);
  assert.ok(contextualStrings().length <= MAX_CONTEXTUAL_STRINGS);
});

test('server recognizer first; on-device after a network failure, for the rest of the run', () => {
  const r = createRecognizerChoice();
  assert.equal(r.requiresOnDevice(true), false);
  assert.equal(r.serverError('no-speech', true), false, 'silence is not a server failure');
  assert.equal(r.requiresOnDevice(true), false);
  assert.equal(r.serverError('network', true), true);
  assert.equal(r.requiresOnDevice(true), true);
  assert.equal(r.serverError('network', true), false, 'switches once');
});

test('without an on-device recognizer it keeps using the server', () => {
  const r = createRecognizerChoice();
  assert.equal(r.serverError('network', false), false);
  assert.equal(r.requiresOnDevice(false), false);
});

test('server failures are network and service-not-allowed only', () => {
  assert.ok(isServerFailure('network'));
  assert.ok(isServerFailure('service-not-allowed'));
  for (const e of ['aborted', 'no-speech', 'audio-capture', 'interrupted', undefined]) assert.ok(!isServerFailure(e), String(e));
});
