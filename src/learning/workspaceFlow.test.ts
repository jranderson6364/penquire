import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import { lineInkSig, recordAssistance, startEpisode } from './session.ts';
import type { Assistance, Snapshot } from './types';
import {
  MOVE_TITLE, fallbackMove, flagFrom, levelMove, needsInitialSnap, phaseLabel, pivotPolicy, repairedAfter, replacementValid,
  withSnapshot, workAttemptId, workTaskId, GIVEN_LINE_ID, REJECTED_LINE_ID, givenFor, replyGuardLines, isDoneQuestion, doneVerdict, checkSaysDone,
} from './workspaceFlow.ts';
import { applyReplyLeakGuard } from '../verify/guard.ts';
import { DEMO_TASK_IDS, TASK_GIVENS } from './demoPack.ts';
import { speakable } from '../voice/text.ts';

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

const onRecovery = () => {
  const ep = ep0();
  return { ...ep, attempts: { [ep.initialAttemptId!]: { ...ep.attempts[ep.initialAttemptId!], taskId: DEMO_TASK_IDS.recovery } } };
};

test('a stale-page reply stating the answer is still scrubbed: the guard keeps the old lines and gets the setup', () => {
  // the only check read the forgotten-height line (incorrect); the page has moved on since
  const stale = [{ id: 'L1', reading: '15t - 5t^2 = 0', verdict: 'incorrect' }];
  const reply = 'Nice, you have the starting height in now. So t = 4 s is your answer.';
  // the gap: t = 4 doesn't satisfy the wrong line, so the old lines alone let it through
  assert.equal(applyReplyLeakGuard(reply, stale, 1), reply);
  const lines = replyGuardLines(stale, givenFor(onRecovery()), true);
  assert.deepEqual(lines.map((l) => l.id), ['L1', GIVEN_LINE_ID, GIVEN_LINE_ID, REJECTED_LINE_ID]);
  const out = applyReplyLeakGuard(reply, lines, 1);
  assert.ok(!/t\s*=\s*4/.test(out), out);
  assert.match(out, /starting height in now/);
  // spoken replies write plain symbols too, so the same guard sees them
  assert.ok(!/4/.test(applyReplyLeakGuard('Yes. It lands after 4 seconds.', lines, 1)));
});

test("stale: the student's own fix survives in a reply, the answer does not; current: a corrected setup is still caught", () => {
  const old = [{ id: 'L1', reading: '20 + 15t + 5t^2 = 0', verdict: 'incorrect' }];
  const given = TASK_GIVENS[DEMO_TASK_IDS.recovery];
  const stale = replyGuardLines(old, given, true);
  const fix = 'Yes, the line with 20 + 15t - 5t^2 = 0 is right. What comes next?';
  assert.equal(applyReplyLeakGuard(fix, stale, 1), fix);
  // Unicode minus and superscript are read as maths too (T15), so this is the same fix, and it survives
  assert.equal(applyReplyLeakGuard('Yes, the line with 20 + 15t − 5t² = 0 is right.', stale, 1), 'Yes, the line with 20 + 15t − 5t² = 0 is right.');
  assert.ok(!/t\s*=\s*4/.test(applyReplyLeakGuard('Right. So t = 4.', stale, 1)));
  // the page hasn't changed: the fix is not on it, and saying it is the corrected setup
  const current = replyGuardLines(old, given, false);
  assert.deepEqual(current.map((l) => l.id), [GIVEN_LINE_ID, GIVEN_LINE_ID, REJECTED_LINE_ID, 'L1']);
  assert.deepEqual(current.map((l) => l.role), ['hidden', 'hidden', 'sayable', undefined]);
  assert.ok(!applyReplyLeakGuard('Close. It should be 20 + 15t - 5t^2 = 0. Check the sign.', current, 1).includes('20 + 15t - 5t^2'));
});

test('spoken replies use ASCII maths, which the voice reads as words', () => {
  assert.equal(speakable('Look at the line with 15t - 5t^2 = 0.'), 'Look at the line with 15t minus 5t squared equals 0.');
});

