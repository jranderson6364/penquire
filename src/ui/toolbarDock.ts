// Pure geometry for the floating toolbar (T14C): where it docks, how a drag snaps to an edge, where a tool's options
// open from each edge, and which single notice the page shows. No React or react-native imports (node-testable).

export type Edge = 'top' | 'bottom' | 'left' | 'right';
/** A docked toolbar: the edge, and where along it (0 = start, 1 = end, of the free space). */
export type Dock = { edge: Edge; t: number };
export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Insets = { top: number; left: number; right: number; bottom: number };

export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];
export const DEFAULT_DOCK: Dock = { edge: 'top', t: 0.5 };
/** gap between the docked bar and the page edge (inside the safe area) */
export const EDGE_MARGIN = 10;
/** a grip touch must move this far (points) before it is a drag, so a tap never moves the bar */
export const DRAG_THRESHOLD = 6;

/** Bar metrics (points): one slot is a 44 pt touch target. */
export const BAR = { slot: 44, pad: 4, gap: 2, grip: 22, divider: 9 } as const;
/** +1 for the hairline border, which sits inside the box */
export const BAR_THICKNESS = BAR.slot + BAR.pad * 2 + 1;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

/** Tolerate a missing or malformed saved dock (older DBs have none). */
export function normalizeDock(raw: unknown): Dock {
  if (!raw || typeof raw !== 'object') return DEFAULT_DOCK;
  const r = raw as { edge?: unknown; t?: unknown };
  const edge = EDGES.includes(r.edge as Edge) ? (r.edge as Edge) : DEFAULT_DOCK.edge;
  const t = typeof r.t === 'number' && Number.isFinite(r.t) ? clamp01(r.t) : DEFAULT_DOCK.t;
  return { edge, t };
}

export const isVertical = (e: Edge) => e === 'left' || e === 'right';

/** Length along the bar for `slots` buttons, with a divider between the tools and undo/redo when both exist. */
export function barLength(tools: number, actions: number): number {
  const items = 1 + tools + actions; // the grip counts as an item for gaps
  const divider = tools > 0 && actions > 0 ? BAR.divider + BAR.gap : 0;
  return BAR.pad * 2 + BAR.grip + (tools + actions) * BAR.slot + (items - 1) * BAR.gap + divider;
}

/** Horizontal on the top/bottom edge, vertical on the left/right edge. */
export function barSize(edge: Edge, length: number, thickness = BAR_THICKNESS): Size {
  return isVertical(edge) ? { w: thickness, h: length } : { w: length, h: thickness };
}

/** The free range for the bar's leading coordinate along an edge: [lo, hi]. hi < lo when the bar does not fit. */
function along(edge: Edge, size: Size, bounds: Size, insets: Insets, margin: number): { lo: number; hi: number; span: number; len: number } {
  if (isVertical(edge)) return { lo: insets.top + margin, hi: bounds.h - insets.bottom - margin - size.h, span: bounds.h, len: size.h };
  return { lo: insets.left + margin, hi: bounds.w - insets.right - margin - size.w, span: bounds.w, len: size.w };
}

const place = (r: { lo: number; hi: number; span: number; len: number }, t: number) => (r.hi >= r.lo ? r.lo + clamp01(t) * (r.hi - r.lo) : (r.span - r.len) / 2);

/** Top-left of the docked bar inside `bounds` (the page container), inside the safe area. */
export function dockPosition(dock: Dock, size: Size, bounds: Size, insets: Insets, margin = EDGE_MARGIN): Point {
  const r = along(dock.edge, size, bounds, insets, margin);
  const a = place(r, dock.t);
  switch (dock.edge) {
    case 'top':
      return { x: a, y: insets.top + margin };
    case 'bottom':
      return { x: a, y: bounds.h - insets.bottom - margin - size.h };
    case 'left':
      return { x: insets.left + margin, y: a };
    case 'right':
      return { x: bounds.w - insets.right - margin - size.w, y: a };
  }
}

/** The edge closest to a point (ties: top, bottom, left, right). */
export function nearestEdge(p: Point, bounds: Size): Edge {
  const d: [Edge, number][] = [
    ['top', p.y],
    ['bottom', bounds.h - p.y],
    ['left', p.x],
    ['right', bounds.w - p.x],
  ];
  let best = d[0];
  for (const x of d) if (x[1] < best[1]) best = x;
  return best[0];
}

/**
 * Where a drop lands: the edge nearest the finger, and the bar centred on the finger along that edge (clamped to the
 * free space). `length` is the bar's length; its orientation follows the new edge.
 */
