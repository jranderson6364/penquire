import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { findPart } from '../problems/flatten';
import type { Assignment } from '../store/types';
import { C } from '../theme';
import { MathText } from './MathText';
import { PartPicker } from './PartPicker';

type Props = {
  assignment: Assignment;
  /** flat label of the part being worked on ("6b"), or undefined */
  activePart?: string;
  onChange: (label: string | undefined) => void;
  /** left/right inset (safe area) */
  insetLeft: number;
  insetRight: number;
};

/** Fixed heights on purpose: this sits in the layout above the canvas, and resizing it would make the page reflow. */
export const BANNER_COLLAPSED = 92;
export const BANNER_EXPANDED = 300;

/** The question being worked on, always visible under the controls. */
export function QuestionBanner({ assignment, activePart, onChange, insetLeft, insetRight }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const { groups, problems } = assignment;
  const labels = problems.map((p) => p.label);
  const idx = activePart ? labels.indexOf(activePart) : -1;
  const go = (d: number) => {
    if (labels.length === 0) return;
    const next = idx < 0 ? (d > 0 ? 0 : labels.length - 1) : Math.min(labels.length - 1, Math.max(0, idx + d));
    onChange(labels[next]);
  };

  const found = activePart && groups ? findPart(groups, activePart) : undefined;
  const flat = activePart ? problems.find((p) => p.label === activePart) : undefined;
  const choices = problems.map((p) => {
    const f = groups ? findPart(groups, p.label) : undefined;
    return { label: p.label, text: f?.part ? f.part.text || f.group.context : f?.group.context ?? p.text };
  });

  const title = found
    ? `Problem ${found.group.label}${found.part ? ` · (${found.part.label})` : ''}${found.group.title ? ` · ${found.group.title}` : ''}`
    : flat
      ? flat.label
      : 'No question selected';

  return (
    <View style={[styles.wrap, { height: expanded ? BANNER_EXPANDED : BANNER_COLLAPSED, paddingLeft: Math.max(12, insetLeft), paddingRight: Math.max(12, insetRight) }]}>
      <View style={styles.row}>
        <Pressable onPress={() => go(-1)} hitSlop={8} style={styles.nav} accessibilityLabel="Previous question">
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable onPress={() => go(1)} hitSlop={8} style={styles.nav} accessibilityLabel="Next question">
          <Text style={styles.navText}>›</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <PartPicker parts={choices} value={activePart} onChange={onChange} />
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.expand} accessibilityLabel={expanded ? 'Collapse' : 'Show the full setup'}>
          <Text style={styles.expandText}>{expanded ? 'Less ▴' : 'Setup ▾'}</Text>
        </Pressable>
      </View>

      {!activePart ? (
        <Text style={styles.hintText}>Pick the question you are working on with ‹ › or the list. The tutor checks your page against it.</Text>
      ) : expanded ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6, paddingBottom: 10 }} nestedScrollEnabled>
          {found ? (
            <>
              {!!found.group.context && <MathText text={found.group.context} style={styles.setup} />}
              {found.part ? (
                <View style={styles.partBox}>
                  <MathText text={`(${found.part.label}) ${found.part.text}`} style={styles.partText} />
                  {found.part.subparts.map((s) => (
                    <MathText key={s.label} text={`(${s.label}) ${s.text}${s.hint ? `  Hint: ${s.hint}` : ''}`} style={styles.sub} />
                  ))}
                  {!!found.part.hint && <MathText text={`Hint: ${found.part.hint}`} style={styles.hint} />}
                  {found.part.asksFor.length > 0 && <Text style={styles.asks}>Needs: {found.part.asksFor.join(' · ')}</Text>}
                </View>
              ) : null}
              {!!found.group.closing && <MathText text={`Applies to all parts: ${found.group.closing}`} style={styles.hint} />}
              {!!found.group.hint && <MathText text={`Hint: ${found.group.hint}`} style={styles.hint} />}
            </>
          ) : (
            <MathText text={flat?.text ?? ''} style={styles.setup} />
          )}
        </ScrollView>
      ) : (
        <MathText
          text={found?.part ? `(${found.part.label}) ${found.part.text}` : (found?.group.context ?? flat?.text ?? '')}
          style={styles.partText}
          numberOfLines={2}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#FFFBEB', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingTop: 6, gap: 4, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nav: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  navText: { fontSize: 20, color: C.primary, fontWeight: '700', marginTop: -2 },
  title: { fontSize: 15, fontWeight: '800', color: C.ink, maxWidth: 360 },
  expand: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  expandText: { fontSize: 13, fontWeight: '700', color: C.primary },
  hintText: { color: C.sub, fontSize: 14 },
  setup: { fontSize: 14, lineHeight: 20, color: C.sub },
  partBox: { backgroundColor: C.card, borderRadius: 8, padding: 8, gap: 4 },
  partText: { fontSize: 16, lineHeight: 22, color: C.ink },
  sub: { fontSize: 15, lineHeight: 21, color: C.ink, paddingLeft: 12 },
  hint: { fontSize: 14, fontStyle: 'italic', color: C.sub },
  asks: { fontSize: 13, color: C.sub, fontStyle: 'italic' },
});
