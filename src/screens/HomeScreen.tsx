import * as React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { deleteAssignment, getAssignments, getSettings, subscribe } from '../store/db';
import { ENV } from '../config';
import { C } from '../theme';

type Props = { onOpen: (id: string) => void; onNew: () => void; onSettings: () => void };

export function HomeScreen({ onOpen, onNew, onSettings }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = React.useState(getAssignments());
  React.useEffect(() => subscribe(() => setItems(getAssignments())), []);
  const hasKey = !!(getSettings().apiKey || ENV.anthropicApiKey);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Penquire</Text>
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
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardSub}>
              {item.course || 'No course'} · {item.problems.length} parts · {item.pageIds.length} page
              {item.pageIds.length === 1 ? '' : 's'} · {item.events.filter((e) => e.type === 'check').length} checks
            </Text>
            <Text style={styles.cardDate}>Updated {new Date(item.updatedAt).toLocaleString()}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  title: { fontSize: 32, fontWeight: '800', color: C.ink },
  warn: { margin: 20, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: C.partialSoft },
  warnText: { color: C.partial, fontWeight: '600' },
  empty: { color: C.sub, fontSize: 16, textAlign: 'center', marginTop: 60 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  cardTitle: { fontSize: 18, fontWeight: '700', color: C.ink },
  cardSub: { fontSize: 14, color: C.sub },
  cardDate: { fontSize: 12, color: C.faint },
});
