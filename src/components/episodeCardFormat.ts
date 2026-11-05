// Pure copy/formatting for EpisodeCard and the Home demo section (node-testable; no React imports).
// Labels come from session.ts outcomeLabels; this file only words them (docs/08 use/avoid lists).
import type { Assistance, Episode, HelpMove, OutcomeLabel, Phase } from '../learning/types';

/** Symbol plus text so meaning never depends on color. No mastery, "retained" or "on your own" wording. */
export const OUTCOME_COPY: Record<OutcomeLabel, { symbol: string; text: string }> = {
  repair_verified: { symbol: '↻', text: 'Repaired after help' },
  passed_independent: { symbol: '✓', text: 'Passed this independent item' },
  needs_practice: { symbol: '○', text: 'Fresh problem: needs more practice' },
  could_not_assess: { symbol: '?', text: 'Could not assess this reading' },
  supported_practice: { symbol: '◐', text: 'Fresh problem used help (supported practice)' },
};

export const PHASE_COPY: Record<Phase, string> = {
  attempt: 'First attempt',
  repair: 'Repairing with help',
  repair_verified: 'Repair checked, fresh problem next',
  independent: 'Fresh problem in progress',
  independent_submitted: 'Fresh problem submitted, waiting for the check',
  outcome: 'Result recorded',
};

const MOVE_NAME: Record<HelpMove, string> = {
  check: 'check',
  pointer: 'pointer',
  explain: 'explanation',
  example: 'worked example',
  step: 'step',
  start: 'getting started',
  dispute: 'dispute',
};

/**
 * Move names in first-use order, deduplicated. A move whose delivered content was not recorded is suffixed
 * "(content unknown)" rather than presented as known. Empty list means nothing was recorded, not "no help".
 */
export function helpUsed(assistance: readonly Assistance[]): string[] {
  const order: HelpMove[] = [];
  const unknown = new Set<HelpMove>();
  for (const a of assistance) {
    if (!order.includes(a.move)) order.push(a.move);
    if (a.revealed === 'unknown') unknown.add(a.move);
  }
  return order.map((m) => (unknown.has(m) ? `${MOVE_NAME[m]} (content unknown)` : MOVE_NAME[m]));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Device-local calendar date, e.g. "Thu, Nov 5, 2026". Fixed format so it does not depend on Intl support. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** A due date is a schedule, not a delayed result. */
export function reviewLine(ep: Pick<Episode, 'reviewDueAt'>): string {
  return ep.reviewDueAt === undefined ? 'No review scheduled' : `Review scheduled for ${localDate(ep.reviewDueAt)}`;
}

/**
 * T08 route contract: once an independent attempt exists (phases independent, independent_submitted, outcome) the
 * episode resumes on the independent screen, which also shows the outcome; before that, the workspace.
 */
export function resumeTarget(ep: Pick<Episode, 'independentAttemptId'>): 'independent' | 'workspace' {
  return ep.independentAttemptId ? 'independent' : 'workspace';
}

/** Newest episode of the given assignment, or undefined. */
export function latestEpisode(episodes: readonly Episode[], assignmentId: string): Episode | undefined {
  let best: Episode | undefined;
  for (const e of episodes) if (e.assignmentId === assignmentId && !e.followUpOf && (!best || e.createdAt > best.createdAt)) best = e;
  return best;
}
