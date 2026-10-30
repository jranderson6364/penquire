import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSubmit, changedSinceSubmission, editInvalidates, helpReplyInput, independentAttemptId, independentView, linesToConfirm,
  outcomeRows, repairHelpPhrase, resultVisible, withConfirmedReadings,
} from './independentFlow.ts';
import {
  applyAssessment, beginIndependent, exitIndependentForHelp, invalidateOnEdit, markRepairVerified, recordAssistance, startEpisode,
  submitIndependent,
} from './session.ts';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask } from './demoPack.ts';
import type { Assessment, Episode, Snapshot } from './types.ts';
import type { CheckResult, LineVerdict } from '../ai/types.ts';

const T0 = 1_800_000_000_000;

function repairEpisode(verified = true): Episode {
  let ep = startEpisode({
    id: 'e1', assignmentId: 'a1', skillId: DEMO_PACK.skillId, packVersion: DEMO_PACK.version, policy: DEMO_PACK.policy,
    taskId: DEMO_TASK_IDS.recovery, pageId: 'p1', rehearsal: false, now: T0,
  });
  ep = recordAssistance(ep, { attemptId: 'e1:initial', move: 'pointer', level: 1, channels: ['marks', 'text'], revealed: ['location'], at: T0 + 1 }, 'h1');
  ep = recordAssistance(ep, { attemptId: 'e1:repair', move: 'explain', level: 2, channels: ['text'], revealed: ['principle'], at: T0 + 2 }, 'h2');
  return verified ? markRepairVerified(ep, T0 + 3) : ep;
}

const begun = (ep = repairEpisode()) => beginIndependent(ep, { attemptId: independentAttemptId(ep.id), taskId: DEMO_TASK_IDS.independent, pageId: 'p2', now: T0 + 10 });
const snap = (id: string, at: number): Snapshot => ({ id, pageFile: `snapshots/${id}.pk`, strokeCount: 3, lines: [], at });
const assessment = (snapshotId: string, result: Assessment['result'], at: number): Assessment => ({
  result, reasons: result === 'pass' ? [] : ['The final value on L3 is not right yet.'], source: 'provider+rubric', packVersion: DEMO_PACK.version, snapshotId, at,
});
const line = (over: Partial<LineVerdict>): LineVerdict => ({ id: 'L1', reading: '3(2y + 1) = 33', verdict: 'valid', note: '', ...over });
const check = (lines: LineVerdict[]): CheckResult => ({ lines, parts: [], feedback: '', question: '', fixedSinceLast: [], stillOpen: [], model: 'test' });

test('view: begin only from a repair phase; otherwise unavailable until an attempt exists', () => {
  assert.equal(independentView(repairEpisode()), 'begin');
  assert.equal(independentView(repairEpisode(false)), 'begin');
  const fresh = startEpisode({ id: 'e2', assignmentId: 'a1', skillId: 's', packVersion: 'v', policy: DEMO_PACK.policy, taskId: 't', pageId: 'p', rehearsal: false, now: T0 });
  assert.equal(independentView(fresh), 'unavailable');
  assert.equal(independentView(begun()), 'working');
});

test('view resumes submitted and outcome phases', () => {
  const sub = submitIndependent(begun(), snap('s1', T0 + 20), [], T0 + 20);
  assert.equal(independentView(sub), 'submitted');
  const out = applyAssessment(sub, 'e1:independent', assessment('s1', 'pass', T0 + 30));
  assert.equal(independentView(out), 'outcome');
});

test('canSubmit: open attempt, loaded page, some ink, nothing running', () => {
  const ok = { phase: 'independent' as const, busy: false, strokeCount: 2, loaded: true };
  assert.equal(canSubmit(ok), true);
  assert.equal(canSubmit({ ...ok, busy: true }), false);
  assert.equal(canSubmit({ ...ok, strokeCount: 0 }), false);
  assert.equal(canSubmit({ ...ok, strokeCount: null }), false);
  assert.equal(canSubmit({ ...ok, loaded: false }), false);
  assert.equal(canSubmit({ ...ok, phase: 'independent_submitted' }), false);
});

test('result visible only after an assessment of the current snapshot; an edit hides it', () => {
  const sub = submitIndependent(begun(), snap('s1', T0 + 20), [], T0 + 20);
  assert.equal(resultVisible(sub), false);
  const out = applyAssessment(sub, 'e1:independent', assessment('s1', 'pass', T0 + 30));
  assert.equal(resultVisible(out), true);
  assert.equal(editInvalidates(out.phase), true);
  const edited = invalidateOnEdit(out, 'e1:independent', T0 + 40);
  assert.equal(resultVisible(edited), false);
  assert.equal(changedSinceSubmission(edited), true);
  assert.equal(changedSinceSubmission(begun()), false);
  assert.equal(editInvalidates('independent'), false);
});

test('a late result for the old snapshot after an edit stays hidden', () => {
  const sub = submitIndependent(begun(), snap('s1', T0 + 20), [], T0 + 20);
  const edited = invalidateOnEdit(sub, 'e1:independent', T0 + 25);
  const late = applyAssessment(edited, 'e1:independent', assessment('s1', 'pass', T0 + 30));
  assert.equal(late, edited);
  assert.equal(resultVisible(late), false);
});

