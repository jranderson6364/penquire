import * as React from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { getSettings, saveSettings } from '../store/db';
import { isInk, selectTool, type ToolKind, type ToolState } from '../tools';
import { C, SHADOW } from '../theme';
import {
  BAR, BAR_THICKNESS, EDGES, barLength, barSize, dockPosition, dragPosition, gripCenter, isVertical, normalizeDock, pastThreshold, popoverPlacement, snapDock,
  type Dock, type Edge, type Insets, type Point, type Size,
} from '../ui/toolbarDock';
import { Icon, type IconName } from './Icon';
import { ToolPopover, type Anchor } from './ToolPopover';

export type ToolSlot = 'pen' | 'marker' | 'eraser' | 'lasso';
const SLOT_LABEL: Record<ToolSlot, string> = { pen: 'Pen', marker: 'Highlighter', eraser: 'Eraser', lasso: 'Lasso' };
const ALL_SLOTS: ToolSlot[] = ['pen', 'marker', 'eraser', 'lasso'];
const PEN_KINDS: ToolKind[] = ['pen', 'fountain', 'pencil'];
const isPenKind = (k: ToolKind) => PEN_KINDS.includes(k);

/** The saved dock (Settings.toolbarDock, validated) and a setter that saves it. Call before any early return. */
export function useToolbarDock(): [Dock, (d: Dock) => void] {
  const [dock, setDock] = React.useState<Dock>(() => normalizeDock(getSettings().toolbarDock));
  const set = React.useCallback((d: Dock) => {
    setDock(d);
    saveSettings({ toolbarDock: d });
  }, []);
  return [dock, set];
}

type Props = {
  tool: ToolState;
  onToolChange: (s: ToolState) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** false on an older binary: the system tool picker is used, so only undo/redo are shown */
  modern: boolean;
  dock: Dock;
  onDock: (d: Dock) => void;
  /** the page container the bar floats in (it is a sibling of the canvas, never inside the zoomed overlay) */
  bounds: Size;
  /** safe-area insets that reach this container's edges */
  insets: Insets;
  /** which tools to show (default all four) */
  slots?: ToolSlot[];
  /** offer the ruler in the pen options (only where the screen sends it to the canvas) */
  allowRuler?: boolean;
};

/**
 * GoodNotes-style floating tool pill: drag it by its grip and it snaps to the nearest edge of the page (vertical on
 * the left and right). Tap a tool to select it; tap the selected tool again for its options.
 */
