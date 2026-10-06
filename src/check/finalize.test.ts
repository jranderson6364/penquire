import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCarry, mergeVerdicts } from './carry.ts';
import { guardMerged } from './finalize.ts';
import type { CheckResult, LineVerdict } from '../ai/types.ts';

const L = (id: string, reading: string, verdict: LineVerdict['verdict'] = 'valid', sig = id): LineVerdict => ({ id, reading, verdict, note: '', part: '1a', sig });
const result = (lines: LineVerdict[], extra: Partial<CheckResult> = {}): CheckResult => ({
  lines,
  parts: [],
  feedback: '',
  question: '',
  fixedSinceLast: [],
  stillOpen: [],
  model: 'test',
  ...extra,
});

test('a new wrong line right after a settled line is step-checked against it', () => {
  // Round 1 settled L1 and L2. The student adds L3, which does not follow from L2.
  const prev = [L('L1', '2x+3=7', 'valid', 'a'), L('L2', '2x=4', 'valid', 'b')];
  const current = [
    { id: 'L1', sig: 'a' },
    { id: 'L2', sig: 'b' },
    { id: 'L3', sig: 'c' },
  ];
  const plan = planCarry(current, prev);
  assert.deepEqual(plan.toGrade, ['L3']);
  // The model, seeing only L3, wrongly calls it valid; the provider guard had no previous line to compare with.
  const merged = mergeVerdicts(current, plan, [L('L3', 'x=5')]);
  const out = guardMerged(result(merged), 1);
  assert.equal(out.lines.find((l) => l.id === 'L3')?.verdict, 'partial');
  assert.equal(out.lines.find((l) => l.id === 'L3')?.guard, 'algebra');
  assert.match(out.lines.find((l) => l.id === 'L3')!.note, /does not follow from L2/);
});

test('a correct new line after a settled line is untouched (same object back)', () => {
  const r = result([L('L1', '2x+3=7'), L('L2', '2x=4'), L('L3', 'x=2')]);
  assert.equal(guardMerged(r, 1), r);
});

test('the leak guard sees settled readings: a question giving the corrected step is withheld', () => {
  const r = result([L('L1', '2x+3=7'), L('L2', '2x=10', 'incorrect')], { question: 'Is it 2x = 4?' });
  const out = guardMerged(r, 1);
  assert.notEqual(out.question, 'Is it 2x = 4?');
  assert.ok(out.leaksBlocked && out.leaksBlocked.length > 0);
});

test('earlier blocked leaks are kept when new ones are found', () => {
  const r = result([L('L1', '2x+3=7'), L('L2', '2x=10', 'incorrect')], { question: 'Is it 2x = 4?', leaksBlocked: [{ fragment: 'older', why: 'answer' }] });
  const out = guardMerged(r, 1);
  assert.ok(out.leaksBlocked?.some((b) => b.fragment === 'older'));
});
