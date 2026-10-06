import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAlgebraGuard } from './guard.ts';
import type { LineVerdict } from '../ai/types.ts';

const L = (id: string, reading: string, verdict: LineVerdict['verdict'] = 'valid', part = '1a'): LineVerdict => ({ id, reading, verdict, note: 'ok', part });
const verdicts = (ls: LineVerdict[]) => ls.map((l) => l.verdict);

test('a model-approved algebra slip is lowered, with a question not a fix', () => {
  const out = applyAlgebraGuard([L('L1', '2x+3=7'), L('L2', '2x=10')]);
  assert.deepEqual(verdicts(out), ['valid', 'partial']);
  assert.equal(out[1].guard, 'algebra');
  assert.match(out[1].note, /does not follow from L1/);
  assert.doesNotMatch(out[1].note, /x\s*=\s*2/);
});

test('correct steps are untouched (same array returned)', () => {
  const input = [L('L1', '2x+3=7'), L('L2', '2x=4'), L('L3', 'x=2')];
  assert.equal(applyAlgebraGuard(input), input);
});

test('never raises a verdict', () => {
  const out = applyAlgebraGuard([L('L1', '2x+3=7'), L('L2', '2x=4', 'incorrect')]);
  assert.equal(out[1].verdict, 'incorrect');
});

test('a correction after a wrong line is not penalised', () => {
  const out = applyAlgebraGuard([L('L1', '2x+3=7', 'incorrect'), L('L2', 'x=2')]);
  assert.deepEqual(verdicts(out), ['incorrect', 'valid']);
});

test('unreadable, context and unparseable lines are skipped; new part resets', () => {
  const out = applyAlgebraGuard([
    L('L1', '2x+3=7'),
    L('L2', '???', 'unreadable'),
    L('L3', 'x = 2 or x = 3'),
    L('L4', 'y = 5', 'valid', '1b'),
  ]);
  assert.deepEqual(verdicts(out), ['valid', 'unreadable', 'valid', 'valid']);
});

test('line order follows the id number, not array order or string order', () => {
  const out = applyAlgebraGuard([L('L10', '2x=10'), L('L2', '2x+3=7')]);
  assert.deepEqual(out.map((l) => l.id), ['L10', 'L2']);
  assert.equal(out[0].verdict, 'partial');
});

test('broken chain of equalities is flagged', () => {
  const out = applyAlgebraGuard([L('L1', '(x+1)^2 = x^2+1 = 2')]);
  assert.equal(out[0].verdict, 'partial');
});

test('a low-confidence reading never keeps a graded verdict (reading guard)', async () => {
  const { applyReadingGuard } = await import('./guard.ts');
  const out = applyReadingGuard([
    { ...L('L1', '2x+3=7'), readConfidence: 'low', uncertain: '+3' },
    { ...L('L2', '2x=10', 'incorrect'), readConfidence: 'low' },
    { ...L('L3', 'x=2'), readConfidence: 'medium' },
    { ...L('L4', 'Given', 'context'), readConfidence: 'low' },
  ]);
  assert.deepEqual(verdicts(out), ['unreadable', 'unreadable', 'valid', 'context']);
  assert.equal(out[0].guard, 'reading');
  assert.equal(out[0].modelVerdict, 'valid');
  assert.match(out[0].note, /\+3/);
  assert.equal(out[1].modelVerdict, 'incorrect');
});

test('reading guard returns the same array when nothing is low confidence', async () => {
  const { applyReadingGuard } = await import('./guard.ts');
  const input = [{ ...L('L1', 'x=2'), readConfidence: 'high' as const }, L('L2', 'y=3')];
  assert.equal(applyReadingGuard(input), input);
});
