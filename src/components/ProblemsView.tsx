import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HELP_LEVELS } from '../ai/prompts';
import { flatLabel } from '../problems/labels';
import type { ParseIssue, ProblemGroup } from '../problems/types';
import type { Assignment } from '../store/types';
import { C } from '../theme';
import { Button } from './Button';
import { MathText } from './MathText';

type Props = {
  assignment: Assignment;
  /** flat label of the part being worked on ("6b") */
  activePart?: string;
  onSelectPart: (label: string | undefined) => void;
  onReparse: () => void;
  reparsing: boolean;
};

/** The assignment as structured problems: setup once, then parts, sub-parts, hints and closing text. */
export function ProblemsView({ assignment, activePart, onSelectPart, onReparse, reparsing }: Props) {
  const { groups, notes, parseIssues } = assignment;
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.heading}>
        {assignment.course ? `${assignment.course} · ` : ''}
        {assignment.title}
        {assignment.sourcePages ? `  (pages ${assignment.sourcePages})` : ''}
      </Text>
      <Text style={styles.meta}>
        Policy: {assignment.policy || '—'} (max help: {HELP_LEVELS[assignment.policyMaxLevel].name})
      </Text>

      {parseIssues && parseIssues.length > 0 && <Issues issues={parseIssues} onReparse={onReparse} reparsing={reparsing} />}

      {notes && notes.length > 0 && (
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>Assignment notes</Text>
          {notes.map((n, i) => (
            <MathText key={i} text={n} style={styles.noteText} />
          ))}
        </View>
      )}

      {assignment.problems.length === 0 && (
        <View style={{ gap: 8 }}>
          <Text style={styles.empty}>No problems loaded. The tutor will infer the task from your page.</Text>
          <Button title="Retry parsing" onPress={onReparse} loading={reparsing} />
        </View>
      )}

      {groups && groups.length > 0
        ? groups.map((g) => <Group key={g.label} g={g} activePart={activePart} onSelectPart={onSelectPart} />)
        : assignment.problems.map((p) => (
            <Pressable key={p.label} onPress={() => onSelectPart(p.label)} style={[styles.card, activePart === p.label && styles.cardActive]}>
              <Text style={styles.label}>{p.label}</Text>
              <MathText text={p.text} />
              {p.asksFor.length > 0 && <Text style={styles.asks}>Needs: {p.asksFor.join(' · ')}</Text>}
            </Pressable>
          ))}

      {groups && groups.length > 0 && (
        <Button title={reparsing ? 'Parsing…' : 'Re-parse the PDF'} kind="ghost" onPress={onReparse} loading={reparsing} style={{ alignSelf: 'flex-start' }} />
      )}
    </ScrollView>
  );
}

function Issues({ issues, onReparse, reparsing }: { issues: ParseIssue[]; onReparse: () => void; reparsing: boolean }) {
  const errors = issues.filter((i) => i.severity === 'error');
  return (
    <View style={[styles.issues, errors.length ? styles.issuesError : styles.issuesWarn]}>
      <Text style={styles.issuesTitle}>
        {errors.length ? 'Some problems may be missing or incomplete' : 'Worth a second look'}
      </Text>
      {issues.slice(0, 6).map((i, k) => (
        <Text key={k} style={styles.issueText}>
          • {i.message}
        </Text>
      ))}
      {issues.length > 6 && <Text style={styles.issueText}>…and {issues.length - 6} more</Text>}
      <Button small title={reparsing ? 'Parsing…' : 'Re-parse'} onPress={onReparse} loading={reparsing} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
    </View>
  );
}

