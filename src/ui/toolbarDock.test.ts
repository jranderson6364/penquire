import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAR_THICKNESS, DEFAULT_DOCK, EDGE_MARGIN, barLength, barSize, dockPosition, dragPosition, gripCenter, nearestEdge, normalizeDock, pageSlots, pastThreshold,
  pickNotice, popoverPlacement, popoverPosition, snapDock,
} from './toolbarDock.ts';

const NO_INSETS = { top: 0, left: 0, right: 0, bottom: 0 };
// iPad Pro 11" landscape (1194 x 834) below a ~60 pt top bar; 13" landscape; 11" portrait with the panel docked
const LAND11 = { w: 1194, h: 770 };
const LAND13 = { w: 1366, h: 960 };
const PORT11_PANEL = { w: 494, h: 1130 };
const LEN = barLength(4, 2);

test('settings fallback: a missing, malformed or partial saved dock loads safely', () => {
  assert.deepEqual(normalizeDock(undefined), DEFAULT_DOCK);
  assert.deepEqual(normalizeDock(null), DEFAULT_DOCK);
  assert.deepEqual(normalizeDock('left'), DEFAULT_DOCK);
  assert.deepEqual(normalizeDock({ edge: 'middle', t: 0.2 }), { edge: DEFAULT_DOCK.edge, t: 0.2 });
  assert.deepEqual(normalizeDock({ edge: 'left' }), { edge: 'left', t: DEFAULT_DOCK.t });
  assert.deepEqual(normalizeDock({ edge: 'right', t: 7 }), { edge: 'right', t: 1 });
  assert.deepEqual(normalizeDock({ edge: 'bottom', t: -1 }), { edge: 'bottom', t: 0 });
  assert.deepEqual(normalizeDock({ edge: 'bottom', t: Number.NaN }), { edge: 'bottom', t: DEFAULT_DOCK.t });
  assert.deepEqual(normalizeDock({ edge: 'top', t: 0.25 }), { edge: 'top', t: 0.25 });
});

test('the bar is horizontal on top/bottom and vertical on left/right', () => {
  assert.deepEqual(barSize('top', LEN), { w: LEN, h: BAR_THICKNESS });
  assert.deepEqual(barSize('bottom', LEN), { w: LEN, h: BAR_THICKNESS });
  assert.deepEqual(barSize('left', LEN), { w: BAR_THICKNESS, h: LEN });
  assert.deepEqual(barSize('right', LEN), { w: BAR_THICKNESS, h: LEN });
  // 6 buttons stay well inside the narrowest page we expect (portrait with the panel docked)
  assert.ok(LEN < PORT11_PANEL.w - 2 * EDGE_MARGIN, `bar ${LEN}`);
  assert.ok(barLength(0, 2) < LEN);
});

test('dockPosition respects the edge, the margin and safe-area insets', () => {
  const insets = { top: 0, left: 20, right: 30, bottom: 20 };
  const h = barSize('top', LEN);
  assert.deepEqual(dockPosition({ edge: 'top', t: 0 }, h, LAND11, insets), { x: 20 + EDGE_MARGIN, y: EDGE_MARGIN });
  assert.deepEqual(dockPosition({ edge: 'top', t: 1 }, h, LAND11, insets), { x: LAND11.w - 30 - EDGE_MARGIN - LEN, y: EDGE_MARGIN });
  const bottom = dockPosition({ edge: 'bottom', t: 0.5 }, h, LAND11, insets);
  assert.equal(bottom.y, LAND11.h - 20 - EDGE_MARGIN - BAR_THICKNESS);
  const v = barSize('left', LEN);
  assert.deepEqual(dockPosition({ edge: 'left', t: 0 }, v, LAND11, insets), { x: 20 + EDGE_MARGIN, y: EDGE_MARGIN });
  const right = dockPosition({ edge: 'right', t: 1 }, v, LAND11, insets);
  assert.equal(right.x, LAND11.w - 30 - EDGE_MARGIN - BAR_THICKNESS);
  assert.equal(right.y, LAND11.h - 20 - EDGE_MARGIN - LEN);
});

test('a bar wider than the page is centred instead of pushed off one side', () => {
  const tiny = { w: 200, h: 600 };
  const p = dockPosition({ edge: 'top', t: 0 }, barSize('top', LEN), tiny, NO_INSETS);
  assert.equal(p.x, (200 - LEN) / 2);
});

test('nearestEdge picks the closest edge of the page', () => {
  assert.equal(nearestEdge({ x: 600, y: 5 }, LAND11), 'top');
  assert.equal(nearestEdge({ x: 600, y: 760 }, LAND11), 'bottom');
  assert.equal(nearestEdge({ x: 5, y: 400 }, LAND11), 'left');
  assert.equal(nearestEdge({ x: 1190, y: 400 }, LAND11), 'right');
  assert.equal(nearestEdge({ x: 100, y: 300 }, LAND11), 'left');
});

test('snapDock lands on the nearest edge, centred on the finger along it', () => {
  const s = snapDock({ x: 30, y: 385 }, LEN, LAND11, NO_INSETS);
  assert.equal(s.edge, 'left');
  const pos = dockPosition(s, barSize('left', LEN), LAND11, NO_INSETS);
  assert.ok(Math.abs(pos.y + LEN / 2 - 385) < 0.5, `centred at ${pos.y + LEN / 2}`);
  const top = snapDock({ x: 700, y: 12 }, LEN, LAND13, NO_INSETS);
  assert.equal(top.edge, 'top');
  const tp = dockPosition(top, barSize('top', LEN), LAND13, NO_INSETS);
  assert.ok(Math.abs(tp.x + LEN / 2 - 700) < 0.5);
});

