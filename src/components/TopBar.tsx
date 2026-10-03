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
import { Button } from './Button';

type Props = {
  title: string;
  pageIndex: number;
  pageCount: number;
  onBack: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onAddPage: () => void;
  /** false on an older binary: no tool spec, so the system palette is used and our tools are hidden */
  modern: boolean;
  tool: ToolState;
  onToolChange: (s: ToolState) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  zoomPercent: number;
  questionOn: boolean;
  onToggleQuestion: () => void;
  checking: boolean;
  onCheck: () => void;
  insetTop: number;
  insetLeft: number;
  insetRight: number;
};

const TOOLS: { kind: ToolKind; label: string; glyph: string }[] = [
  { kind: 'pen', label: 'Pen', glyph: '✎' },
  { kind: 'fountain', label: 'Fountain', glyph: '✒︎' },
  { kind: 'pencil', label: 'Pencil', glyph: '✏︎' },
  { kind: 'marker', label: 'Highlight', glyph: '▬' },
  { kind: 'eraser', label: 'Eraser', glyph: '⌫' },
  { kind: 'lasso', label: 'Lasso', glyph: '⬚' },
];

/** GoodNotes-style top bar: navigation on the left, drawing tools in the middle, actions on the right. */
export function TopBar(p: Props) {
  const atFirst = p.pageIndex === 0;
  const atLast = p.pageIndex >= p.pageCount - 1;
  return (
    <View style={[styles.bar, { paddingTop: p.insetTop + 4, paddingLeft: Math.max(8, p.insetLeft), paddingRight: Math.max(8, p.insetRight) }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Button small kind="ghost" title="‹ Back" onPress={p.onBack} />
          <Text style={styles.title} numberOfLines={1}>
            {p.title}
          </Text>
          <Pressable onPress={p.onPrevPage} disabled={atFirst} hitSlop={8} style={styles.page}>
            <Text style={[styles.pageArrow, atFirst && styles.dim]}>‹</Text>
          </Pressable>
          <Text style={styles.pageText}>
            {p.pageIndex + 1}/{p.pageCount}
          </Text>
          <Pressable onPress={p.onNextPage} disabled={atLast} hitSlop={8} style={styles.page}>
            <Text style={[styles.pageArrow, atLast && styles.dim]}>›</Text>
          </Pressable>
          <Pressable onPress={p.onAddPage} hitSlop={8} style={styles.page} accessibilityLabel="Add page">
            <Text style={styles.pageArrow}>＋</Text>
          </Pressable>
        </View>

        {p.modern && (
          <View style={styles.group}>
            {TOOLS.map((t) => (
              <Pressable
                key={t.kind}
                onPress={() => p.onToolChange(selectTool(p.tool, t.kind))}
                style={[styles.tool, p.tool.tool === t.kind && styles.toolOn]}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: p.tool.tool === t.kind }}
              >
                <Text style={[styles.glyph, p.tool.tool === t.kind && styles.on]}>{t.glyph}</Text>
                <Text style={[styles.toolLabel, p.tool.tool === t.kind && styles.on]}>{t.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => p.onToolChange({ ...p.tool, ruler: !p.tool.ruler })} style={[styles.tool, p.tool.ruler && styles.toolOn]} accessibilityLabel="Ruler">
              <Text style={[styles.glyph, p.tool.ruler && styles.on]}>📏</Text>
              <Text style={[styles.toolLabel, p.tool.ruler && styles.on]}>Ruler</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.group}>
          <Pressable onPress={p.onUndo} style={styles.icon} accessibilityLabel="Undo">
            <Text style={styles.iconText}>↶</Text>
          </Pressable>
          <Pressable onPress={p.onRedo} style={styles.icon} accessibilityLabel="Redo">
            <Text style={styles.iconText}>↷</Text>
          </Pressable>
          {p.modern && (
            <Pressable onPress={p.onFit} style={styles.fit} accessibilityLabel="Fit page to width">
              <Text style={styles.fitText}>{p.zoomPercent}% Fit</Text>
            </Pressable>
          )}
          <Pressable onPress={p.onToggleQuestion} style={[styles.fit, p.questionOn && styles.toolOn]} accessibilityLabel="Show or hide the current question">
            <Text style={[styles.fitText, p.questionOn && styles.on]}>Question</Text>
          </Pressable>
          <Button small kind="primary" title={p.checking ? 'Checking…' : 'Check'} loading={p.checking} onPress={p.onCheck} />
        </View>
      </ScrollView>
    </View>
  );
}

/** Thin strip under the bar with the options of the selected tool. Always the same height so the page never reflows. */
export const STRIP_HEIGHT = 48;

export function ContextStrip({ tool, onChange, insetLeft, insetRight }: { tool: ToolState; onChange: (s: ToolState) => void; insetLeft: number; insetRight: number }) {
  const ink = isInk(tool.tool);
  const palette = tool.tool === 'marker' ? HIGHLIGHT_COLORS : COLORS;
  const color = ink ? tool.colors[tool.tool as 'pen'] : undefined;
  return (
    <View style={[styles.strip, { height: STRIP_HEIGHT, paddingLeft: Math.max(12, insetLeft), paddingRight: Math.max(12, insetRight) }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow} keyboardShouldPersistTaps="handled">
        {ink && (
          <>
            {palette.map((c) => (
              <Pressable key={c} onPress={() => onChange(setColor(tool, c))} style={styles.swatchHit} accessibilityRole="button" accessibilityLabel={`Color ${c}`}>
                <View style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} />
              </Pressable>
            ))}
            <View style={styles.divider} />
            {WIDTHS[tool.tool as 'pen'].map((w, i) => {
              const on = tool.widthIdx[tool.tool as 'pen'] === i;
              const dot = Math.min(22, 6 + i * 6);
              return (
                <Pressable key={i} onPress={() => onChange(setWidth(tool, i))} style={[styles.widthHit, on && styles.toolOn]} accessibilityLabel={`Width ${i + 1}`}>
                  <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: on ? C.primary : C.faint }} />
                </Pressable>
              );
            })}
          </>
        )}
        {tool.tool === 'eraser' && (
          <>
            <Seg label="Stroke eraser" on={tool.eraserMode === 'stroke'} onPress={() => onChange({ ...tool, eraserMode: 'stroke' })} />
            <Seg label="Pixel eraser" on={tool.eraserMode === 'pixel'} onPress={() => onChange({ ...tool, eraserMode: 'pixel' })} />
            {tool.eraserMode === 'pixel' &&
              ERASER_SIZES.map((s, i) => <Seg key={s} label={['Small', 'Medium', 'Large'][i]} on={tool.eraserSizeIdx === i} onPress={() => onChange({ ...tool, eraserSizeIdx: i })} />)}
            <Text style={styles.stripHint}>{tool.eraserMode === 'stroke' ? 'Tap a stroke to remove all of it' : 'Rub out just the part you touch'}</Text>
          </>
        )}
        {tool.tool === 'lasso' && <Text style={styles.stripHint}>Circle ink to select it, then drag to move or tap to copy and delete</Text>}
      </ScrollView>
    </View>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.seg, on && styles.toolOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.segText, on && styles.on]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingBottom: 4 },
  row: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: C.ink, maxWidth: 200, marginHorizontal: 4 },
  page: { paddingHorizontal: 4 },
  pageArrow: { fontSize: 22, color: C.primary, fontWeight: '600' },
  pageText: { fontSize: 13, color: C.sub, fontVariant: ['tabular-nums'] },
  dim: { color: C.faint },
  tool: { minWidth: 54, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  toolOn: { backgroundColor: C.primarySoft },
  glyph: { fontSize: 20, color: C.ink },
  toolLabel: { fontSize: 10, color: C.sub },
  on: { color: C.primary, fontWeight: '800' },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 22, color: C.ink },
  fit: { minHeight: 36, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  fitText: { fontSize: 13, fontWeight: '700', color: C.ink },
  strip: { backgroundColor: C.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, justifyContent: 'center' },
  stripRow: { alignItems: 'center', gap: 6 },
  stripHint: { fontSize: 13, color: C.sub, marginLeft: 8 },
  divider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: C.line, marginHorizontal: 6 },
  swatchHit: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchOn: { borderWidth: 3, borderColor: C.primary },
  widthHit: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  seg: { minHeight: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  segText: { fontSize: 14, fontWeight: '700', color: C.ink },
});
