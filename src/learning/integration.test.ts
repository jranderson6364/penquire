// T10: a whole demo episode through the pure learning functions, with fixture CheckResults in place of the provider,
// then one variant per device-free row of docs/09 "Release-blocking demo cases".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult, LineVerdict, PartStatus } from '../ai/types';
import type { Line } from '../ink/lines';
import { assessSubmission } from './assess.ts';
import { independentCheckInput } from './context.ts';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask } from './demoPack.ts';
import { createGate } from './gate.ts';
import { helpReplyInput, independentAttemptId, linesToConfirm, liveMatchesSnapshot, outcomeRows } from './independentFlow.ts';
import { buildDemoEpisode, demoContent } from './seedData.ts';
import { learnerText } from './demoPack.ts';
import {
  REVIEW_DELAY_MS, applyAssessment, beginIndependent, clampMove, exitIndependentForHelp, invalidateOnEdit, markRepairVerified,
  outcomeLabels, recordAssistance, repairEvidence, scheduleReview, submitIndependent,
} from './session.ts';
import type { Assistance, Episode, Snapshot } from './types';
import { fallbackMove, flagFrom, pivotPolicy, replacementValid, workAttemptId, type Flag } from './workspaceFlow.ts';

// ---- fixtures ---------------------------------------------------------------------------------------------

const v = (id: string, reading: string, verdict: LineVerdict['verdict'] = 'valid', extra: Partial<LineVerdict> = {}): LineVerdict => ({
  id, reading, verdict, note: '', readConfidence: 'high', ...extra,
});
const result = (lines: LineVerdict[], parts: PartStatus[] = [{ label: '1', status: 'complete', missing: [] }]): CheckResult => ({
  lines, parts, feedback: '', question: '', fixedSinceLast: [], stillOpen: [], model: 'fixture',
});
const ink = (id: string, y: number, strokes: number[], w = 300): Line => ({ id, x: 40, y, w, h: 40, strokes });
const snapOf = (id: string, pageId: string, lines: Line[], at: number): Snapshot => ({ id, pageFile: `snapshots/${id}.pk`, strokeCount: lines.reduce((n, l) => n + l.strokes.length, 0), lines, at });
const PAGE = { base64: 'AAAA', mediaType: 'image/png' as const };
const EXPLAIN = 'The other solution, t = −1 s, is a time before the ball was thrown, so it is rejected.';

const help = (ep: Episode, move: Assistance['move'], level: Assistance['level'], at: number, over: Partial<Assistance> = {}) =>
  recordAssistance(ep, { attemptId: workAttemptId(ep), move, level, channels: ['text'], revealed: 'unknown', at, ...over }, `h${at}`);

const independentTask = demoTask(DEMO_TASK_IDS.independent);

/** The built-in fall from docs/12: L2 drops the 20 m starting height (15t − 5t² = 0 is the time back at the cliff edge). */
const firstAttempt = [ink('L1', 100, [0, 1, 2]), ink('L2', 160, [3, 4, 5])];
const firstCheck = result([v('L1', 'y = 20 + 15t - 5t^2'), v('L2', '15t - 5t^2 = 0', 'incorrect')]);
/** L2 erased and rewritten in the same place (new strokes, so a new signature), then the rest of the solution. */
const repairedPage = [ink('L1', 100, [0, 1, 2]), ink('L2', 162, [6, 7, 8, 9]), ink('L3', 220, [10, 11]), ink('L4', 280, [12])];
const repairedCheck = result([v('L1', 'y = 20 + 15t - 5t^2'), v('L2', '20 + 15t - 5t^2 = 0'), v('L3', '(t - 4)(t + 1) = 0'), v('L4', String.raw`t = 4\,\mathrm{s}`)]);

const freshLines = [ink('F1', 100, [0]), ink('F2', 160, [1]), ink('F3', 220, [2]), ink('F4', 280, [3]), ink('F5', 340, [4, 5, 6], 600)];
const freshCorrect = result([v('F1', '15 + 10t - 5t^2 = 0'), v('F2', 't^2 - 2t - 3 = 0'), v('F3', '(t - 3)(t + 1) = 0'), v('F4', String.raw`t = 3\,\mathrm{s}`), v('F5', EXPLAIN)]);

