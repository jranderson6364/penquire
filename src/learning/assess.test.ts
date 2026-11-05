import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSubmission, COULD_NOT_ASSESS, equationsOf, finalMisfits } from './assess.ts';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask } from './demoPack.ts';
import type { CheckResult, LineVerdict, PartStatus } from '../ai/types';

// Readings are written the way the check model transcribes (src/ai/claude.ts): LaTeX maths, units in \mathrm{...},
// sometimes Unicode minus and superscripts.
const task = demoTask(DEMO_TASK_IDS.independent); // 15 m, 10 m/s, g = 10: t = 3 s
const EXPLAIN = 'The other solution, t = −1 s, is a time before the ball was thrown, so only t = 3 s answers the question.';
const SKETCH = '[sketch: balcony 15 m above the ground, ball thrown up at 10 m/s, up positive, g pointing down]';

const line = (id: string, reading: string, extra: Partial<LineVerdict> = {}): LineVerdict => ({
  id, reading, verdict: 'valid', note: '', readConfidence: 'high', ...extra,
});
const check = (lines: LineVerdict[], parts: PartStatus[] = [{ label: '1', status: 'complete', missing: [] }]): CheckResult => ({
  lines, parts, feedback: '', question: '', fixedSinceLast: [], stillOpen: [], model: 'fixture',
});
const run = (c: CheckResult, t = task) => assessSubmission(t, c, 'snap-7', 5000);
const why = (a: { reasons: string[] }) => a.reasons.join(' | ');

const correct = [
  line('L1', 'y = 15 + 10t - 5t^2'),
  line('L2', '0 = 15 + 10t - 5t^2'),
  line('L3', 't^2 - 2t - 3 = 0'),
  line('L4', '(t - 3)(t + 1) = 0'),
  line('L5', String.raw`t = 3\,\mathrm{s}`),
  line('L6', EXPLAIN),
];

test('a correct solution with an explanation passes', () => {
  const a = run(check(correct));
  assert.equal(a.result, 'pass', why(a));
  assert.equal(a.source, 'provider+rubric');
  assert.equal(a.packVersion, DEMO_PACK.version);
  assert.equal(a.snapshotId, 'snap-7');
  assert.equal(a.at, 5000);
});

test('units on the answer: \\mathrm{s}, \\text{ s}, "s" and "seconds" all read as the number; no unit is fine', () => {
  for (const ans of [String.raw`t = 3\,\mathrm{s}`, String.raw`t = 3 \text{ s}`, 't = 3 s', 't = 3 seconds', 't = 3', '3 = t', String.raw`t = 3.0\,\mathrm{s}`]) {
    const a = run(check([...correct.slice(0, 4), line('L5', ans), correct[5]]));
    assert.equal(a.result, 'pass', `${ans}: ${why(a)}`);
  }
});

test('a final value with the wrong kind of unit, or a scaled unit, is not a pass', () => {
  const metres = run(check([...correct.slice(0, 4), line('L5', String.raw`t = 3\,\mathrm{m}`), correct[5]]));
  assert.equal(metres.result, 'needs_practice');
  assert.ok(metres.reasons.some((r) => /unit/.test(r)), why(metres));
  // minutes are not rescaled into seconds (conversion never loosens anything): the value is not read at all
  const minutes = run(check([...correct.slice(0, 4), line('L5', String.raw`t = 3\,\mathrm{min}`), correct[5]]));
  assert.equal(minutes.result, 'needs_practice');
});

test('the quadratic-formula route passes', () => {
  const a = run(check([
    line('L1', '15 + 10t - 5t^2 = 0'),
    line('L2', '5t^2 - 10t - 15 = 0'),
    line('L3', String.raw`t = \frac{10 \pm \sqrt{100 + 300}}{10}`), // ± is not parsed: the model's verdict stands for it
    line('L4', String.raw`t = \frac{10 + 20}{10} = 3\,\mathrm{s}`),
    line('L5', 'The minus sign gives t = −1 s, which is before the throw, so I reject it.'),
  ]));
  assert.equal(a.result, 'pass', why(a));
});

test('factoring straight from the setup, sides swapped, and Unicode minus/superscripts pass', () => {
  const a = run(check([line('L1', '−5t² + 10t + 15 = 0'), line('L2', '(t − 3)(t + 1) = 0'), line('L3', 't = 3 or t = −1'), line('L4', 't = 3 s'), line('L5', EXPLAIN)]));
  assert.equal(a.result, 'pass', why(a));
});

