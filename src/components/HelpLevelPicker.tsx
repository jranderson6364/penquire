import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { HELP_LEVELS } from '../ai/prompts';
import type { HelpLevel } from '../ai/types';
import { C } from '../theme';

type Props = {
  value: HelpLevel;
  max: HelpLevel;
  onChange: (l: HelpLevel) => void;
};

export function HelpLevelPicker({ value, max, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.chip}>
        <Text style={styles.chipText}>Help: {HELP_LEVELS[value].name} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Help level</Text>
            {([0, 1, 2, 3, 4] as HelpLevel[]).map((l) => {
              const locked = l > max;
              return (
                <Pressable
                  key={l}
                  disabled={locked}
                  onPress={() => {
                    onChange(l);
                    setOpen(false);
                  }}
                  style={[styles.row, value === l && styles.rowActive, locked && { opacity: 0.4 }]}
                >
                  <Text style={styles.rowTitle}>
                    {l}. {HELP_LEVELS[l].name} {locked ? '🔒' : ''}
                  </Text>
                  <Text style={styles.rowSub}>{locked ? 'Not allowed by this course policy' : HELP_LEVELS[l].short}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.primarySoft },
  chipText: { color: C.primary, fontWeight: '700', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', alignItems: 'center' },
  sheet: { width: 380, backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 6, color: C.ink },
  row: { padding: 10, borderRadius: 10 },
  rowActive: { backgroundColor: C.primarySoft },
  rowTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  rowSub: { fontSize: 13, color: C.sub },
});