const start = (): Episode =>
  buildDemoEpisode(demoContent(DEMO_PACK, learnerText), { id: 'e1', pageId: 'p-demo', now: 1000 });

/** Workspace phase of the narrative (docs/12 steps 2–5), returning the verified episode. */
function recover(): Episode {
  let ep = start();
  const flag = flagFrom(firstAttempt, firstCheck.lines);
  assert.ok(flag, 'the forgotten height is flagged');
  ep = help(ep, 'pointer', 1, 2000, { channels: ['marks', 'text'] });
  assert.equal(ep.phase, 'repair');
  ep = help(ep, 'explain', 2, 3000);
  const ev = repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: repairedPage, nowValid: replacementValid(flag, repairedPage, repairedCheck.lines) });
  assert.equal(ev.verified, true, ev.reason);
  return markRepairVerified(ep, 4000);
}

/** Independent phase (docs/12 steps 6–8) up to the assessment, with a given check result. */
function independent(ep: Episode, check: CheckResult, lines = freshLines) {
  ep = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  const snap = snapOf('s-fresh', 'p-fresh', lines, 6000);
  ep = submitIndependent(ep, snap, [], 6000);
  const as = assessSubmission(independentTask, check, snap.id, 7000);
  return { ep: applyAssessment(ep, ep.independentAttemptId!, as), snap, as };
}

// ---- the whole loop -----------------------------------------------------------------------------------------

test('error → pointer → explain → repair verified → independent → submit → pass → review scheduled', () => {
  let ep = recover();
  assert.equal(ep.phase, 'repair_verified');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified']);

  // The independent request is built from the fresh task and its snapshot only.
  ep = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  assert.equal(ep.phase, 'independent');
  const at = ep.attempts[ep.independentAttemptId!];
  assert.equal(at.assistanceIds.length, 0, 'no help carries over');
  assert.notEqual(at.pageId, ep.attempts[ep.initialAttemptId!].pageId, 'a separate page');
  const snap = snapOf('s-fresh', 'p-fresh', freshLines, 6000);
  const input = JSON.stringify(independentCheckInput(independentTask, snap, PAGE));
  for (const t of DEMO_PACK.tasks) {
    if (t.id !== independentTask.id) assert.ok(!input.includes(t.prompt), `no ${t.role} prompt in the independent check`);
    for (const s of [t.expected.finalAnswer, t.expected.keyIdea, ...t.expected.acceptedSteps, ...t.expected.rubric, t.workedSolution ?? '\u0000']) {
      assert.ok(!input.includes(s), `no key text "${s}" from ${t.role}`);
    }
  }
  for (const k of ['previous', 'settled', 'confirmed', 'groups', 'focusPart', 'history', 'strokes']) assert.ok(!input.includes(`"${k}"`), `no ${k}`);

  ep = submitIndependent(ep, snap, [], 6000);
  assert.equal(ep.phase, 'independent_submitted');
  const as = assessSubmission(independentTask, freshCorrect, snap.id, 7000);
  assert.equal(as.result, 'pass', as.reasons.join(' | '));
  ep = applyAssessment(ep, ep.independentAttemptId!, as);
  ep = scheduleReview(ep, DEMO_TASK_IDS.review, 7000);
  assert.equal(ep.phase, 'outcome');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'passed_independent']);
  assert.equal(ep.reviewDueAt, 7000 + REVIEW_DELAY_MS);
  assert.equal(ep.delayedOutcome, undefined, 'a due date is not a delayed result');
  const rows = outcomeRows(ep);
  assert.equal(rows.repair.text, 'Repaired after an explanation');
  assert.equal(rows.fresh.label, 'passed_independent');

  // Relaunch: the stored JSON gives the same record.
  const back: Episode = JSON.parse(JSON.stringify(ep));
  assert.deepEqual(outcomeLabels(back), outcomeLabels(ep));
  assert.equal(back.reviewDueAt, ep.reviewDueAt);
  assert.equal(back.attempts[back.independentAttemptId!].snapshot?.id, 's-fresh');
  assert.equal(back.assistance.length, 2);
});

// ---- docs/09 release-blocking cases (the device-free ones) ----------------------------------------------

