import type { HelpLevel } from '../ai/types';

/**
 * Hint ladder: each open issue (a flagged line) has its own rung, so asking for more help on one line does
 * not unlock answers everywhere. A rung only moves up on an explicit request, is clamped to the course
 * policy IN CODE (the prompt is not the enforcement point), and resets when the issue is fixed.
 */
export type Ladder = Record<string, HelpLevel>;

/**
 * Stable key for an issue (line IDs change between checks). Keyed on the INK when the line has a stroke signature
 * (src/check/carry.ts): the same ink transcribed differently is the same issue, so a re-read never resets a rung or
 * logs a false "resolved". Lines without a signature (older checks) fall back to part + the reading.
 */
export function issueKey(part: string | undefined, reading: string, sig?: string): string {
  return sig ? `${part ?? ''}|ink:${sig}` : legacyIssueKey(part, reading);
}

/** The pre-signature key: part + transcribed reading. Used to migrate stored rungs and issue records. */
export function legacyIssueKey(part: string | undefined, reading: string): string {
  return `${part ?? ''}|${reading.replace(/\s+/g, '').toLowerCase()}`;
}

/** Move rungs stored under old keys to their new keys (an existing rung on the new key wins). */
export function renameLadderKeys(ladder: Ladder, pairs: ReadonlyArray<[from: string, to: string]>): Ladder {
  let out = ladder;
  for (const [from, to] of pairs) {
    if (from === to || !(from in out)) continue;
    const { [from]: level, ...rest } = out;
    out = to in rest ? rest : { ...rest, [to]: level };
  }
  return out;
}

const clamp = (n: number, max: HelpLevel): HelpLevel => Math.max(0, Math.min(n, max)) as HelpLevel;

/** Rung currently in force for an issue (never above the policy ceiling). */
export function rungFor(ladder: Ladder, key: string, base: HelpLevel, policyMax: HelpLevel): HelpLevel {
  return clamp(Math.max(ladder[key] ?? base, base), policyMax);
}

export type Escalation = { ladder: Ladder; level: HelpLevel; atCeiling: boolean };

/** One tap on "more help": raise this issue by one rung, up to the policy maximum. */
export function escalate(ladder: Ladder, key: string, base: HelpLevel, policyMax: HelpLevel): Escalation {
  const current = rungFor(ladder, key, base, policyMax);
  const level = clamp(current + 1, policyMax);
  return { ladder: { ...ladder, [key]: level }, level, atCeiling: current >= policyMax };
}

/** Keep rungs only for issues still open after a check; fixed issues start over if they come back. */
export function pruneLadder(ladder: Ladder, openKeys: string[]): Ladder {
  const open = new Set(openKeys);
  return Object.fromEntries(Object.entries(ladder).filter(([k]) => open.has(k)));
}
