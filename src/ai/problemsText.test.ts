import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemsText } from './prompts.ts';
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
