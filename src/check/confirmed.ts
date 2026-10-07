/**
 * Readings the student confirmed ("Yes, that's what I wrote") or corrected ("It misread me"), keyed by the line's ink
 * signature (src/check/carry.ts). Valid only while that ink is unchanged: a rewritten line has a new signature and is
 * read afresh. Passed to the next check so the tutor grades what the student wrote instead of re-guessing it, and so
 * the reading guard doesn't ask the same question twice. Pure.
 */
export type Confirmed = Record<string, string>; // sig -> reading

const MAX_READING = 200;

export function confirmReading(prev: Confirmed | undefined, sig: string | undefined, reading: string): Confirmed {
  const r = reading.trim().slice(0, MAX_READING);
  if (!sig || !r) return prev ?? {};
  return { ...(prev ?? {}), [sig]: r };
}

/** Confirmed readings for the lines on the page now (by current line id), and the map pruned to ink still present. */
export function confirmedFor(map: Confirmed | undefined, current: ReadonlyArray<{ id: string; sig: string }>): { input: { id: string; reading: string }[]; kept: Confirmed } {
  const kept: Confirmed = {};
  const input: { id: string; reading: string }[] = [];
  if (!map) return { input, kept };
  for (const c of current) {
    const r = c.sig ? map[c.sig] : undefined;
    if (r === undefined) continue;
    kept[c.sig] = r;
    input.push({ id: c.id, reading: r });
  }
  return { input, kept };
}
