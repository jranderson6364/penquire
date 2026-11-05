/**
 * Groups handwritten strokes into "lines" (L1, L2, ...) using only bounding boxes.
 * Pure + dependency-free so it can be unit-tested with plain Node.
 *
 * Heuristics:
 *  1. Strokes whose vertical extents overlap enough join the same line.
 *  2. Stacked fractions (numerator / bar / denominator) are merged into one line.
 *  3. Small marks (sub/superscripts, dots) and tall glyphs attach to the line whose band contains them.
 *  4. Lines that still overlap heavily are merged.
 *  4b. A matched bracket pair (matrix, column vector, brace) is one object: the bands it spans merge into one line.
 *  5. A line is split at a wide horizontal gap (margin labels, side calculations, two-column work), and
 *     groups at the same height are numbered left to right.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type StrokeLike = Box & { i: number; t?: number };
export type Line = Box & { id: string; strokes: number[] };

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Vertical overlap divided by the smaller height (0..1). */
export const vOverlap = (a: Box, b: Box) => {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, bottom - top);
  const minH = Math.max(1, Math.min(a.h, b.h));
  return inter / minH;
};

const hOverlap = (a: Box, b: Box) => {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  return Math.max(0, right - left);
};

type Group = Box & { strokes: number[]; core: Box };

const charHeight = (strokes: StrokeLike[]) => {
  // Typical character height, ignoring dots and long flat strokes (bars, underlines).
  const charHeights = strokes.filter((s) => s.h > 4 && s.h < s.w * 6).map((s) => s.h);
  return Math.max(12, median(charHeights.length ? charHeights : strokes.map((s) => s.h)));
};

/**
 * A sketch (a cliff, a ball's path, a force diagram) is ONE object, not a dozen "lines". Seeds are strokes far bigger
 * than handwriting in both directions (an outline, an arc); thin tall strokes (integral signs, brackets) are not seeds.
 * Seeds near each other form one figure, and every stroke whose centre sits inside it (labels like "20 m", arrows,
 * the ball) joins it. The figure box does not grow from what it absorbs, so work written beside it stays separate.
 * (Device run, November 4, 2026: the cliff sketch came back as 10+ labelled lines.)
 */
function splitFigures(strokes: StrokeLike[], hMed: number): { figures: Group[]; rest: StrokeLike[] } {
  // an outline or an arc (big both ways), or a very tall straight stroke (a cliff face, an axis): taller than any
  // bracket around a few rows of maths
  const isSeed = (s: Box) => (s.h > hMed * 2.6 && s.w > hMed * 1.5) || s.h > hMed * 5;
  const near = (a: Box, b: Box, pad: number) =>
    a.x - pad <= b.x + b.w && b.x - pad <= a.x + a.w && a.y - pad <= b.y + b.h && b.y - pad <= a.y + a.h;
  const regions: Box[] = [];
  for (const s of strokes.filter(isSeed)) {
    let box: Box = s;
    for (let k = regions.length - 1; k >= 0; k--) {
      if (near(regions[k], box, hMed * 1.5)) {
        box = union(box, regions[k]);
        regions.splice(k, 1);
      }
    }
    regions.push(box);
  }
  // a second sweep: two regions that only touch after both grew
  for (let a = 0; a < regions.length; a++)
    for (let b = regions.length - 1; b > a; b--)
      if (near(regions[a], regions[b], hMed * 1.5)) {
        regions[a] = union(regions[a], regions[b]);
        regions.splice(b, 1);
      }
  if (regions.length === 0) return { figures: [], rest: strokes };
  const figures: Group[] = regions.map((r) => ({ ...r, strokes: [], core: r }));
  const pad = hMed * 0.75;
  // a dash of a dashed path, a tick, the ball: tiny next to handwriting. A chain of these grows the figure (a dashed
  // path leaving the cliff), so they extend the core; labels and arrows join without extending it.
  const isDash = (s: Box) => Math.max(s.w, s.h) < hMed * 0.7;
  // a long stroke drawn onto the outline (the cliff top, the ground, a path leaving the edge) is part of the drawing
  const isLong = (s: Box) => Math.max(s.w, s.h) > hMed * 2;
  const grows = (s: Box) => isSeed(s) || isDash(s) || isLong(s);
  const joins = (g: Group, s: StrokeLike) => {
    if (isSeed(s)) return near(g.core, s, 0);
    if (isDash(s)) return near(g.core, s, hMed);
    if (isLong(s) && near(g.core, s, hMed * 0.5)) return true;
    // a long flat stroke just under or over the sketch (the ground, a table top) belongs to it
    if (s.h < hMed * 0.5 && s.w > hMed * 3 && hOverlap(g.core, s) > s.w * 0.3 && near(g.core, s, hMed * 1.5)) return true;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    return cx >= g.core.x - pad && cx <= g.core.x + g.core.w + pad && cy >= g.core.y - pad && cy <= g.core.y + g.core.h + pad;
  };
  let left = [...strokes];
  for (let changed = true; changed; ) {
    changed = false;
    const next: StrokeLike[] = [];
    for (const s of left) {
      const f = figures.find((g) => joins(g, s));
      if (!f) {
        next.push(s);
        continue;
      }
      f.strokes.push(s.i);
      Object.assign(f, union(f, s));
      if (grows(s)) f.core = union(f.core, s);
      changed = true;
    }
    left = next;
  }
  return { figures: figures.filter((f) => f.strokes.length > 0), rest: left };
}

