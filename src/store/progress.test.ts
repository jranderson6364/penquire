import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedParts } from './progress.ts';

const check = (at: number, parts: Array<[string, string]>) =>
  ({ at, result: { parts: parts.map(([label, status]) => ({ label, status, missing: [] })) } }) as never;
const problems = ['1a', '1b', '2a'].map((label) => ({ label, text: '', asksFor: [] }));

test('counts parts complete in their most recent check', () => {
  const a = { problems, checks: { p1: check(1, [['1a', 'complete'], ['1b', 'in_progress']]), p2: check(2, [['1b', 'complete']]) } };
  assert.deepEqual(completedParts(a), { done: 2, total: 3 });
});

test('a newer check that reopens a part wins over an older complete', () => {
  const a = { problems, checks: { p1: check(1, [['1a', 'complete']]), p2: check(2, [['1a', 'in_progress']]) } };
  assert.deepEqual(completedParts(a), { done: 0, total: 3 });
});

test('labels the assignment does not have, and empty assignments, are ignored', () => {
  assert.deepEqual(completedParts({ problems, checks: { p1: check(1, [['9z', 'complete']]) } }), { done: 0, total: 3 });
  assert.deepEqual(completedParts({ problems: [], checks: {} }), { done: 0, total: 0 });
});
