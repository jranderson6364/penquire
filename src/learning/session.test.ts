import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_DELAY_MS, applyAssessment, beginIndependent, clampMove, exitIndependentForHelp, invalidateOnEdit, lineInkSig,
  markRepairVerified, outcomeLabels, recordAssistance, repairEvidence, scheduleReview, startEpisode, submitIndependent,
} from './session.ts';
import type { Assessment, Assistance, Episode, EpisodePolicy, Snapshot } from './types.ts';
import type { Line } from '../ink/lines.ts';

const POLICY: EpisodePolicy = { maxLevel: 3, allowExplain: true, allowExample: true };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const start = (over: Partial<Parameters<typeof startEpisode>[0]> = {}) =>
  deepFreeze(startEpisode({
    id: 'ep1', assignmentId: 'demo', skillId: 'linear-eq', packVersion: 'pack-1', policy: POLICY,
    taskId: 'recovery', pageId: 'p1', rehearsal: false, now: 1000, ...over,
  }));

const help = (attemptId: string, at = 2000, over: Partial<Assistance> = {}): Omit<Assistance, 'id' | 'episodeId'> => ({
  attemptId, move: 'pointer', level: 1, channels: ['marks'], revealed: ['location'], at, ...over,
});

const line = (id: string, y: number, strokes: number[], x = 10, w = 200, h = 30): Line => ({ id, x, y, w, h, strokes });
const snap = (id: string, at: number): Snapshot => ({ id, pageFile: `snap/${id}.png`, strokeCount: 3, lines: [line('L1', 0, [0, 1, 2])], at });
const assessment = (snapshotId: string, result: Assessment['result'] = 'pass', at = 9000, source: Assessment['source'] = 'provider+rubric'): Assessment =>
  ({ result, reasons: ['ok'], source, packVersion: 'pack-1', snapshotId, at });

/** ep1 helped once, repair verified, independent attempt 'ind' open on page p2 */
function toIndependent(): Episode {
  let ep = recordAssistance(start(), help('ep1:initial'), 'h1');
  ep = markRepairVerified(ep, 3000);
  return deepFreeze(beginIndependent(ep, { attemptId: 'ind', taskId: 'independent', pageId: 'p2', now: 4000 }));
}

// ---------- startEpisode / recordAssistance ----------

test('startEpisode opens an initial attempt in phase attempt and keeps the rehearsal flag', () => {
  const ep = start({ rehearsal: true, part: 'a' });
  assert.equal(ep.phase, 'attempt');
  assert.equal(ep.initialAttemptId, 'ep1:initial');
  assert.equal(ep.attempts['ep1:initial'].kind, 'initial');
  assert.equal(ep.attempts['ep1:initial'].pageId, 'p1');
  assert.equal(ep.rehearsal, true);
  assert.equal(ep.part, 'a');
  assert.deepEqual(ep.assistance, []);
  assert.equal(ep.reviewDueAt, undefined);
});

test('the first assistance moves attempt → repair and is recorded on the attempt it was given on', () => {
  const ep = recordAssistance(start(), help('ep1:initial'), 'h1');
  assert.equal(ep.phase, 'repair');
  assert.equal(ep.repairAttemptId, 'ep1:repair');
  assert.equal(ep.attempts['ep1:repair'].kind, 'repair');
  assert.equal(ep.attempts['ep1:repair'].pageId, 'p1');
  assert.deepEqual(ep.attempts['ep1:initial'].assistanceIds, ['h1']);
  assert.deepEqual(ep.assistance.map((a) => [a.id, a.episodeId]), [['h1', 'ep1']]);
});

test('unknown exposure stays unknown, and delivered text is bounded', () => {
  const ep = recordAssistance(start(), help('ep1:initial', 2000, { revealed: 'unknown', text: 'x'.repeat(5000), channels: ['speech'] }), 'h1');
  assert.equal(ep.assistance[0].revealed, 'unknown');
  assert.equal(ep.assistance[0].text?.length, 2000);
});

