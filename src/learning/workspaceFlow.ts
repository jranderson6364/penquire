// Pure helpers for the workspace's pivot (demo episode) flow (T07, moved here by T10 so they can be tested).
// No React, no store: WorkspaceScreen and LearningBar own the side effects.
import type { CheckResult, HelpLevel, LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import type { Assignment } from '../store/types';
import { TASK_GIVENS, type TaskGiven } from './demoPack.ts';
import { finalMisfits } from './assess.ts';
import type { LeakLine } from '../verify/leak.ts';
import { clampMove, lineInkSig } from './session.ts';
import type { Assistance, Episode, EpisodePolicy, HelpMove, Phase, Snapshot } from './types';

/** docs/03 "Required learning states" */
export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'attempt':
      return 'Attempting';
    case 'repair':
      return 'Repairing with help';
    case 'repair_verified':
      return 'Repair verified';
    case 'independent':
      return 'Independent attempt';
    case 'independent_submitted':
      return 'Independent attempt submitted';
    case 'outcome':
      return 'Result recorded';
  }
}

/** The move a stored HelpLevel stands for (typed chat, voice): 0 check … 4 step. */
export function levelMove(level: HelpLevel): HelpMove {
  return (['check', 'pointer', 'explain', 'example', 'step'] as const)[level];
}

const STRONGEST_FIRST: HelpMove[] = ['step', 'example', 'explain', 'pointer', 'check'];

/** The strongest move below `move` that the policy allows (for a denied move), or undefined. */
export function fallbackMove(move: HelpMove, policy: EpisodePolicy): HelpMove | undefined {
  const from = STRONGEST_FIRST.indexOf(move === 'start' ? 'explain' : move === 'dispute' ? 'check' : move);
  return STRONGEST_FIRST.slice(from + 1).find((m) => 'level' in clampMove(m, policy));
}

const HELP_NAME: Record<HelpLevel, string> = { 0: 'a check', 1: 'a pointer', 2: 'an explanation', 3: 'an example', 4: 'a step' };

/** "Repaired after an explanation": the strongest help actually delivered in this episode. */
export function repairedAfter(assistance: Assistance[]): string {
  if (assistance.length === 0) return 'Repaired';
  const top = Math.max(...assistance.map((x) => x.level)) as HelpLevel;
  return `Repaired after ${HELP_NAME[top]}`;
}

export const MOVE_TITLE: Record<HelpMove, string> = {
  check: 'Check',
  pointer: 'Find the issue',
  explain: 'Explain the idea',
  example: 'Show another example',
  step: 'Show one step',
  start: 'Help me start',
  dispute: 'I think this is right',
};

/** Help during the workspace goes on the repair attempt once it exists, else the initial attempt. */
export const workAttemptId = (ep: Episode) => ep.repairAttemptId ?? ep.initialAttemptId ?? '';

/** Never wider than the assignment's own ceiling. */
export const pivotPolicy = (ep: Episode, a: Pick<Assignment, 'policyMaxLevel'>): EpisodePolicy => ({
  ...ep.policy,
  maxLevel: Math.min(ep.policy.maxLevel, a.policyMaxLevel) as HelpLevel,
});

/** The first help on an untouched episode needs a copy of the attempt first. */
export const needsInitialSnap = (ep: Episode) => ep.phase === 'attempt' && !!ep.initialAttemptId && !ep.attempts[ep.initialAttemptId]?.snapshot;

/** Stores a snapshot on an attempt once; a later call never replaces it. */
export const withSnapshot = (ep: Episode, attemptId: string, snap: Snapshot | undefined): Episode => {
  const at = ep.attempts[attemptId];
  if (!snap || !at || at.snapshot) return ep;
  return { ...ep, attempts: { ...ep.attempts, [attemptId]: { ...at, snapshot: snap } } };
};

/** The first flagged line of a check, as the ink signature repairEvidence matches on, with the lines it was seen in. */
export type Flag = { sig: string; before: Line[] };
export const flagFrom = (lines: Line[], verdicts: LineVerdict[]): Flag | null => {
  const flagged = verdicts.find((v) => v.verdict === 'incorrect' || v.verdict === 'partial');
  const line = flagged && lines.find((l) => l.id === flagged.id);
  return line ? { sig: lineInkSig(line), before: lines } : null;
};