test('deliberate forgotten-height error: flagged, never validated by the repair check', () => {
  const flag = flagFrom(firstAttempt, firstCheck.lines)!;
  assert.equal(flag.sig.endsWith('#3'), true);
  // the same wrong step rewritten is new ink but not valid → no repair
  const stillWrong = result([v('L1', 'y = 20 + 15t - 5t^2'), v('L2', '15t - 5t^2 = 0', 'incorrect')]);
  assert.equal(replacementValid(flag, repairedPage, stillWrong.lines), false);
  assert.equal(repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: repairedPage, nowValid: false }).verified, false);
});

test('fully correct work: no flag, so nothing to repair and no manufactured issue', () => {
  assert.equal(flagFrom(repairedPage, repairedCheck.lines), null);
});

test('correct final answer with invalid reasoning: no independent pass', () => {
  const bogus = result([v('F1', '15 + 10t - 5t^2 = 0'), v('F2', 't^2 - 2t - 5 = 0'), v('F3', 't = 3 s'), v('F5', EXPLAIN)]);
  const { ep, as } = independent(recover(), bogus);
  assert.equal(as.result, 'needs_practice', 'the model called the bogus step valid; checkStep still catches it');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'needs_practice']);
  const bare = independent(recover(), result([v('F1', 't = 3 s')]));
  assert.equal(bare.as.result, 'needs_practice');
});

test('wrong answer: needs practice', () => {
  const wrong = result([v('F1', '10t - 5t^2 = 0', 'incorrect'), v('F2', '5t(2 - t) = 0', 'incorrect'), v('F3', 't = 2 s', 'incorrect'), v('F5', EXPLAIN)]);
  assert.deepEqual(outcomeLabels(independent(recover(), wrong).ep), ['repair_verified', 'needs_practice']);
});

test('ambiguous symbol: unassessable, never a pass', () => {
  const unsure = result([v('F1', '15 + 10t - 5t^2 = 0'), v('F2', 't^2 - 2t - 3 = 0', 'valid', { readConfidence: 'low' }), v('F3', 't = 3 s'), v('F5', EXPLAIN)]);
  const { ep, as } = independent(recover(), unsure);
  assert.equal(as.result, 'unassessable');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'could_not_assess']);
});

test('valid alternative approach (the quadratic formula): accepted', () => {
  const alt = result([v('F1', '5t^2 - 10t - 15 = 0'), v('F2', String.raw`t = \frac{10 \pm \sqrt{100 + 300}}{10}`), v('F3', String.raw`t = \frac{10 + 20}{10} = 3\,\mathrm{s}`), v('F5', 'The minus sign gives a negative time, before the throw, so I keep t = 3 s.')]);
  assert.deepEqual(outcomeLabels(independent(recover(), alt).ep), ['repair_verified', 'passed_independent']);
});

test('missing explanation when the task asks for one: needs practice', () => {
  const noWords = result(freshCorrect.lines.filter((l) => l.id !== 'F5'));
  assert.equal(independent(recover(), noWords).as.result, 'needs_practice');
});

test('bad line erased: no repair label', () => {
  const flag = flagFrom(firstAttempt, firstCheck.lines)!;
  const erased = [ink('L1', 100, [0, 1, 2])];
  assert.equal(repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: erased, nowValid: replacementValid(flag, erased, [v('L1', 'y = 20 + 15t - 5t^2')]) }).verified, false);
  // new ink elsewhere on the page does not count either
  const elsewhere = [...firstAttempt.filter((l) => l.id === 'L1'), ink('L9', 600, [9, 10])];
  assert.equal(repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: elsewhere, nowValid: replacementValid(flag, elsewhere, [v('L1', 't'), v('L9', 't = 4 s')]) }).verified, false);
});

test('tutor reversal on unchanged ink: a correction, not a repair', () => {
  const flag = flagFrom(firstAttempt, firstCheck.lines)!;
  const reversed = result([v('L1', 'y = 20 + 15t - 5t^2'), v('L2', '15t - 5t^2 = 0')]); // now called valid, ink untouched
  assert.equal(replacementValid(flag, firstAttempt, reversed.lines), false);
  const ev = repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: firstAttempt, nowValid: true });
  assert.deepEqual(ev, { verified: false, reason: 'flagged ink is unchanged' });
});

