// Pure helpers for the workspace's pivot (demo episode) flow (T07, moved here by T10 so they can be tested).
// No React, no store: WorkspaceScreen and LearningBar own the side effects.
import type { HelpLevel, LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import type { Assignment } from '../store/types';
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
