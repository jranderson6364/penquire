import type { ParseResult } from '../ai/types';
import { flatten } from '../problems/flatten.ts';
import type { Assignment } from './types';

/**
 * Put a parse result on an assignment (used when creating one and when re-parsing). `problems` stays the flat
 * per-part list the tutor and part picker use; `groups` is the structured version the UI shows.
 * Re-parsing changes labels, so rungs and part statuses keyed on old labels are dropped rather than left dangling.
 */
export function applyParse(a: Assignment, parsed: ParseResult, opts: { pages?: string; only?: string } = {}): Assignment {
  const groups = parsed.groups ?? [];
  const problems = groups.length ? flatten(groups) : parsed.problems;
  const parts = problems.length;
  const detail = groups.length ? `${groups.length} problem${groups.length === 1 ? '' : 's'}, ${parts} part${parts === 1 ? '' : 's'}` : `${parts} parts`;
  return {
    ...a,
    problems,
    groups: groups.length ? groups : undefined,
    notes: parsed.notes && parsed.notes.length ? parsed.notes : undefined,
    parseIssues: parsed.issues && parsed.issues.length ? parsed.issues : undefined,
    sourcePages: opts.pages || a.sourcePages,
    sourceOnly: opts.only || a.sourceOnly,
    course: a.course || parsed.course || '',
    ladder: {},
    events: [...a.events, { t: Date.now(), type: 'parse', detail: opts.pages ? `${detail} (pages ${opts.pages})` : detail }],
  };
}