/** New ink in the flagged line's place (same test as repairEvidence) is all valid. */
export const replacementValid = (flag: Flag, after: Line[], verdicts: LineVerdict[]): boolean => {
  const flagged = flag.before.find((l) => lineInkSig(l) === flag.sig);
  if (!flagged) return false;
  const old = new Set(flag.before.map(lineInkSig));
  const overlap = (l: Line) => Math.max(0, Math.min(l.y + l.h, flagged.y + flagged.h) - Math.max(l.y, flagged.y)) / Math.max(1, Math.min(l.h, flagged.h));
  const fresh = after.filter((l) => !old.has(lineInkSig(l)) && overlap(l) >= 0.5);
  const verdict = new Map(verdicts.map((v) => [v.id, v.verdict]));
  return fresh.length > 0 && fresh.every((l) => verdict.get(l.id) === 'valid');
};

// ---- the reply leak guard's view of the work ----------------------------------------------------------------

type GuardLine = LeakLine;

/** The workspace task of a demo episode (undefined outside the pack). */
export const workTaskId = (ep: Episode | undefined): string | undefined => (ep ? ep.attempts[workAttemptId(ep)]?.taskId : undefined);

/** What the guards know about the episode's workspace task (demo pack only; src/learning/demoPack.ts TASK_GIVENS). */
export const givenFor = (ep: Episode | undefined): TaskGiven | undefined => {
  const taskId = workTaskId(ep);
  return taskId ? TASK_GIVENS[taskId] : undefined;
};

/** Sorts first (src/verify/guard.ts orders by line number); never named to the student (guard.ts fallbackFor). */
export const GIVEN_LINE_ID = 'the task setup';
export const REJECTED_LINE_ID = 'a rejected root';

/**
 * What the leak guards judge tutor text against: the latest check's lines, kept even when the page changed since
 * (with no lines the guard passes everything), plus the task's setup. The setup is what makes a stated final answer
 * detectable: "t = 4" doesn't follow from a wrong "15t - 5t^2 = 0", but it solves "20 + 15t - 5t^2 = 0". Only for demo
 * tasks: an imported physics given like "v = 3 m/s" would scrub a tutor restating it.
 *
 * The projectile setup is not printed in the prompt (`stated: false`), so it goes in as a hidden line (src/verify/leak.ts):
 * the tutor restating it, or an equivalent form, is withheld unless the student wrote an equivalent line. Rejected
 * roots go in as sayable lines, so "what does t = -1 mean?" stays a usable pointer (every pack task has that root).
 *
 * Order matters (src/verify/leak.ts reads a wrong line against the valid line before it). With a current check the
 * setup comes first, so a corrected setup ("it should be 20 + 15t - 5t^2 = 0" under a wrong "20 + 15t + 5t^2 = 0") is
 * caught. With a stale check the setup goes last and is not hidden: the student may have written that very fix
 * since, and the tutor's "the line with 20 + 15t - 5t^2 = 0 is right" must survive. The final answer is caught either way.
 */
export function replyGuardLines(checkLines: readonly GuardLine[] | undefined, given?: TaskGiven, stale = false): GuardLine[] {
  const lines: GuardLine[] = (checkLines ?? []).map(({ id, reading, verdict }) => ({ id, reading, verdict }));
  if (!given) return lines;
  const hidden = !given.stated && !stale;
  const setup: GuardLine[] = [given.equation, ...(given.forms ?? [])].map((reading) => ({
    id: GIVEN_LINE_ID, reading, verdict: 'valid', ...(hidden ? { role: 'hidden' as const } : {}),
  }));
  const sayable: GuardLine[] = (given.rejected ?? []).map((reading) => ({ id: REJECTED_LINE_ID, reading, verdict: 'valid', role: 'sayable' as const }));
  return stale ? [...lines, ...setup, ...sayable] : [...setup, ...sayable, ...lines];
}

// ---- "am I done?": the real check, then a short verdict --------------------------------------------------------

const FILLER = new Set(
  'so ok okay wait yeah yes yep um uh hmm well and but now then alright hey hi please tutor right too yet here there already at all so far or not just finally actually really'.split(' ')
);

