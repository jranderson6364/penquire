import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { findPart } from '../problems/flatten';
import type { Assignment } from '../store/types';
import { C, F, R, T } from '../theme';
import { Icon } from './Icon';
import { MathText } from './MathText';
import { PartPicker } from './PartPicker';

type Props = {
  assignment: Assignment;
  /** flat label of the part being worked on ("6b"), or undefined */
  activePart?: string;
  onChange: (label: string | undefined) => void;
  /** typeset the current part (or only the setup) onto the page */
  onPlacePart: () => void;
  onPlaceSetup: () => void;
  /** tuck the whole strip away; a small pill on the page brings it back */
  onRetract: () => void;
  /** left/right inset (safe area) */
  insetLeft: number;
  insetRight: number;
};

/**
 * Fixed height on purpose: this sits in the layout above the canvas, and resizing it would make the page reflow.
 * The full setup opens as a sheet that floats over the page instead of pushing it down.
 */
export const BANNER_COLLAPSED = 112;
const SHEET_MAX = 320;

/** The question being worked on: the shared setup of the whole problem (one line), then just the current part. */
export function QuestionBanner({ assignment, activePart, onChange, onPlacePart, onPlaceSetup, onRetract, insetLeft, insetRight }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const [more, setMore] = React.useState(false);
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

  const hasPart = !!found?.part && !!found.part.text;
  const setup = found?.group.context ?? '';
  const partLine = found?.part ? `(${found.part.label}) ${found.part.text}` : (setup || flat?.text || '');
  const title = found
    ? `Problem ${found.group.label}${found.group.title ? ` · ${found.group.title}` : ''}`
    : flat
      ? flat.label
      : 'No question selected';

  return (
    <View style={[styles.wrap, { height: BANNER_COLLAPSED, paddingLeft: Math.max(12, insetLeft), paddingRight: Math.max(12, insetRight) }]}>
      <View style={styles.row}>
        <Pressable onPress={() => go(-1)} hitSlop={8} style={styles.nav} accessibilityRole="button" accessibilityLabel="Previous question">
          <Icon name="chevron-left" size={16} color={C.primary} />
        </Pressable>
        <Pressable onPress={() => go(1)} hitSlop={8} style={styles.nav} accessibilityRole="button" accessibilityLabel="Next question">
          <Icon name="chevron-right" size={16} color={C.primary} />
        </Pressable>
        {/* the title IS the question menu: one control instead of a tag, a title and a separate picker */}
        <PartPicker parts={choices} value={activePart} onChange={onChange} label={activePart ? (found?.part ? `${activePart} · ${title}` : title) : 'Choose a question'} />
        <View style={{ flex: 1 }} />
        {!!activePart && more && (
          <>
            <Pressable onPress={() => (onPlacePart(), setMore(false))} style={styles.action} accessibilityRole="button" accessibilityLabel="Place this part on the page">
              <Icon name="pin" size={16} color={C.primary} />
              <Text style={styles.actionText}>Place part</Text>
            </Pressable>
            {!!setup && hasPart && (
              <Pressable onPress={() => (onPlaceSetup(), setMore(false))} style={styles.action} accessibilityRole="button" accessibilityLabel="Place the setup of the whole problem on the page">
                <Icon name="pin" size={16} color={C.primary} />
                <Text style={styles.actionText}>Place setup</Text>
              </Pressable>
            )}
          </>
        )}
        {!!activePart && (
          <Pressable onPress={() => setMore((m) => !m)} style={[styles.nav, more && { backgroundColor: C.primarySoft }]} accessibilityRole="button" accessibilityLabel={more ? 'Hide question actions' : 'More: place the question on the page'}>
            <Text style={styles.moreText}>⋯</Text>
          </Pressable>
        )}
        <Pressable onPress={onRetract} hitSlop={6} style={styles.nav} accessibilityRole="button" accessibilityLabel="Hide the question strip">
          <Icon name="close" size={14} color={C.sub} />
        </Pressable>
      </View>

      {!activePart ? (
        <Text style={styles.hintText}>Pick the question you are working on. The tutor checks your page against it.</Text>
      ) : (
        // tap the question to read all of it (setup, sub-parts, hints)
        <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button" accessibilityLabel={expanded ? 'Close the full question' : 'Show the full question'}>
          {hasPart && !!setup && <MathText text={setup} style={styles.setupLine} numberOfLines={1} />}
          <MathText text={partLine} style={styles.partText} numberOfLines={hasPart && setup ? 2 : 3} />
        </Pressable>
      )}

      {expanded && !!activePart && (
        <ScrollView style={[styles.sheet, { left: Math.max(0, insetLeft), right: Math.max(0, insetRight) }]} contentContainerStyle={styles.sheetContent} nestedScrollEnabled>
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
                  {found.part.asksFor.length > 0 && <MathText text={`Needs: ${found.part.asksFor.join(' · ')}`} style={styles.asks} />}
                </View>
              ) : null}
              {!!found.group.closing && <MathText text={`Applies to all parts: ${found.group.closing}`} style={styles.hint} />}
              {!!found.group.hint && <MathText text={`Hint: ${found.group.hint}`} style={styles.hint} />}
            </>
          ) : (
            <MathText text={flat?.text ?? ''} style={styles.setup} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** What remains of the question strip when it is tucked away: one small pill on the page. */
export function QuestionPill({ label, onPress, insetLeft }: { label?: string; onPress: () => void; insetLeft: number }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, { left: Math.max(8, insetLeft) }]} accessibilityRole="button" accessibilityLabel="Show the question">
      <Icon name="question" size={16} color={C.primary} />
      <Text style={styles.pillText}>{label ?? 'Question'}</Text>
      <Icon name="chevron-down" size={14} color={C.sub} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.line, paddingTop: 6, gap: 3, zIndex: 20, overflow: 'visible' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nav: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: R.pill, backgroundColor: C.primarySoft },
  actionText: { fontSize: T.small, fontWeight: '600', color: C.primary },
  hintText: { color: C.sub, fontSize: T.body - 1 },
  moreText: { fontSize: 18, lineHeight: 20, fontWeight: '700', color: C.primary },
  setupLine: { fontSize: T.small, lineHeight: 18, color: C.sub },
  pill: { position: 'absolute', top: 8, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, shadowColor: '#0F1419', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  pillText: { fontSize: T.small, fontWeight: '600', color: C.ink },
  sheet: {
    position: 'absolute',
    top: BANNER_COLLAPSED,
    maxHeight: SHEET_MAX,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderColor: C.lineStrong,
    shadowColor: '#0F1419',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sheetContent: { gap: 8, padding: 14 },
  setup: { fontSize: T.body - 1, lineHeight: 21, color: C.sub },
  partBox: { backgroundColor: C.bg, borderRadius: R.sm + 2, padding: 10, gap: 4 },
  partText: { fontSize: T.lead - 1, lineHeight: 22, color: C.ink },
  sub: { fontSize: T.body, lineHeight: 21, color: C.ink, paddingLeft: 12 },
  hint: { fontSize: T.body - 1, fontStyle: 'italic', color: C.sub },
  asks: { fontSize: T.small, color: C.sub, fontFamily: F.mono },
});
