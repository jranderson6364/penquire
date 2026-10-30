// Pure helpers for the independent-attempt screen (T08). No React, no store: the screen owns side effects.
import type { ChatTurn, CheckResult, HelpLevel, LineVerdict, PageImage, ReplyInput } from '../ai/types';
import { outcomeLabels } from './session.ts';
import type { Attempt, DemoTask, Episode, HelpMove, OutcomeLabel } from './types';

export const independentAttemptId = (episodeId: string) => `${episodeId}:independent`;

const attemptOf = (ep: Episode): Attempt | undefined => (ep.independentAttemptId ? ep.attempts[ep.independentAttemptId] : undefined);

/**
 * What the screen shows for this episode on entry or relaunch:
 *  - 'begin': no independent attempt yet and the episode may start one (the screen calls beginIndependent);
 *  - 'unavailable': no attempt and the episode isn't at a repair phase;
 *  - 'working' / 'submitted' / 'outcome': resume the stored attempt.
 */
export type IndependentView = 'begin' | 'unavailable' | 'working' | 'submitted' | 'outcome';
export function independentView(ep: Episode): IndependentView {
  if (!attemptOf(ep)) return ep.phase === 'repair' || ep.phase === 'repair_verified' ? 'begin' : 'unavailable';
  if (ep.phase === 'independent_submitted') return 'submitted';
  if (ep.phase === 'outcome') return 'outcome';
  return 'working';
}

/** Submit is allowed only while the attempt is open, nothing is running, and there is ink to submit. */
export function canSubmit(s: { phase: Episode['phase']; busy: boolean; strokeCount: number | null; loaded: boolean }): boolean {
  return s.phase === 'independent' && !s.busy && s.loaded && (s.strokeCount ?? 0) > 0;
}

/** The submitted snapshot was assessed and nothing changed since: the result may be shown. */
export function resultVisible(ep: Episode): boolean {
  const at = attemptOf(ep);
  if (ep.phase !== 'outcome' || !at?.snapshot || !at.assessment) return false;
  if (at.assessment.snapshotId !== at.snapshot.id) return false;
  return at.invalidatedAt === undefined || at.invalidatedAt < at.snapshot.at;
}

/** The attempt was submitted once and then edited: the old result is gone and the student must submit again. */
export function changedSinceSubmission(ep: Episode): boolean {
  const at = attemptOf(ep);
  return ep.phase === 'independent' && !!at?.snapshot && at.invalidatedAt !== undefined && at.invalidatedAt >= at.snapshot.at;
}

/** A stroke change counts as an edit of submitted work only in these phases (see invalidateOnEdit). */
export const editInvalidates = (phase: Episode['phase']) => phase === 'independent_submitted' || phase === 'outcome';

/** Lines whose reading the student must confirm before assessment (assess.ts treats them as unassessable). */
export function linesToConfirm(check: CheckResult): LineVerdict[] {
  return check.lines.filter(
    (l) => l.verdict !== 'context' && (typeof l.reading === 'string' ? l.reading.trim() : '') !== '' && (l.verdict === 'unreadable' || l.readConfidence === 'low' || l.guard === 'reading')
  );
}

/**
 * Apply the student's confirmed readings to a recheck. The recheck was sent with `confirmed` (the model is told to use
 * that text with high confidence), but the model may still report low confidence. The student's confirmation is what
 * resolves that, so the confirmed lines read exactly as confirmed with high confidence. The verdict stays the model's:
 * an 'unreadable' verdict is kept, so the assessment stays honest.
 */
export function withConfirmedReadings(check: CheckResult, confirmed: { id: string; reading: string }[]): CheckResult {
  const byId = new Map(confirmed.map((c) => [c.id, c.reading]));
  return {
    ...check,
    lines: check.lines.map((l) => {
      const r = byId.get(l.id);
      if (r === undefined) return l;
      const { guard: _g, ...rest } = l;
      return { ...rest, reading: r, readConfidence: 'high' as const, ...(l.guard && l.guard !== 'reading' ? { guard: l.guard } : {}) };
    }),
  };
}

const MOVE_PHRASE: Record<HelpMove, string> = {
  check: 'check',
  pointer: 'pointer',
  explain: 'explanation',
  example: 'worked example',
  step: 'step',
  start: 'start hint',
  dispute: 'review of a mark',
};

/** The most help delivered on the repair attempt, as a phrase ("pointer", "worked example"); undefined if none recorded. */
export function repairHelpPhrase(ep: Episode): string | undefined {
  const ids = new Set(ep.repairAttemptId ? [ep.repairAttemptId] : []);
  const help = ep.assistance.filter((a) => ids.has(a.attemptId));
  if (help.length === 0) return undefined;
  const top = help.reduce((m, a) => (a.level > m.level ? a : m));
  return MOVE_PHRASE[top.move];
}

const FRESH_TEXT: Record<Exclude<OutcomeLabel, 'repair_verified'>, string> = {
  passed_independent: 'Passed this independent item',
  needs_practice: 'Needs more practice',
  could_not_assess: 'Could not assess',
  supported_practice: 'Supported practice',
};

export type OutcomeRows = {
  repair: { verified: boolean; text: string };
  fresh: { label?: Exclude<OutcomeLabel, 'repair_verified'>; text: string; reasons: string[] };
};

/** The two separate outcome rows. Labels come only from session.outcomeLabels; no percentages or mastery words. */
export function outcomeRows(ep: Episode): OutcomeRows {
  const labels = outcomeLabels(ep);
  const verified = labels.includes('repair_verified');
  const helpPhrase = repairHelpPhrase(ep);
  const repairText = !verified ? 'No verified repair recorded' : helpPhrase ? `Repaired after ${/^[aeiou]/.test(helpPhrase) ? 'an' : 'a'} ${helpPhrase}` : 'Repaired after help (kind not recorded)';
  const fresh = labels.find((l): l is Exclude<OutcomeLabel, 'repair_verified'> => l !== 'repair_verified');
  const at = attemptOf(ep);
  const reasons = fresh === 'supported_practice'
    ? ['Help was used during this attempt, so it does not count as independent.', ...(at?.assessment?.reasons ?? [])]
    : (at?.assessment?.reasons ?? []);
  return {
    repair: { verified, text: repairText },
    fresh: { label: fresh, text: fresh ? FRESH_TEXT[fresh] : 'Not assessed yet', reasons },
  };
}

/** Local calendar date for the review line ("Review scheduled for <date>"). */
export function reviewDateText(dueAt: number, locale?: string): string {
  return new Date(dueAt).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
}

export const INDEPENDENT_POLICY_TEXT =
  'Original demo practice. The student left an independent attempt to get help, so this is supported practice. Checking, general explanations and worked examples on different tasks are allowed through level';

/**
 * A help reply after the student left the independent attempt. Independent-task context only: the task's
 * learner-facing prompt and this help conversation only (`history`): no workspace chat, no lastCheck, no other task,
 * never the answer key.
 */
export function helpReplyInput(task: DemoTask, message: string, level: HelpLevel, history: ChatTurn[], image?: PageImage): ReplyInput {
  return {
    course: 'Original demo practice',
    assignmentTitle: 'Supported practice',
    problems: [{ label: '1', text: task.prompt, asksFor: [] }],
    policy: `${INDEPENDENT_POLICY_TEXT} ${level}.`,
    helpLevel: level,
    history: history.map((t) => ({ role: t.role, text: t.text })),
    message,
    ...(image ? { image } : {}),
  };
}