test('later help on the repair attempt appends without reopening the repair', () => {
  let ep = recordAssistance(start(), help('ep1:initial'), 'h1');
  ep = recordAssistance(deepFreeze(ep), help('ep1:repair', 2500, { move: 'explain', level: 2 }), 'h2');
  assert.equal(ep.phase, 'repair');
  assert.deepEqual(ep.attempts['ep1:repair'].assistanceIds, ['h2']);
  assert.equal(ep.assistance.length, 2);
});

test('assistance for an unknown attempt or a duplicate id is a no-op, not a throw', () => {
  const ep = recordAssistance(start(), help('ep1:initial'), 'h1');
  assert.equal(recordAssistance(ep, help('nope'), 'h9'), ep);
  assert.equal(recordAssistance(ep, help('ep1:initial'), 'h1'), ep);
});

// ---------- clampMove ----------

test('clampMove maps moves to the stored ladder levels', () => {
  const open: EpisodePolicy = { maxLevel: 4, allowExplain: true, allowExample: true };
  const levels = (['check', 'pointer', 'explain', 'example', 'step', 'start', 'dispute'] as const).map((m) => clampMove(m, open));
  assert.deepEqual(levels, [{ level: 0 }, { level: 1 }, { level: 2 }, { level: 3 }, { level: 4 }, { level: 2 }, { level: 0 }]);
});

test('clampMove denies a move above maxLevel with a reason, and never widens', () => {
  const r = clampMove('step', POLICY);
  assert.ok('denied' in r && r.denied.length > 0);
  const low: EpisodePolicy = { maxLevel: 1, allowExplain: true, allowExample: true };
  assert.ok('denied' in clampMove('start', low));
  assert.ok('denied' in clampMove('explain', low));
  assert.deepEqual(clampMove('pointer', low), { level: 1 });
});

test('clampMove honors allowExplain and allowExample even when the level fits', () => {
  const p: EpisodePolicy = { maxLevel: 4, allowExplain: false, allowExample: false };
  assert.ok('denied' in clampMove('explain', p));
  assert.ok('denied' in clampMove('example', p));
  assert.deepEqual(clampMove('step', p), { level: 4 });
});

// ---------- repairEvidence ----------

const before = [line('L1', 0, [0, 1]), line('L2', 50, [2, 3, 4])];
const flaggedSig = lineInkSig(before[1]);

test('a rewritten flagged line with a valid new reading is verified', () => {
  const after = [line('L1', 0, [0, 1]), line('L2', 51, [2, 3, 4, 5], 10, 240)];
  const r = repairEvidence({ flaggedSig, before, after, nowValid: true });
  assert.equal(r.verified, true);
  assert.match(r.reason, /valid/);
});

test('a flagged line replaced by new lines in its place counts when the student confirmed the reading', () => {
  const after = [line('L1', 0, [0, 1]), line('L2', 48, [2, 3], 10, 90), line('L3', 52, [4, 5], 120, 90)];
  const r = repairEvidence({ flaggedSig, before, after, nowValid: false, confirmedReading: '2x = 6' });
  assert.equal(r.verified, true);
  assert.match(r.reason, /confirmed/);
});

test('erasing the flagged line with no replacement is not a repair', () => {
  const r = repairEvidence({ flaggedSig, before, after: [line('L1', 0, [0, 1])], nowValid: true });
  assert.equal(r.verified, false);
  assert.match(r.reason, /erased/);
});

test('new ink elsewhere on the page does not count as replacing the flagged line', () => {
  const after = [line('L1', 0, [0, 1]), line('L3', 300, [2, 3])];
  assert.equal(repairEvidence({ flaggedSig, before, after, nowValid: true }).verified, false);
});

test('a tutor withdrawal on unchanged ink is not a repair', () => {
  // same ink; stroke indices renumbered because an earlier line was erased
  const after = [{ ...before[1], strokes: [0, 1, 2] }];
  const r = repairEvidence({ flaggedSig, before, after, nowValid: true, confirmedReading: 'x = 3' });
  assert.equal(r.verified, false);
  assert.match(r.reason, /unchanged/);
});

