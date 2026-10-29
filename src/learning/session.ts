// Episode state transitions (T02). All pure: each returns a new object, or the same object when the call is illegal or
// stale (never throws). UI code calls these and never re-implements the learning-evidence rules.
import type { HelpLevel } from '../ai/types';
import type { Line } from '../ink/lines';
import type { Assessment, Assistance, Attempt, Episode, EpisodePolicy, HelpMove, OutcomeLabel, Snapshot } from './types';

export const REVIEW_DELAY_MS = 7 * 24 * 3600 * 1000;
const MAX_TEXT = 2000;

const withAttempt = (ep: Episode, at: Attempt, now: number, rest: Partial<Episode> = {}): Episode => ({
  ...ep,
  ...rest,
  attempts: { ...ep.attempts, [at.id]: at },
  updatedAt: now,
});

export function startEpisode(a: {
  id: string; assignmentId: string; part?: string; skillId: string; packVersion: string; policy: EpisodePolicy;
  taskId: string; pageId: string; rehearsal: boolean; now: number;
}): Episode {
  const initial: Attempt = {
    id: `${a.id}:initial`, episodeId: a.id, kind: 'initial', taskId: a.taskId, pageId: a.pageId,
    startedAt: a.now, assistanceIds: [], allowedResources: [],
  };
  return {
    id: a.id, assignmentId: a.assignmentId, ...(a.part !== undefined ? { part: a.part } : {}),
    skillId: a.skillId, packVersion: a.packVersion, policy: { ...a.policy },
    phase: 'attempt',
    attempts: { [initial.id]: initial },
    initialAttemptId: initial.id,
    assistance: [],
    rehearsal: a.rehearsal,
    createdAt: a.now, updatedAt: a.now,
  };
}

/**
 * Appends delivered help to the episode and to the attempt it was given on. The first help moves attempt → repair and
 * opens the repair attempt (same task and page as the initial one). Help on an independent attempt is ignored unless
 * the student has exited it for help first (it is then supported practice).
 */
export function recordAssistance(ep: Episode, a: Omit<Assistance, 'id' | 'episodeId'>, id: string): Episode {
  const at = ep.attempts[a.attemptId];
  if (!at || at.kind === 'independent' || ep.assistance.some((x) => x.id === id)) return ep;
  const entry: Assistance = {
    ...a, id, episodeId: ep.id,
    channels: [...a.channels],
    revealed: a.revealed === 'unknown' ? 'unknown' : [...a.revealed],
    ...(a.text !== undefined ? { text: a.text.slice(0, MAX_TEXT) } : {}),
  };
  const now = Math.max(ep.updatedAt, a.at);
  let next = withAttempt(ep, { ...at, assistanceIds: [...at.assistanceIds, id] }, now, {
    assistance: [...ep.assistance, entry],
  });
  if (ep.phase === 'attempt') {
    const initial = ep.initialAttemptId ? ep.attempts[ep.initialAttemptId] : at;
    const repair: Attempt = {
      id: `${ep.id}:repair`, episodeId: ep.id, kind: 'repair', taskId: initial.taskId, pageId: initial.pageId,
      startedAt: a.at, assistanceIds: [], allowedResources: [],
    };
    next = withAttempt(next, repair, now, { phase: 'repair', repairAttemptId: repair.id });
  }
  return next;
}

const MOVE_LEVEL: Record<HelpMove, HelpLevel> = { check: 0, pointer: 1, explain: 2, example: 3, step: 4, start: 2, dispute: 0 };

/** The level a move needs, or a short reason the policy does not allow it. Never widens the policy. */
export function clampMove(move: HelpMove, policy: EpisodePolicy): { level: HelpLevel } | { denied: string } {
  if (move === 'explain' && !policy.allowExplain) return { denied: 'Explanations are off for this assignment.' };
  if (move === 'example' && !policy.allowExample) return { denied: 'Worked examples are off for this assignment.' };
  const level = MOVE_LEVEL[move];
  if (level > policy.maxLevel) return { denied: `This assignment allows help up to level ${policy.maxLevel}.` };
  return { level };
}

const STEP = 2; // page points, as in src/check/carry.ts: harmless jitter does not change a signature
const snap2 = (v: number) => Math.round(v / STEP);

/**
 * The ink signature repairEvidence matches on: the line's rounded box plus its stroke count. It deliberately leaves out
 * stroke indices (erasing an earlier line renumbers them) and is NOT the carry.ts signature, which needs stroke boxes.
 * Callers pass `lineInkSig(flaggedLine)` as `flaggedSig`.
 */
export function lineInkSig(line: Line): string {
  return `${snap2(line.x)},${snap2(line.y)},${snap2(line.w)},${snap2(line.h)}#${line.strokes.length}`;
}

/** Vertical overlap divided by the smaller height (0..1), as in src/ink/lines.ts. */
const vOverlap = (a: Line, b: Line) => {
  const inter = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return inter / Math.max(1, Math.min(a.h, b.h));
};

/**
 * A repair is verified only by new work: the flagged line's ink changed or was replaced by new lines in its place, and
 * the new reading is valid or the student confirmed it. Erasing the flag, or a tutor withdrawal on unchanged ink, is not.
 */