test('restricted help request: the existing cap holds and a useful allowed move is offered', () => {
  const ep = start();
  // an imported-style ceiling of 1 under the demo policy (3) stays 1
  const policy = pivotPolicy(ep, { policyMaxLevel: 1 });
  assert.equal(policy.maxLevel, 1);
  assert.ok('denied' in clampMove('explain', policy));
  assert.ok('denied' in clampMove('example', policy));
  assert.equal(fallbackMove('explain', policy), 'pointer');
  assert.equal(fallbackMove('example', { ...ep.policy, allowExample: false }), 'explain');
  assert.equal(fallbackMove('pointer', { maxLevel: 0, allowExplain: false, allowExample: false }), 'check');
  // the demo pack never widens a wider assignment: min() of both ceilings
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 4 }).maxLevel, 3);
});

test('request an example directly: allowed with no weaker help first', () => {
  const ep = start();
  assert.deepEqual(clampMove('example', pivotPolicy(ep, { policyMaxLevel: 3 })), { level: 3 });
  const next = help(ep, 'example', 3, 2000, { revealed: ['example'] });
  assert.equal(next.phase, 'repair');
  assert.equal(next.assistance.length, 1);
});

test('prior reply completes after the switch to independent: stale', async () => {
  const gate = createGate();
  const ep = start();
  gate.enter({ episodeId: ep.id, attemptId: workAttemptId(ep), phase: 'repair' });
  const s = gate.stamp();
  let resolve!: (x: string) => void;
  const late = gate.guard(new Promise<string>((r) => (resolve = r)), s);
  gate.enter({ episodeId: ep.id, attemptId: workAttemptId(ep), phase: 'independent' }); // "Try a fresh problem"
  gate.enter({ episodeId: ep.id, attemptId: independentAttemptId(ep.id), phase: 'independent' }); // the screen's own entry
  resolve('t = 4 s');
  assert.deepEqual(await late, { ok: false, stale: true });
  assert.equal(gate.isCurrent(s), false);
});

test('independent edit after submission: verdict invalidated, a late result for the old snapshot ignored', () => {
  const { ep: done, snap } = independent(recover(), freshCorrect);
  assert.equal(done.phase, 'outcome');
  let ep = invalidateOnEdit(done, done.independentAttemptId!, 8000);
  assert.equal(ep.phase, 'independent');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified']);
  // the old check finishing late does not come back
  const lateAs = assessSubmission(independentTask, freshCorrect, snap.id, 8500);
  assert.equal(applyAssessment(ep, ep.independentAttemptId!, lateAs), ep);
  // resubmit a new snapshot → a new result
  const snap2 = snapOf('s-fresh-2', 'p-fresh', freshLines, 9000);
  ep = submitIndependent(ep, snap2, [], 9000);
  ep = applyAssessment(ep, ep.independentAttemptId!, assessSubmission(independentTask, freshCorrect, snap2.id, 9500));
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'passed_independent']);
});

test('duplicate submit and duplicate assessment: one piece of evidence', () => {
  let ep = recover();
  ep = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  const snap = snapOf('s-fresh', 'p-fresh', freshLines, 6000);
  ep = submitIndependent(ep, snap, [], 6000);
  assert.equal(submitIndependent(ep, snap, [], 6100), ep);
  const needs = assessSubmission(independentTask, result([v('F1', 't = 3 s')]), snap.id, 7000);
  ep = applyAssessment(ep, ep.independentAttemptId!, needs);
  const pass = assessSubmission(independentTask, freshCorrect, snap.id, 7100);
  assert.equal(applyAssessment(ep, ep.independentAttemptId!, pass), ep, 'the first result wins');
});

