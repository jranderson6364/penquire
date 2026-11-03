import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastCheckBlock, problemsText } from './prompts.ts';
import { flatten } from '../problems/flatten.ts';
import type { ProblemGroup } from '../problems/types.ts';

const groups: ProblemGroup[] = [
  {
    label: '1',
    title: 'Blocks on a ramp',
    context: 'A block of mass m slides down a frictionless ramp of angle theta.',
    parts: [
      { label: 'a', text: 'Find the acceleration.', hint: '', asksFor: ['acceleration'], subparts: [] },
      { label: 'b', text: 'Find the speed after a distance d.', hint: '', asksFor: [], subparts: [{ label: 'ii', text: 'Check the limit theta -> 0.', hint: '' }] },
    ],
    closing: '',
    hint: '',
    asksFor: [],
  } as ProblemGroup,
];

const count = (s: string, sub: string) => s.split(sub).length - 1;

test('the setup appears once when groups match the flat list', () => {
  const text = problemsText(flatten(groups), groups);
  assert.equal(count(text, 'frictionless ramp'), 1);
  assert.match(text, /PART LABELS[^\n]*1a, 1b/);
  // sub-parts are not offered as separate part labels
  assert.doesNotMatch(text, /\[1b\.ii\]/);
});

test('falls back to the flat list when groups and problems disagree', () => {
  const flat = flatten(groups).slice(0, 1);
  const text = problemsText(flat, groups);
  assert.doesNotMatch(text, /PART LABELS/);
  assert.match(text, /\[1a\]/);
});

test('flat list without groups is unchanged', () => {
  const flat = flatten(groups);
  assert.equal(count(problemsText(flat), 'frictionless ramp'), 2);
});

test('a dispute with deterministic evidence tells the tutor not to concede on disagreement alone', async () => {
  const { intentBlock } = await import('./prompts.ts');
  const plain = intentBlock('dispute');
  assert.match(plain, /Disagreement alone is not evidence/);
  assert.doesNotMatch(plain, /INDEPENDENT CHECK/);
  const withEv = intentBlock('dispute', undefined, 'Algebra check: this does not follow from L1.');
  assert.match(withEv, /INDEPENDENT CHECK[^\n]*does not follow from L1/);
  assert.match(withEv, /Do not concede just because the student disagrees/);
});

test('a current check is context the student has seen; an out-of-date one is labelled history, and the page wins', () => {
  const last = { feedback: 'Part 1: L1 is incorrect (distribution).', stillOpen: ['distribution'] };
  const cur = lastCheckBlock(last, false);
  assert.match(cur, /LATEST CHECK RESULT \(current/);
  assert.match(cur, /Still open: distribution/);
  const old = lastCheckBlock(last, true);
  assert.match(old, /OUT OF DATE/);
  assert.match(old, /page image is the truth/);
  assert.match(old, /history, not the current state/);
  assert.match(old, /Open at that time: distribution/);
  assert.doesNotMatch(old, /Still open:/);
  // the old feedback is still there as history
  assert.ok(old.includes(last.feedback));
  assert.equal(lastCheckBlock(undefined, true), '');
});
