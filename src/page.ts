/**
 * Page space vs screen space.
 *
 * Everything we store (stroke boxes, line boxes, check results, exported images) is in PAGE space: a fixed
 * logical sheet of PAGE_WIDTH x PAGE_HEIGHT points that never changes with zoom, rotation or Split View.
 * The native canvas reports a viewport; screen = page * scale + (tx, ty). Pure and tested.
 */

/** US Letter at 96 dpi. Must match what the canvas is given as pageWidth/pageHeight. */
export const PAGE_WIDTH = 816;
export const PAGE_HEIGHT = 1056;

export type Box = { x: number; y: number; w: number; h: number };

export type Viewport = {
  scale: number;
  tx: number;
  ty: number;
  viewWidth: number;
  viewHeight: number;
  /** a pinch, drag or fling is in progress: overlays should hide rather than lag behind the ink */
  interacting: boolean;
};

/** What an old binary (no zoom) is equivalent to: the page fills the view 1:1. */
export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0, viewWidth: PAGE_WIDTH, viewHeight: PAGE_HEIGHT, interacting: false };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Native payloads are untrusted at the edges: anything malformed falls back to the previous viewport. */
export function parseViewport(raw: unknown, fallback: Viewport = IDENTITY_VIEWPORT): Viewport {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  if (!finite(r.scale) || r.scale <= 0 || !finite(r.tx) || !finite(r.ty)) return fallback;
  return {
    scale: r.scale,
    tx: r.tx,
    ty: r.ty,
    viewWidth: finite(r.viewWidth) && r.viewWidth > 0 ? r.viewWidth : fallback.viewWidth,
    viewHeight: finite(r.viewHeight) && r.viewHeight > 0 ? r.viewHeight : fallback.viewHeight,
    interacting: r.interacting === true,
  };
}

export const pageToScreenX = (x: number, v: Viewport) => x * v.scale + v.tx;
export const pageToScreenY = (y: number, v: Viewport) => y * v.scale + v.ty;
export const screenToPageX = (x: number, v: Viewport) => (x - v.tx) / v.scale;
export const screenToPageY = (y: number, v: Viewport) => (y - v.ty) / v.scale;

export function boxToScreen(b: Box, v: Viewport): Box {
  return { x: pageToScreenX(b.x, v), y: pageToScreenY(b.y, v), w: b.w * v.scale, h: b.h * v.scale };
}

/** Does any part of a screen-space box overlap the visible view? */
export function intersectsView(b: Box, v: Viewport): boolean {
  return b.x < v.viewWidth && b.x + b.w > 0 && b.y < v.viewHeight && b.y + b.h > 0;
}

/** Same viewport, close enough that re-rendering overlays would change nothing visible. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return (
    Math.abs(a.scale - b.scale) < 1e-4 &&
    Math.abs(a.tx - b.tx) < 0.25 &&
    Math.abs(a.ty - b.ty) < 0.25 &&
    a.viewWidth === b.viewWidth &&
    a.viewHeight === b.viewHeight &&
    a.interacting === b.interacting
  );
}

/** Marks were stored in page space (v2) or, for older checks, in the old full-view canvas space. */
export type CoordSpace = 'page-v2';
