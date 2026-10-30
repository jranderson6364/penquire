import * as React from 'react';
import { Animated, PanResponder, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  /** top-left in screen points of the parent (where it first opens) */
  initial: { x: number; y: number };
  /** the parent's size: the card is kept inside it */
  bounds: { w: number; h: number };
  width: number;
  /** a rough height for keeping the card on screen (it is not measured) */
  height: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * A card in SCREEN space: the same size at any zoom and still while the page scrolls under it. Drag it anywhere on the
 * card (a short move first, so taps still reach its buttons); it stays inside the parent.
 */
export function FloatingCard({ initial, bounds, width, height, style, children }: Props) {
  const clamp = React.useCallback(
    (p: { x: number; y: number }) => ({
      x: Math.max(8, Math.min(p.x, bounds.w - width - 8)),
      y: Math.max(8, Math.min(p.y, bounds.h - Math.min(height, bounds.h - 16) - 8)),
    }),
    [bounds.w, bounds.h, width, height]
  );
  const pos = React.useRef(clamp(initial));
  const xy = React.useRef(new Animated.ValueXY(pos.current)).current;
  const live = React.useRef(clamp);
  live.current = clamp;

  // the window can change (rotation, side panel): keep the card on screen
  React.useEffect(() => {
    pos.current = clamp(pos.current);
    xy.setValue(pos.current);
  }, [clamp, xy]);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
        onPanResponderMove: (_e, g) => xy.setValue(live.current({ x: pos.current.x + g.dx, y: pos.current.y + g.dy })),
        onPanResponderRelease: (_e, g) => {
          pos.current = live.current({ x: pos.current.x + g.dx, y: pos.current.y + g.dy });
          xy.setValue(pos.current);
        },
        onPanResponderTerminate: () => xy.setValue(pos.current),
      }),
    [xy]
  );

  return (
    <Animated.View {...pan.panHandlers} style={[styles.card, { width, transform: xy.getTranslateTransform() }, style]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 0, top: 0 },
});
