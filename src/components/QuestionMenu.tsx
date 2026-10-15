import * as React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { Problem } from '../ai/types';
import { menuModel } from '../problems/menu';
import type { ProblemGroup } from '../problems/types';
import { C, R, SHADOW, T } from '../theme';
import { latexToUnicode } from '../ui/mathText';
import { Icon } from './Icon';

type Props = {
  groups?: ProblemGroup[];
  problems: Problem[];
  /** flat label of the part being worked on, or undefined for the whole page */
  value: string | undefined;
  onChange: (label: string | undefined) => void;
  /** text on the trigger, e.g. "3b · Blocks on a ramp" */
  label: string;
};

const W = 420;

/**
 * Which question you are on. One trigger (the question's own title); tapping it opens a popover anchored right under
 * it: one row per problem with its parts as letter chips, the current one filled. One tap picks a part and closes.
 * "Whole page" (check everything equally) is the single extra choice. No search, no second level, no Done button.
 */
export function QuestionMenu({ groups, problems, value, onChange, label }: Props) {
  const rows = React.useMemo(() => menuModel(groups, problems), [groups, problems]);
  const trigger = React.useRef<View>(null);
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; h: number } | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  if (rows.length === 0) return null;

  const open = () => trigger.current?.measureInWindow((x, y, _w, h) => setAnchor({ x, y, h }));
  const close = () => setAnchor(null);
  const choose = (l: string | undefined) => {
    onChange(l);
    close();
  };
  const left = anchor ? Math.max(12, Math.min(anchor.x, winW - W - 12)) : 0;
  const top = anchor ? anchor.y + anchor.h + 8 : 0;

  return (
    <>
      <Pressable ref={trigger} onPress={open} style={({ pressed }) => [styles.trigger, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`Question: ${label}. Change question`}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="chevron-down" size={14} color={C.sub} />
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down']}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close the question menu" />
        <View style={[styles.card, { left, top, width: W, maxHeight: Math.max(240, winH - top - 24) }]}>
          <View style={styles.head}>
            <Text style={styles.headTitle}>Questions</Text>
            <Pressable onPress={() => choose(undefined)} style={[styles.whole, value === undefined && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: value === undefined }}>
              <Text style={[styles.wholeText, value === undefined && styles.chipTextOn]}>Whole page</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {rows.map((r) => {
              const single = r.items.length === 1 && r.items[0].short === r.label;
              const rowOn = r.items.some((i) => i.flat === value);
              return (
                <Pressable
                  key={r.label}
                  onPress={single ? () => choose(r.items[0].flat) : undefined}
                  disabled={!single}
                  style={[styles.row, rowOn && styles.rowOn]}
                  accessibilityRole={single ? 'button' : undefined}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>Problem {r.label}</Text>
                    {!!r.title && (
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {latexToUnicode(r.title)}
                      </Text>
                    )}
                  </View>
                  {!single && (
                    <View style={styles.chips}>
                      {r.items.map((it) => {
                        const on = it.flat === value;
                        return (
                          <Pressable key={it.flat} onPress={() => choose(it.flat)} hitSlop={4} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityLabel={`Part ${it.flat}`} accessibilityState={{ selected: on }}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{it.short}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: C.bg, maxWidth: 440 },
  triggerText: { fontSize: T.body, fontWeight: '600', color: C.ink, letterSpacing: -0.2, flexShrink: 1 },
  card: { position: 'absolute', backgroundColor: C.raised, borderRadius: R.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, overflow: 'hidden', ...SHADOW },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  headTitle: { fontSize: T.small, fontWeight: '600', color: C.faint, letterSpacing: 0.4, textTransform: 'uppercase' },
  whole: { height: 28, paddingHorizontal: 12, borderRadius: R.pill, justifyContent: 'center', backgroundColor: C.bg },
  wholeText: { fontSize: T.small, fontWeight: '600', color: C.sub },
  list: { paddingHorizontal: 8, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10, borderRadius: R.md },
  rowOn: { backgroundColor: C.bg },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: T.body, fontWeight: '600', color: C.ink, letterSpacing: -0.2 },
  rowTitle: { fontSize: T.small, color: C.sub },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 200 },
  chip: { minWidth: 32, height: 32, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: T.body, fontWeight: '600', color: C.ink },
  chipTextOn: { color: C.onPrimary },
});
