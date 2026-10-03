import { HELP_LEVELS } from './ai/prompts.ts';
import type { HelpLevel } from './ai/types.ts';
import type { Assignment, LogEvent } from './store/types.ts';
import { resolvedUnaided } from './tutor/issues.ts';

/** What the tutor was allowed to do at the highest level actually used. Derived from HELP_LEVELS, so it can't drift. */
const WHAT_IT_DID: Record<HelpLevel, string> = {
  0: 'The tutor only marked my lines (valid, partly valid, incorrect, unreadable) and said where to look.',
  1: 'The tutor marked my lines and pointed to where an issue was; it did not explain concepts, show examples or give any steps.',
  2: 'At most, the tutor stated relevant principles in general terms; it showed no examples and no steps of my problem.',
  3: 'At most, the tutor worked examples of different, similar problems; it gave no steps of my problem.',
  4: 'At most, the tutor explained one next step of my problem at a time when I asked; it never gave final answers.',
};

const HELPED: LogEvent['type'][] = ['check', 'reply', 'start', 'dispute'];

export type IssueOutcomes = { unaided: number; helped: number; helpedByLevel: Map<HelpLevel, number>; open: number };

/** Issues resolved on the student's own (marks + pointers) vs. after more help, plus the ones still open. */
export function issueOutcomes(a: Assignment): IssueOutcomes {
  const resolved = a.events.filter((e) => e.type === 'resolved');
  const helpedByLevel = new Map<HelpLevel, number>();
  let unaided = 0;
  for (const e of resolved) {
    if (resolvedUnaided(e.level)) unaided++;
    else helpedByLevel.set(e.level as HelpLevel, (helpedByLevel.get(e.level as HelpLevel) ?? 0) + 1);
  }
  const helped = resolved.length - unaided;
  return { unaided, helped, helpedByLevel, open: Object.keys(a.issues ?? {}).length };
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
  const flagged = o.unaided + o.helped + o.open;
  const helpedText = [...o.helpedByLevel.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([lvl, n]) => `${n} with ${HELP_LEVELS[lvl].name}`)
    .join(', ');
  const outcomes = flagged
    ? `Of ${plural(flagged, 'issue')} the tutor flagged, ${o.unaided} ${o.unaided === 1 ? 'was' : 'were'} resolved on my own (marks and pointers only)${
        o.helped ? `, ${o.helped} after more help (${helpedText})` : ''
      }${o.open ? `, and ${o.open} ${o.open === 1 ? 'is' : 'are'} still open` : ''}.`
    : '';
  const over = a.events.filter((e) => e.overLevel?.length).length;

  return [
    `AI use for "${a.title}"${a.course ? ` (${a.course})` : ''}: I used an AI tutor to check my handwritten reasoning${span}.`,
    `${plural(checks.length, 'work check')} and ${plural(replies.length, 'follow-up question')}.`,
    levelText ? `Help levels used: ${levelText}.` : 'No hints used.',
    outcomes,
    maxUsed !== undefined ? WHAT_IT_DID[maxUsed] : '',
    over ? `In ${plural(over, 'response')} the tutor reported revealing more than the selected level allows; those are marked in the log.` : '',
    'The tutor is set never to give final answers, and I wrote all of the work myself.',
  ]
    .filter(Boolean)
    .join(' ');
}
