import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import { lineInkSig, recordAssistance, startEpisode } from './session.ts';
import type { Assistance, Snapshot } from './types';
import {
  MOVE_TITLE, fallbackMove, flagFrom, levelMove, needsInitialSnap, phaseLabel, pivotPolicy, repairedAfter, replacementValid,
  withSnapshot, workAttemptId, GIVEN_LINE_ID, givenEquation, replyGuardLines, isDoneQuestion, doneVerdict, checkSaysDone,
} from './workspaceFlow.ts';
import { applyReplyLeakGuard } from '../verify/guard.ts';
import { DEMO_TASK_IDS } from './demoPack.ts';

const line = (id: string, y: number, strokes: number[]): Line => ({ id, x: 10, y, w: 200, h: 30, strokes });
const v = (id: string, verdict: LineVerdict['verdict']): LineVerdict => ({ id, reading: id, verdict, note: '' });
const ep0 = () => startEpisode({
  id: 'e', assignmentId: 'a', skillId: 's', packVersion: 'v', policy: { maxLevel: 3, allowExplain: true, allowExample: true },
  taskId: 't', pageId: 'p', rehearsal: false, now: 1,
});
const snap = (id: string): Snapshot => ({ id, pageFile: `snapshots/${id}.pk`, strokeCount: 0, lines: [], at: 1 });

test('flagFrom takes the first incorrect or partial line, as its ink signature', () => {
  const lines = [line('L1', 0, [0]), line('L2', 40, [1, 2]), line('L3', 80, [3])];
  const f = flagFrom(lines, [v('L1', 'valid'), v('L2', 'partial'), v('L3', 'incorrect')]);
  assert.deepEqual(f, { sig: lineInkSig(lines[1]), before: lines });
  assert.equal(flagFrom(lines, [v('L1', 'valid'), v('L3', 'unreadable')]), null);
  assert.equal(flagFrom(lines, [v('L9', 'incorrect')]), null, 'a verdict for an unknown line');
});

test('replacementValid: every new line in the flagged place must be valid', () => {
  const before = [line('L1', 0, [0]), line('L2', 40, [1])];
  const flag = flagFrom(before, [v('L1', 'valid'), v('L2', 'incorrect')])!;
  const after = [line('L1', 0, [0]), line('L2', 42, [2, 3]), line('L3', 200, [4])];
  assert.equal(replacementValid(flag, after, [v('L1', 'valid'), v('L2', 'valid'), v('L3', 'incorrect')]), true, 'L3 is elsewhere');
  assert.equal(replacementValid(flag, after, [v('L2', 'partial')]), false);
  assert.equal(replacementValid(flag, after, []), false, 'no verdict is not valid');
  assert.equal(replacementValid(flag, before, [v('L2', 'valid')]), false, 'unchanged ink');
  assert.equal(replacementValid(flag, [line('L1', 0, [0])], [v('L1', 'valid')]), false, 'erased only');
  assert.equal(replacementValid({ sig: 'nope', before }, after, [v('L2', 'valid')]), false);
});

test('fallbackMove offers the strongest allowed move below the denied one', () => {
  const p = { maxLevel: 1 as const, allowExplain: true, allowExample: true };
  assert.equal(fallbackMove('example', p), 'pointer');
  assert.equal(fallbackMove('start', p), 'pointer');
  assert.equal(fallbackMove('step', { maxLevel: 3, allowExplain: true, allowExample: false }), 'explain');
  assert.equal(fallbackMove('check', p), undefined);
});

test('repairedAfter names the strongest delivered help', () => {
  const h = (level: Assistance['level']): Assistance => ({ id: `${level}`, episodeId: 'e', attemptId: 'x', move: levelMove(level), level, channels: ['text'], revealed: 'unknown', at: 1 });
  assert.equal(repairedAfter([]), 'Repaired');
  assert.equal(repairedAfter([h(1)]), 'Repaired after a pointer');
  assert.equal(repairedAfter([h(1), h(3), h(2)]), 'Repaired after an example');
});

test('labels and moves', () => {
  assert.equal(phaseLabel('repair'), 'Repairing with help');
  assert.equal(levelMove(0), 'check');
  assert.equal(levelMove(4), 'step');
  assert.equal(MOVE_TITLE.example, 'Show another example');
});

test('pivotPolicy never widens the assignment ceiling', () => {
  const ep = ep0();
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 0 }).maxLevel, 0);
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 4 }).maxLevel, 3);
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 2 }).allowExample, true, 'flags come from the episode; the level gate still denies example at 2');
});

test('work attempt, initial snapshot, and snapshots are never replaced', () => {
  let ep = ep0();
  assert.equal(workAttemptId(ep), 'e:initial');
  assert.equal(needsInitialSnap(ep), true);
  ep = withSnapshot(ep, 'e:initial', snap('s1'));
  assert.equal(needsInitialSnap(ep), false);
  assert.equal(withSnapshot(ep, 'e:initial', snap('s2')), ep);
  assert.equal(withSnapshot(ep, 'missing', snap('s3')), ep);
  ep = recordAssistance(ep, { attemptId: 'e:initial', move: 'pointer', level: 1, channels: ['text'], revealed: 'unknown', at: 2 }, 'h1');
  assert.equal(workAttemptId(ep), 'e:repair');
});

// ---- the reply leak guard on an out-of-date check ------------------------------------------------------------

