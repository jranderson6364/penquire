/**
 * Chunks: the "words" of a handwritten line (terms, numbers, operators), found by horizontal gaps between strokes.
 * They let the tutor point at one expression inside a line without ever giving a coordinate: the model says which
 * stretch of the line (a fraction of its width), and code snaps that to whole chunks so the mark never slices a
 * symbol in half. Pure and tested.
 */
export type Box = { x: number; y: number; w: number; h: number };

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Group a line's strokes into chunks, left to right. */
export function chunkLine(strokes: readonly Box[]): Box[] {
  if (strokes.length === 0) return [];
  const heights = strokes.filter((s) => s.h > 3).map((s) => s.h);
  const gap = Math.max(5, 0.32 * (median(heights) || 20));
  const sorted = [...strokes].sort((a, b) => a.x - b.x);
  const chunks: Box[] = [];
  let cur: Box = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.x - (cur.x + cur.w) <= gap) cur = union(cur, s);
    else {
      chunks.push(cur);
      cur = { ...s };
    }
  }
  chunks.push(cur);
  return chunks;
}

/**
 * The part of a line a span covers, snapped to chunks. `from`/`to` are fractions of the line's width (0 = left edge,
 * 1 = right edge). A chunk belongs to the span when at least half of it lies inside; if no chunk qualifies the nearest
 * one to the span's centre is used. Returns the whole line when there is no span or no chunks.
 */
export function snapSpan(line: Box, chunks: readonly Box[], from?: number, to?: number): Box {
  if (from === undefined || to === undefined || chunks.length === 0) return { ...line };
  const x0 = line.x + Math.max(0, Math.min(1, from)) * line.w;
  const x1 = line.x + Math.max(0, Math.min(1, to)) * line.w;
  if (x1 - x0 < 1) return { ...line };
  const inside = chunks.filter((c) => {
    const ov = Math.min(c.x + c.w, x1) - Math.max(c.x, x0);
    return ov / Math.max(c.w, 1) >= 0.5;
  });
  let pick = inside;
  if (pick.length === 0) {
    const mid = (x0 + x1) / 2;
    const nearest = [...chunks].sort((a, b) => Math.abs(a.x + a.w / 2 - mid) - Math.abs(b.x + b.w / 2 - mid))[0];
    pick = [nearest];
  }
  return pick.slice(1).reduce(union, pick[0]);
}