test('changed ink that is neither valid nor confirmed is not yet a repair', () => {
  const after = [line('L1', 0, [0, 1]), line('L2', 50, [2, 3, 4, 5], 10, 240)];
  const r = repairEvidence({ flaggedSig, before, after, nowValid: false, confirmedReading: '  ' });
  assert.equal(r.verified, false);
});

test('an unknown flagged signature is not verified', () => {
  const r = repairEvidence({ flaggedSig: 'nope', before, after: [], nowValid: true });
  assert.deepEqual(r, { verified: false, reason: 'flagged line not found' });
});

test('lineInkSig ignores sub-step jitter but not a new stroke', () => {
  assert.equal(lineInkSig(line('a', 50, [1, 2])), lineInkSig(line('b', 50.4, [7, 8])));
  assert.notEqual(lineInkSig(line('a', 50, [1, 2])), lineInkSig(line('a', 50, [1, 2, 3])));
});

// ---------- phase transitions ----------

test('markRepairVerified only works from repair', () => {
  const s = start();
  assert.equal(markRepairVerified(s, 3000), s);
  const ep = markRepairVerified(recordAssistance(s, help('ep1:initial'), 'h1'), 3000);
  assert.equal(ep.phase, 'repair_verified');
  assert.equal(ep.repairVerifiedAt, 3000);
  assert.equal(markRepairVerified(deepFreeze(ep), 3500), ep);
});

test('beginIndependent creates a fresh attempt with no assistance copied, and only after help', () => {
  assert.equal(beginIndependent(start(), { attemptId: 'ind', taskId: 't', pageId: 'p2', now: 1 }).phase, 'attempt');
  const ep = toIndependent();
  const ind = ep.attempts.ind;
  assert.equal(ep.phase, 'independent');
  assert.equal(ep.independentAttemptId, 'ind');
  assert.deepEqual([ind.kind, ind.taskId, ind.pageId, ind.assistanceIds], ['independent', 'independent', 'p2', []]);
  assert.equal(beginIndependent(ep, { attemptId: 'ind2', taskId: 't', pageId: 'p3', now: 5000 }), ep);
});

test('beginIndependent is allowed from repair without verification', () => {
  const ep = beginIndependent(recordAssistance(start(), help('ep1:initial'), 'h1'), { attemptId: 'ind', taskId: 't', pageId: 'p2', now: 4000 });
  assert.equal(ep.phase, 'independent');
  assert.deepEqual(outcomeLabels(ep), []);
});

test('help during the independent attempt is ignored until the student exits for help', () => {
  const ep = toIndependent();
  assert.equal(recordAssistance(ep, help('ind', 4500), 'h2'), ep);
  const exited = exitIndependentForHelp(ep, 4600);
  assert.equal(exited.attempts.ind.kind, 'supported_practice');
  const helped = recordAssistance(deepFreeze(exited), help('ind', 4700), 'h2');
  assert.deepEqual(helped.attempts.ind.assistanceIds, ['h2']);
});

test('help during the independent attempt gives supported practice even with a passing assessment', () => {
  let ep = exitIndependentForHelp(toIndependent(), 4600);
  ep = submitIndependent(deepFreeze(ep), snap('s1', 5000), ['x = 3'], 5000);
  ep = applyAssessment(deepFreeze(ep), 'ind', assessment('s1', 'pass'));
  assert.equal(ep.phase, 'outcome');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'supported_practice']);
  assert.equal(ep.outcome?.label, 'supported_practice');
});

test('exitIndependentForHelp outside an open independent attempt is a no-op', () => {
  const s = start();
  assert.equal(exitIndependentForHelp(s, 1), s);
  const submitted = deepFreeze(submitIndependent(toIndependent(), snap('s1', 5000), [], 5000));
  assert.equal(exitIndependentForHelp(submitted, 5100), submitted);
});

