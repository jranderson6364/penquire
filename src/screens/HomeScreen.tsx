import * as React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { deleteAssignment, getAssignments, getSettings, subscribe } from '../store/db';
import { ENV } from '../config';
import { completedParts } from '../store/progress';
import { C, F, LABEL, R, T } from '../theme';

type Props = { onOpen: (id: string) => void; onNew: () => void; onSettings: () => void };

export function HomeScreen({ onOpen, onNew, onSettings }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = React.useState(getAssignments());
  React.useEffect(() => subscribe(() => setItems(getAssignments())), []);
  const hasKey = !!(getSettings().apiKey || ENV.anthropicApiKey);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Penquire</Text>
          <Text style={styles.tagline}>Handwritten work, checked step by step</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Settings" onPress={onSettings} />
          <Button title="+ New assignment" kind="primary" onPress={onNew} />
        </View>
      </View>
      {!hasKey && (
        <Pressable onPress={onSettings} style={styles.warn}>
          <Text style={styles.warnText}>No API key yet. Tap to add one in Settings (or set EXPO_PUBLIC_ANTHROPIC_API_KEY in .env).</Text>
        </Pressable>
      )}
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        ListEmptyComponent={
          <Text style={styles.empty}>No assignments yet. Create one, import the pset PDF, and start writing.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.id)}
            onLongPress={() =>
              Alert.alert('Delete assignment?', `"${item.title}" and its pages will be removed from this iPad.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => deleteAssignment(item.id) },
              ])
            }
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.cardCourse}>{item.course || 'No course'}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Progress assignment={item} />
            <Text style={styles.cardMeta}>
              {item.pageIds.length} page{item.pageIds.length === 1 ? '' : 's'} · {item.events.filter((e) => e.type === 'check').length} checks · updated{' '}
              {new Date(item.updatedAt).toLocaleDateString()}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function Progress({ assignment }: { assignment: Parameters<typeof completedParts>[0] }) {
  const { done, total } = completedParts(assignment);
  if (total === 0) return null;
  return (
    <View style={styles.progressRow}>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
        <View style={[styles.fill, { width: `${(done / total) * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {done}/{total} parts
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  title: { fontSize: T.display, fontWeight: '700', color: C.ink, letterSpacing: -0.6 },
  tagline: { fontSize: T.small, color: C.faint, marginTop: 2 },
  warn: { margin: 20, marginBottom: 0, padding: 12, borderRadius: R.md, backgroundColor: C.partialSoft },
  warnText: { color: C.partial, fontWeight: '600' },
  empty: { color: C.sub, fontSize: T.lead, textAlign: 'center', marginTop: 60 },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 18, gap: 6, borderWidth: 1, borderColor: C.line },
  cardCourse: { ...LABEL },
  cardTitle: { fontSize: T.lead + 1, fontWeight: '600', color: C.ink, letterSpacing: -0.2 },
  cardMeta: { fontSize: T.caption, color: C.faint, fontFamily: F.mono },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: C.valid },
  progressText: { fontSize: T.caption, color: C.sub, fontFamily: F.mono },
});
