import * as React from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PageBlock } from '../blocks';
import { boxToLayer } from '../page';
import { PAGE_TYPE, PAPER } from '../theme';
import { Icon } from './Icon';
import { MathText } from './MathText';

type Props = {
  blocks: PageBlock[];
  /** settled zoom: the blocks are laid out in layer units (page * k) inside PageLayer */
  k: number;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  /** ✓: stamp the block where it is (no handles, every touch to the Pencil) */
  onStamp: (id: string) => void;
};

/**
 * Question blocks typeset on the page, above the ink. While a block is being placed it shows three handles (drag ⠿,
 * stamp ✓, remove ✕); everything else lets touches through so the Pencil writes right over it. Once stamped it has no
 * handles at all, takes no touches, and is cached as a still image (it never re-renders while you write).
 * Text sizes are page units (PAGE_TYPE), so a block reads at the same size as the rest of the page at any zoom.
 */
export function BlocksLayer({ blocks, k, onMove, onRemove, onStamp }: Props) {
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {blocks.map((b) => (
        <Block key={b.id} block={b} k={k} onMove={onMove} onRemove={onRemove} onStamp={onStamp} />
      ))}
    </View>
  );
}

function Block({ block, k, onMove, onRemove, onStamp }: { block: PageBlock; k: number } & Pick<Props, 'onMove' | 'onRemove' | 'onStamp'>) {
  // the layer is at rest while a block is dragged, so a screen point is a layer unit and a page point is 1/k of one
  const drag = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const live = React.useRef({ block, k });
  live.current = { block, k };

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_e, g) => drag.setValue({ x: g.dx, y: g.dy }), // moves the block without re-rendering it
        onPanResponderRelease: (_e, g) => {
          const { block: b, k: sc } = live.current;
          drag.setValue({ x: 0, y: 0 });
          onMove(b.id, b.x + g.dx / sc, b.y + g.dy / sc);
        },
        onPanResponderTerminate: () => drag.setValue({ x: 0, y: 0 }),
      }),
    [onMove, drag]
  );

  const box = boxToLayer({ x: block.x, y: block.y, w: block.w, h: block.h ?? 80 }, k);
  const body = PAGE_TYPE.body * k;
  const locked = !!block.locked;
  return (
    <Animated.View
      pointerEvents={locked ? 'none' : 'box-none'}
      shouldRasterizeIOS={locked}
      style={[
        styles.block,
        locked && styles.stamped,
        { left: box.x, top: box.y, width: box.w, paddingHorizontal: 12 * k, paddingVertical: 8 * k, borderRadius: 8 * k, transform: drag.getTranslateTransform() },
      ]}
    >
      <View pointerEvents="none">
        <Text style={[styles.heading, { fontSize: PAGE_TYPE.label * k, lineHeight: PAGE_TYPE.label * k * 1.3 }]}>{block.heading}</Text>
        {block.lines.map((l, i) => (
          <MathText key={i} onPaper text={l} style={{ fontSize: body, lineHeight: body * PAGE_TYPE.leading, marginTop: (i === 0 ? 2 : 4) * k }} />
        ))}
      </View>
      {!locked && (
        <View style={styles.handle}>
          <View {...pan.panHandlers} style={styles.handleBtn} accessibilityLabel="Move this question" accessibilityRole="adjustable">
            <Text style={styles.grip}>⠿</Text>
          </View>
          <Pressable onPress={() => onStamp(block.id)} hitSlop={6} style={[styles.handleBtn, styles.stampBtn]} accessibilityRole="button" accessibilityLabel="Stamp the question here">
            <Icon name="check" size={15} color="#FFFFFF" weight="semibold" />
          </Pressable>
          <Pressable onPress={() => onRemove(block.id)} hitSlop={6} style={styles.handleBtn} accessibilityRole="button" accessibilityLabel="Remove this question from the page">
            <Icon name="close" size={14} color={PAPER.sub} />
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { position: 'absolute', backgroundColor: PAPER.wash, borderLeftWidth: 3, borderLeftColor: PAPER.primary },
  // stamped: printed on the page, quieter than a block still being placed
  stamped: { backgroundColor: 'transparent' },
  heading: { fontWeight: '700', color: PAPER.primary, letterSpacing: -0.1 },
  handle: { position: 'absolute', top: 4, right: 4, flexDirection: 'row', gap: 4 },
  handleBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER.handle, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.08)' },
  stampBtn: { backgroundColor: PAPER.primary, borderColor: PAPER.primary },
  grip: { fontSize: 16, color: PAPER.sub, marginTop: -2 },
});
