// Episode state transitions (T02). All pure: each returns a new object. Stubs until T02 fills them in.
import type { HelpLevel } from '../ai/types';
import type { Line } from '../ink/lines';
import type { Assessment, Assistance, Episode, EpisodePolicy, HelpMove, OutcomeLabel, Snapshot } from './types';

export function startEpisode(a: {
  id: string; assignmentId: string; part?: string; skillId: string; packVersion: string; policy: EpisodePolicy;
  taskId: string; pageId: string; rehearsal: boolean; now: number;
}): Episode {
  throw new Error('not implemented: startEpisode');
}

/** moves attempt → repair */
export function recordAssistance(ep: Episode, a: Omit<Assistance, 'id' | 'episodeId'>, id: string): Episode {
  throw new Error('not implemented: recordAssistance');
}

export function clampMove(move: HelpMove, policy: EpisodePolicy): { level: HelpLevel } | { denied: string } {
  throw new Error('not implemented: clampMove');
}

export function repairEvidence(i: {
  flaggedSig: string; before: Line[]; after: Line[]; confirmedReading?: string; nowValid: boolean;
}): { verified: boolean; reason: string } {
  throw new Error('not implemented: repairEvidence');
}

export function markRepairVerified(ep: Episode, now: number): Episode {
  throw new Error('not implemented: markRepairVerified');
}

export function beginIndependent(ep: Episode, a: { attemptId: string; taskId: string; pageId: string; now: number }): Episode {
  throw new Error('not implemented: beginIndependent');
}

/** → supported_practice */
export function exitIndependentForHelp(ep: Episode, now: number): Episode {
  throw new Error('not implemented: exitIndependentForHelp');
}

export function submitIndependent(ep: Episode, snap: Snapshot, readings: string[], now: number): Episode {
  throw new Error('not implemented: submitIndependent');
}

/** ignores an assessment whose snapshotId is stale */
export function applyAssessment(ep: Episode, attemptId: string, as: Assessment): Episode {
  throw new Error('not implemented: applyAssessment');
}

export function invalidateOnEdit(ep: Episode, attemptId: string, now: number): Episode {
  throw new Error('not implemented: invalidateOnEdit');
}

/** reviewDueAt = now + 7 days */
export function scheduleReview(ep: Episode, reviewTaskId: string, now: number): Episode {
  throw new Error('not implemented: scheduleReview');
}

/** repair and independent outcomes are shown separately */
export function outcomeLabels(ep: Episode): OutcomeLabel[] {
  throw new Error('not implemented: outcomeLabels');
}
