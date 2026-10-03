import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLeak, type LeakContext } from './leak.ts';

const ctx = (level: 0 | 1 | 2 | 3 | 4): LeakContext => ({
  level,
  lines: [
    { id: 'L1', reading: 'v = v_0 + a t', verdict: 'valid' },
    { id: 'L2', reading: 'v = 2 + 4(1)', verdict: 'valid' },
    { id: 'L3', reading: 'v = 5', verdict: 'incorrect' },
  ],
});

// Everyday tutoring sentences: none may be withheld (a blocked normal hint makes the tutor useless).
const SAFE = [
  'Where does the 4 come from in $v = v_0 + a t$?',
  'Check your arithmetic between L2 and L3.',
  'Is $v = v_0 + a t$ the right kinematic relation when acceleration is constant?',
  'What are the units of each term in L1?',
  'Newton\'s second law says $F = ma$; which quantities here are known?',
  'You wrote $v = 5$. Does that match what L2 gives?',
  'Think about energy: $K = \\frac{1}{2}mv^2$ relates speed to kinetic energy.',
  'Try a similar case: if $v_0 = 1$, $a = 2$, $t = 3$ what do you get from L1?',
];

test('ordinary tutoring sentences are never withheld', () => {
  for (const level of [0, 1, 2, 3, 4] as const) {
    for (const s of SAFE) assert.equal(findLeak(s, ctx(level)), null, `level ${level}: ${s}`);
  }
});

test('stating the answer is withheld at every level', () => {
  for (const level of [0, 1, 2, 3, 4] as const) {
    assert.equal(findLeak('So v = 6 is what you should get.', ctx(level))?.why, 'final-answer', `level ${level}`);
    assert.equal(findLeak('The correct value is $v = 6$.', ctx(level))?.why, 'final-answer', `level ${level}`);
  }
});

test('paraphrased answers (different form, same value) are caught', () => {
  assert.equal(findLeak('That gives $v = 12/2$.', ctx(2))?.why, 'final-answer');
  assert.equal(findLeak('Evaluate it and you get $v = 3 \\cdot 2$.', ctx(1))?.why, 'final-answer');
});
