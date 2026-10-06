import * as React from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { BLOCK_FONT, type PageBlock } from '../blocks';
import { boxToScreen, type Viewport } from '../page';
import { C } from '../theme';
import { Icon } from './Icon';
import { MathText } from './MathText';

type Props = {
  blocks: PageBlock[];
  viewport: Viewport;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
};

/**
 * Question blocks typeset on the page. They are drawn above the ink but let every touch through (so the Pencil
 * writes right over them); only the small handle in each block's corner takes touches, to drag or remove it.
 */
export function BlocksLayer({ blocks, viewport, onMove, onRemove }: Props) {
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {blocks.map((b) => (
        <Block key={b.id} block={b} viewport={viewport} onMove={onMove} onRemove={onRemove} />
      ))}
    </View>
  );
}

function Block({ block, viewport, onMove, onRemove }: { block: PageBlock; viewport: Viewport } & Pick<Props, 'onMove' | 'onRemove'>) {
  const s = viewport.scale;
  const [drag, setDrag] = React.useState({ dx: 0, dy: 0 });
  const live = React.useRef({ block, s });
  live.current = { block, s };

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_e, g) => setDrag({ dx: g.dx, dy: g.dy }),
        onPanResponderRelease: (_e, g) => {
          const { block: b, s: sc } = live.current;
          setDrag({ dx: 0, dy: 0 });
          onMove(b.id, b.x + g.dx / sc, b.y + g.dy / sc);
        },
        onPanResponderTerminate: () => setDrag({ dx: 0, dy: 0 }),
      }),
    [onMove]
  );

  const box = boxToScreen({ x: block.x, y: block.y, w: block.w, h: block.h ?? 80 }, viewport);
  const font = BLOCK_FONT * s;
  return (
    <View pointerEvents="box-none" style={[styles.block, { left: box.x + drag.dx, top: box.y + drag.dy, width: box.w, paddingHorizontal: 12 * s, paddingVertical: 8 * s, borderRadius: 8 * s }]}>
      <View pointerEvents="none">
        <Text style={[styles.heading, { fontSize: font * 0.85 }]}>{block.heading}</Text>
        {block.lines.map((l, i) => (
          <MathText key={i} text={l} style={{ fontSize: font, lineHeight: font * 1.45, marginTop: i === 0 ? 2 * s : 4 * s }} />
        ))}
      </View>
      <View style={[styles.handle, { top: 4, right: 4 }]}>
        <View {...pan.panHandlers} style={styles.handleBtn} accessibilityLabel="Move this block" accessibilityRole="adjustable">
          <Text style={styles.grip}>⠿</Text>
        </View>
        <Pressable onPress={() => onRemove(block.id)} hitSlop={6} style={styles.handleBtn} accessibilityRole="button" accessibilityLabel="Remove this block from the page">
          <Icon name="close" size={14} color={C.sub} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { position: 'absolute', backgroundColor: 'rgba(243,244,247,0.55)', borderLeftWidth: 3, borderLeftColor: C.primary },
  heading: { fontWeight: '700', color: C.primary, letterSpacing: -0.1 },
  handle: { position: 'absolute', flexDirection: 'row', gap: 2, opacity: 0.85 },
  handleBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.9)' },
  grip: { fontSize: 16, color: C.sub, marginTop: -2 },
});
