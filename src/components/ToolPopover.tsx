import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS, ERASER_SIZES, HIGHLIGHT_COLORS, WIDTHS, isInk, selectTool, setColor, setWidth, type ToolKind, type ToolState } from '../tools';
import { C, R, T } from '../theme';
import { Icon } from './Icon';

export type Anchor = { x: number; y: number; w: number; h: number };

type Props = {
  tool: ToolState;
  anchor: Anchor;
  windowWidth: number;
  onChange: (s: ToolState) => void;
  onClose: () => void;
};

const PEN_KINDS: { kind: ToolKind; label: string }[] = [
  { kind: 'pen', label: 'Pen' },
  { kind: 'fountain', label: 'Fountain' },
  { kind: 'pencil', label: 'Pencil' },
];

const POP_W = 300;

/** The selected tool's options, opened by tapping the tool again: pen type, color, thickness / eraser mode and size. */
export function ToolPopover({ tool, anchor, windowWidth, onChange, onClose }: Props) {
  const ink = isInk(tool.tool);
  const isPen = tool.tool === 'pen' || tool.tool === 'fountain' || tool.tool === 'pencil';
  const palette = tool.tool === 'marker' ? HIGHLIGHT_COLORS : COLORS;
  const current = ink ? tool.colors[tool.tool as 'pen'] : undefined;
  const left = Math.max(8, Math.min(windowWidth - POP_W - 8, anchor.x + anchor.w / 2 - POP_W / 2));

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down']}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close tool options" />
      <View style={[styles.card, { left, top: anchor.y + anchor.h + 6, width: POP_W }]}>
        <View style={[styles.arrow, { left: Math.max(14, Math.min(POP_W - 30, anchor.x + anchor.w / 2 - left - 8)) }]} />

        {isPen && (
          <View style={styles.seg}>
            {PEN_KINDS.map((k) => {
              const on = tool.tool === k.kind;
              return (
                <Pressable key={k.kind} onPress={() => onChange(selectTool(tool, k.kind))} style={[styles.segItem, on && styles.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Icon name={k.kind as 'pen'} size={18} color={on ? C.primary : C.sub} />
                  <Text style={[styles.segText, on && { color: C.primary }]}>{k.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {ink && (
          <>
            <View style={styles.swatches}>
              {palette.map((c) => {
                const on = current === c;
                return (
                  <Pressable key={c} onPress={() => onChange(setColor(tool, c))} accessibilityRole="button" accessibilityLabel={`Color ${c}`} accessibilityState={{ selected: on }} style={styles.swatchHit}>
                    <View style={[styles.swatch, { backgroundColor: c }, on && styles.swatchOn]}>
                      {on && <Icon name="check" size={16} color={tool.tool === 'marker' ? C.ink : '#fff'} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.widths}>
              {WIDTHS[tool.tool as 'pen'].map((w, i) => {
                const on = tool.widthIdx[tool.tool as 'pen'] === i;
                const h = Math.min(20, Math.max(2, tool.tool === 'marker' ? w / 2 : w * 1.6));
                return (
                  <Pressable key={i} onPress={() => onChange(setWidth(tool, i))} accessibilityRole="button" accessibilityLabel={`Thickness ${i + 1}`} accessibilityState={{ selected: on }} style={[styles.widthItem, on && styles.segOn]}>
                    <View style={{ width: 52, height: h, borderRadius: h / 2, backgroundColor: current ?? C.ink, opacity: tool.tool === 'marker' ? 0.7 : 1 }} />
                  </Pressable>
                );
              })}
            </View>
            {/* the ruler only matters while inking, so it lives with the ink options, not in the toolbar */}
            <Pressable onPress={() => onChange({ ...tool, ruler: !tool.ruler })} style={[styles.rulerRow, tool.ruler && styles.segOn]} accessibilityRole="switch" accessibilityLabel="Ruler" accessibilityState={{ checked: tool.ruler }}>
              <Icon name="ruler" size={18} color={tool.ruler ? C.primary : C.sub} />
              <Text style={[styles.segText, tool.ruler && { color: C.primary }]}>{tool.ruler ? 'Ruler on' : 'Ruler'}</Text>
            </Pressable>
          </>
        )}

        {tool.tool === 'eraser' && (
          <>
            <View style={styles.seg}>
              {(['stroke', 'pixel'] as const).map((m) => {
                const on = tool.eraserMode === m;
                return (
                  <Pressable key={m} onPress={() => onChange({ ...tool, eraserMode: m })} style={[styles.segItem, on && styles.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[styles.segText, on && { color: C.primary }]}>{m === 'stroke' ? 'Whole stroke' : 'Part of a stroke'}</Text>
                  </Pressable>
                );
              })}
            </View>
            {tool.eraserMode === 'pixel' && (
              <View style={styles.widths}>
                {ERASER_SIZES.map((s, i) => {
                  const on = tool.eraserSizeIdx === i;
                  const d = 10 + i * 8;
                  return (
                    <Pressable key={s} onPress={() => onChange({ ...tool, eraserSizeIdx: i })} accessibilityRole="button" accessibilityLabel={['Small', 'Medium', 'Large'][i]} accessibilityState={{ selected: on }} style={[styles.widthItem, on && styles.segOn]}>
                      <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 1.5, borderColor: on ? C.primary : C.faint }} />
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text style={styles.hint}>{tool.eraserMode === 'stroke' ? 'Tap a stroke to remove all of it.' : 'Rub out just the part you touch.'}</Text>
          </>
        )}

        {tool.tool === 'lasso' && <Text style={styles.hint}>Circle ink to select it, then drag to move it or tap for copy and delete.</Text>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: '#0F1419',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  arrow: { position: 'absolute', top: -7, width: 14, height: 14, backgroundColor: C.card, borderLeftWidth: 1, borderTopWidth: 1, borderColor: C.line, transform: [{ rotate: '45deg' }] },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: R.md, padding: 3, gap: 2 },
  segItem: { flex: 1, minHeight: 36, borderRadius: R.sm + 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 6 },
  segOn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  segText: { fontSize: T.small, fontWeight: '600', color: C.sub },
  rulerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 10, borderRadius: R.sm, backgroundColor: C.bg },
  swatches: { flexDirection: 'row', flexWrap: 'wrap' },
  swatchHit: { width: 68, height: 40, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(15,20,25,0.15)' },
  swatchOn: { borderWidth: 2, borderColor: C.ink },
  widths: { flexDirection: 'row', gap: 6 },
  widthItem: { flex: 1, minHeight: 44, borderRadius: R.sm + 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  hint: { fontSize: T.small, color: C.sub, lineHeight: 18 },
});
