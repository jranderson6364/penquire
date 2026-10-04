/**
 * Settled-line carry-over: which lines of a page were already verified by an earlier check and have not changed,
 * so a new check only grades what is new. Pure and dependency-free (unit-tested with plain Node).
 *
 * Why it exists: every Check used to re-send and re-grade the whole page, so moving on to 2a re-judged a fully
 * correct 1a, and one page-level explanation could describe the wrong part.
 *
 * Safety rules (a carried check mark that is wrong would be a false check mark, the worst bug):
 *  - Only `valid` / `context` lines are ever carried. Anything the tutor flagged is always re-graded.
 *  - A line is "the same" only if its signature matches: the rounded boxes of ALL its strokes. Adding, removing or
 *    moving any stroke changes the signature.
 *  - Work is cumulative: when a line changes (or disappears), the later settled lines of the same part may follow
 *    from it, so they are re-graded too. Other parts are untouched.
 *  - A check saved without signatures (older versions) carries nothing.
 */
import type { Box, Line, StrokeLike } from '../ink/lines';
import type { LineVerdict, PartStatus } from '../ai/types';

const STEP = 2; // page points: ink coordinates are floats; this keeps harmless jitter from changing a signature

/** Stable fingerprint of a line's ink. Order-independent; any added/removed/moved stroke changes it. */
export function lineSignature(line: Pick<Line, 'strokes'>, byIndex: ReadonlyMap<number, Box>): string {
  const parts: string[] = [];
  for (const i of line.strokes) {
    const b = byIndex.get(i);
    if (!b) continue;
    parts.push([b.x, b.y, b.w, b.h].map((n) => Math.round(n / STEP)).join(','));
  }
  parts.sort();
  let h = 0x811c9dc5; // FNV-1a; the stroke count is part of the signature too
  const s = parts.join(';');
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${parts.length}:${h.toString(36)}`;
}

export function signatures(lines: Line[], strokes: StrokeLike[]): Map<string, string> {
  const byIndex = new Map<number, Box>(strokes.map((s) => [s.i, s]));
  return new Map(lines.map((l) => [l.id, lineSignature(l, byIndex)]));
}

const CARRIABLE = new Set(['valid', 'context']);

export type SavedLine = LineVerdict;
export type Reason = 'new' | 'flagged-before' | 'follows-change';
export type CurrentLine = { id: string; sig: string };

export type CarryPlan = {
  /** current line id -> the earlier verdict it keeps (callers re-id it) */
  settled: Map<string, SavedLine>;
  /** current line ids that must be graded */
  toGrade: string[];
  reason: Map<string, Reason>;
  /** parts whose earlier lines vanished (erased) or follow a change, so their status chip must be refreshed */
  dirtyParts: Set<string>;
};

/**
 * @param current  this page's lines in reading order, with signatures
 * @param prev     the lines of the last saved check, in saved (reading) order; ids need not match
 * @param carryNothing  force a full re-grade (e.g. the pixel eraser was used, which may not change stroke boxes)
 */
export function planCarry(current: ReadonlyArray<CurrentLine>, prev: ReadonlyArray<SavedLine> | undefined, carryNothing = false): CarryPlan {
  const settled = new Map<string, SavedLine>();
  const reason = new Map<string, Reason>();
  const dirtyParts = new Set<string>();

  if (carryNothing || !prev || prev.length === 0 || prev.every((p) => !p.sig)) {
    for (const c of current) reason.set(c.id, 'new');
    for (const p of prev ?? []) if (p.part) dirtyParts.add(p.part);
    return { settled, toGrade: current.map((c) => c.id), reason, dirtyParts };
  }

  // Match each current line to an earlier line with the same signature (each earlier line used once).
  const bySig = new Map<string, number[]>();
  prev.forEach((p, j) => {
    if (p.sig) bySig.set(p.sig, [...(bySig.get(p.sig) ?? []), j]);
  });
  const matchOf: Array<number | undefined> = current.map((c) => bySig.get(c.sig)?.shift());
  const used = new Set(matchOf.filter((j): j is number => j !== undefined));
  const partOf = (j: number) => prev[j].part ?? '';

  const invalid = new Set<number>(); // indexes into `current`

  // 1) A changed or new line invalidates the later settled lines of the same part. Its own part is unknown until it
  //    is graded, so use the part of the nearest settled line above it (or the first one below, at the top).
  for (let k = 0; k < current.length; k++) {
    if (matchOf[k] !== undefined) continue;
    let ref: string | undefined;
    for (let b = k - 1; b >= 0 && ref === undefined; b--) if (matchOf[b] !== undefined) ref = partOf(matchOf[b]!);
    for (let f = k + 1; f < current.length && ref === undefined; f++) if (matchOf[f] !== undefined) ref = partOf(matchOf[f]!);
    if (ref === undefined) continue;
    for (let f = k + 1; f < current.length; f++) {
      if (matchOf[f] === undefined) continue;
      if (partOf(matchOf[f]!) !== ref) break;
      invalid.add(f);
    }
  }

  // 2) A line that disappeared (erased, or edited into a different signature) invalidates the later matched lines
  //    of its part, and makes that part's status stale even if nothing below it exists.
  for (let j = 0; j < prev.length; j++) {
    if (used.has(j) || !prev[j].sig) continue;
    const p = partOf(j);
    dirtyParts.add(p);
    for (let k = 0; k < current.length; k++) {
      const m = matchOf[k];
      if (m === undefined || m < j) continue;
      if (partOf(m) !== p) break;
      invalid.add(k);
    }
  }

  const toGrade: string[] = [];
  current.forEach((c, k) => {
    const m = matchOf[k];
    if (m === undefined) {
      reason.set(c.id, 'new');
      toGrade.push(c.id);
    } else if (!CARRIABLE.has(prev[m].verdict)) {
      reason.set(c.id, 'flagged-before');
      toGrade.push(c.id);
      dirtyParts.add(partOf(m));
    } else if (invalid.has(k)) {
      reason.set(c.id, 'follows-change');
      toGrade.push(c.id);
      dirtyParts.add(partOf(m));
    } else {
      settled.set(c.id, prev[m]);
    }
  });
  return { settled, toGrade, reason, dirtyParts };
}

/**
 * Part status chips after a partial check: a part that no graded line belongs to and that lost no lines keeps its
 * earlier status (the model was not shown its work, so its new opinion of it is not evidence). Everything else
 * takes the model's fresh status.
 */
export function mergeParts(
  model: ReadonlyArray<PartStatus>,
  prev: ReadonlyArray<PartStatus> | undefined,
  plan: CarryPlan,
  merged: ReadonlyArray<SavedLine>
): PartStatus[] {
  if (!prev || plan.settled.size === 0) return [...model];
  const gradeSet = new Set(plan.toGrade);
  const touched = new Set(plan.dirtyParts);
  for (const l of merged) if (gradeSet.has(l.id) && l.part) touched.add(l.part);
  const before = new Map(prev.map((p) => [p.label, p]));
  const seen = new Set<string>();
  const out: PartStatus[] = [];
  for (const m of model) {
    seen.add(m.label);
    const old = before.get(m.label);
    out.push(old && !touched.has(m.label) ? old : m);
  }
  for (const p of prev) if (!seen.has(p.label) && !touched.has(p.label)) out.push(p);
  return out;
}

const SEVERITY: Record<string, number> = { valid: 0, context: 0, partial: 1, unreadable: 2, incorrect: 3 };

/**
 * Combine carried verdicts with the model's verdicts for the lines it was asked about.
 *  - Settled line: keep the carried verdict; the model may only DOWNGRADE it, never upgrade.
 *  - Graded line: the model's verdict (a missing one stays unmarked, as before).
 * Output is in current reading order with current ids and fresh signatures.
 */
export function mergeVerdicts(current: ReadonlyArray<CurrentLine>, plan: CarryPlan, graded: ReadonlyArray<LineVerdict>): SavedLine[] {
  const model = new Map(graded.map((l) => [l.id, l]));
  const out: SavedLine[] = [];
  for (const c of current) {
    const carried = plan.settled.get(c.id);
    const fresh = model.get(c.id);
    if (carried) {
      const downgrade = fresh !== undefined && (SEVERITY[fresh.verdict] ?? 2) > (SEVERITY[carried.verdict] ?? 0);
      out.push(downgrade ? { ...fresh, sig: c.sig } : { ...carried, id: c.id, sig: c.sig });
    } else if (fresh) {
      out.push({ ...fresh, sig: c.sig });
    }
  }
  return out;
}
