import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_VIEWPORT, boxToScreen, intersectsView, pageToScreenX, parseViewport, sameViewport, screenToPageX, screenToPageY, pageToScreenY, type Viewport } from './page.ts';
import { DEFAULT_TOOL_STATE, normalizeToolState, selectTool, setColor, setWidth, toNativeSpec, toggleEraser, WIDTHS } from './tools.ts';

const v = (over: Partial<Viewport> = {}): Viewport => ({ scale: 2, tx: -100, ty: 40, viewWidth: 800, viewHeight: 600, interacting: false, ...over });

test('page <-> screen round trip, and the identity viewport changes nothing', () => {
  for (const vp of [v(), v({ scale: 0.5, tx: 30, ty: -7 }), IDENTITY_VIEWPORT]) {
    assert.ok(Math.abs(screenToPageX(pageToScreenX(123.4, vp), vp) - 123.4) < 1e-9);
    assert.ok(Math.abs(screenToPageY(pageToScreenY(-8.2, vp), vp) + 8.2) < 1e-9);
  }
  assert.deepEqual(boxToScreen({ x: 10, y: 20, w: 30, h: 40 }, IDENTITY_VIEWPORT), { x: 10, y: 20, w: 30, h: 40 });
});

test('boxes scale and translate; visibility is decided in screen space', () => {
  const b = boxToScreen({ x: 100, y: 100, w: 50, h: 10 }, v());
  assert.deepEqual(b, { x: 100, y: 240, w: 100, h: 20 });
  assert.equal(intersectsView(b, v()), true);
  assert.equal(intersectsView({ x: 900, y: 10, w: 20, h: 20 }, v()), false); // off to the right
  assert.equal(intersectsView({ x: -50, y: 10, w: 20, h: 20 }, v()), false); // off to the left
  assert.equal(intersectsView({ x: -10, y: 10, w: 20, h: 20 }, v()), true); // straddling the edge
});

test('malformed native payloads fall back instead of poisoning the overlay', () => {
  const prev = v();
  for (const bad of [null, undefined, 5, 'x', {}, { scale: 0, tx: 0, ty: 0 }, { scale: NaN, tx: 0, ty: 0 }, { scale: 1, tx: 'a', ty: 0 }]) {
    assert.equal(parseViewport(bad, prev), prev);
  }
  const ok = parseViewport({ scale: 1.5, tx: -3, ty: 4, viewWidth: 700, viewHeight: 500, interacting: true });
  assert.deepEqual(ok, { scale: 1.5, tx: -3, ty: 4, viewWidth: 700, viewHeight: 500, interacting: true });
});

test('viewport equality ignores sub-pixel jitter but not real moves', () => {
  assert.equal(sameViewport(v(), v({ tx: -100.1 })), true);
  assert.equal(sameViewport(v(), v({ tx: -99 })), false);
  assert.equal(sameViewport(v(), v({ interacting: true })), false);
});

test('tool spec: pen, marker, eraser modes, lasso', () => {
  const s = DEFAULT_TOOL_STATE;
  assert.deepEqual(toNativeSpec(s), { kind: 'ink', ink: 'pen', color: '#111111', width: WIDTHS.pen[1] });
  assert.deepEqual(toNativeSpec(selectTool(s, 'marker')), { kind: 'ink', ink: 'marker', color: '#FDE047', width: WIDTHS.marker[1] });
  assert.deepEqual(toNativeSpec(selectTool(s, 'eraser')), { kind: 'eraser', eraser: 'vector' });
  assert.deepEqual(toNativeSpec({ ...selectTool(s, 'eraser'), eraserMode: 'pixel', eraserSizeIdx: 2 }), { kind: 'eraser', eraser: 'fixed', eraserWidth: 36 });
  assert.deepEqual(toNativeSpec(selectTool(s, 'lasso')), { kind: 'lasso' });
});

test('each ink remembers its own color and width', () => {
  let s = setColor(DEFAULT_TOOL_STATE, '#DC2626');
  s = setWidth(s, 2);
  s = selectTool(s, 'marker');
  s = setColor(s, '#86EFAC');
  s = selectTool(s, 'pen');
  assert.deepEqual(toNativeSpec(s), { kind: 'ink', ink: 'pen', color: '#DC2626', width: WIDTHS.pen[2] });
  // colors and widths only change for inks
  const eraser = selectTool(s, 'eraser');
  assert.equal(setColor(eraser, '#000000'), eraser);
  assert.equal(setWidth(eraser, 0), eraser);
});

test('pencil double-tap toggles the eraser and restores the previous tool', () => {
  const a = toggleEraser(selectTool(DEFAULT_TOOL_STATE, 'marker'), 'pen');
  assert.equal(a.state.tool, 'eraser');
  assert.equal(a.previous, 'marker');
  const b = toggleEraser(a.state, a.previous);
  assert.equal(b.state.tool, 'marker');
  assert.equal(toggleEraser(selectTool(DEFAULT_TOOL_STATE, 'eraser'), 'eraser').state.tool, 'pen'); // never gets stuck
});

test('a persisted tool state from another app version is tolerated', () => {
  assert.deepEqual(normalizeToolState(null), DEFAULT_TOOL_STATE);
  const s = normalizeToolState({ tool: 'bogus', widthIdx: { pen: 99 }, eraserSizeIdx: -4, colors: { pen: '#123456' } });
  assert.equal(s.tool, 'pen');
  assert.equal(s.colors.pen, '#123456');
  assert.equal(s.colors.marker, DEFAULT_TOOL_STATE.colors.marker);
  assert.equal(toNativeSpec(s).kind, 'ink');
  assert.equal(s.eraserSizeIdx, 0);
});