// ---------- submit / assess / invalidate ----------

test('submitIndependent stores snapshot and readings; a duplicate submit is a no-op', () => {
  const ep = deepFreeze(submitIndependent(toIndependent(), snap('s1', 5000), ['x = 3'], 5001));
  const ind = ep.attempts.ind;
  assert.equal(ep.phase, 'independent_submitted');
  assert.deepEqual([ind.snapshot?.id, ind.readings, ind.submittedAt], ['s1', ['x = 3'], 5001]);
  assert.equal(submitIndependent(ep, snap('s1', 5000), ['x = 3'], 5002), ep);
});

test('submit before an independent attempt exists is a no-op', () => {
  const s = start();
  assert.equal(submitIndependent(s, snap('s1', 1), [], 1), s);
});

test('a passing assessment of the submitted snapshot gives passed_independent, separate from repair', () => {
  let ep = submitIndependent(toIndependent(), snap('s1', 5000), ['x = 3'], 5000);
  ep = applyAssessment(deepFreeze(ep), 'ind', assessment('s1', 'pass'));
  assert.equal(ep.phase, 'outcome');
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'passed_independent']);
  assert.equal(ep.outcome?.label, 'passed_independent');
});

test('needs_practice and unassessable map to their labels', () => {
  const sub = deepFreeze(submitIndependent(toIndependent(), snap('s1', 5000), [], 5000));
  assert.deepEqual(outcomeLabels(applyAssessment(sub, 'ind', assessment('s1', 'needs_practice'))), ['repair_verified', 'needs_practice']);
  assert.deepEqual(outcomeLabels(applyAssessment(sub, 'ind', assessment('s1', 'unassessable'))), ['repair_verified', 'could_not_assess']);
});

test('an assessment with a stale snapshotId is ignored', () => {
  const sub = deepFreeze(submitIndependent(toIndependent(), snap('s1', 5000), [], 5000));
  assert.equal(applyAssessment(sub, 'ind', assessment('old')), sub);
  assert.equal(applyAssessment(sub, 'nope', assessment('s1')), sub);
});

test('a second assessment for the same snapshot does not overwrite the first', () => {
  const sub = submitIndependent(toIndependent(), snap('s1', 5000), [], 5000);
  const first = deepFreeze(applyAssessment(deepFreeze(sub), 'ind', assessment('s1', 'needs_practice')));
  assert.equal(applyAssessment(first, 'ind', assessment('s1', 'pass', 9500)), first);
});

test('edit after submit, then a late assessment of the old snapshot, is ignored', () => {
  const sub = submitIndependent(toIndependent(), snap('s1', 5000), [], 5000);
  const edited = deepFreeze(invalidateOnEdit(deepFreeze(sub), 'ind', 6000));
  assert.equal(edited.phase, 'independent');
  assert.equal(edited.attempts.ind.invalidatedAt, 6000);
  assert.equal(applyAssessment(edited, 'ind', assessment('s1', 'pass')), edited);
  assert.deepEqual(outcomeLabels(edited), ['repair_verified']);
});

test('edit after assessment reopens the attempt and drops the result', () => {
  let ep = submitIndependent(toIndependent(), snap('s1', 5000), [], 5000);
  ep = deepFreeze(applyAssessment(deepFreeze(ep), 'ind', assessment('s1', 'pass')));
  const edited = invalidateOnEdit(ep, 'ind', 9500);
  assert.equal(edited.phase, 'independent');
  assert.equal(edited.attempts.ind.assessment, undefined);
  assert.equal(edited.outcome, undefined);
  assert.deepEqual(outcomeLabels(edited), ['repair_verified']);
});

