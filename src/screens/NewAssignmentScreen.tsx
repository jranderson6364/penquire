import { File } from 'expo-file-system';
import * as React from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getProvider } from '../ai';
import { HELP_LEVELS } from '../ai/prompts';
import type { HelpLevel } from '../ai/types';
import { Button } from '../components/Button';
import { getSettings, newId, saveAssignment } from '../store/db';
import { saveSource } from '../store/sources';
import type { Assignment } from '../store/types';
import { C } from '../theme';

const DEFAULT_POLICY =
  'AI may be used only in "Socratic mode": to clarify concepts or check reasoning, never to produce solutions, final answers, or derivations.';

type Props = { onCancel: () => void; onCreated: (id: string) => void };

export function NewAssignmentScreen({ onCancel, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = React.useState('');
  const [course, setCourse] = React.useState('');
  const [policy, setPolicy] = React.useState(DEFAULT_POLICY);
  const [maxLevel, setMaxLevel] = React.useState<HelpLevel>(2);
  const [only, setOnly] = React.useState('');
  const [pasted, setPasted] = React.useState('');
  const [pdf, setPdf] = React.useState<{ name: string; base64: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pickPdf = async () => {
    try {
      const res = await File.pickFileAsync({ mimeTypes: 'application/pdf' });
      if (res.canceled) return;
      const file = res.result;
      const base64 = await file.base64();
      setPdf({ name: file.name, base64 });
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    } catch (e) {
      Alert.alert('Could not open PDF', String(e));
    }
  };

  const create = async () => {
    setBusy(true);
    const s = getSettings();
    const now = Date.now();
    let a: Assignment = {
      id: newId('a_'),
      title: title.trim() || 'Untitled assignment',
      course: course.trim(),
      policy: policy.trim(),
      policyMaxLevel: maxLevel,
      helpLevel: Math.min(1, maxLevel) as HelpLevel,
      style: '',
      problems: [],
      pageIds: [newId('p_')],
      chat: [],
      checks: {},
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (pdf || pasted.trim()) {
        const provider = getProvider({ apiKey: s.apiKey, checkModel: s.checkModel, parseModel: s.parseModel });
        const parsed = await provider.parseAssignment({
          title: a.title,
          pdfBase64: pdf?.base64,
          text: pasted,
          onlyProblems: only,
        });
        a = {
          ...a,
          problems: parsed.problems,
          course: a.course || parsed.course || '',
          events: [{ t: Date.now(), type: 'parse', detail: `${parsed.problems.length} parts` }],
        };
      }
    } catch (e) {
      Alert.alert('Parsing failed', `${String(e)}\n\nThe assignment was created without problem text; you can retry from the Problems tab.`);
    }
    saveAssignment(a);
    // Keep the PDF so parsing can be retried without re-picking it.
    if (pdf) saveSource(a.id, pdf.base64);
    setBusy(false);
    onCreated(a.id);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <Button title="Cancel" kind="ghost" onPress={onCancel} />
          <Text style={styles.title}>New assignment</Text>
          <Button title="Create" kind="primary" onPress={create} loading={busy} />
        </View>

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Pset 3" />
        </Field>
        <Field label="Course">
          <TextInput style={styles.input} value={course} onChangeText={setCourse} placeholder="PHYSICS 61" />
        </Field>

        <Field label="Assignment PDF" hint="The pset itself, or textbook pages. The tutor reads the exact wording.">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title={pdf ? 'Change PDF' : 'Choose PDF'} onPress={pickPdf} />
            <Text style={styles.hint}>{pdf ? pdf.name : 'None selected'}</Text>
          </View>
        </Field>
        <Field label="Only these problems (optional)" hint="Useful for textbook chapters, e.g. 3.8, 3.10, 3.12">
          <TextInput style={styles.input} value={only} onChangeText={setOnly} placeholder="3.8, 3.10, 3.12" />
        </Field>
        <Field label="…or paste problem text (optional)">
          <TextInput style={[styles.input, styles.multi]} value={pasted} onChangeText={setPasted} multiline placeholder="Paste problems here" />
        </Field>

        <Field label="Course AI policy" hint="The tutor treats this as binding.">
          <TextInput style={[styles.input, styles.multi]} value={policy} onChangeText={setPolicy} multiline />
        </Field>
        <Field label="Maximum help level this policy allows">
          <View style={{ gap: 6 }}>
            {([0, 1, 2, 3, 4] as HelpLevel[]).map((l) => (
              <Pressable key={l} onPress={() => setMaxLevel(l)} style={[styles.level, maxLevel === l && styles.levelActive]}>
                <Text style={styles.levelTitle}>
                  {l}. {HELP_LEVELS[l].name}
                </Text>
                <Text style={styles.hint}>{HELP_LEVELS[l].short}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, gap: 18, maxWidth: 760, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: C.ink },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: C.ink },
  hint: { fontSize: 13, color: C.sub },
  input: {
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  level: { padding: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  levelActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  levelTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
});