test('several equations on one line count', () => {
  for (const lines of [
    [line('L1', '15 + 10t - 5t^2 = 0 → t^2 - 2t - 3 = 0'), line('L2', '(t - 3)(t + 1) = 0 so t = 3 s'), line('L3', EXPLAIN)],
    [line('L1', 'y(t) = 15 + 10t - 5t^2 = 0'), line('L2', 't^2 - 2t - 3 = 0, t = 3'), line('L3', EXPLAIN)],
  ]) {
    const a = run(check(lines));
    assert.equal(a.result, 'pass', `${lines.map((l) => l.reading).join(' / ')}: ${why(a)}`);
  }
  // a bogus equation hidden in a combined line is still caught
  const a = run(check([line('L1', '15 + 10t - 5t^2 = 0 so t^2 - 2t - 5 = 0'), line('L2', 't = 3 s'), line('L3', EXPLAIN)]));
  assert.equal(a.result, 'needs_practice');
});

test('forgetting the starting height (time back at the launch point) needs practice, even if the model called it valid', () => {
  // independent numbers: 10t - 5t^2 = 0 gives t = 2 s
  const a = run(check([line('L1', '10t - 5t^2 = 0'), line('L2', 't(10 - 5t) = 0'), line('L3', 't = 2 s'), line('L4', 'The other solution t = 0 is the moment it is thrown, so it is not the answer.')]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /final value on L3 is not right/.test(r)), why(a));
  assert.ok(a.reasons.some((r) => /L1/.test(r) && /does not follow/.test(r)), why(a));
  assert.ok(a.reasons.some((r) => /key step is not shown/.test(r)), why(a));
});

test('on the recovery task, 15t − 5t² = 0 → t = 3 s (back at the cliff edge) is not a pass', () => {
  const recovery = demoTask(DEMO_TASK_IDS.recovery);
  const a = run(check([line('L1', '15t - 5t^2 = 0'), line('L2', '5t(3 - t) = 0'), line('L3', String.raw`t = 3\,\mathrm{s}`)]), recovery);
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /final value on L3/.test(r)), why(a));
});

test('a sign-of-g error needs practice', () => {
  const a = run(check([line('L1', '15 + 10t + 5t^2 = 0'), line('L2', 't^2 + 2t + 3 = 0'), line('L3', 't = 3 s'), line('L4', EXPLAIN)]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /L1, L2 does not follow/.test(r)), why(a));
});

test('keeping t = −1 as an answer needs practice; rejecting it with a reason does not count against you', () => {
  for (const [last, label] of [
    ['t = 3, −1', 'comma list'],
    ['t = 3 s or t = −1 s', 'or'],
    [String.raw`t = 3\,\mathrm{s} \text{ or } t = -1\,\mathrm{s}`, 'LaTeX or'],
  ] as const) {
    const a = run(check([...correct.slice(0, 4), line('L5', last), correct[5]]));
    assert.equal(a.result, 'needs_practice', `${label}: ${why(a)}`);
    assert.ok(a.reasons.some((r) => /L5 still gives a solution/.test(r)), `${label}: ${why(a)}`);
  }
  // the final value is −1
  const neg = run(check([...correct.slice(0, 4), line('L5', 't = 3'), line('L6', 't = −1 s'), { ...correct[5], id: 'L7' }]));
  assert.equal(neg.result, 'needs_practice');
  assert.ok(neg.reasons.some((r) => /final value on L6 is not right/.test(r)), why(neg));
  // both listed, then thrown out in words on the final line
  const ok = run(check([...correct.slice(0, 4), line('L5', 't = 3 s (t = −1 s is before the throw)'), correct[5]]));
  assert.equal(ok.result, 'pass', why(ok));
});

test('the right number with a bogus step is not a pass, even if the model called every line valid', () => {
  const a = run(check([line('L1', '15 + 10t - 5t^2 = 0'), line('L2', 't^2 - 2t - 5 = 0'), line('L3', 't = 3 s'), line('L4', EXPLAIN)]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => /final number is right, but L2/.test(r)), why(a));
});

test('a bare "t = 3 s" with no working, or with no explanation, is not a pass', () => {
  const bare = run(check([line('L1', 't = 3 s')]));
  assert.equal(bare.result, 'needs_practice');
  assert.ok(bare.reasons.some((r) => /key step is not shown/.test(r)), why(bare));
  assert.ok(bare.reasons.some((r) => /explanation/.test(r)), why(bare));
  const noWhy = run(check(correct.slice(0, 5), [{ label: '1', status: 'missing_items', missing: ['why one solution is rejected'] }]));
  assert.equal(noWhy.result, 'needs_practice');
  assert.ok(noWhy.reasons.some((r) => /explanation/.test(r)), why(noWhy));
});

test('an explanation the provider flagged as missing an item needs practice', () => {
  const a = run(check(correct, [{ label: '1', status: 'missing_items', missing: ['why the negative time is rejected'] }]));
  assert.equal(a.result, 'needs_practice');
  assert.ok(a.reasons.some((r) => r.includes('why the negative time is rejected')));
});

