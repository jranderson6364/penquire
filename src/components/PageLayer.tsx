import * as React from 'react';
import { Animated } from 'react-native';

import { PAGE_HEIGHT, PAGE_WIDTH, type Viewport } from '../page';

/**
 * One sheet of acetate over the page. Every page overlay (question blocks, tutor marks, verdict marks) is laid out
 * inside it ONCE, in page space scaled by the settled zoom k. Panning and pinching only move this one layer through a
 * transform (Animated.setValue: no React render, no re-layout, no text re-wrap), so the overlays stay glued to each
 * other and to the ink instead of being rebuilt on every viewport event. When the gesture settles, the screen renders
 * the layer again at the new k (so text and strokes are drawn crisply at that size) and the layer's own scale snaps
 * back to 1 in the same frame.
 *
 *   screen = (tx, ty) + rel * layer,   layer = page * k,   rel = live zoom / k
 */
export type LiveViewport = { tx: Animated.Value; ty: Animated.Value; rel: Animated.Value };

export function useLiveViewport(): LiveViewport {
  return React.useRef<LiveViewport>({ tx: new Animated.Value(0), ty: new Animated.Value(0), rel: new Animated.Value(1) }).current;
}

/** Follow a live viewport event (called from the native onViewportChanged; cheap enough for every frame). */
export function followViewport(live: LiveViewport, v: Viewport, settledScale: number) {
  live.tx.setValue(v.tx);
  live.ty.setValue(v.ty);
  live.rel.setValue(settledScale > 0 ? v.scale / settledScale : 1);
}

type Props = {
  live: LiveViewport;
  /** the settled viewport: the layer is laid out at k = settled.scale */
  settled: Viewport;
  children: React.ReactNode;
};

export function PageLayer({ live, settled, children }: Props) {
  const k = settled.scale;
  // the layer was just re-laid out at the settled zoom: put its transform at rest in the same frame
  React.useLayoutEffect(() => {
    followViewport(live, settled, k);
  }, [live, settled, k]);
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: PAGE_WIDTH * k,
        height: PAGE_HEIGHT * k,
        transformOrigin: 'left top',
        transform: [{ translateX: live.tx }, { translateY: live.ty }, { scale: live.rel }],
      }}
    >
      {children}
    </Animated.View>
  );
}
