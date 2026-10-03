import { File } from 'expo-file-system';
import * as React from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getProvider } from '../ai';
import { HELP_LEVELS } from '../ai/prompts';
import type { HelpLevel } from '../ai/types';
import { Button } from '../components/Button';
import { MAX_SLICE_PAGES, MAX_WHOLE_PDF_PAGES, parsePageRange, pdfPageCount, slicePdf } from '../pdf/pages';
import { getSettings, newId, recordUsage, saveAssignment } from '../store/db';
import { applyParse } from '../store/parseApply';
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
  const [pdf, setPdf] = React.useState<{ name: string; base64: string; pageCount?: number } | null>(null);
  const [pages, setPages] = React.useState('');
  const [reading, setReading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const needsRange = !!pdf?.pageCount && pdf.pageCount > MAX_WHOLE_PDF_PAGES;

  const pickPdf = async () => {
    try {
      const res = await File.pickFileAsync({ mimeTypes: 'application/pdf' });
      if (res.canceled) return;
      const file = res.result;
      setReading(true);
      const base64 = await file.base64();
      let pageCount: number | undefined;
      try {
        pageCount = await pdfPageCount(base64);
      } catch (e) {
        console.warn('could not count PDF pages', e);
      }
      setPdf({ name: file.name, base64, pageCount });
      setPages('');
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    } catch (e) {
      Alert.alert('Could not open PDF', String(e));
    } finally {
      setReading(false);
    }
  };

  const create = async () => {
    // Large PDFs (a whole textbook) are never sent whole: slice out the pages that hold the problems.
    let source = pdf?.base64;
    let pagesUsed = '';
    if (pdf && (needsRange || pages.trim())) {
      const range = parsePageRange(pages, pdf.pageCount);
      if (!range.pages) {
        Alert.alert(needsRange ? `This PDF has ${pdf.pageCount} pages` : 'Check the page range', range.error ?? 'Enter a page range like 80-82.');
        return;
      }
      try {
        setBusy(true);
        source = await slicePdf(pdf.base64, range.pages);
        pagesUsed = pages.trim();
      } catch (e) {
        setBusy(false);
        Alert.alert('Could not read those pages', String(e instanceof Error ? e.message : e));
        return;
      }
    }

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
      if (source || pasted.trim()) {
        const provider = getProvider({ apiKey: s.apiKey, checkModel: s.checkModel, parseModel: s.parseModel, onUsage: recordUsage });
        const parsed = await provider.parseAssignment({ title: a.title, pdfBase64: source, text: pasted, onlyProblems: only });
        a = applyParse(a, parsed, { pages: pagesUsed, only: only.trim() });
      }
    } catch (e) {
      Alert.alert('Parsing failed', `${String(e)}\n\nThe assignment was created without problem text; you can retry from the Problems tab.`);
    }
    saveAssignment(a);
    // Keep the (sliced) PDF so parsing can be retried without re-picking it.
    if (source) saveSource(a.id, source);
    setBusy(false);
    onCreated(a.id);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.root, { paddingTop: insets.top + 12 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Button title="Cancel" kind="ghost" onPress={onCancel} />
          <Text style={styles.title}>New assignment</Text>
          <Button title={busy ? 'Reading…' : 'Create'} kind="primary" onPress={create} loading={busy} disabled={reading} />
        </View>

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Pset 3" />
        </Field>
        <Field label="Course">
          <TextInput style={styles.input} value={course} onChangeText={setCourse} placeholder="PHYSICS 61" />
        </Field>

        <Field label="Assignment PDF" hint="The pset itself, or a textbook. The tutor reads the exact wording, including figures.">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title={pdf ? 'Change PDF' : 'Choose PDF'} onPress={pickPdf} loading={reading} />
            <Text style={styles.hint}>
              {pdf ? `${pdf.name}${pdf.pageCount ? ` · ${pdf.pageCount} pages` : ''}` : 'None selected'}
            </Text>
          </View>
        </Field>

        {pdf?.pageCount ? (
          <Field
            label={needsRange ? 'Pages that contain your problems (required)' : 'Only these pages (optional)'}
            hint={
              needsRange
                ? `This PDF has ${pdf.pageCount} pages, too many to read at once. Use the PDF page numbers (the Nth page of the file), up to ${MAX_SLICE_PAGES} pages, e.g. 80-82.`
                : 'Leave empty to read the whole document.'
            }
          >
            <TextInput
              style={[styles.input, needsRange && !pages.trim() && styles.inputWarn]}
              value={pages}
              onChangeText={setPages}
              placeholder="80-82"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </Field>
        ) : null}

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
  inputWarn: { borderColor: C.partial, borderWidth: 1.5 },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  level: { padding: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  levelActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  levelTitle: { fontSize: 15, fontWeight: '700', color: C.ink },
});
