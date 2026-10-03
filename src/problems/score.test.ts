import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentWords, normalizeSourceText, scoreParse, type Gold } from './score.ts';
import type { ProblemGroup } from './types.ts';

// Invented content only (public repo).
const gold: Gold = {
  id: 'synthetic',
  notes_keys: ['bring a calculator'],
  problems: [
    {
      label: '1',
      title_keys: ['Spinning disk'],
      context_keys: ['uniform disk of radius R', 'spun about its axis'],
      closing_keys: ['Justify each answer'],
      figure: true,
      parts: [
        { label: 'a', keys: ['moment of inertia'], hint_keys: ['parallel axis'] },
        { label: 'b', keys: ['angular momentum'], subparts: [{ label: 'i', keys: ['at t = 0'] }, { label: 'ii', keys: ['at t = 2 s'] }] },
      ],
    },
  ],
};

const good: ProblemGroup = {
  label: '1',
  title: 'Spinning disk',
  context: 'A uniform disk of radius R is spun about its axis. [Figure: a disk with an axis through its centre]',
  parts: [
    { label: 'a', text: 'Find the moment of inertia.', hint: 'Think about the parallel axis theorem.', asksFor: [], subparts: [] },
    {
      label: 'b',
      text: 'Compute the angular momentum',
      asksFor: [],
      subparts: [
        { label: 'i', text: 'at t = 0.' },
        { label: 'ii', text: 'at t = 2 s.' },
      ],
    },
  ],
  closing: 'Justify each answer.',
  asksFor: [],
};

test('a faithful parse scores 100%', () => {
  const s = scoreParse({ notes: ['Please bring a calculator.'], groups: [good] }, gold);
  assert.equal(s.summary.structureF1, 1);
  assert.equal(s.summary.keyRecall, 1);
  assert.equal(s.summary.placement, 1);
  assert.equal(s.figures.marked, 1);
  assert.deepEqual(s.issues, []);
});

test('a missing part and subpart lower structure and are named', () => {
  const broken: ProblemGroup = { ...good, parts: [good.parts[0], { ...good.parts[1], subparts: [good.parts[1].subparts[0]] }] };
  const s = scoreParse({ notes: [], groups: [broken] }, gold);
  assert.deepEqual(s.subpartLabels.missing, ['1b.ii']);
  assert.ok(s.summary.structureF1 < 1);
  assert.ok(s.keys.parts.missing.some((m) => m.includes('at t = 2 s')));
  assert.ok(s.keys.notes.missing.length === 1);
});

test('content in the wrong place is reported as misplaced', () => {
  // the closing instructions were stuffed into the setup
  const wrong: ProblemGroup = { ...good, context: good.context + ' Justify each answer.', closing: undefined };
  const s = scoreParse({ notes: ['bring a calculator'], groups: [wrong] }, gold);
  assert.deepEqual(s.keys.closing.missing, ['P1: Justify each answer']);
  assert.deepEqual(s.keys.misplaced, ['P1: Justify each answer']);
  assert.ok(s.summary.placement < 1);
});

test('repeating the setup in every part is penalized', () => {
  const repeated: ProblemGroup = { ...good, parts: good.parts.map((p) => ({ ...p, text: good.context + ' ' + p.text })) };
  const s = scoreParse({ notes: ['bring a calculator'], groups: [repeated] }, gold);
  assert.equal(s.partsRepeatingContext, 2);
  assert.ok(s.summary.placement < 1);
});

test('invented words are found against the source text, ignoring [Figure: ...] descriptions', () => {
  const source = normalizeSourceText('A uniform disk of radius R is spun about its axis.\nFind the moment of iner-\ntia. Compute the angular momentum. Justify each answer. Spinning disk');
  const hallucinated: ProblemGroup = { ...good, context: good.context + ' The turntable rotates counterclockwise.' };
  const s = scoreParse({ notes: ['bring a calculator'], groups: [hallucinated] }, gold, { sourceText: source });
  assert.ok(s.unsupportedWords.sample.includes('turntable'));
  assert.ok(s.unsupportedWords.sample.includes('counterclockwise'));
  assert.ok(!s.unsupportedWords.sample.includes('centre')); // inside [Figure: ...]
  assert.ok(s.summary.fidelity < 1);
});

test('source normalization: de-hyphenation, ligatures, replacement characters', () => {
  assert.equal(normalizeSourceText('mil-\nlisecond'), 'millisecond');
  assert.equal(normalizeSourceText('eﬃcient � x'), 'efficient x');
  assert.deepEqual(contentWords('The \\vec{F} equals mass times acceleration'), ['equals', 'times', 'acceleration']);
});
