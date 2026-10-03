import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, VERDICT_STYLE } from '../theme';

type Props = {
  onPress: () => void;
  /** verdict counts of the latest check on this page, if any */
  counts?: Partial<Record<'valid' | 'partial' | 'incorrect' | 'unreadable', number>>;
  stale: boolean;
  insetRight: number;
  insetBottom: number;
};

/** Bottom-right button that opens the tutor sidebar (feedback, chat, problems, log). */
export function AiFab({ onPress, counts, stale, insetRight, insetBottom }: Props) {
  const shown = (['valid', 'partial', 'incorrect', 'unreadable'] as const).filter((v) => counts?.[v]);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, { right: Math.max(16, insetRight + 8), bottom: Math.max(18, insetBottom + 10) }]}
      accessibilityRole="button"
      accessibilityLabel="Open the tutor"
    >
      <Text style={styles.label}>✦ Tutor</Text>
      {shown.length > 0 && (
        <View style={[styles.badges, stale && { opacity: 0.45 }]}>
          {shown.map((v) => (
            <Text key={v} style={[styles.badge, { color: VERDICT_STYLE[v].color, backgroundColor: VERDICT_STYLE[v].bg }]}>
              {VERDICT_STYLE[v].symbol}
              {counts?.[v]}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 26,
    backgroundColor: C.primary,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  label: { color: '#fff', fontSize: 16, fontWeight: '800' },
  badges: { flexDirection: 'row', gap: 4 },
  badge: { fontSize: 12, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
});
