import { HELP_LEVELS } from './ai/prompts.ts';
import type { HelpLevel } from './ai/types.ts';
import type { Assignment, LogEvent } from './store/types.ts';
import { resolvedAfter, type ResolvedAfter } from './tutor/issues.ts';

/**
 * What the highest level actually used allowed the tutor to do. These are the tutor's settings, not a guarantee of what
 * it said (over-level reveals are reported separately). Derived from HELP_LEVELS, so it can't drift.
 */
const WHAT_IT_DID: Record<HelpLevel, string> = {
  0: 'At that level the tutor is set only to mark lines (valid, partly valid, incorrect, unreadable) and say where to look.',
  1: 'At that level the tutor is set to mark lines and point to where an issue is, without explaining concepts, showing examples or giving steps.',
  2: 'At that level the tutor is set to state relevant principles in general terms, without examples or steps of my problem.',
  3: 'At that level the tutor is set to work examples of different, similar problems, without steps of my problem.',
  4: 'At that level the tutor is set to explain one next step of my problem at a time when asked, without final answers.',
};

const HELPED: LogEvent['type'][] = ['check', 'reply', 'start', 'dispute'];

export type IssueOutcomes = {
  /** resolved issues by the most help in force when each stopped being flagged */
  after: Record<ResolvedAfter, number>;
  resolved: number;
  open: number;
  /** the tutor's own reversals on unchanged ink: never counted as student fixes */
  withdrawn: number;
};

/**
 * Flagged issues by the help in force when they stopped being flagged, plus the ones still open and the ones the tutor
 * withdrew. No bucket means "independent": a fix after a pointer is still a fix after help.
 */
export function issueOutcomes(a: Assignment): IssueOutcomes {
  const after: Record<ResolvedAfter, number> = { 'marks only': 0, pointer: 0, explanation: 0, example: 0, step: 0, unrecorded: 0 };
  const resolved = a.events.filter((e) => e.type === 'resolved');
  for (const e of resolved) after[resolvedAfter(e.level)]++;
  const withdrawn = a.events.filter((e) => e.type === 'withdrawn').length;
  return { after, resolved: resolved.length, open: Object.keys(a.issues ?? {}).length, withdrawn };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Deterministic, paste-ready AI-use disclosure built from the append-only event log. */
export function disclosureSummary(a: Assignment): string {
  const checks = a.events.filter((e) => e.type === 'check');
  const replies = a.events.filter((e) => e.type === 'reply' || e.type === 'start' || e.type === 'dispute');
  const levels = new Map<HelpLevel, number>();
  let maxUsed: HelpLevel | undefined;
  for (const e of a.events) {
    if (!HELPED.includes(e.type) || e.level === undefined) continue;
    levels.set(e.level, (levels.get(e.level) ?? 0) + 1);
    if (maxUsed === undefined || e.level > maxUsed) maxUsed = e.level;
  }
  const levelText = [...levels.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([lvl, n]) => `${n}× ${HELP_LEVELS[lvl].name} (level ${lvl})`)
    .join(', ');
  const first = a.events[0]?.t;
  const last = a.events[a.events.length - 1]?.t;
  const span = first && last ? ` between ${new Date(first).toLocaleString()} and ${new Date(last).toLocaleString()}` : '';

  const o = issueOutcomes(a);
  const flagged = o.resolved + o.open;
  const bucket = (label: string, n: number) => `${label}: ${n}.`;
  const outcomes = flagged
    ? [
        `The tutor flagged ${plural(flagged, 'issue')}.`,
        bucket('After marks only', o.after['marks only']),
        bucket('After a pointer', o.after.pointer),
        bucket('After an explanation or example', o.after.explanation + o.after.example),
        o.after.step ? bucket('After a step', o.after.step) : '',
        o.after.unrecorded ? bucket('After unrecorded help', o.after.unrecorded) : '',
        bucket('Still open', o.open),
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  // Withdrawn flags were the tutor's mistakes on unchanged work: not issues the student resolved, so counted apart.
  const withdrawnText = o.withdrawn ? `Withdrawn by the tutor (not counted as student fixes): ${o.withdrawn}.` : '';
  const over = a.events.filter((e) => e.overLevel?.length).length;

  return [
    `AI use for "${a.title}"${a.course ? ` (${a.course})` : ''}: I used an AI tutor to check my handwritten reasoning${span}.`,
    `${plural(checks.length, 'work check')} and ${plural(replies.length, 'follow-up question')}.`,
    levelText ? `Help levels used: ${levelText}.` : 'No help levels were recorded.',
    outcomes,
    withdrawnText,
    maxUsed !== undefined ? `Highest level used: ${HELP_LEVELS[maxUsed].name}. ${WHAT_IT_DID[maxUsed]}` : '',
    over ? `In ${plural(over, 'response')} the tutor reported revealing more than the selected level allows; those are marked in the log.` : '',
    'This summary is built from the app event log. It records help levels, not everything the tutor said, and it is not a statement of authorship.',
  ]
    .filter(Boolean)
    .join(' ');
}