test('a stale-page reply stating the answer is still scrubbed: the guard keeps the old lines and gets the given', () => {
  // T11 run 1: the only check read "6x - 4 = 10" (incorrect); the page had moved on to x = 3
  const stale = [{ id: 'L1', reading: '6x - 4 = 10', verdict: 'incorrect' }];
  const reply = 'Nice, the distribution is fixed now. So x = 3 is your answer.';
  // the gap: x = 3 doesn't satisfy the wrong line, so the old lines alone let it through
  assert.equal(applyReplyLeakGuard(reply, stale, 1), reply);
  const ep = ep0();
  const lines = replyGuardLines(stale, givenEquation({ ...ep, attempts: { [ep.initialAttemptId!]: { ...ep.attempts[ep.initialAttemptId!], taskId: DEMO_TASK_IDS.recovery } } }));
  assert.deepEqual(lines.map((l) => l.id), [GIVEN_LINE_ID, 'L1']);
  const out = applyReplyLeakGuard(reply, lines, 1);
  assert.ok(!/x\s*=\s*3/.test(out), out);
  assert.match(out, /distribution is fixed/);
  // spoken replies write plain symbols too, so the same guard sees them
  assert.ok(!/x\s*=\s*3/.test(applyReplyLeakGuard('Yes. You get x = 3.', lines, 1)));
});

test('with no check yet the given alone keeps the guard on; outside the demo pack there is no given', () => {
  const lines = replyGuardLines(undefined, '2(3x - 4) = 10');
  assert.ok(!/x\s*=\s*3/.test(applyReplyLeakGuard('The answer is x = 3.', lines, 1)));
  // the given itself and other talk pass
  assert.equal(applyReplyLeakGuard('Start from 2(3x - 4) = 10 and look at the two.', lines, 1), 'Start from 2(3x - 4) = 10 and look at the two.');
  assert.equal(givenEquation(ep0()), undefined);
  assert.equal(givenEquation(undefined), undefined);
  assert.deepEqual(replyGuardLines(undefined), []);
});

// ---- done questions ----------------------------------------------------------------------------------------------

test('asking whether the work is right or done is a done question (T11 run 1 wording included)', () => {
  for (const t of [
    'Is this right?',
    'is that correct',
    'Am I done?',
    'So madam, so am I done?',
    'Wait, did I finally do it right?',
    'OK, did I do it right?',
    'Yeah, OK how’s it looking?',
    'How about now? Is it good?',
    'Is that right now?',
    'did i get it',
    'Does this look right?',
    'Is my answer correct?',
    'Can you check my work?',
    'Have I got it right?',
    'Is this the right answer?',
  ])
    assert.equal(isDoneQuestion(t), true, t);
});

test('reasoning with a tag question, help requests and other questions go to the tutor', () => {
  for (const t of [
    "I'd distribute the two to get six x minus eight, is that right?",
    'I think I subtract a from both sides, right?',
    'Is it okay to divide first?',
    'Is this the right way to start?',
    "What's the answer?",
    "It's OK what's wrong here?",
    'How do I start?',
    'Why is it wrong?',
    'Eight',
    '',
  ])
    assert.equal(isDoneQuestion(t), false, t);
});

const vd = (id: string, verdict: LineVerdict['verdict'], reading = ''): LineVerdict => ({ id, part: '1', reading, verdict, note: '' }) as LineVerdict;
const done = (lines: LineVerdict[], parts: { status: 'complete' | 'in_progress' }[] = [{ status: 'complete' }], stillOpen: string[] = []) => ({
  kind: 'checked' as const,
  result: { lines, parts: parts.map((p) => ({ label: '1', missing: [], ...p })), stillOpen },
});

test('a check that is all valid and complete says plainly that the work is done, with no question', () => {
  const t = doneVerdict(done([vd('L1', 'context', '2(3x-4)=10'), vd('L2', 'valid', '6x-8=10'), vd('L3', 'valid', 'x=3')]));
  assert.equal(t, "That's correct. You're done with this one.");
  assert.ok(!t!.includes('?'));
  // the same check found again (nothing changed since) gives the same answer
  assert.equal(doneVerdict({ kind: 'unchanged', result: done([vd('L1', 'valid', 'x=3')]).result }), t);
});

test('otherwise the verdict points at the earliest open line by what it says, never by its number', () => {
  const t = doneVerdict(done([vd('L2', 'incorrect', 'x=14/6'), vd('L1', 'incorrect', '6x-4=10')], [{ status: 'in_progress' }], ['distribution']));
  assert.equal(t, 'Not yet. Take another look at the line with 6x-4=10.');
  assert.doesNotMatch(t!, /\bL\d|line \d/);
  assert.match(doneVerdict(done([vd('L1', 'valid', '6x-8=10'), vd('L2', 'unreadable')]))!, /couldn't read/);
  // correct so far but not finished, or a part not complete: not done
  assert.match(doneVerdict(done([vd('L1', 'valid', '6x-8=10')], [{ status: 'in_progress' }]))!, /isn't finished/);
  assert.match(doneVerdict(done([vd('L1', 'valid', '6x-8=10')], [{ status: 'complete' }], ['solve for x']))!, /isn't finished/);
  assert.equal(checkSaysDone(done([vd('L1', 'valid', 'x=3')], []).result), false, 'no parts: not provably complete');
  assert.equal(checkSaysDone(done([vd('L1', 'context', '2(3x-4)=10')]).result), false, 'nothing valid written');
});

test('a dropped check says nothing; a failed or empty one says so', () => {
  assert.equal(doneVerdict({ kind: 'dropped' }), undefined);
  assert.match(doneVerdict({ kind: 'error' })!, /couldn't finish/);
  assert.match(doneVerdict({ kind: 'empty' })!, /nothing on the page/);
});
