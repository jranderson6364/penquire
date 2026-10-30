import * as React from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { ENV } from '../config';
import { getSettings, getUsage, saveSettings } from '../store/db';
import { formatUSD, monthTotal } from '../store/usageRecords';
import { feedbackStats } from '../store/evalRecords';
import { loadEvals, writeExport } from '../store/evals';
import type { Settings } from '../store/types';
import { C } from '../theme';
import { applyAppearance } from '../appearance';
import { englishVoices, previewVoice, voiceAvailable } from '../voice/engine';
import { VOICE_DOWNLOAD_HINT, chooseVoice, needsBetterVoice, voiceLabel, type VoiceInfo } from '../voice/session';

/** how many voices the picker lists (best first); the saved pick is always included */
const VOICE_ROWS = 12;

export function SettingsScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [s, setS] = React.useState<Settings>(getSettings());
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const [voices, setVoices] = React.useState<VoiceInfo[] | null>(null);
  React.useEffect(() => {
    if (voiceAvailable()) void englishVoices().then(setVoices);
  }, []);
  const shownVoices = (voices ?? []).filter((v, i) => i < VOICE_ROWS || v.identifier === s.voiceId);
  const autoVoice = voices ? chooseVoice(voices) : undefined;

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
      <TextInput placeholderTextColor={C.faint}
        style={styles.input}
        value={s.apiKey}
        onChangeText={(v) => set('apiKey', v.trim())}
        placeholder={ENV.anthropicApiKey ? 'Using key from .env' : 'sk-ant-…'}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Check / chat model</Text>
      <TextInput placeholderTextColor={C.faint}
        style={styles.input}
        value={s.checkModel}
        onChangeText={(v) => set('checkModel', v.trim())}
        placeholder={ENV.checkModel}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Assignment parsing model</Text>
      <TextInput placeholderTextColor={C.faint}
        style={styles.input}
        value={s.parseModel}
        onChangeText={(v) => set('parseModel', v.trim())}
        placeholder={ENV.parseModel}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.section}>Usage (estimate)</Text>
      <Text style={styles.label}>
        {(() => {
          const t = monthTotal(getUsage());
          return `This month: ${formatUSD(t.costUSD)} over ${t.calls} call${t.calls === 1 ? '' : 's'}${t.unpriced ? ` (${t.unpriced} with unknown price)` : ''}`;
        })()}
      </Text>

      <Text style={styles.section}>Accuracy feedback</Text>
      <Text style={styles.label}>
        {(() => {
          const st = feedbackStats(loadEvals());
          return `${st.ratings} rating${st.ratings === 1 ? '' : 's'} on ${st.checks} check${st.checks === 1 ? '' : 's'} (${st.wrong} wrong)`;
        })()}
      </Text>
      <Button
        title="Export feedback (JSON)"
        onPress={async () => {
          try {
            if (feedbackStats(loadEvals()).ratings === 0) return Alert.alert('Nothing to export', 'Rate a mark first.');
            await Share.share({ url: writeExport() });
          } catch (e) {
            Alert.alert('Export failed', String(e instanceof Error ? e.message : e));
          }
        }}
      />

      <Text style={styles.section}>Appearance</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['system', 'light', 'dark'] as const).map((m) => (
          <Button
            key={m}
            title={m === 'system' ? 'Match iPad' : m === 'light' ? 'Light' : 'Dark'}
            kind={(s.appearance ?? 'system') === m ? 'primary' : 'secondary'}
            onPress={() => {
              set('appearance', m);
              applyAppearance(m); // preview right away; Save keeps it
            }}
            small
          />
        ))}
      </View>

      <Text style={styles.section}>Tutor voice</Text>
      {!voiceAvailable() ? (
        <Text style={styles.hint}>Voice needs the newest app build.</Text>
      ) : voices === null ? (
        <Text style={styles.hint}>Looking for installed voices…</Text>
      ) : (
        <>
          {needsBetterVoice(voices) && <Text style={styles.hint}>{VOICE_DOWNLOAD_HINT}</Text>}
          {!!s.voiceId && !voices.some((v) => v.identifier === s.voiceId) && <Text style={styles.hint}>The voice you picked is no longer installed; the best installed voice is used instead.</Text>}
          <View style={styles.voiceRow}>
            <Text style={[styles.label, { flex: 1 }]}>Automatic{autoVoice ? ` (${voiceLabel(autoVoice)})` : ''}</Text>
            <Button title="Preview" small onPress={() => void previewVoice(undefined)} />
            <Button title={s.voiceId ? 'Use' : 'In use'} kind={s.voiceId ? 'secondary' : 'primary'} small onPress={() => set('voiceId', undefined)} />
          </View>
          {shownVoices.map((v) => (
            <View key={v.identifier} style={styles.voiceRow}>
              <Text style={[styles.label, { flex: 1 }]}>{voiceLabel(v)}</Text>
              <Button title="Preview" small onPress={() => void previewVoice(v.identifier)} />
              <Button title={s.voiceId === v.identifier ? 'In use' : 'Use'} kind={s.voiceId === v.identifier ? 'primary' : 'secondary'} small onPress={() => set('voiceId', v.identifier)} />
            </View>
          ))}
        </>
      )}

      <Text style={styles.section}>Canvas</Text>
      <Text style={styles.label}>Paper</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['grid', 'lined', 'blank'] as const).map((p) => (
          <Button key={p} title={p} kind={s.paper === p ? 'primary' : 'secondary'} onPress={() => set('paper', p)} small />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Check as I write (quietly, at most 20 times an hour)</Text>
        <Switch value={!!s.autoCheck} onValueChange={(v) => set('autoCheck', v)} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Two fingers to scroll (palm protection)</Text>
        <Switch value={s.twoFingerScroll !== false} onValueChange={(v) => set('twoFingerScroll', v)} />
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
    color: C.ink,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hint: { fontSize: 14, color: C.sub },
});