export function groupLines(strokes: StrokeLike[]): Line[] {
  if (strokes.length === 0) return [];
  const { figures, rest } = splitFigures(strokes, charHeight(strokes));
  return order([...figures, ...groupText(rest)], rest.length ? charHeight(rest) : charHeight(strokes));
}

function groupText(strokes: StrokeLike[]): Group[] {
  if (strokes.length === 0) return [];
  const hMed = charHeight(strokes);
  const isFlat = (s: Box) => s.h < hMed * 0.35 && s.w > hMed * 0.8;
  const isTall = (s: Box) => s.h > hMed * 2.6; // integral signs, big brackets, arrows
  const isSmall = (s: Box) => s.h < hMed * 0.6 && s.w < hMed * 0.8; // sub/superscripts, dots, primes

  const sorted = [...strokes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const groups: Group[] = [];

  // Pass 1: assign regular strokes to lines by vertical overlap with the line's "core" band.
  const deferred: StrokeLike[] = [];
  for (const s of sorted) {
    if (isFlat(s) || isTall(s) || isSmall(s)) {
      deferred.push(s);
      continue;
    }
    let best: Group | null = null;
    let bestScore = 0;
    for (const g of groups) {
      const score = vOverlap(s, g.core);
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best && bestScore >= 0.4) {
      best.strokes.push(s.i);
      Object.assign(best, union(best, s));
      // Core band grows slowly so one tall glyph doesn't swallow neighbouring lines.
      const coreTop = Math.min(best.core.y, s.y + s.h * 0.25);
      const coreBottom = Math.max(best.core.y + best.core.h, s.y + s.h * 0.75);
      best.core = { x: best.x, y: coreTop, w: best.w, h: coreBottom - coreTop };
    } else {
      const coreY = s.y + s.h * 0.25;
      groups.push({ ...s, strokes: [s.i], core: { x: s.x, y: coreY, w: s.w, h: Math.max(4, s.h * 0.5) } });
    }
  }

  // Pass 2: flat strokes (fraction bars, minus signs, underlines), tall strokes, and small marks.
  for (const s of deferred) {
    const cy = s.y + s.h / 2;
    if (isFlat(s)) {
      // Fraction bar: a group just above AND just below that overlap it horizontally -> merge all three.
      const above = groups
        .filter((g) => g.y + g.h <= cy + hMed * 0.3 && cy - (g.y + g.h) < hMed * 0.9 && hOverlap(g, s) > 0)
        .sort((a, b) => b.y + b.h - (a.y + a.h))[0];
      const below = groups
        .filter((g) => g.y >= cy - hMed * 0.3 && g.y - cy < hMed * 0.9 && hOverlap(g, s) > 0)
        .sort((a, b) => a.y - b.y)[0];
      if (above && below && above !== below) {
        above.strokes.push(s.i, ...below.strokes);
        Object.assign(above, union(union(above, s), below));
        above.core = { x: above.x, y: s.y - hMed * 0.5, w: above.w, h: s.h + hMed };
        groups.splice(groups.indexOf(below), 1);
        continue;
      }
    }
    // Otherwise attach to the line whose band contains its centre, or the nearest line.
    let best: Group | null = null;
    let bestDist = Infinity;
    for (const g of groups) {
      const gcy = g.core.y + g.core.h / 2;
      const inside = cy >= g.y - hMed * 0.3 && cy <= g.y + g.h + hMed * 0.3;
      const d = inside ? 0 : Math.abs(cy - gcy);
      if (d < bestDist) {
        bestDist = d;
        best = g;
      }
    }
    if (best && bestDist < hMed * 1.2) {
      best.strokes.push(s.i);
      Object.assign(best, union(best, s));
    } else {
      groups.push({ ...s, strokes: [s.i], core: { x: s.x, y: s.y, w: s.w, h: Math.max(4, s.h) } });
    }
  }

  // Pass 2.5: a bracket pair (matrix, column vector, big brace) is ONE object. Without this every row of a column
  // vector becomes its own "line", and the boxes overlap each other (real linear-algebra pages came out as 30+ colliding
  // lines). Merge the bands whose centres sit inside a matched pair. Two tall, thin strokes of similar height at the same
  // vertical position, with nothing closer in between, form a pair.
  const bracketLike = strokes.filter((s) => s.h > hMed * 1.8 && s.w < s.h * 0.45).sort((p, q) => p.x - q.x);
  const paired = new Set<number>();
  for (let a = 0; a < bracketLike.length; a++) {
    const left = bracketLike[a];
    if (paired.has(left.i)) continue;
    let right: StrokeLike | null = null;
    let rightGap = Infinity;
    for (let b = a + 1; b < bracketLike.length; b++) {
      const cand = bracketLike[b];
      if (paired.has(cand.i)) continue;
      const gap = cand.x - (left.x + left.w);
      if (gap < 0) continue;
      if (gap > hMed * 14) break; // sorted by x: nothing further away can be closer
      const overlap = Math.max(0, Math.min(left.y + left.h, cand.y + cand.h) - Math.max(left.y, cand.y)) / Math.min(left.h, cand.h);
      const ratio = Math.max(left.h, cand.h) / Math.min(left.h, cand.h);
      if (overlap >= 0.75 && ratio <= 1.5 && gap < rightGap) {
        right = cand;
        rightGap = gap;
      }
    }
    if (!right) continue;
    paired.add(left.i);
    paired.add(right.i);
    const rect = union(left, right);
    const inside = groups.filter((g) => {
      const cy = g.y + g.h / 2;
      return cy >= rect.y - hMed * 0.2 && cy <= rect.y + rect.h + hMed * 0.2;
    });
    if (inside.length < 2) continue;
    const keep = inside[0];
    for (const g of inside.slice(1)) {
      keep.strokes.push(...g.strokes);
      Object.assign(keep, union(keep, g));
      keep.core = union(keep.core, g.core);
      groups.splice(groups.indexOf(g), 1);
    }
  }

  // Pass 3: merge lines whose cores overlap heavily (e.g. a line written in two bursts).
  groups.sort((a, b) => a.y - b.y);
  for (let k = 0; k < groups.length - 1; ) {
    const a = groups[k];
    const b = groups[k + 1];
    if (vOverlap(a.core, b.core) > 0.6) {
      a.strokes.push(...b.strokes);
      Object.assign(a, union(a, b));
      a.core = union(a.core, b.core);
      groups.splice(k + 1, 1);
    } else {
      k++;
    }
  }

  // Pass 4: split at wide horizontal gaps. Words in one equation are close; a gap of several character
  // heights means separate material that merely sits at the same height.
  const byIndex = new Map(strokes.map((s) => [s.i, s]));
  const gapLimit = Math.max(120, hMed * 8);
  const split: Group[] = [];
  for (const g of groups) {
    const members = g.strokes.map((i) => byIndex.get(i)!).sort((a, b) => a.x - b.x);
    let run: StrokeLike[] = [];
    let right = -Infinity;
    const flush = () => {
      if (run.length === 0) return;
      const box = run.slice(1).reduce<Box>((acc, m) => union(acc, m), run[0]);
      split.push({ ...box, strokes: run.map((m) => m.i), core: box });
      run = [];
    };
    for (const m of members) {
      if (run.length && m.x - right > gapLimit) {
        flush();
        right = -Infinity;
      }
      run.push(m);
      right = Math.max(right, m.x + m.w);
    }
    flush();
  }
  return split;
}

/** Order: top to bottom; within a run at (nearly) the same height, left to right. */
function order(groups: Group[], hMed: number): Line[] {
  groups.sort((a, b) => a.y - b.y);
  const ordered: Group[] = [];
  for (let k = 0; k < groups.length; ) {
    const row = [groups[k]];
    const cy0 = groups[k].y + groups[k].h / 2;
    let j = k + 1;
    while (j < groups.length && Math.abs(groups[j].y + groups[j].h / 2 - cy0) < hMed * 0.6) row.push(groups[j++]);
    ordered.push(...row.sort((a, b) => a.x - b.x));
    k = j;
  }

  return ordered
    .map((g, idx) => ({
      id: `L${idx + 1}`,
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      strokes: [...g.strokes].sort((p, q) => p - q),
    }));
}