test('a resubmit after an edit can be assessed, and the old late result is still ignored', () => {
  let ep = submitIndependent(toIndependent(), snap('s1', 5000), [], 5000);
  ep = invalidateOnEdit(deepFreeze(ep), 'ind', 6000);
  ep = deepFreeze(submitIndependent(deepFreeze(ep), snap('s2', 7000), ['x = 3'], 7000));
  assert.equal(ep.phase, 'independent_submitted');
  assert.equal(applyAssessment(ep, 'ind', assessment('s1', 'pass')), ep);
  const done = applyAssessment(ep, 'ind', assessment('s2', 'pass'));
  assert.deepEqual(outcomeLabels(done), ['repair_verified', 'passed_independent']);
});

test('invalidateOnEdit before submission or on another attempt is a no-op', () => {
  const ep = toIndependent();
  assert.equal(invalidateOnEdit(ep, 'ind', 4500), ep);
  assert.equal(invalidateOnEdit(ep, 'ep1:initial', 4500), ep);
});

// ---------- review / labels ----------

test('scheduleReview sets a due date seven days ahead and no delayed outcome', () => {
  const now = Date.UTC(2026, 10, 2, 18, 0);
  const ep = deepFreeze(scheduleReview(toIndependent(), 'review', now));
  assert.equal(ep.reviewDueAt, now + 7 * 24 * 3600 * 1000);
  assert.equal(REVIEW_DELAY_MS, 604_800_000);
  assert.equal(new Date(ep.reviewDueAt!).toISOString(), '2026-11-09T18:00:00.000Z');
  assert.equal(ep.reviewTaskId, 'review');
  assert.equal(ep.delayedOutcome, undefined);
  assert.equal(scheduleReview(ep, 'other', now + 1), ep);
});

test('no labels are earned by an untouched episode or by a flag that simply disappeared', () => {
  assert.deepEqual(outcomeLabels(start()), []);
  assert.deepEqual(outcomeLabels(recordAssistance(start(), help('ep1:initial'), 'h1')), []);
});

test('a rehearsal-sourced assessment is never a pass on a real episode, but a rehearsal episode keeps its labels and flag', () => {
  const real = deepFreeze(submitIndependent(toIndependent(), snap('s1', 5000), [], 5000));
  assert.deepEqual(outcomeLabels(applyAssessment(real, 'ind', assessment('s1', 'pass', 9000, 'rehearsal'))), ['repair_verified', 'could_not_assess']);

  let ep = recordAssistance(start({ rehearsal: true }), help('ep1:initial'), 'h1');
  ep = markRepairVerified(ep, 3000);
  ep = beginIndependent(ep, { attemptId: 'ind', taskId: 'independent', pageId: 'p2', now: 4000 });
  ep = submitIndependent(ep, snap('s1', 5000), [], 5000);
  ep = applyAssessment(ep, 'ind', assessment('s1', 'pass', 9000, 'rehearsal'));
  ep = scheduleReview(ep, 'review', 9100);
  assert.equal(ep.rehearsal, true);
  assert.deepEqual(outcomeLabels(ep), ['repair_verified', 'passed_independent']);
});

test('every transition leaves its input unchanged (inputs are deep-frozen)', () => {
  const s = start();
  const copy = structuredClone(s);
  let ep = recordAssistance(s, help('ep1:initial'), 'h1');
  ep = markRepairVerified(deepFreeze(ep), 3000);
  ep = beginIndependent(deepFreeze(ep), { attemptId: 'ind', taskId: 'independent', pageId: 'p2', now: 4000 });
  const mid = structuredClone(ep);
  ep = exitIndependentForHelp(deepFreeze(ep), 4100);
  ep = submitIndependent(deepFreeze(ep), deepFreeze(snap('s1', 5000)), deepFreeze(['x']), 5000);
  ep = applyAssessment(deepFreeze(ep), 'ind', deepFreeze(assessment('s1')));
  ep = invalidateOnEdit(deepFreeze(ep), 'ind', 9500);
  scheduleReview(deepFreeze(ep), 'review', 9600);
  assert.deepEqual(s, copy);
  assert.notDeepEqual(mid, ep);
});
