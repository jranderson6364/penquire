import { HELP_LEVELS } from './ai/prompts';
import type { HelpLevel } from './ai/types';
import type { Assignment } from './store/types';

/** Deterministic, paste-ready AI-use disclosure built from the append-only event log. */
export function disclosureSummary(a: Assignment): string {
  const checks = a.events.filter((e) => e.type === 'check');
  const replies = a.events.filter((e) => e.type === 'reply');
  const levels = new Map<HelpLevel, number>();
  for (const e of [...checks, ...replies]) {
    if (e.level !== undefined) levels.set(e.level, (levels.get(e.level) ?? 0) + 1);
  }
  const levelText = [...levels.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([lvl, n]) => `${n}× ${HELP_LEVELS[lvl].name} (level ${lvl})`)
    .join(', ');
  const first = a.events[0]?.t;
  const last = a.events[a.events.length - 1]?.t;
  const span = first && last ? ` between ${new Date(first).toLocaleString()} and ${new Date(last).toLocaleString()}` : '';
  return [
    `AI use for "${a.title}"${a.course ? ` (${a.course})` : ''}: I used an AI tutor in Socratic mode to check my handwritten reasoning${span}.`,
    `${checks.length} work check${checks.length === 1 ? '' : 's'} and ${replies.length} follow-up question${replies.length === 1 ? '' : 's'}.`,
    levelText ? `Help levels used: ${levelText}.` : 'No hints used.',
    `The tutor was instructed never to provide solutions, final answers, or derivation steps${
      a.policyMaxLevel < 4 ? '' : ' beyond single-step walkthroughs where my course policy allows'
    }. All work and fixes are my own.`,
  ].join(' ');
}
