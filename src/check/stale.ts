/**
 * Is the page's latest check still about the ink on the page? Pure (tested).
 *
 * A chat reply gets the latest check as context. In T11 run 1 every reply got a check of "6x − 4 = 10" (incorrect,
 * distribution still open) while the page already showed the fix, and the tutor kept re-announcing it. When this
 * says the check is out of date, the reply is told so (src/ai/prompts.ts lastCheckBlock): the page image is the truth.
 * The check's lines still go to the reply leak guard either way (src/verify/guard.ts passes everything through when
 * it has no lines).
 */

export type CheckInk = { strokeCount: number; sigs: readonly (string | undefined)[] };
export type PageInk = { strokes: number; sigs: readonly string[] };

/**
 * True when the page changed since the check: a different stroke count, a checked line whose signature is no longer
 * on the page (a stroke erased and another drawn keeps the count), or the pixel eraser was used (it can shrink a
 * stroke without changing its box). Lines saved without a signature can only be compared by the stroke count. No
 * check: nothing is stale.
 */
export function checkOutOfDate(check: CheckInk | undefined, now: PageInk, pixelErased = false): boolean {
  if (!check) return false;
  if (pixelErased || check.strokeCount !== now.strokes) return true;
  const present = new Set(now.sigs);
  return check.sigs.some((s) => !!s && !present.has(s));
}
