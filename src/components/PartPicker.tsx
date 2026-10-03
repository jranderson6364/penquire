import * as React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Problem } from '../ai/types';
import { C } from '../theme';

type Props = {
  parts: Problem[];
  /** label of the part being worked on, or undefined for "all parts" */
  value: string | undefined;
  onChange: (label: string | undefined) => void;
};

/** Which problem part the student is working on now. The check emphasizes it but still reports the others. */
export function PartPicker({ parts, value, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  if (parts.length === 0) return null;
  const choose = (label: string | undefined) => {
    onChange(label);
    setOpen(false);
  };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.chip} accessibilityLabel="Choose the problem part you are working on">
        <Text style={styles.chipText}>{value ? `Part ${value}` : 'All parts'} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Working on</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Pressable onPress={() => choose(undefined)} style={[styles.row, value === undefined && styles.rowActive]}>
                <Text style={styles.rowTitle}>All parts</Text>
                <Text style={styles.rowSub}>Check everything on the page equally</Text>
              </Pressable>
              {parts.map((p) => (
                <Pressable key={p.label} onPress={() => choose(p.label)} style={[styles.row, value === p.label && styles.rowActive]}>
                  <Text style={styles.rowTitle}>{p.label}</Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {p.text}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
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
  sheet: { width: 420, backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 6 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 6, color: C.ink },
  row: { padding: 10, borderRadius: 10 },
  rowActive: { backgroundColor: C.primarySoft },
  rowTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  rowSub: { fontSize: 13, color: C.sub },
});
