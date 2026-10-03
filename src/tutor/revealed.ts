import { REVEAL_KINDS, type HelpLevel, type RevealKind, type Revealed } from '../ai/types.ts';

/**
 * What each help level may reveal. A level is a ceiling on information, not on wording: a "conceptual" hint can give
 * away more of a problem than a procedural one, so the tutor reports what it revealed and code compares that with
 * the level. Must match the "Allowed in revealed" lines in HELP_LEVELS (src/ai/prompts.ts).
 */
export const ALLOWED_REVEALS: Record<HelpLevel, readonly RevealKind[]> = {
  0: ['location'],
  1: ['location'],
  2: ['location', 'principle'],
  3: ['location', 'principle', 'example'],
  4: ['location', 'principle', 'example', 'subgoal', 'step'],
};

/** Reveal kinds in `revealed` that the level does not allow (deduplicated, in ladder order). */
export function overLevel(revealed: Revealed[] | undefined, level: HelpLevel): RevealKind[] {
  if (!revealed?.length) return [];
  const allowed = new Set(ALLOWED_REVEALS[level]);
  const over = new Set(revealed.map((r) => r.kind).filter((k) => !allowed.has(k)));
  return REVEAL_KINDS.filter((k) => over.has(k));
}

/** Lowest help level that allows a reveal kind (used to describe what a session actually needed). */
export function levelFor(kind: RevealKind): HelpLevel {
  return (([0, 1, 2, 3, 4] as HelpLevel[]).find((l) => ALLOWED_REVEALS[l].includes(kind)) ?? 4) as HelpLevel;
}
