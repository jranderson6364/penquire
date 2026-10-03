import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareProblemLabels, flatLabel, labelIndex, missingInSequence, normalizePartLabel, normalizeProblemLabel } from './labels.ts';
import { sanitizeParsed } from './sanitize.ts';
import { findPart, flatten } from './flatten.ts';
import { formatGroups } from './format.ts';
import { hasErrors, validateGroups } from './validate.ts';
import type { ProblemGroup } from './types.ts';

// All text below is invented for the tests (never real course material: this repo is public).
const group = (over: Partial<ProblemGroup> = {}): ProblemGroup => ({
  label: '6',
  title: 'Rolling cart',
  context: 'A cart of mass M rolls down a frictionless incline of angle \\theta starting from rest at height h, as in the figure.',
  parts: [
    { label: 'a', text: 'Find the speed at the bottom.', asksFor: ['speed'], subparts: [] },
    { label: 'b', text: 'How long does the descent take?', asksFor: [], subparts: [] },
  ],
  asksFor: [],
  ...over,
});

test('label normalization', () => {
  assert.equal(normalizeProblemLabel('Problem 6.'), '6');
  assert.equal(normalizeProblemLabel('Question 3'), '3');
  assert.equal(normalizeProblemLabel('Exercise 3.10'), '3.10');
  assert.equal(normalizeProblemLabel('(7)'), '7');
  assert.equal(normalizeProblemLabel('Q12'), '12');
  assert.equal(normalizePartLabel('(b)'), 'b');
  assert.equal(normalizePartLabel('b.'), 'b');
  assert.equal(normalizePartLabel('(ii)'), 'ii');
  assert.equal(normalizePartLabel('Part c'), 'c');
  assert.equal(normalizePartLabel('(A)'), 'A');
  assert.equal(flatLabel('3.10', 'c'), '3.10c');
  assert.equal(flatLabel('1', 'b', 'ii'), '1b.ii');
});

test('sequence gaps in letters, capitals and roman numerals', () => {
  assert.deepEqual(missingInSequence(['a', 'b', 'd']), ['c']);
  assert.deepEqual(missingInSequence(['a', 'b', 'c']), []);
  assert.deepEqual(missingInSequence(['i', 'ii', 'iv']), ['iii']);
  assert.deepEqual(missingInSequence(['A', 'C']), ['B']);
  assert.deepEqual(missingInSequence(['b', 'c']), []); // starting late is not a gap inside the sequence
  assert.equal(labelIndex('iii'), 2);
  assert.equal(labelIndex('c'), 2);
});

test('natural problem order', () => {
  assert.ok(compareProblemLabels('2', '10') < 0);
  assert.ok(compareProblemLabels('3.8', '3.10') < 0);
  assert.ok(compareProblemLabels('4', '4') === 0);
});

test('sanitizer: coerces, normalizes labels, merges a problem reported twice, sorts', () => {
  const out = sanitizeParsed({
    course: ' PHYS 1 ',
    notes: ['read chapter 2', '', 5],
    problems: [
      { label: 'Problem 10.', context: 'ten', parts: [{ label: '(a)', text: 'x', asks_for: ['y', ''] }] },
      { label: '2', context: '', parts: [{ label: 'a', text: 'first' }] },
      { label: 'Problem 2', context: 'two', parts: [{ label: 'a', text: 'dup' }, { label: '(b)', text: 'second' }], title: 'T' },
      null,
      { label: '' },
      'junk',
    ],
  });
  assert.equal(out.course, 'PHYS 1');
  assert.deepEqual(out.notes, ['read chapter 2', '5']);
  assert.deepEqual(out.groups.map((g) => g.label), ['2', '10']);
  const two = out.groups[0];
  assert.equal(two.context, 'two');
  assert.equal(two.title, 'T');
  assert.deepEqual(two.parts.map((p) => [p.label, p.text]), [['a', 'first'], ['b', 'second']]);
  assert.deepEqual(out.groups[1].parts[0].asksFor, ['y']);
});

test('sanitizer: total garbage yields an empty, well-formed result', () => {
  for (const bad of [null, undefined, 5, 'x', [], { problems: 'no' }]) {
    const out = sanitizeParsed(bad);
    assert.deepEqual(out.groups, []);
    assert.deepEqual(out.notes, []);
  }
});

test('flatten: one self-contained item per part, labels stable, closing and hints attached', () => {
  const g = group({ closing: 'Show your work.', hint: 'Use energy.' });
  const flat = flatten([g]);
  assert.deepEqual(flat.map((p) => p.label), ['6a', '6b']);
  assert.ok(flat[0].text.includes('frictionless incline'));
  assert.ok(flat[0].text.includes('Find the speed'));
  assert.ok(flat[0].text.includes('Applies to all parts'));
  assert.ok(flat[1].text.includes('Hint: Use energy.'));
  assert.deepEqual(flat[0].asksFor, ['speed']);
});

