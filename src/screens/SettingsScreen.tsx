import * as React from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { ENV } from '../config';
import { getSettings, saveSettings } from '../store/db';
import type { Settings } from '../store/types';
import { C } from '../theme';

export function SettingsScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [s, setS] = React.useState<Settings>(getSettings());
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Button
          title="Save"
          kind="primary"
          onPress={() => {
            saveSettings(s);
            onDone();
          }}
        />
      </View>

      <Text style={styles.section}>AI (dev only: the key is stored on this iPad)</Text>
      <Text style={styles.label}>Anthropic API key</Text>
      <TextInput
        style={styles.input}
        value={s.apiKey}
        onChangeText={(v) => set('apiKey', v.trim())}
        placeholder={ENV.anthropicApiKey ? 'Using key from .env' : 'sk-ant-…'}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Check / chat model</Text>
      <TextInput
        style={styles.input}
        value={s.checkModel}
        onChangeText={(v) => set('checkModel', v.trim())}
        placeholder={ENV.checkModel}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Assignment parsing model</Text>
      <TextInput
        style={styles.input}
        value={s.parseModel}
        onChangeText={(v) => set('parseModel', v.trim())}
        placeholder={ENV.parseModel}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.section}>Canvas</Text>
      <Text style={styles.label}>Paper</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['grid', 'lined', 'blank'] as const).map((p) => (
          <Button key={p} title={p} kind={s.paper === p ? 'primary' : 'secondary'} onPress={() => set('paper', p)} small />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Allow finger drawing</Text>
        <Switch value={s.allowFingerDrawing} onValueChange={(v) => set('allowFingerDrawing', v)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: C.ink },
  section: { fontSize: 13, fontWeight: '800', color: C.sub, textTransform: 'uppercase', marginTop: 16 },
  label: { fontSize: 15, fontWeight: '600', color: C.ink },
  input: {
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
});