test('a sketch labelled context is ignored: it never blocks a pass or makes the attempt unassessable', () => {
  assert.equal(run(check([line('L0', SKETCH, { verdict: 'context' }), ...correct])).result, 'pass');
  // a sketch read as nothing, or with low confidence, is still fine when it is context
  assert.equal(run(check([line('L0', '', { verdict: 'context' }), ...correct])).result, 'pass');
  assert.equal(run(check([line('L0', '+y up, g', { verdict: 'context', readConfidence: 'low' }), ...correct])).result, 'pass');
  // labels the model read as their own lines ("+y up", "g") and called valid don't count as equations or as the answer
  const labels = run(check([line('L0', '+y up'), line('L01', 'g'), line('L02', String.raw`20\,\mathrm{m}`), ...correct]));
  assert.equal(labels.result, 'pass', why(labels));
});

test('a restated given after the answer does not become the final value', () => {
  const a = run(check([...correct, line('L7', String.raw`g = 10\,\mathrm{m/s^2}`), line('L8', String.raw`h = 15\,\mathrm{m}`)]));
  assert.equal(a.result, 'pass', why(a));
});

test('a substitution check after the answer still passes; a wrong one the model flagged fails', () => {
  assert.equal(run(check([...correct, line('L7', '15 + 10 \\cdot 3 - 5 \\cdot 9 = 0')])).result, 'pass');
  assert.equal(run(check([...correct, line('L7', '15 + 30 - 45 = 5', { verdict: 'incorrect' })])).result, 'needs_practice');
});

test('an ambiguous symbol on a step cannot be assessed', () => {
  for (const extra of [{ readConfidence: 'low' as const, uncertain: '2' }, { verdict: 'unreadable' as const }, { guard: 'reading' as const, verdict: 'partial' as const }]) {
    const lines = correct.map((l) => (l.id === 'L3' ? { ...l, reading: 't^2 - 2t - 8 = 0', ...extra } : l));
    const a = run(check(lines));
    assert.equal(a.result, 'unassessable');
    assert.equal(a.reasons[0], COULD_NOT_ASSESS);
    assert.ok(a.reasons[1].includes('L3'));
  }
});

test('a blank page cannot be assessed; context lines are ignored', () => {
  assert.equal(run(check([])).result, 'unassessable');
  assert.equal(run(check([line('L1', SKETCH, { verdict: 'context' })])).result, 'unassessable');
});

test('tasks without an explanation requirement do not need one', () => {
  const recovery = demoTask(DEMO_TASK_IDS.recovery);
  const a = run(check([line('L0', SKETCH.replace('balcony 15', 'cliff 20'), { verdict: 'context' }), line('L1', '20 + 15t - 5t^2 = 0'), line('L2', 't^2 - 3t - 4 = 0'), line('L3', '(t - 4)(t + 1) = 0'), line('L4', 't = 4 s')]), recovery);
  assert.equal(a.result, 'pass', why(a));
});

test('equationsOf reads units, "or" and chains', () => {
  assert.deepEqual(equationsOf(String.raw`t = 4\,\mathrm{s} \text{ or } t = -1\,\mathrm{s}`).map((w) => w.eq), ['t = 4', 't = -1']);
  assert.deepEqual(equationsOf('y(t) = 20 + 15t - 5t^2 = 0').map((w) => w.eq), ['y = 20 + 15t - 5t^2', '20 + 15t - 5t^2 = 0']);
});

test('finalMisfits: the last value of t must solve the task setup and not be the rejected root', () => {
  const rec = DEMO_TASK_IDS.recovery;
  assert.equal(finalMisfits([line('L1', '15t - 5t^2 = 0'), line('L2', 't = 3 s')], rec), true, 'cliff edge');
  assert.equal(finalMisfits([line('L1', '20 + 15t - 5t^2 = 0'), line('L2', 't = -1 s')], rec), true, 'rejected root');
  assert.equal(finalMisfits([line('L1', '20 + 15t - 5t^2 = 0'), line('L2', String.raw`t = 4\,\mathrm{s}`)], rec), false);
  // a two-stage route with an intermediate time is judged on its last value only
  assert.equal(finalMisfits([line('L1', 't = 1.5 s'), line('L2', '31.25 = 5t^2'), line('L3', 't = 1.5 + 2.5 = 4 s')], rec), false);
  assert.equal(finalMisfits([line('L1', '20 + 15t - 5t^2 = 0')], rec), false, 'no value yet');
  // the rejected root written last, but thrown out on its line: the final value is still t = 4
  const solvedThen = (last: string) => [line('L1', '20 + 15t - 5t^2 = 0'), line('L2', 't = 4 s'), line('L3', last)];
  for (const last of ['t = −1 s (before the throw)', 't = −1 s → reject', 't = −1 s ✗', String.raw`t = -1\,\mathrm{s} \text{ is not possible}`]) {
    assert.equal(finalMisfits(solvedThen(last), rec), false, last);
  }
  assert.equal(finalMisfits(solvedThen('t = −1 s'), rec), true, 'a bare trailing −1 is kept as the answer');
  assert.equal(finalMisfits([line('L1', 't = 3')], undefined), false, 'outside the pack');
});