test('linesToConfirm picks low-confidence, unreadable and reading-guarded lines, not context or blanks', () => {
  const c = check([
    line({ id: 'L1' }),
    line({ id: 'L2', readConfidence: 'low', verdict: 'unreadable', guard: 'reading', modelVerdict: 'valid' }),
    line({ id: 'L3', verdict: 'unreadable' }),
    line({ id: 'L4', verdict: 'context', readConfidence: 'low' }),
    line({ id: 'L5', reading: '  ', verdict: 'unreadable' }),
  ]);
  assert.deepEqual(linesToConfirm(c).map((l) => l.id), ['L2', 'L3']);
});

test('withConfirmedReadings sets the confirmed text with high confidence and keeps the verdict', () => {
  const c = check([line({ id: 'L1', readConfidence: 'low', reading: '6y + 3 = 38', verdict: 'valid' }), line({ id: 'L2', verdict: 'unreadable', readConfidence: 'low' })]);
  const out = withConfirmedReadings(c, [{ id: 'L1', reading: '6y + 3 = 33' }, { id: 'L2', reading: 'y = 5' }]);
  assert.equal(out.lines[0].reading, '6y + 3 = 33');
  assert.equal(out.lines[0].readConfidence, 'high');
  assert.equal(out.lines[0].verdict, 'valid');
  assert.equal(out.lines[1].verdict, 'unreadable'); // still unassessable: confirmation does not invent a verdict
  assert.equal(c.lines[0].reading, '6y + 3 = 38'); // input untouched
});

test('repair help phrase is the strongest help on the repair attempt only', () => {
  assert.equal(repairHelpPhrase(repairEpisode()), 'explanation');
  const ep = repairEpisode();
  assert.equal(repairHelpPhrase({ ...ep, assistance: ep.assistance.filter((a) => a.attemptId !== 'e1:repair') }), undefined);
});

test('outcome rows: separate repair and fresh-problem rows with honest labels', () => {
  const sub = submitIndependent(begun(), snap('s1', T0 + 20), [], T0 + 20);
  const pass = outcomeRows(applyAssessment(sub, 'e1:independent', assessment('s1', 'pass', T0 + 30)));
  assert.deepEqual(pass.repair, { verified: true, text: 'Repaired after an explanation' });
  assert.equal(pass.fresh.text, 'Passed this independent item');
  const np = outcomeRows(applyAssessment(sub, 'e1:independent', assessment('s1', 'needs_practice', T0 + 30)));
  assert.equal(np.fresh.text, 'Needs more practice');
  assert.deepEqual(np.fresh.reasons, ['The final value on L3 is not right yet.']);
  const na = outcomeRows(applyAssessment(sub, 'e1:independent', assessment('s1', 'unassessable', T0 + 30)));
  assert.equal(na.fresh.text, 'Could not assess');
  assert.equal(outcomeRows(sub).fresh.text, 'Not assessed yet');
  const unverified = outcomeRows(begun(repairEpisode(false)));
  assert.equal(unverified.repair.verified, false);
  assert.equal(unverified.repair.text, 'No verified repair recorded');
});

test('leaving for help gives supported practice even with a passing assessment', () => {
  const left = exitIndependentForHelp(begun(), T0 + 15);
  const sub = submitIndependent(left, snap('s1', T0 + 20), [], T0 + 20);
  const rows = outcomeRows(applyAssessment(sub, 'e1:independent', assessment('s1', 'pass', T0 + 30)));
  assert.equal(rows.fresh.label, 'supported_practice');
  assert.equal(rows.fresh.text, 'Supported practice');
  assert.match(rows.fresh.reasons[0], /does not count as independent/);
});

test('outcome text never claims mastery, retention or a percentage', () => {
  const sub = submitIndependent(begun(), snap('s1', T0 + 20), [], T0 + 20);
  for (const r of ['pass', 'needs_practice', 'unassessable'] as const) {
    const s = JSON.stringify(outcomeRows(applyAssessment(sub, 'e1:independent', assessment('s1', r, T0 + 30))));
    assert.doesNotMatch(s, /master|retain|retention|%/i);
  }
});

test('help reply input: independent prompt only, no answer key, no other task, no lastCheck', () => {
  const task = demoTask(DEMO_TASK_IDS.independent);
  const input = helpReplyInput(task, 'How do I start?', 2, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello', costUSD: 0.01 }]);
  assert.equal(input.helpLevel, 2);
  assert.equal(input.problems.length, 1);
  assert.equal(input.problems[0].text, task.prompt);
  assert.equal('lastCheck' in input, false);
  assert.equal('lines' in input, false);
  assert.deepEqual(input.history, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }]);
  const s = JSON.stringify(input);
  assert.equal(s.includes(task.expected.finalAnswer), false);
  assert.equal(s.includes(task.expected.keyIdea), false);
  for (const step of task.expected.acceptedSteps) assert.equal(s.includes(step), false);
  for (const other of DEMO_PACK.tasks.filter((t) => t.id !== task.id)) assert.equal(s.includes(other.prompt), false);
});