function Group({ g, activePart, onSelectPart }: { g: ProblemGroup; activePart?: string; onSelectPart: (l: string | undefined) => void }) {
  const [open, setOpen] = React.useState(true);
  const wholeActive = activePart === g.label;
  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.groupHead}>
        <Text style={styles.label}>
          Problem {g.label}
          {g.title ? ` · ${g.title}` : ''}
        </Text>
        <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <>
          {!!g.context && <MathText text={g.context} />}
          {g.parts.length === 0 && (
            <Button
              small
              kind={wholeActive ? 'primary' : 'secondary'}
              title={wholeActive ? 'Working on this' : 'Work on this'}
              onPress={() => onSelectPart(wholeActive ? undefined : g.label)}
              style={{ alignSelf: 'flex-start' }}
            />
          )}
          {g.parts.map((p) => {
            const fl = flatLabel(g.label, p.label);
            const active = activePart === fl;
            return (
              <View key={p.label} style={[styles.part, active && styles.partActive]}>
                <View style={styles.partHead}>
                  <Text style={styles.partLabel}>({p.label})</Text>
                  <Pressable onPress={() => onSelectPart(active ? undefined : fl)} hitSlop={8} style={[styles.workBtn, active && styles.workBtnOn]}>
                    <Text style={[styles.workText, active && { color: '#fff' }]}>{active ? 'Working on this' : 'Work on this'}</Text>
                  </Pressable>
                </View>
                <MathText text={p.text} />
                {p.subparts.map((s) => (
                  <View key={s.label} style={styles.sub}>
                    <Text style={styles.partLabel}>({s.label})</Text>
                    <View style={{ flex: 1 }}>
                      <MathText text={s.text} />
                      {!!s.hint && <MathText text={`Hint: ${s.hint}`} style={styles.hint} />}
                    </View>
                  </View>
                ))}
                {!!p.hint && <MathText text={`Hint: ${p.hint}`} style={styles.hint} />}
                {p.asksFor.length > 0 && <Text style={styles.asks}>Needs: {p.asksFor.join(' · ')}</Text>}
              </View>
            );
          })}
          {!!g.closing && (
            <View style={styles.closing}>
              <Text style={styles.closingLabel}>Applies to all parts</Text>
              <MathText text={g.closing} />
            </View>
          )}
          {!!g.hint && <MathText text={`Hint: ${g.hint}`} style={styles.hint} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 14, gap: 10, paddingBottom: 60 },
  heading: { fontSize: 15, fontWeight: '800', color: C.ink },
  meta: { fontSize: 12, color: C.faint },
  empty: { color: C.sub, fontSize: 15, lineHeight: 21 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 8 },
  cardActive: { borderWidth: 2, borderColor: C.primary },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: '800', color: C.primary, fontSize: 15, flex: 1 },
  chev: { color: C.sub, fontSize: 16 },
  part: { gap: 4, paddingLeft: 10, borderLeftWidth: 3, borderColor: C.line },
  partActive: { borderColor: C.primary, backgroundColor: C.primarySoft, borderRadius: 6, paddingVertical: 6 },
  partHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partLabel: { fontWeight: '800', color: C.ink, fontSize: 14, minWidth: 28 },
  sub: { flexDirection: 'row', gap: 4, paddingLeft: 12 },
  hint: { fontStyle: 'italic', color: C.sub, fontSize: 14 },
  asks: { fontSize: 13, color: C.sub, fontStyle: 'italic' },
  closing: { backgroundColor: C.unknownSoft, borderRadius: 8, padding: 8, gap: 2 },
  closingLabel: { fontSize: 11, fontWeight: '800', color: C.sub, textTransform: 'uppercase' },
  workBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  workBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  workText: { fontSize: 12, fontWeight: '700', color: C.primary },
  notes: { backgroundColor: C.partialSoft, borderRadius: 10, padding: 10, gap: 4 },
  notesTitle: { fontSize: 12, fontWeight: '800', color: C.partial, textTransform: 'uppercase' },
  noteText: { fontSize: 14, lineHeight: 20 },
  issues: { borderRadius: 10, padding: 10, gap: 3 },
  issuesError: { backgroundColor: C.incorrectSoft },
  issuesWarn: { backgroundColor: C.partialSoft },
  issuesTitle: { fontWeight: '800', color: C.ink, fontSize: 14 },
  issueText: { fontSize: 13, color: C.ink },
});
