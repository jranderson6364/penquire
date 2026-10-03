import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  COLORS,
  ERASER_SIZES,
  HIGHLIGHT_COLORS,
  WIDTHS,
  isInk,
  selectTool,
  setColor,
  setWidth,
  type ToolKind,
  type ToolState,
} from '../tools';
import { C } from '../theme';

type Props = {
  state: ToolState;
  onChange: (s: ToolState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  zoomPercent: number;
};

const TOOLS: { kind: ToolKind; label: string; glyph: string }[] = [
  { kind: 'pen', label: 'Pen', glyph: '✎' },
  { kind: 'fountain', label: 'Fountain', glyph: '✒︎' },
  { kind: 'pencil', label: 'Pencil', glyph: '✏︎' },
  { kind: 'marker', label: 'Highlighter', glyph: '▬' },
  { kind: 'eraser', label: 'Eraser', glyph: '⌫' },
  { kind: 'lasso', label: 'Lasso', glyph: '⬚' },
];

/** GoodNotes-style floating tool bar. Pure JS: tools, colors and widths can change without a native build. */
export function DrawingToolbar({ state, onChange, onUndo, onRedo, onFit, zoomPercent }: Props) {
  const [collapsed, setCollapsed] = React.useState(false);
  const ink = isInk(state.tool);
  const palette = state.tool === 'marker' ? HIGHLIGHT_COLORS : COLORS;
  const color = ink ? state.colors[state.tool as 'pen'] : undefined;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => setCollapsed((c) => !c)} style={styles.collapse} accessibilityLabel={collapsed ? 'Show tools' : 'Hide tools'}>
            <Text style={styles.collapseText}>{collapsed ? '▸' : '▾'}</Text>
          </Pressable>

          {!collapsed &&
            TOOLS.map((t) => (
              <Pressable
                key={t.kind}
                onPress={() => onChange(selectTool(state, t.kind))}
                style={[styles.tool, state.tool === t.kind && styles.toolOn]}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: state.tool === t.kind }}
              >
                <Text style={[styles.glyph, state.tool === t.kind && styles.glyphOn]}>{t.glyph}</Text>
                <Text style={[styles.toolLabel, state.tool === t.kind && styles.glyphOn]}>{t.label}</Text>
              </Pressable>
            ))}

          {!collapsed && <View style={styles.divider} />}

          {!collapsed && ink && (
            <>
              {palette.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onChange(setColor(state, c))}
                  style={[styles.swatchHit]}
                  accessibilityRole="button"
                  accessibilityLabel={`Color ${c}`}
                >
                  <View style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} />
                </Pressable>
              ))}
              <View style={styles.divider} />
              {WIDTHS[state.tool as 'pen'].map((w, i) => {
                const on = state.widthIdx[state.tool as 'pen'] === i;
                const dot = Math.min(22, 6 + i * 6);
                return (
                  <Pressable key={i} onPress={() => onChange(setWidth(state, i))} style={[styles.widthHit, on && styles.toolOn]} accessibilityLabel={`Width ${i + 1}`}>
                    <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: on ? C.primary : C.faint }} />
                  </Pressable>
                );
              })}
            </>
          )}

          {!collapsed && state.tool === 'eraser' && (
            <>
              <Segment label="Stroke" on={state.eraserMode === 'stroke'} onPress={() => onChange({ ...state, eraserMode: 'stroke' })} />
              <Segment label="Pixel" on={state.eraserMode === 'pixel'} onPress={() => onChange({ ...state, eraserMode: 'pixel' })} />
              {state.eraserMode === 'pixel' &&
                ERASER_SIZES.map((s, i) => (
                  <Segment key={s} label={['S', 'M', 'L'][i]} on={state.eraserSizeIdx === i} onPress={() => onChange({ ...state, eraserSizeIdx: i })} />
                ))}
            </>
          )}

          {!collapsed && state.tool === 'lasso' && <Text style={styles.hint}>Circle ink to select, then drag to move</Text>}

          {!collapsed && <View style={styles.divider} />}
          <Segment label="Ruler" on={state.ruler} onPress={() => onChange({ ...state, ruler: !state.ruler })} />
          <Segment label="↶" on={false} onPress={onUndo} accessibilityLabel="Undo" />
          <Segment label="↷" on={false} onPress={onRedo} accessibilityLabel="Redo" />
          <Segment label={`${zoomPercent}% Fit`} on={false} onPress={onFit} accessibilityLabel="Fit page to width" />
        </ScrollView>
      </View>
    </View>
  );
}

function Segment({ label, on, onPress, accessibilityLabel }: { label: string; on: boolean; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && styles.toolOn]} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
      <Text style={[styles.segText, on && styles.glyphOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, bottom: 14, alignItems: 'center' },
  bar: {
    maxWidth: '100%',
    backgroundColor: C.card,
    borderRadius: 28,
    paddingVertical: 6,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  row: { alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  collapse: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  collapseText: { fontSize: 18, color: C.sub },
  tool: { minWidth: 56, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  toolOn: { backgroundColor: C.primarySoft },
  glyph: { fontSize: 20, color: C.ink },
  glyphOn: { color: C.primary, fontWeight: '800' },
  toolLabel: { fontSize: 10, color: C.sub },
  divider: { width: StyleSheet.hairlineWidth, height: 30, backgroundColor: C.line, marginHorizontal: 4 },
  swatchHit: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchOn: { borderWidth: 3, borderColor: C.primary },
  widthHit: { width: 40, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  seg: { minWidth: 44, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segText: { fontSize: 14, fontWeight: '700', color: C.ink },
  hint: { fontSize: 12, color: C.sub, maxWidth: 200 },
});
