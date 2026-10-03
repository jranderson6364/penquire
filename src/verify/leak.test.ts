import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMath, findLeak, scrubText, type LeakContext } from './leak.ts';
import { applyLeakGuard, applyReplyLeakGuard } from './guard.ts';
import { escalate, issueKey, pruneLadder, rungFor } from '../tutor/ladder.ts';
import type { CheckResult, LineVerdict } from '../ai/types.ts';

const ctxAt = (level: 0 | 1 | 2 | 3 | 4): LeakContext => ({
  level,
  lines: [
    { id: 'L1', reading: '2x + 3 = 7', verdict: 'valid' },
    { id: 'L2', reading: '2x = 10', verdict: 'incorrect' }, // the student's slip
  ],
});

test('extracts math from dollars, backticks and bare prose', () => {
  const m = extractMath('Try $2x = 4$ and also `x = 2`. So we get y = 3x + 1 here.');
  assert.ok(m.includes('2x = 4'));
  assert.ok(m.includes('x = 2'));
  assert.ok(m.some((f) => f.startsWith('y = 3x')));
});

test('the corrected step is a leak at levels 0-3', () => {
  const leak = findLeak('You should have gotten $2x = 4$ there.', ctxAt(1));
  assert.equal(leak?.why === 'corrected-step' || leak?.why === 'solved-form', true);
});

test('a final numeric answer is a leak at EVERY level', () => {
  for (const level of [0, 1, 2, 3, 4] as const) {
    assert.equal(findLeak('The answer is x = 2.', ctxAt(level))?.why, 'final-answer', `level ${level}`);
  }
});

test('level 4 may explain the next step in words and one formula', () => {
  assert.equal(findLeak('Subtract 3 from both sides to get $2x = 4$.', ctxAt(4)), null);
});

test('quoting the student\'s own line is not a leak', () => {
  assert.equal(findLeak('Look at $2x = 10$. Does that follow from $2x + 3 = 7$?', ctxAt(1)), null);
});

test('math unrelated to the student\'s work (an analogous example) is fine', () => {
  assert.equal(findLeak('For example, with $3y + 1 = 10$ you would first subtract 1.', ctxAt(3)), null);
  assert.equal(findLeak('Newton\'s second law: $F = ma$.', ctxAt(2)), null);
});

test('prose with no math is never blocked', () => {
  assert.equal(findLeak('What did you do to both sides between L1 and L2?', ctxAt(1)), null);
});

test('scrub removes only the leaking sentence and keeps markdown lines', () => {
  const { text, leaks } = scrubText('- Check L2.\n- The answer is x = 2.\n- Does L2 follow from L1?', ctxAt(1));
  assert.equal(leaks.length, 1);
  assert.equal(text, '- Check L2.\n- Does L2 follow from L1?');
});

const verdict = (id: string, reading: string, v: LineVerdict['verdict']): LineVerdict => ({ id, reading, verdict: v, note: 'ok' });
const result = (question: string, feedback = 'Looks close.'): CheckResult => ({
  lines: [verdict('L1', '2x + 3 = 7', 'valid'), verdict('L2', '2x = 10', 'incorrect')],
  parts: [],
  feedback,
  question,
  fixedSinceLast: [],
  stillOpen: [],
  model: 'm',
});

test('leaking question is replaced by a content-free one naming only line IDs', () => {
  const out = applyLeakGuard(result('Why is x = 2 and not 5?'), 1);
  assert.match(out.question, /L2/);
  assert.match(out.question, /L1/);
  assert.doesNotMatch(out.question, /x\s*=\s*2/);
  assert.equal(out.leaksBlocked?.length, 1);
});

test('clean results are returned unchanged (same object)', () => {
  const r = result('What did you do to both sides?');
  assert.equal(applyLeakGuard(r, 1), r);
});

test('ladder: per-issue rungs, clamped to policy, reset when fixed', () => {
  const key = issueKey('1a', '2x = 10');
  let e = escalate({}, key, 1, 3);
  assert.equal(e.level, 2);
  e = escalate(e.ladder, key, 1, 3);
  assert.equal(e.level, 3);
  e = escalate(e.ladder, key, 1, 3);
  assert.equal(e.level, 3);
  assert.equal(e.atCeiling, true);
  // another issue is unaffected
  assert.equal(rungFor(e.ladder, issueKey('1a', 'y = 4'), 1, 3), 1);
  // policy lowered after the fact still wins
  assert.equal(rungFor(e.ladder, key, 1, 2), 2);
  // fixed issues are pruned
  assert.deepEqual(pruneLadder(e.ladder, []), {});
  assert.equal(issueKey('1a', '2x=10'), issueKey('1a', '2x = 10'));
});

test('chat replies are guarded too: leaking sentence removed, clean reply untouched', () => {
  const lines = [
    { id: 'L1', reading: '2x + 3 = 7', verdict: 'valid' },
    { id: 'L2', reading: '2x = 10', verdict: 'incorrect' },
  ];
  assert.equal(applyReplyLeakGuard('Look at L2 again. The answer is x = 2.', lines, 1), 'Look at L2 again.');
  const clean = 'What did you do to both sides between L1 and L2?';
  assert.equal(applyReplyLeakGuard(clean, lines, 1), clean);
  assert.match(applyReplyLeakGuard('x = 2.', lines, 1), /L2/);
  // no transcribed lines (no check yet): nothing to compare against, reply passes through
  assert.equal(applyReplyLeakGuard('x = 2.', [], 1), 'x = 2.');
});