export function repairEvidence(i: {
  flaggedSig: string; before: Line[]; after: Line[]; confirmedReading?: string; nowValid: boolean;
}): { verified: boolean; reason: string } {
  const flagged = i.before.find((l) => lineInkSig(l) === i.flaggedSig);
  if (!flagged) return { verified: false, reason: 'flagged line not found' };
  if (i.after.some((l) => lineInkSig(l) === i.flaggedSig)) return { verified: false, reason: 'flagged ink is unchanged' };
  const old = new Set(i.before.map(lineInkSig));
  const replaced = i.after.some((l) => !old.has(lineInkSig(l)) && vOverlap(l, flagged) >= 0.5);
  if (!replaced) return { verified: false, reason: 'flagged line was erased with no new work in its place' };
  if (i.nowValid) return { verified: true, reason: 'flagged line was rewritten and the new reading is valid' };
  if (i.confirmedReading?.trim()) return { verified: true, reason: 'flagged line was rewritten and the student confirmed the new reading' };
  return { verified: false, reason: 'new work is not yet valid or confirmed' };
}

export function markRepairVerified(ep: Episode, now: number): Episode {
  if (ep.phase !== 'repair') return ep;
  return { ...ep, phase: 'repair_verified', repairVerifiedAt: now, updatedAt: now };
}

/** A fresh attempt on its own task and page. No assistance carries over. */
export function beginIndependent(ep: Episode, a: { attemptId: string; taskId: string; pageId: string; now: number }): Episode {
  if (ep.phase !== 'repair' && ep.phase !== 'repair_verified') return ep;
  if (ep.independentAttemptId || ep.attempts[a.attemptId]) return ep;
  const at: Attempt = {
    id: a.attemptId, episodeId: ep.id, kind: 'independent', taskId: a.taskId, pageId: a.pageId,
    startedAt: a.now, assistanceIds: [], allowedResources: [],
  };
  return withAttempt(ep, at, a.now, { phase: 'independent', independentAttemptId: at.id });
}

const independentAttempt = (ep: Episode) => (ep.independentAttemptId ? ep.attempts[ep.independentAttemptId] : undefined);

/** → supported_practice. Permanent: that attempt can never become passed_independent. */
export function exitIndependentForHelp(ep: Episode, now: number): Episode {
  const at = independentAttempt(ep);
  if (ep.phase !== 'independent' || !at || at.kind !== 'independent') return ep;
  return withAttempt(ep, { ...at, kind: 'supported_practice' }, now);
}

/** Stores the submitted snapshot and readings. Submitting the same snapshot again is a no-op. */
export function submitIndependent(ep: Episode, snap: Snapshot, readings: string[], now: number): Episode {
  const at = independentAttempt(ep);
  if (!at || at.snapshot?.id === snap.id || ep.phase !== 'independent') return ep;
  const { assessment: _dropped, ...rest } = at;
  return withAttempt(ep, { ...rest, snapshot: { ...snap, lines: [...snap.lines] }, readings: [...readings], submittedAt: now }, now, {
    phase: 'independent_submitted',
  });
}

/** Ignored when the snapshot is stale, the work changed after it, or the attempt is already assessed. */
export function applyAssessment(ep: Episode, attemptId: string, as: Assessment): Episode {
  const at = ep.attempts[attemptId];
  if (!at?.snapshot || at.snapshot.id !== as.snapshotId || at.assessment) return ep;
  if (at.invalidatedAt !== undefined && at.invalidatedAt >= at.snapshot.at) return ep;
  const assessed = { ...at, assessment: { ...as, reasons: [...as.reasons] } };
  const now = Math.max(ep.updatedAt, as.at);
  let next = withAttempt(ep, assessed, now);
  if (attemptId === ep.independentAttemptId && ep.phase === 'independent_submitted') {
    const label = independentLabel(next, assessed);
    next = { ...next, phase: 'outcome', ...(label ? { outcome: { label, at: as.at } } : {}) };
  }
  return next;
}

/** Work changed after submission: the assessment no longer counts and the attempt is open again. */
export function invalidateOnEdit(ep: Episode, attemptId: string, now: number): Episode {
  const at = ep.attempts[attemptId];
  if (!at?.snapshot || attemptId !== ep.independentAttemptId) return ep;
  if (ep.phase !== 'independent_submitted' && ep.phase !== 'outcome') return ep;
  const { assessment: _dropped, ...rest } = at;
  const { outcome: _outcome, ...epRest } = ep;
  return withAttempt(epRest, { ...rest, invalidatedAt: now }, now, { phase: 'independent' });
}

/** reviewDueAt = now + 7 days (epoch ms). delayedOutcome stays undefined until a real delayed attempt. */
export function scheduleReview(ep: Episode, reviewTaskId: string, now: number): Episode {
  if (ep.reviewTaskId) return ep;
  return { ...ep, reviewTaskId, reviewDueAt: now + REVIEW_DELAY_MS, updatedAt: now };
}

function independentLabel(ep: Episode, at: Attempt): OutcomeLabel | undefined {
  if (at.kind === 'supported_practice' || at.assistanceIds.length > 0) return 'supported_practice';
  const as = at.assessment;
  if (!as || !at.snapshot || as.snapshotId !== at.snapshot.id) return undefined;
  if (at.invalidatedAt !== undefined && at.invalidatedAt >= at.snapshot.at) return undefined;
  if (as.source === 'rehearsal' && !ep.rehearsal) return 'could_not_assess'; // rehearsal output is never learner evidence
  if (as.result === 'pass') return 'passed_independent';
  if (as.result === 'needs_practice') return 'needs_practice';
  return 'could_not_assess';
}

/** Repair label first, then the independent label; each only when earned. A pass comes only from an assessment. */
export function outcomeLabels(ep: Episode): OutcomeLabel[] {
  const labels: OutcomeLabel[] = [];
  if (ep.repairVerifiedAt !== undefined) labels.push('repair_verified');
  const at = independentAttempt(ep);
  const label = at && independentLabel(ep, at);
  if (label) labels.push(label);
  return labels;
}