test('snapDock clamps near a corner and outside the page', () => {
  assert.deepEqual(snapDock({ x: 3, y: 2 }, LEN, LAND11, NO_INSETS), { edge: 'top', t: 0 });
  assert.deepEqual(snapDock({ x: 5000, y: 400 }, LEN, LAND11, NO_INSETS), { edge: 'right', t: (400 - LEN / 2 - EDGE_MARGIN) / (LAND11.h - 2 * EDGE_MARGIN - LEN) });
  const b = snapDock({ x: 1190, y: 5000 }, LEN, LAND11, NO_INSETS);
  assert.equal(b.edge, 'bottom');
  assert.equal(b.t, 1);
});

test('snap then dock never leaves the safe area, at every iPad size and edge', () => {
  const insets = { top: 0, left: 0, right: 0, bottom: 20 };
  for (const bounds of [LAND11, LAND13, PORT11_PANEL, { w: 834, h: 1130 }, { w: 1024, h: 1300 }]) {
    for (const f of [{ x: 0, y: 0 }, { x: bounds.w, y: bounds.h / 2 }, { x: bounds.w / 2, y: bounds.h }, { x: 1, y: bounds.h - 1 }, { x: bounds.w / 3, y: 4 }]) {
      const d = snapDock(f, LEN, bounds, insets);
      const size = barSize(d.edge, LEN);
      const p = dockPosition(d, size, bounds, insets);
      assert.ok(p.x >= 0 && p.y >= 0, JSON.stringify({ bounds, f, d, p }));
      assert.ok(p.x + size.w <= bounds.w && p.y + size.h <= bounds.h - insets.bottom, JSON.stringify({ bounds, f, d, p }));
    }
  }
});

test('dragging keeps the grip (the finger) inside the page', () => {
  const start = { x: 100, y: 10 };
  const g = gripCenter(start, 'top');
  const p = dragPosition(start, { x: -5000, y: -5000 }, 'top', LAND11);
  const g2 = gripCenter(p, 'top');
  assert.deepEqual({ x: g2.x, y: g2.y }, { x: 0, y: 0 });
  const q = dragPosition(start, { x: 40, y: 30 }, 'top', LAND11);
  assert.deepEqual(q, { x: 140, y: 40 });
  assert.ok(g.x > start.x && g.y > start.y);
});

test('a grip tap below the movement threshold is not a drag', () => {
  assert.equal(pastThreshold(2, 3), false);
  assert.equal(pastThreshold(0, 6), false);
  assert.equal(pastThreshold(5, 5), true);
});

test('tool options open away from the docked edge and stay on screen', () => {
  assert.equal(popoverPlacement('top'), 'below');
  assert.equal(popoverPlacement('bottom'), 'above');
  assert.equal(popoverPlacement('left'), 'right');
  assert.equal(popoverPlacement('right'), 'left');
  const win = { w: 1194, h: 834 };
  const card = { w: 300, h: 320 };
  const a = { x: 500, y: 100, w: 44, h: 44 };
  const below = popoverPosition(a, 'below', card, win);
  assert.equal(below.top, 154);
  assert.equal(below.left + below.arrow, 522); // the arrow points at the button
  const above = popoverPosition({ ...a, y: 760 }, 'above', card, win);
  assert.equal(above.top, 760 - 10 - 320);
  const right = popoverPosition({ x: 20, y: 300, w: 44, h: 44 }, 'right', card, win);
  assert.equal(right.left, 74);
  assert.equal(right.top + right.arrow, 322);
  const left = popoverPosition({ x: 1130, y: 300, w: 44, h: 44 }, 'left', card, win);
  assert.equal(left.left, 1130 - 10 - 300);
  // a button near the bottom of a vertical bar: the card is pulled up onto the screen, the arrow still near the button
  const low = popoverPosition({ x: 20, y: 780, w: 44, h: 44 }, 'right', card, win);
  assert.equal(low.top, 834 - 8 - 320);
  assert.ok(low.arrow <= 320 - 16);
  // a button at the far left of a top bar
  const corner = popoverPosition({ x: 0, y: 70, w: 44, h: 44 }, 'below', card, win);
  assert.equal(corner.left, 8);
  assert.equal(corner.arrow, 16);
});

test('one notice slot: the highest-priority notice wins', () => {
  const n = (kind: 'load' | 'voice' | 'denied' | 'notice' | 'key' | 'stale') => ({ kind });
  assert.equal(pickNotice([n('stale'), n('key'), n('notice')])?.kind, 'notice');
  assert.equal(pickNotice([false, n('denied'), undefined, n('voice')])?.kind, 'voice');
  assert.equal(pickNotice([n('stale'), n('load')])?.kind, 'load');
  assert.equal(pickNotice([n('stale')])?.kind, 'stale');
  assert.equal(pickNotice([false, null, undefined]), undefined);
});

test('page chrome moves below a top-docked bar; the repair card avoids the bar edge', () => {
  assert.equal(pageSlots('top').top, EDGE_MARGIN + BAR_THICKNESS + 8);
  assert.equal(pageSlots('left').top, 8);
  assert.equal(pageSlots('bottom').card, 'top');
  assert.equal(pageSlots('top').card, 'bottom');
  assert.equal(pageSlots('right').card, 'bottom');
});
