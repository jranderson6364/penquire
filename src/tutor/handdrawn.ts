/**
 * Hand-drawn geometry for the tutor's marks, so a ring looks like a quick loop with a pen and a highlight looks like
 * a marker pass, not a CSS border. Pure, deterministic (seeded by the mark id, so a mark never changes shape between
 * renders) and tested. The UI draws a stroke as a chain of short rounded segments, so no vector library is needed.
 */
export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export type Seg = { cx: number; cy: number; len: number; angleDeg: number; th: number };

/** Small seeded generator (mulberry32 over an FNV-1a hash of the seed string). */
export function rng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Stroke = { pts: Pt[]; th: number[] };

/** A quick loop around a box: starts top-left, goes round once, overshoots and ends slightly inside where it began. */
export function ring(box: Box, seed: string, pad = 8): Stroke {
  const r = rng(seed + ':ring');
  const cx = box.x + box.w / 2 + (r() - 0.5) * 3;
  const cy = box.y + box.h / 2 + (r() - 0.5) * 3;
  // an ellipse that clears the box corners: scale the half-sizes by sqrt(2), so the loop never cuts through the work
  const rx = (box.w / 2 + pad) * 1.28;
  const ry = (box.h / 2 + pad) * 1.34;
  const dir = r() < 0.2 ? -1 : 1; // most people circle clockwise-on-paper (counter-clockwise on screen coordinates)
  const start = (-Math.PI * (0.62 + r() * 0.2)) * dir;
  const sweep = Math.PI * 2 * (1.04 + r() * 0.05) * dir;
  const p1 = r() * 6;
  const p2 = r() * 6;
  const n = 64;
  const pts: Pt[] = [];
  const th: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + sweep * t;
    const wob = 1 + 0.045 * Math.sin(2 * a + p1) + 0.03 * Math.sin(3 * a + p2);
    const drift = 1 - 0.1 * t; // the end of the loop lands inside the start, like a real overshoot
    pts.push({ x: cx + Math.cos(a) * rx * wob * drift, y: cy + Math.sin(a) * ry * wob * drift });
    const taper = Math.min(1, t * 9, (1 - t) * 6 + 0.35);
    th.push((0.8 + 0.3 * Math.sin(t * 7 + p1)) * (0.45 + 0.55 * taper));
  }
  return { pts, th };
}

/** A pen underline: a gentle bow, slightly tilted, a little longer than the text at both ends. */
export function underline(box: Box, seed: string): Stroke {
  const r = rng(seed + ':ul');
  const x0 = box.x - 4 - r() * 4;
  const x1 = box.x + box.w + 4 + r() * 5;
  const y0 = box.y + box.h + 3 + r() * 2;
  const tilt = (r() - 0.5) * 4;
  const bow = 1 + r() * 2;
  const n = 14;
  const pts: Pt[] = [];
  const th: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + (x1 - x0) * t, y: y0 + tilt * t + Math.sin(t * Math.PI) * bow });
    th.push(0.85 + 0.2 * Math.sin(t * 5) * (1 - Math.abs(t - 0.5)));
  }
  return { pts, th };
}

export type Wash = { x: number; y: number; w: number; h: number; rotateDeg: number; radius: number; radiusRight: number };