export function snapDock(finger: Point, length: number, bounds: Size, insets: Insets, thickness = BAR_THICKNESS, margin = EDGE_MARGIN): Dock {
  const p = { x: Math.max(0, Math.min(bounds.w, finger.x)), y: Math.max(0, Math.min(bounds.h, finger.y)) };
  const edge = nearestEdge(p, bounds);
  const size = barSize(edge, length, thickness);
  const r = along(edge, size, bounds, insets, margin);
  if (r.hi <= r.lo) return { edge, t: 0.5 };
  const lead = (isVertical(edge) ? p.y : p.x) - r.len / 2;
  return { edge, t: clamp01((lead - r.lo) / (r.hi - r.lo)) };
}

/** The grip's centre for a bar at `pos` (the grip leads the bar on every edge). */
export function gripCenter(pos: Point, edge: Edge, thickness = BAR_THICKNESS): Point {
  const lead = BAR.pad + BAR.grip / 2;
  return isVertical(edge) ? { x: pos.x + thickness / 2, y: pos.y + lead } : { x: pos.x + lead, y: pos.y + thickness / 2 };
}

/** While dragging, keep the grip (the finger) inside the page so the bar can always be picked up again. */
export function dragPosition(start: Point, d: Point, edge: Edge, bounds: Size, thickness = BAR_THICKNESS): Point {
  const g0 = gripCenter(start, edge, thickness);
  const gx = Math.max(0, Math.min(bounds.w, g0.x + d.x));
  const gy = Math.max(0, Math.min(bounds.h, g0.y + d.y));
  return { x: start.x + (gx - g0.x), y: start.y + (gy - g0.y) };
}

export const pastThreshold = (dx: number, dy: number, threshold = DRAG_THRESHOLD) => Math.hypot(dx, dy) > threshold;

// ---- tool options popover ------------------------------------------------------------------

export type Placement = 'below' | 'above' | 'right' | 'left';

/** Options open away from the edge the bar is docked on. */
export function popoverPlacement(edge: Edge): Placement {
  return edge === 'top' ? 'below' : edge === 'bottom' ? 'above' : edge === 'left' ? 'right' : 'left';
}

export type Anchor = { x: number; y: number; w: number; h: number };

/**
 * Window position of a `card`-sized popover beside `anchor`, kept on screen, plus where its arrow sits along the side
 * facing the anchor (offset of the arrow's centre from the card's left for below/above, from its top for left/right).
 */
export function popoverPosition(anchor: Anchor, placement: Placement, card: Size, win: Size, gap = 10, margin = 8): { left: number; top: number; arrow: number } {
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const clampX = (x: number) => Math.max(margin, Math.min(win.w - card.w - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(win.h - card.h - margin, y));
  const arrowAt = (c: number, start: number, len: number) => Math.max(16, Math.min(len - 16, c - start));
  if (placement === 'below' || placement === 'above') {
    const left = clampX(cx - card.w / 2);
    const top = clampY(placement === 'below' ? anchor.y + anchor.h + gap : anchor.y - gap - card.h);
    return { left, top, arrow: arrowAt(cx, left, card.w) };
  }
  const top = clampY(cy - card.h / 2);
  const left = clampX(placement === 'right' ? anchor.x + anchor.w + gap : anchor.x - gap - card.w);
  return { left, top, arrow: arrowAt(cy, top, card.h) };
}

// ---- one notice slot -----------------------------------------------------------------------

/** Highest first: a failed load, the live voice state, a denied help move, a transient notice, no key, stale marks. */
export const NOTICE_PRIORITY = ['load', 'voice', 'denied', 'notice', 'key', 'stale'] as const;
export type NoticeKind = (typeof NOTICE_PRIORITY)[number];

/** The one notice to show of those that currently apply (falsy entries are ignored). */
export function pickNotice<T extends { kind: NoticeKind }>(candidates: readonly (T | false | null | undefined)[]): T | undefined {
  let best: T | undefined;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || NOTICE_PRIORITY.indexOf(c.kind) < NOTICE_PRIORITY.indexOf(best.kind)) best = c;
  }
  return best;
}

/**
 * Keep page chrome off the toolbar: how far from the top the top-of-page items start (below a top-docked bar), and
 * which horizontal edge the repair card uses (the one the bar is not on).
 */
export function pageSlots(edge: Edge, thickness = BAR_THICKNESS, margin = EDGE_MARGIN): { top: number; card: 'top' | 'bottom' } {
  return { top: edge === 'top' ? margin + thickness + 8 : 8, card: edge === 'bottom' ? 'top' : 'bottom' };
}