/** Asking whether the work is right or finished; a check answers these, not a tutor's opinion. */
const DONE_ASKS: RegExp[] = [
  /\b(am i|are we) (done|finished|right|correct)\b/,
  /\bis (this|that|it|everything|my (answer|work|working)) (all )?(right|correct|good|ok|okay|done|finished|complete)\b/,
  /\b(is|does) (this|that|it|my work) look(ing)? (right|correct|good|ok|okay)\b/,
  /\bdid i (finally |actually )?(do|get|solve|finish) (it|this|that)( right| correctly)?\b/,
  /\bhave i (got|gotten|done|solved|finished) it( right)?\b/,
  /\bhow('s| is| does) (it|this|that|my work|everything) look(ing)?\b/,
  /\bhow am i doing\b/,
  /\bis (this|that) (the )?(right|correct) answer\b/,
  /\b(can you )?check (my work|this|it|that)( for me)?\b/,
];

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * "Am I done?", "is this right?", "did I do it right?", "how's it looking?", spoken or typed. In a demo episode these
 * run the real check (T11 run 1: the tutor said "yes, you're done" three times and nothing in the app changed). Each
 * sentence is judged on its own: the ask, up to three other words before it ("so", "wait", a misheard word), and only
 * filler after it. A longer sentence is reasoning with a tag on it ("I'd distribute the two to get 6x − 8, is that
 * right?") and goes to the tutor; so does "is it okay to divide first?".
 */
export function isDoneQuestion(text: string): boolean {
  const norm = text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'?.!\s]/g, ' ');
  return norm.split(/[.?!]+/).some((sentence) => {
    const s = words(sentence).join(' ');
    for (const re of DONE_ASKS) {
      const m = re.exec(s);
      if (!m) continue;
      const before = words(s.slice(0, m.index)).filter((w) => !FILLER.has(w));
      const after = words(s.slice(m.index + m[0].length)).filter((w) => !FILLER.has(w));
      if (before.length <= 3 && after.length === 0) return true;
    }
    return false;
  });
}

/** What runCheck reports back, so a done question can be answered from the check itself. */
export type CheckOutcome =
  | { kind: 'checked'; result: CheckVerdicts; assistanceId?: string }
  /** nothing changed since the latest check: that check is the answer */
  | { kind: 'unchanged'; result: CheckVerdicts }
  | { kind: 'empty' }
  /** a boundary (fresh problem, leaving) passed while checking: say nothing */
  | { kind: 'dropped' }
  | { kind: 'error' };

type CheckVerdicts = Pick<CheckResult, 'lines' | 'parts' | 'stillOpen'> & { question?: string };

const lineNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;

/** Done means the check found nothing to do: some valid work, every line valid or context, every part complete, nothing open. */
export function checkSaysDone(r: CheckVerdicts): boolean {
  return (
    r.lines.some((l) => l.verdict === 'valid') &&
    r.lines.every((l) => l.verdict === 'valid' || l.verdict === 'context') &&
    r.parts.length > 0 &&
    r.parts.every((p) => p.status === 'complete') &&
    r.stillOpen.length === 0
  );
}

/**
 * The short verdict said (or written) after a done question's check. Plain words and the student's own lines only
 * (the check's marks and feedback carry the rest), so nothing here goes past a location reveal. undefined: say nothing.
 */
export function doneVerdict(o: CheckOutcome, repairVerified = false, taskId?: string): string | undefined {
  switch (o.kind) {
    case 'dropped':
      return undefined;
    case 'error':
      return "I couldn't finish checking. Tap Check to try again.";
    case 'empty':
      return "There's nothing on the page to check yet.";
  }
  const r = o.result;
  // every line valid, but the final value doesn't fit the task (the time back at the cliff edge, a rejected root):
  // the check is wrong to call it done, so say where to look, never what the value should be
  if (checkSaysDone(r) && finalMisfits(r.lines, taskId)) return 'Not yet. Check your final answer against the situation in the problem.';
  if (checkSaysDone(r)) return repairVerified ? "That's correct. You're done with this one. When you're ready, tap Try a fresh problem." : "That's correct. You're done with this one.";
  const ordered = [...r.lines].sort((a, b) => lineNo(a.id) - lineNo(b.id));
  const flagged = ordered.find((l) => l.verdict === 'incorrect' || l.verdict === 'partial');
  if (flagged) {
    const where = flagged.reading.trim() ? `Not yet. Take another look at the line with ${flagged.reading.trim()}.` : 'Not yet. Take another look at the marked line.';
    // the check's own guiding question ("what does the 0 mean for the ball?"), when it can be said aloud as written:
    // no line numbers (the student can't see them) and no LaTeX
    const q = (r.question ?? '').trim();
    return q && q.endsWith('?') && !/\bL\d|line \d|\\|\$/.test(q) && q.length <= 160 ? `${where} ${q}` : where;
  }
  if (ordered.some((l) => l.verdict === 'unreadable')) return "I couldn't read all of it. Could you rewrite the marked line more clearly?";
  return "What you have so far is right, but it isn't finished yet.";
}

/** Said straight away while a done question's check runs (a check takes seconds; silence reads as not heard). */
export const CHECKING_LINE = 'Let me check that.';