test('flatten: a problem with no parts is one item; subparts are inlined into their part', () => {
  const single = flatten([{ label: '4', context: 'Compute the thing.', parts: [], asksFor: ['the value'] }]);
  assert.deepEqual(single.map((p) => p.label), ['4']);
  assert.deepEqual(single[0].asksFor, ['the value']);
  const nested = flatten([group({ parts: [{ label: 'a', text: 'Lead-in.', asksFor: [], subparts: [{ label: 'i', text: 'First.' }, { label: 'ii', text: 'Second.', hint: 'h' }] }] })]);
  assert.ok(nested[0].text.includes('(i) First.'));
  assert.ok(nested[0].text.includes('(ii) Second. Hint: h'));
});

test('findPart resolves a flat label back to its group and part', () => {
  const found = findPart([group()], '6b');
  assert.equal(found?.part?.label, 'b');
  assert.equal(findPart([group()], '6')?.part, undefined);
  assert.equal(findPart([group()], '9z'), undefined);
});

test('tutor text states the setup once, then the parts', () => {
  const text = formatGroups([group({ closing: 'Show your work.' })]);
  assert.equal(text.split('frictionless incline').length - 1, 1);
  assert.ok(text.includes('[6a] Find the speed'));
  assert.ok(text.includes('[6b] How long'));
  assert.ok(text.includes('Applies to all parts: Show your work.'));
});

test('validator: a clean problem has no issues', () => {
  assert.deepEqual(validateGroups([group()]), []);
});

test('validator: a missing part (a, b, d) is an error and says which', () => {
  const g = group({ parts: ['a', 'b', 'd'].map((label) => ({ label, text: `text ${label}`, asksFor: [], subparts: [] })) });
  const issues = validateGroups([g]);
  assert.equal(hasErrors(issues), true);
  assert.ok(issues.some((i) => i.code === 'part-gap' && i.message.includes('part c')));
});

test('validator: empty parts, empty problems, duplicate problems, repeated setup, duplicate parts', () => {
  assert.ok(validateGroups([group({ parts: [{ label: 'a', text: '', asksFor: [], subparts: [] }] })]).some((i) => i.code === 'empty-text'));
  assert.ok(validateGroups([{ label: '1', context: '', parts: [], asksFor: [] }]).some((i) => i.code === 'empty-problem'));
  assert.ok(validateGroups([group(), group()]).some((i) => i.code === 'duplicate-problem'));
  const repeated = group();
  repeated.parts[0].text = repeated.context + ' Find the speed at the bottom.';
  assert.ok(validateGroups([repeated]).some((i) => i.code === 'part-repeats-context'));
  const same = group();
  same.parts[1].text = same.parts[0].text;
  assert.ok(validateGroups([same]).some((i) => i.code === 'duplicate-part'));
});

test('validator: two parts that differ by one word are NOT duplicates', () => {
  const g = group();
  g.parts[0].text = 'The apparent length depends on where the observer stands in the room.';
  g.parts[1].text = 'The observed length depends on where the observer stands in the room.';
  assert.ok(!validateGroups([g]).some((i) => i.code === 'duplicate-part'));
});

test('validator: latex health', () => {
  const bad1 = group({ context: 'The angle is $\\theta and the height is h, long enough to matter here.' });
  assert.ok(validateGroups([bad1]).some((i) => i.code === 'latex'));
  const bad2 = group({ context: 'Use \\frac{a}{b for the ratio of the two sides, which is long enough.' });
  assert.ok(validateGroups([bad2]).some((i) => i.code === 'latex'));
  const bad3 = group({ context: 'Use \\madeupcommand{x} for the ratio of the two sides, which is long enough.' });
  assert.ok(validateGroups([bad3]).some((i) => i.code === 'latex' && i.message.includes('madeupcommand')));
  assert.deepEqual(validateGroups([group({ context: 'Use $\\vec{F} = m\\vec{a}$ and $\\frac{1}{2}mv^2$, long enough to matter here.' })]), []);
});

test('validator: the source text reveals a missing problem, but cross-references do not', () => {
  const source = ['Problem 1. First thing.', 'text', 'Problem 2. Second thing.', 'Read Problem 1.6 (Pole in barn) on p. 45 in the textbook.', 'Problem 3. Third.'].join('\n');
  const issues = validateGroups([group({ label: '1' }), group({ label: '3' })], { sourceText: source });
  const missing = issues.filter((i) => i.code === 'missing-problem').map((i) => i.problem);
  assert.deepEqual(missing, ['2']);
});
