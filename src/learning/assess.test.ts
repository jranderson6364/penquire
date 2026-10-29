import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSubmission, COULD_NOT_ASSESS } from './assess.ts';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask } from './demoPack.ts';
import type { CheckResult, LineVerdict, PartStatus } from '../ai/types';

const task = demoTask(DEMO_TASK_IDS.independent);
const EXPLAIN = 'The 3 multiplies every term inside the parentheses, both the 2y and the 1.';

const line = (id: string, reading: string, extra: Partial<LineVerdict> = {}): LineVerdict => ({
  id, reading, verdict: 'valid', note: '', readConfidence: 'high', ...extra,
});
const check = (lines: LineVerdict[], parts: PartStatus[] = [{ label: '1', status: 'complete', missing: [] }]): CheckResult => ({
  lines, parts, feedback: '', question: '', fixedSinceLast: [], stillOpen: [], model: 'fixture',
});
const run = (c: CheckResult) => assessSubmission(task, c, 'snap-7', 5000);

const correct = [line('L1', '3(2y + 1) = 33'), line('L2', '6y + 3 = 33'), line('L3', '6y = 30'), line('L4', 'y = 5'), line('L5', EXPLAIN)];

test('a correct solution with an explanation passes', () => {
  const a = run(check(correct));
  assert.equal(a.result, 'pass', a.reasons.join(' | '));
  assert.equal(a.source, 'provider+rubric');
  assert.equal(a.packVersion, DEMO_PACK.version);
  assert.equal(a.snapshotId, 'snap-7');
  assert.equal(a.at, 5000);
});

test('the alternative route (divide by 3 first) passes', () => {
  const a = run(check([
    line('L1', '3(2y + 1) = 33'), line('L2', '2y + 1 = 11'), line('L3', '2y = 10'), line('L4', '5 = y'),
    line('L5', 'Dividing both sides by 3 first undoes the multiplication on the whole bracket.'),
  ]));
  assert.equal(a.result, 'pass', a.reasons.join(' | '));
});

test('sides written the other way round still count as the key step', () => {
  const a = run(check([line('L1', '33 = 3 + 6y'), line('L2', '30 = 6y'), line('L3', 'y = 5'), line('L4', EXPLAIN)]));
  assert.equal(a.result, 'pass', a.reasons.join(' | '));
});

test('a substitution check after the answer still passes, wherever the explanation is', () => {
  assert.equal(run(check([...correct, line('L6', '3(2·5 + 1) = 33')])).result, 'pass');
  const reordered = [...correct.slice(0, 4), line('L5', EXPLAIN), line('L6', '3(2 * 5 + 1) = 3 * 11 = 33')];
  assert.equal(run(check(reordered)).result, 'pass');
  // a wrong check the model marked incorrect still fails
  assert.equal(run(check([...correct, line('L6', '3 * 11 = 34', { verdict: 'incorrect' })])).result, 'needs_practice');
});

test('several equations on one line count', () => {
  for (const lines of [
    [line('L1', '3(2y + 1) = 33'), line('L2', '6y + 3 = 33'), line('L3', '6y = 30 so y = 5'), line('L4', EXPLAIN)],
    [line('L1', '6y + 3 = 33 → 6y = 30'), line('L2', 'y = 5.'), line('L3', EXPLAIN)],
    [line('L1', '3(2y + 1) = 6y + 3 = 33'), line('L2', '6y = 30, y = 5'), line('L3', EXPLAIN)],
  ]) {
    const a = run(check(lines));
    assert.equal(a.result, 'pass', `${lines.map((l) => l.reading).join(' / ')}: ${a.reasons.join(' | ')}`);
  }
  // a bogus equation hidden in a combined line is still caught
  const a = run(check([line('L1', '3(2y + 1) = 33'), line('L2', '6y + 3 = 33 so 6y = 31'), line('L3', 'y = 5'), line('L4', EXPLAIN)]));
  assert.equal(a.result, 'needs_practice');
});

test('the distribution error needs practice', () => {
  const a = run(check([
    line('L1', '3(2y + 1) = 33'),
    line('L2', '6y + 1 = 33', { verdict: 'incorrect', obstacle: 'misconception' }),
    line('L3', '6y = 32', { verdict: 'incorrect' }),
    line('L4', 'y = 16/3', { verdict: 'incorrect' }),
    line('L5', EXPLAIN),
  ]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /final value on L4 is not right/.test(r)));
  assert.ok(a.reasons.some((r) => /parentheses/.test(r)));
});

test('the right final number with a bogus step is not a pass, even if the model called every line valid', () => {
  const lines = [line('L1', '3(2y + 1) = 33'), line('L2', '6y + 1 = 33'), line('L3', '6y = 30'), line('L4', 'y = 5'), line('L5', EXPLAIN)];
  const a = run(check(lines));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /final number is right, but L2/.test(r)), a.reasons.join(' | '));
});

test('the right number with the distribution skipped is not a pass', () => {
  const a = run(check([line('L1', '3(2y + 1) = 33'), line('L2', '6y = 30'), line('L3', 'y = 5'), line('L4', EXPLAIN)]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /not shown/.test(r)));
});

test('a bare answer is not a pass', () => {
  assert.equal(run(check([line('L1', 'y = 5')])).result, 'needs_practice');
});

test('an ambiguous symbol on a step cannot be assessed', () => {
  for (const extra of [{ readConfidence: 'low' as const, uncertain: 'y' }, { verdict: 'unreadable' as const }, { guard: 'reading' as const, verdict: 'partial' as const }]) {
    const lines = correct.map((l) => (l.id === 'L2' ? { ...l, reading: '6y + 3 = 38', ...extra } : l));
    const a = run(check(lines));
    assert.equal(a.result, 'unassessable');
    assert.equal(a.reasons[0], COULD_NOT_ASSESS);
    assert.ok(a.reasons[1].includes('L2'));
  }
});

test('a missing explanation needs practice', () => {
  const a = run(check(correct.slice(0, 4), [{ label: '1', status: 'missing_items', missing: ['explanation'] }]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /explanation/.test(r)));
});

test('an explanation the provider flagged as missing an item needs practice', () => {
  const a = run(check(correct, [{ label: '1', status: 'missing_items', missing: ['why both terms are multiplied'] }]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => r.includes('why both terms are multiplied')));
});

test('a blank page cannot be assessed; context lines are ignored', () => {
  assert.equal(run(check([])).result, 'unassessable');
  assert.equal(run(check([line('L1', 'Problem 1', { verdict: 'context' })])).result, 'unassessable');
  assert.equal(run(check([line('L0', 'Find y', { verdict: 'context', readConfidence: 'low' }), ...correct])).result, 'pass');
});

test('a wrong final answer needs practice', () => {
  const lines = [line('L1', '3(2y + 1) = 33'), line('L2', '6y + 3 = 33'), line('L3', '6y = 30'), line('L4', 'y = 6', { verdict: 'incorrect' }), line('L5', EXPLAIN)];
  assert.equal(run(check(lines)).result, 'needs_practice');
});

test('tasks without an explanation requirement do not need one', () => {
  const review = demoTask(DEMO_TASK_IDS.recovery);
  const a = assessSubmission(review, check([line('L1', '2(3x - 4) = 10'), line('L2', '6x - 8 = 10'), line('L3', '6x = 18'), line('L4', 'x = 3')]), 's', 1);
  assert.equal(a.result, 'pass', a.reasons.join(' | '));
});