/** A marker pass over the text: wider than the box by a few points, a hair off level, with uneven rounded ends. */
export function wash(box: Box, seed: string): Wash {
  const r = rng(seed + ':wash');
  const padX = 4 + r() * 3;
  const h = Math.max(10, box.h * 0.95);
  return {
    x: box.x - padX,
    y: box.y + (box.h - h) / 2 + (r() - 0.5) * 2,
    w: box.w + padX * 2 + r() * 3,
    h,
    rotateDeg: (r() - 0.5) * 1.1,
    radius: 2 + r() * 4,
    radiusRight: 2 + r() * 6,
  };
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * The stroke as ONE filled shape whose width follows the per-point thickness (a pen pressed harder in the middle,
 * lighter at the ends), with round caps: what a real pen leaves, instead of a chain of beads. Edges are smoothed with
 * quadratic curves through the midpoints. SVG path data in the stroke's own units.
 */
export function outlinePath(s: Stroke, base: number): string {
  const n = s.pts.length;
  if (n < 2) return '';
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = s.pts[Math.max(0, i - 1)];
    const b = s.pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const r = (base * (s.th[i] ?? 1)) / 2;
    left.push({ x: s.pts[i].x - ty * r, y: s.pts[i].y + tx * r });
    right.push({ x: s.pts[i].x + ty * r, y: s.pts[i].y - tx * r });
  }
  const smooth = (pts: Pt[], first: boolean) => {
    let d = first ? `M${f1(pts[0].x)} ${f1(pts[0].y)}` : `L${f1(pts[0].x)} ${f1(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += `Q${f1(pts[i].x)} ${f1(pts[i].y)} ${f1(mx)} ${f1(my)}`;
    }
    const last = pts[pts.length - 1];
    return d + `L${f1(last.x)} ${f1(last.y)}`;
  };
  const rEnd = (base * (s.th[n - 1] ?? 1)) / 2;
  const rStart = (base * (s.th[0] ?? 1)) / 2;
  const back = [...right].reverse();
  // left edge forward, round cap, right edge back, round cap
  return (
    smooth(left, true) +
    `A${f1(rEnd)} ${f1(rEnd)} 0 0 1 ${f1(back[0].x)} ${f1(back[0].y)}` +
    smooth(back, false).replace(/^L[^QL]*/, '') +
    `A${f1(rStart)} ${f1(rStart)} 0 0 1 ${f1(left[0].x)} ${f1(left[0].y)}Z`
  );
}

/** The pen's path through the stroke (for a write-on reveal), and its length. */
export function centerPath(s: Stroke): { d: string; length: number } {
  if (s.pts.length < 2) return { d: '', length: 0 };
  let d = `M${f1(s.pts[0].x)} ${f1(s.pts[0].y)}`;
  let length = 0;
  for (let i = 1; i < s.pts.length; i++) {
    d += `L${f1(s.pts[i].x)} ${f1(s.pts[i].y)}`;
    length += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
  }
  return { d, length };
}

/** Smooth a few control points into a dense pen path with pressure that rises then tapers (one quick stroke). */
function penStroke(ctrl: Pt[], r: () => number, n = 18): Stroke {
  const pts: Pt[] = [];
  const th: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const seg = Math.min(ctrl.length - 2, Math.floor(t * (ctrl.length - 1)));
    const u = t * (ctrl.length - 1) - seg;
    const a = ctrl[seg];
    const b = ctrl[seg + 1];
    // a touch of ease within each segment, like a hand speeding up mid-stroke
    const e = u * u * (3 - 2 * u);
    pts.push({ x: a.x + (b.x - a.x) * e + (r() - 0.5) * 0.4, y: a.y + (b.y - a.y) * e + (r() - 0.5) * 0.4 });
    th.push(0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  }
  return { pts, th };
}

/**
 * A teacher's verdict, as pen strokes in a box: a quick tick (✓), a cross (✗, two strokes), a squiggle (~).
 * Seeded by the line id, so a mark keeps its shape between renders.
 */
export function verdictStrokes(kind: 'valid' | 'incorrect' | 'partial', box: Box, seed: string): Stroke[] {
  const r = rng(seed + ':' + kind);
  const X = (f: number) => box.x + box.w * f;
  const Y = (f: number) => box.y + box.h * f;
  const j = () => (r() - 0.5) * 0.08;
  if (kind === 'valid') return [penStroke([{ x: X(0.08 + j()), y: Y(0.55 + j()) }, { x: X(0.38 + j()), y: Y(0.88 + j()) }, { x: X(0.95 + j()), y: Y(0.08 + j()) }], r)];
  if (kind === 'incorrect')
    return [
      penStroke([{ x: X(0.12 + j()), y: Y(0.12 + j()) }, { x: X(0.88 + j()), y: Y(0.9 + j()) }], r, 12),
      penStroke([{ x: X(0.86 + j()), y: Y(0.1 + j()) }, { x: X(0.14 + j()), y: Y(0.9 + j()) }], r, 12),
    ];
  // a squiggle: two humps
  const ctrl: Pt[] = [];
  for (let i = 0; i <= 6; i++) ctrl.push({ x: X(0.05 + (0.9 * i) / 6), y: Y(0.5 + (i % 2 === 0 ? 0.18 : -0.18) * (i === 0 || i === 6 ? 0.4 : 1) + j()) });
  return [penStroke(ctrl, r, 24)];
}

/** A polyline with per-point thickness factors -> segments to draw as rounded rectangles (fallback renderer). */
export function toSegments(s: Stroke, baseThickness: number): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i];
    const b = s.pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    out.push({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, len, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI, th: baseThickness * (((s.th[i] ?? 1) + (s.th[i + 1] ?? 1)) / 2) });
  }
  return out;
}