test('with no check yet the setup alone keeps the guard on; outside the demo pack there is no setup', () => {
  const lines = replyGuardLines(undefined, TASK_GIVENS[DEMO_TASK_IDS.recovery]);
  assert.ok(!/t\s*=\s*4/.test(applyReplyLeakGuard('The answer is t = 4 s.', lines, 1)));
  // talk about the situation and the prompt's own numbers passes
  const talk = 'Start from the ground: the ball begins 20 m up with 15 m/s, and g = 10 m/s^2 pulls it down.';
  assert.equal(applyReplyLeakGuard(talk, lines, 1), talk);
  assert.equal(givenFor(ep0()), undefined);
  assert.equal(givenFor(undefined), undefined);
  assert.equal(workTaskId(onRecovery()), DEMO_TASK_IDS.recovery);
  assert.deepEqual(replyGuardLines(undefined), []);
  // a setup printed in the prompt (stated) is quotable, as before T15
  const stated = replyGuardLines(undefined, { equation: '2(3x - 4) = 10', stated: true });
  assert.equal(stated[0].role, undefined);
  assert.equal(applyReplyLeakGuard('Start from 2(3x - 4) = 10.', stated, 1), 'Start from 2(3x - 4) = 10.');
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
  const t = doneVerdict(done([vd('L1', 'context', '[sketch: cliff 20 m, ball thrown up, up positive]'), vd('L2', 'valid', '20 + 15t - 5t^2 = 0'), vd('L3', 'valid', 't = 4 s')]), false, DEMO_TASK_IDS.recovery);
  assert.equal(t, "That's correct. You're done with this one.");
  assert.ok(!t!.includes('?'));
  // the same check found again (nothing changed since) gives the same answer
  assert.equal(doneVerdict({ kind: 'unchanged', result: done([vd('L1', 'valid', 'x=3')]).result }), t);
  // a verified repair names the next step, which the Try a fresh problem card now offers
  const v = doneVerdict(done([vd('L1', 'valid', 'x=3')]), true);
  assert.ok(v!.startsWith("That's correct. You're done with this one.") && v!.includes('Try a fresh problem'));
});

test('otherwise the verdict points at the earliest open line by what it says, never by its number', () => {
  const t = doneVerdict(done([vd('L2', 'incorrect', 't = 3 s'), vd('L1', 'incorrect', '15t - 5t^2 = 0')], [{ status: 'in_progress' }], ['starting height']));
  assert.equal(t, 'Not yet. Take another look at the line with 15t - 5t^2 = 0.');
  assert.doesNotMatch(t!, /\bL\d|line \d/);
  // the check's guiding question is said too, unless it names a line number
  const withQ = (question: string) => {
    const o = done([vd('L1', 'incorrect', '15t - 5t^2 = 0')], [{ status: 'in_progress' }]);
    return doneVerdict({ ...o, result: { ...o.result, question } } as typeof o);
  };
  assert.equal(withQ('What does the 0 on the right say about where the ball is?'), 'Not yet. Take another look at the line with 15t - 5t^2 = 0. What does the 0 on the right say about where the ball is?');
  assert.equal(withQ('Look again at L3: what does the 0 mean?'), 'Not yet. Take another look at the line with 15t - 5t^2 = 0.');
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

test('a sketch never blocks done: context lines with or without a reading', () => {
  const lines = [vd('L1', 'context', '[sketch: cliff 20 m, +y up, g down]'), vd('L2', 'context', ''), vd('L3', 'valid', '20 + 15t - 5t^2 = 0'), vd('L4', 'valid', 't = 4 s')];
  assert.equal(checkSaysDone(done(lines).result), true);
  assert.equal(doneVerdict(done(lines), false, DEMO_TASK_IDS.recovery), "That's correct. You're done with this one.");
});

test('"done" on a page whose final value does not fit the task is not done, whatever the verdicts (T15)', () => {
  // the "thought I was done" moment: the model called the forgotten-height work valid
  const edge = [vd('L1', 'valid', '15t - 5t^2 = 0'), vd('L2', 'valid', String.raw`t = 3\,\mathrm{s}`)];
  const t = doneVerdict(done(edge), false, DEMO_TASK_IDS.recovery);
  assert.equal(t, 'Not yet. Check your final answer against the situation in the problem.');
  assert.doesNotMatch(t!, /4|20|height|zero/);
  // keeping the rejected root as the last value
  assert.match(doneVerdict(done([vd('L1', 'valid', '20 + 15t - 5t^2 = 0'), vd('L2', 'valid', 't = -1 s')]), true, DEMO_TASK_IDS.recovery)!, /^Not yet/);
  // outside the pack the verdicts are all there is
  assert.equal(doneVerdict(done(edge)), "That's correct. You're done with this one.");
});
