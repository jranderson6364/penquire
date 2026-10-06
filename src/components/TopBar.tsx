import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { isInk, selectTool, type ToolKind, type ToolState } from '../tools';
import { C, R, T } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { ToolPopover, type Anchor } from './ToolPopover';

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
  /** 'saved' on disk, 'dirty' waiting for the autosave, 'blocked' could not be saved */
  saveStatus: 'saved' | 'dirty' | 'blocked';
  onSaveTap: () => void;
  insetTop: number;
  insetLeft: number;
  insetRight: number;
};

const PEN_KINDS: ToolKind[] = ['pen', 'fountain', 'pencil'];
const isPenKind = (k: ToolKind) => PEN_KINDS.includes(k);

type Slot = 'pen' | 'marker' | 'eraser' | 'lasso';
const SLOT_LABEL: Record<Slot, string> = { pen: 'Pen', marker: 'Highlighter', eraser: 'Eraser', lasso: 'Lasso' };

/**
 * GoodNotes-style top bar: navigation on the left, a tool tray in the middle, actions on the right.
 * Tap a tool to select it; tap the selected tool again for its options (type, color, thickness) in a popover.
 */
export function TopBar(p: Props) {
  const { width } = useWindowDimensions();
  const narrow = width < 900;
  const atFirst = p.pageIndex === 0;
  const atLast = p.pageIndex >= p.pageCount - 1;

  const lastPen = React.useRef<ToolKind>('pen');
  if (isPenKind(p.tool.tool)) lastPen.current = p.tool.tool;
  const refs = React.useRef<Partial<Record<Slot, View | null>>>({});
  const [pop, setPop] = React.useState<{ slot: Slot; anchor: Anchor } | null>(null);

  const kindOf = (slot: Slot): ToolKind => (slot === 'pen' ? lastPen.current : slot);
  const selectedSlot = (slot: Slot) => (slot === 'pen' ? isPenKind(p.tool.tool) : p.tool.tool === slot);

  const press = (slot: Slot) => {
    if (!selectedSlot(slot)) {
      p.onToolChange(selectTool(p.tool, kindOf(slot)));
      return;
    }
    refs.current[slot]?.measureInWindow((x, y, w, h) => setPop({ slot, anchor: { x, y, w, h } }));
  };

  const iconFor = (slot: Slot): IconName => (slot === 'pen' ? (lastPen.current as 'pen') : slot === 'marker' ? 'highlighter' : slot);

  const left = (
    <View style={styles.group}>
      <Pressable onPress={p.onBack} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back to assignments">
        <Icon name="chevron-left" size={22} color={C.primary} />
      </Pressable>
      <Pressable onPress={p.onSaveTap} accessibilityLabel={`${p.title}. ${p.saveStatus === 'saved' ? 'Saved' : p.saveStatus === 'dirty' ? 'Saving' : 'Not saved. Tap to retry'}`} style={styles.titleBox}>
        <Text style={styles.title} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={[styles.save, p.saveStatus === 'blocked' && styles.saveBad]}>{p.saveStatus === 'saved' ? 'Saved' : p.saveStatus === 'dirty' ? 'Saving…' : 'Not saved · tap to retry'}</Text>
      </Pressable>
      <View style={styles.pager}>
        <Pressable onPress={p.onPrevPage} disabled={atFirst} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Previous page">
          <Icon name="chevron-left" size={16} color={atFirst ? C.lineStrong : C.sub} />
        </Pressable>
        <Text style={styles.pagerText}>
          {p.pageIndex + 1}/{p.pageCount}
        </Text>
        <Pressable onPress={p.onNextPage} disabled={atLast} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Next page">
          <Icon name="chevron-right" size={16} color={atLast ? C.lineStrong : C.sub} />
        </Pressable>
        <Pressable onPress={p.onAddPage} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Add page">
          <Icon name="plus" size={16} color={C.sub} />
        </Pressable>
      </View>
    </View>
  );

  const tray = p.modern ? (
    <View style={styles.tray}>
      {(['pen', 'marker', 'eraser', 'lasso'] as Slot[]).map((slot) => {
        const on = selectedSlot(slot);
        const colorKey = slot === 'pen' ? lastPen.current : slot;
        const ink = on && isInk(p.tool.tool);
        return (
          <Pressable
            key={slot}
            ref={(r) => {
              refs.current[slot] = r;
            }}
            onPress={() => press(slot)}
            style={[styles.tool, on && styles.toolOn]}
            accessibilityRole="button"
            accessibilityLabel={SLOT_LABEL[slot]}
            accessibilityHint={on ? 'Opens options' : 'Selects this tool'}
            accessibilityState={{ selected: on }}
          >
            <Icon name={iconFor(slot)} size={22} color={on ? C.primary : C.sub} />
            {(slot === 'pen' || slot === 'marker') && <View style={[styles.inkBar, { backgroundColor: p.tool.colors[colorKey as 'pen'] }, on && ink && styles.inkBarOn]} />}
          </Pressable>
        );
      })}
      <View style={styles.trayDivider} />
      <Pressable onPress={() => p.onToolChange({ ...p.tool, ruler: !p.tool.ruler })} style={[styles.tool, p.tool.ruler && styles.toolOn]} accessibilityRole="button" accessibilityLabel="Ruler" accessibilityState={{ selected: p.tool.ruler }}>
        <Icon name="ruler" size={22} color={p.tool.ruler ? C.primary : C.sub} />
      </Pressable>
    </View>
  ) : (
    <Text style={styles.oldBuild}>Old app build: install the latest build for zoom, rotation and the new tools</Text>
  );

  const right = (
    <View style={styles.group}>
      <Pressable onPress={p.onUndo} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Undo">
        <Icon name="undo" size={22} color={C.ink} />
      </Pressable>
      <Pressable onPress={p.onRedo} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Redo">
        <Icon name="redo" size={22} color={C.ink} />
      </Pressable>
      {p.modern && (
        <Pressable onPress={p.onFit} style={styles.zoom} accessibilityRole="button" accessibilityLabel={`Zoom ${p.zoomPercent} percent. Fit page to width`}>
          <Text style={styles.zoomText}>{p.zoomPercent}%</Text>
        </Pressable>
      )}
      <Pressable
        onPress={p.onToggleQuestion}
        style={[styles.iconBtn, p.questionOn && styles.toolOn]}
        accessibilityRole="button"
        accessibilityLabel={p.questionOn ? 'Hide the question' : 'Show the question'}
        accessibilityState={{ selected: p.questionOn }}
      >
        <Icon name="question" size={22} color={p.questionOn ? C.primary : C.sub} />
      </Pressable>
      <Button small kind="primary" title={p.checking ? 'Checking…' : 'Check'} loading={p.checking} onPress={p.onCheck} style={styles.check} />
    </View>
  );

  const pad = { paddingTop: p.insetTop + 6, paddingLeft: Math.max(10, p.insetLeft), paddingRight: Math.max(10, p.insetRight) };
  return (
    <View style={[styles.bar, pad]}>
      {narrow ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          {left}
          {tray}
          {right}
        </ScrollView>
      ) : (
        <View style={styles.row}>
          {left}
          <View style={styles.center}>{tray}</View>
          {right}
        </View>
      )}
      {pop && <ToolPopover tool={p.tool} anchor={pop.anchor} windowWidth={width} onChange={p.onToolChange} onClose={() => setPop(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.line, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48 },
  center: { flex: 1, alignItems: 'center' },
  group: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleBox: { maxWidth: 220, paddingHorizontal: 4 },
  title: { fontSize: T.body, fontWeight: '600', color: C.ink, letterSpacing: -0.2 },
  save: { fontSize: 11, color: C.faint, marginTop: 1 },
  saveBad: { color: C.incorrect, fontWeight: '700' },
  oldBuild: { fontSize: T.caption, color: C.partial, fontWeight: '700', maxWidth: 260 },
  pager: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: R.pill, paddingHorizontal: 4, height: 32 },
  pagerBtn: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
  pagerText: { fontSize: T.small, color: C.sub, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'center' },
  tray: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: R.md + 2, padding: 3, gap: 2 },
  tool: { width: 52, height: 42, borderRadius: R.md - 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  toolOn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  inkBar: { width: 18, height: 3, borderRadius: 2 },
  inkBarOn: { width: 22 },
  trayDivider: { width: 1, height: 22, backgroundColor: C.lineStrong, marginHorizontal: 3 },
  iconBtn: { width: 42, height: 42, borderRadius: R.md - 1, alignItems: 'center', justifyContent: 'center' },
  zoom: { minWidth: 56, height: 32, borderRadius: R.pill, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  zoomText: { fontSize: T.small, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] },
  check: { marginLeft: 4, minWidth: 84 },
});
