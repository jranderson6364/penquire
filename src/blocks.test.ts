import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBlock, estimateHeight, nextBlockY, partContent, setupContent } from './blocks.ts';
import type { ProblemGroup } from './problems/types.ts';

const groups: ProblemGroup[] = [
  {
    label: '2',
    title: 'A 2x2 matrix',
    context: 'Let $A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 3 \\end{pmatrix}$.',
    closing: 'Show your work.',
    asksFor: [],
    parts: [
      { label: 'a', text: 'Compute $\\det(A)$.', asksFor: [], subparts: [] },
      { label: 'b', text: 'Find the inverse in two ways:', asksFor: [], subparts: [{ label: 'i', text: 'by the adjugate' }, { label: 'ii', text: 'by row reduction' }] },
    ],
  },
  { label: '3', context: '', asksFor: [], parts: [{ label: '', text: 'Show that $(n+1)^2 - n^2 = 2n + 1$.', asksFor: [], subparts: [] }] },
];
const problems = [
  { label: '2a', text: 'Compute det(A)', asksFor: [] },
  { label: '2b', text: 'Find the inverse', asksFor: [] },
  { label: '3', text: 'Show that (n+1)^2 - n^2 = 2n + 1', asksFor: [] },
];

test('a part block holds just that part and its sub-parts, not the shared setup', () => {
  const c = partContent(groups, problems, '2b')!;
  assert.equal(c.heading, '2b');
  assert.deepEqual(c.lines, ['(b) Find the inverse in two ways:', '(i) by the adjugate', '(ii) by row reduction']);
  assert.ok(!c.lines.join(' ').includes('Let $A'));
});

test('a setup block holds the context and the text that applies to every part', () => {
  const c = setupContent(groups, '2a')!;
  assert.equal(c.heading, 'Problem 2 · A 2x2 matrix');
  assert.equal(c.lines.length, 2);
  assert.match(c.lines[0], /^Let \$A/);
});

test('a problem without parts or setup still places its text; a missing setup is null', () => {
  assert.deepEqual(partContent(groups, problems, '3')!.lines.length, 1);
  assert.equal(setupContent(groups, '3'), null);
  assert.equal(partContent(groups, problems, 'zz'), null);
});

test('without structured groups the flat text is used', () => {
  assert.deepEqual(partContent(undefined, problems, '2a'), { heading: '2a', lines: ['Compute det(A)'] });
});

test('placement goes below the ink and earlier blocks, and stays on the page', () => {
  assert.equal(nextBlockY(0, [], 1056, 100), 48);
  assert.equal(nextBlockY(300, [], 1056, 100), 324);
  assert.equal(nextBlockY(300, [{ y: 400, h: 120 }], 1056, 100), 544);
  assert.equal(nextBlockY(1000, [], 1056, 100), 1056 - 100 - 24);
  assert.equal(nextBlockY(Number.NaN, [], 1056, 100), 48);
});

test('estimated height grows with text and is finite for empty content', () => {
  const short = estimateHeight({ heading: 'x', lines: ['a'] });
  const long = estimateHeight({ heading: 'x', lines: ['a '.repeat(400)] });
  assert.ok(long > short && Number.isFinite(short));
});

test('dragging is clamped to the page', () => {
  assert.deepEqual(clampBlock({ x: -50, y: -9, w: 720 }, 816, 1056), { x: 0, y: 0 });
  assert.deepEqual(clampBlock({ x: 500, y: 5000, w: 720 }, 816, 1056), { x: 96, y: 1016 });
});