export function FloatingToolbar(p: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const slots = p.modern ? (p.slots ?? ALL_SLOTS) : [];
  const allowRuler = p.allowRuler !== false;
  const ruler = p.modern && allowRuler && p.tool.ruler;
  // +1: the hairline border sits inside the box
  const length = barLength(slots.length + (ruler ? 1 : 0), 2) + 1;
  const edge = p.dock.edge;
  const vertical = isVertical(edge);
  const size = barSize(edge, length);
  const target = dockPosition(p.dock, size, p.bounds, p.insets);

  // ---- position: animated to the docked spot; follows the finger while dragging -----------------------
  const xy = React.useRef(new Animated.ValueXY(target)).current;
  const dragging = React.useRef(false);
  const gliding = React.useRef(false);
  const live = React.useRef({ edge, bounds: p.bounds, insets: p.insets, length, target, onDock: p.onDock });
  live.current = { edge, bounds: p.bounds, insets: p.insets, length, target, onDock: p.onDock };
  /** spring to a dock; when it settles, land exactly on the current target (the page may have resized meanwhile) */
  const glide = React.useCallback(
    (to: Point) => {
      gliding.current = true;
      Animated.spring(xy, { toValue: to, useNativeDriver: false, friction: 8, tension: 70 }).start(({ finished }) => {
        gliding.current = false;
        if (finished && !dragging.current) xy.setValue(live.current.target);
      });
    },
    [xy]
  );
  // rotation, the side panel or the ruler button changed the target: follow it (no animation)
  React.useEffect(() => {
    if (dragging.current || gliding.current) return;
    xy.setValue(target);
  }, [target.x, target.y, xy]);

  const pan = React.useMemo(() => {
    let start: Point = { x: 0, y: 0 };
    let moved = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        moved = false;
        dragging.current = true;
        xy.stopAnimation((v) => {
          start = { x: v.x, y: v.y };
        });
      },
      onPanResponderMove: (_e, g) => {
        if (!moved && !pastThreshold(g.dx, g.dy)) return;
        moved = true;
        xy.setValue(dragPosition(start, { x: g.dx, y: g.dy }, live.current.edge, live.current.bounds));
      },
      onPanResponderRelease: (_e, g) => {
        const L = live.current;
        dragging.current = false;
        if (!moved) return glide(L.target); // a tap on the grip: stay put
        const finger = gripCenter(dragPosition(start, { x: g.dx, y: g.dy }, L.edge, L.bounds), L.edge);
        const next = snapDock(finger, L.length, L.bounds, L.insets);
        // the bar may change orientation: put the new layout's grip under the finger, then spring to the dock
        const g0 = gripCenter({ x: 0, y: 0 }, next.edge);
        xy.setValue({ x: finger.x - g0.x, y: finger.y - g0.y });
        glide(dockPosition(next, barSize(next.edge, L.length), L.bounds, L.insets));
        L.onDock(next);
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        glide(live.current.target);
      },
    });
  }, [xy, glide]);

  // ---- tools (same behavior as the old top-bar tray) ---------------------------------------------------
  const lastPen = React.useRef<ToolKind>('pen');
  if (isPenKind(p.tool.tool)) lastPen.current = p.tool.tool;
  const refs = React.useRef<Partial<Record<ToolSlot, View | null>>>({});
  const [pop, setPop] = React.useState<{ anchor: Anchor } | null>(null);
  const kindOf = (slot: ToolSlot): ToolKind => (slot === 'pen' ? lastPen.current : slot);
  const selected = (slot: ToolSlot) => (slot === 'pen' ? isPenKind(p.tool.tool) : p.tool.tool === slot);
  const press = (slot: ToolSlot) => {
    if (!selected(slot)) {
      p.onToolChange(selectTool(p.tool, kindOf(slot)));
      return;
    }
    refs.current[slot]?.measureInWindow((x, y, w, h) => setPop({ anchor: { x, y, w, h } }));
  };
  const iconFor = (slot: ToolSlot): IconName => (slot === 'pen' ? (lastPen.current as 'pen') : slot === 'marker' ? 'highlighter' : slot);

  const moveTo = (e: Edge) => {
    if (!EDGES.includes(e)) return;
    const next = { edge: e, t: 0.5 };
    glide(dockPosition(next, barSize(e, length), p.bounds, p.insets));
    p.onDock(next);
  };

  return (
    <Animated.View
      style={[styles.bar, { width: size.w, height: size.h, flexDirection: vertical ? 'column' : 'row', transform: xy.getTranslateTransform() }]}
      accessibilityRole="toolbar"
      accessibilityLabel="Tools"
    >
      <View
        {...pan.panHandlers}
        style={[styles.grip, vertical ? { width: BAR.slot, height: BAR.grip } : { width: BAR.grip, height: BAR.slot }]}
        accessible
        accessibilityLabel="Move the toolbar"
        accessibilityHint="Drag to the top, bottom, left or right edge of the page"
        accessibilityActions={[
          { name: 'top', label: 'Move to the top' },
          { name: 'bottom', label: 'Move to the bottom' },
          { name: 'left', label: 'Move to the left' },
          { name: 'right', label: 'Move to the right' },
        ]}
        onAccessibilityAction={(e) => moveTo(e.nativeEvent.actionName as Edge)}
      >
        <View style={[styles.dots, vertical ? { flexDirection: 'row', width: 22 } : { flexDirection: 'column', height: 22 }]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dotPair, { flexDirection: vertical ? 'column' : 'row' }]}>
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
          ))}
        </View>
      </View>

      {slots.map((slot) => {
        const on = selected(slot);
        const colorKey = slot === 'pen' ? lastPen.current : slot;
        return (
          <Pressable
            key={slot}
            ref={(r) => {
              refs.current[slot] = r;
            }}
            onPress={() => press(slot)}
            style={[styles.slot, on && styles.slotOn]}
            accessibilityRole="button"
            accessibilityLabel={SLOT_LABEL[slot]}
            accessibilityHint={on ? 'Opens options' : 'Selects this tool'}
            accessibilityState={{ selected: on }}
          >
            <Icon name={iconFor(slot)} size={22} color={on ? C.primary : C.sub} />
            {(slot === 'pen' || slot === 'marker') && <View style={[styles.inkBar, { backgroundColor: p.tool.colors[colorKey as 'pen'] }, on && isInk(p.tool.tool) && styles.inkBarOn]} />}
          </Pressable>
        );
      })}
      {/* the ruler toggle lives in the pen/highlighter options; this button shows it is on and hides it */}
      {ruler && (
        <Pressable onPress={() => p.onToolChange({ ...p.tool, ruler: false })} style={[styles.slot, styles.slotOn]} accessibilityRole="button" accessibilityLabel="Ruler is on. Tap to hide it.">
          <Icon name="ruler" size={22} color={C.primary} />
        </Pressable>
      )}
      {slots.length > 0 && <View style={vertical ? styles.dividerH : styles.dividerV} />}
      <Pressable onPress={p.onUndo} style={styles.slot} accessibilityRole="button" accessibilityLabel="Undo">
        <Icon name="undo" size={21} color={C.ink} />
      </Pressable>
      <Pressable onPress={p.onRedo} style={styles.slot} accessibilityRole="button" accessibilityLabel="Redo">
        <Icon name="redo" size={21} color={C.ink} />
      </Pressable>

      {pop && (
        <ToolPopover
          tool={p.tool}
          anchor={pop.anchor}
          windowWidth={winW}
          windowHeight={winH}
          placement={popoverPlacement(edge)}
          showRuler={allowRuler}
          onChange={p.onToolChange}
          onClose={() => setPop(null)}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 30,
    alignItems: 'center',
    padding: BAR.pad,
    gap: BAR.gap,
    borderRadius: BAR_THICKNESS / 2,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    ...SHADOW,
  },
  grip: { alignItems: 'center', justifyContent: 'center' },
  dots: { justifyContent: 'space-between', alignItems: 'center' },
  dotPair: { gap: 4 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.faint },
  slot: { width: BAR.slot, height: BAR.slot, borderRadius: BAR.slot / 2, alignItems: 'center', justifyContent: 'center', gap: 3 },
  slotOn: { backgroundColor: C.primarySoft },
  inkBar: { width: 16, height: 3, borderRadius: 2 },
  inkBarOn: { width: 20 },
  dividerV: { width: 1, height: 24, marginHorizontal: (BAR.divider - 1) / 2, backgroundColor: C.line },
  dividerH: { height: 1, width: 24, marginVertical: (BAR.divider - 1) / 2, backgroundColor: C.line },
});