test('help during the independent attempt: explicit exit, supported practice even with a pass', () => {
  let ep = recover();
  ep = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  // help without the exit is not recorded
  const id = ep.independentAttemptId!;
  assert.equal(recordAssistance(ep, { attemptId: id, move: 'explain', level: 2, channels: ['text'], revealed: 'unknown', at: 5100 }, 'hx'), ep);
  ep = exitIndependentForHelp(ep, 5200);
  ep = recordAssistance(ep, { attemptId: id, move: 'explain', level: 2, channels: ['text'], revealed: 'unknown', at: 5300 }, 'hx');
  const snap = snapOf('s-fresh', 'p-fresh', freshLines, 6000);
  ep = submitIndependent(ep, snap, [], 6000);
  ep = applyAssessment(ep, id, assessSubmission(independentTask, freshCorrect, snap.id, 7000));
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'supported_practice']);
  // the help reply's request holds only the fresh prompt, never its key or the recovery task
  const req = JSON.stringify(helpReplyInput(independentTask, 'how do I start?', 2, []));
  assert.ok(!req.includes(independentTask.expected.finalAnswer) && !req.includes(demoTask(DEMO_TASK_IDS.recovery).prompt));
});

test('provider/guard failure: work kept, no manufactured result', () => {
  let ep = recover();
  ep = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  ep = submitIndependent(ep, snapOf('s-fresh', 'p-fresh', freshLines, 6000), [], 6000);
  // the caller never calls assessSubmission on an error (T04/T08): the episode waits for Retry with its snapshot
  assert.equal(ep.phase, 'independent_submitted');
  assert.equal(ep.attempts[ep.independentAttemptId!].snapshot?.id, 's-fresh');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified']);
  assert.equal(ep.outcome, undefined);
});

test('a rehearsal assessment on a real episode never passes', () => {
  const ep = recover();
  const b = beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: independentTask.id, pageId: 'p-fresh', now: 5000 });
  const s = submitIndependent(b, snapOf('s-fresh', 'p-fresh', freshLines, 6000), [], 6000);
  const as = { ...assessSubmission(independentTask, freshCorrect, 's-fresh', 7000), source: 'rehearsal' as const };
  assert.deepEqual(outcomeLabels(applyAssessment(s, s.independentAttemptId!, as)), ['repair_verified', 'could_not_assess']);
});

test('the flag survives a relaunch only through the latest check (documented limit)', () => {
  // After relaunch WorkspaceScreen rebuilds the flag from the page's latest stored check. An erase-only check in
  // between stores a check with no flag, so the original flag is gone: the rewrite then cannot verify the repair.
  const erased = [ink('L1', 100, [0, 1, 2])];
  const afterErase = result([v('L1', 'y = 20 + 15t - 5t^2')]);
  const rebuilt: Flag | null = flagFrom(erased, afterErase.lines);
  assert.equal(rebuilt, null);
});

// ---- T10 reviewer findings (regressions) -------------------------------------------------------------------

test('a line read as nothing, or left out of the check, makes the attempt unassessable, not a pass', () => {
  const ids = freshLines.map((l) => l.id).concat('F6');
  const blank = result([...freshCorrect.lines, v('F6', '', 'unreadable')]);
  assert.equal(assessSubmission(independentTask, blank, 's', 1, ids).result, 'unassessable');
  assert.equal(assessSubmission(independentTask, blank, 's', 1).result, 'unassessable', 'even without the submitted ids');
  assert.deepEqual(linesToConfirm(blank).map((l) => l.id), ['F6'], 'the student is asked what it says');
  // confirmed with nothing typed, and the recheck now calls the line valid: still unread, still not a pass
  const confirmedBlank = result([...freshCorrect.lines, v('F6', '', 'valid')]);
  assert.equal(assessSubmission(independentTask, confirmedBlank, 's', 1, ids).result, 'unassessable');
  // the model returned five of six submitted lines
  assert.equal(assessSubmission(independentTask, freshCorrect, 's', 1, ids).result, 'unassessable');
  assert.equal(assessSubmission(independentTask, freshCorrect, 's', 1, freshLines.map((l) => l.id)).result, 'pass');
});

test('Retry after a relaunch exports the live page only when it is the loaded, unchanged submission', () => {
  const snap = snapOf('s', 'p-fresh', freshLines, 1);
  assert.equal(liveMatchesSnapshot(snap, { loaded: true, strokeCount: snap.strokeCount }), true);
  assert.equal(liveMatchesSnapshot(snap, { loaded: false, strokeCount: snap.strokeCount }), false, 'stored page never loaded');
  assert.equal(liveMatchesSnapshot(snap, { loaded: true, strokeCount: snap.strokeCount + 1 }), false, 'ink differs');
});
