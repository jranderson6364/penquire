import type { Assignment } from './types';

/**
 * Parts of an assignment the latest checks call complete. A part counts once, from the most recent check that
 * mentions it; a "complete" status on an older page does not survive a newer page that reopened it.
 */
export function completedParts(a: Pick<Assignment, 'checks' | 'problems'>): { done: number; total: number } {
  const total = a.problems.length;
  if (total === 0) return { done: 0, total: 0 };
  const latest = new Map<string, { at: number; complete: boolean }>();
  for (const c of Object.values(a.checks ?? {})) {
    for (const p of c.result.parts) {
      const prev = latest.get(p.label);
      if (!prev || c.at >= prev.at) latest.set(p.label, { at: c.at, complete: p.status === 'complete' });
    }
  }
  const known = new Set(a.problems.map((p) => p.label));
  let done = 0;
  for (const [label, v] of latest) if (v.complete && known.has(label)) done++;
  return { done, total };
}
