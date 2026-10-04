import * as React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HELP_LEVELS } from '../ai/prompts';
import type { PartStatus } from '../ai/types';
import { disclosureSummary, issueOutcomes } from '../log';
import type { Assignment, StoredCheck } from '../store/types';
import { assignmentSpend, formatCost } from '../store/usageRecords';
import { C, VERDICT_STYLE } from '../theme';
import { Button } from './Button';
import { Markdown } from './Markdown';
import { ProblemsView } from './ProblemsView';

export type Tab = 'feedback' | 'problems' | 'chat' | 'log';

type Props = {
  assignment: Assignment;
  check?: StoredCheck;
  stale: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
  draft: string;
  onDraft: (s: string) => void;
  onSend: (message: string, attachPage: boolean) => void;
  /** "Help me start": a first move for the active part, no attempt required */
  onHelpStart: () => void;
  sending: boolean;
  onReparse: () => void;
  reparsing: boolean;
  /** the part being worked on (flat label) and how to change it from the Problems tab */
  activePart?: string;
  onSelectPart: (label: string | undefined) => void;
  /** rendered above the tabs: Check, help level, marks toggle */
  header?: React.ReactNode;
  onClose: () => void;
  onInputFocus?: () => void;
  onInputBlur?: () => void;
};

const STATUS_STYLE: Record<PartStatus['status'], { color: string; bg: string; label: string }> = {
  complete: { color: C.valid, bg: C.validSoft, label: 'complete' },
  in_progress: { color: C.partial, bg: C.partialSoft, label: 'in progress' },
  missing_items: { color: C.incorrect, bg: C.incorrectSoft, label: 'missing' },
  not_started: { color: C.unknown, bg: C.unknownSoft, label: 'not started' },
};

export function SidePanel(p: Props) {
  return (
    <View style={styles.panel}>
      {p.header}
      <View style={styles.tabs}>
        {(['feedback', 'chat', 'problems', 'log'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => p.onTab(t)} style={[styles.tab, p.tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, p.tab === t && styles.tabTextActive]}>{t[0].toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={p.onClose} hitSlop={10} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      {p.tab === 'feedback' && <FeedbackTab {...p} />}
      {p.tab === 'chat' && <ChatTab {...p} />}
      {p.tab === 'problems' && (
        <ProblemsView assignment={p.assignment} activePart={p.activePart} onSelectPart={p.onSelectPart} onReparse={p.onReparse} reparsing={p.reparsing} />
      )}
      {p.tab === 'log' && <LogTab {...p} />}
    </View>
  );
}

const REVEAL_LABEL: Record<string, string> = {
  location: 'where to look',
  principle: 'a principle',
  example: 'a similar example',
  subgoal: 'the next goal',
  step: 'a step',
};

function StartButton({ activePart, onHelpStart, sending }: Props) {
  return (
    <Button
      small
      title={`Not sure how to start${activePart ? ` ${activePart}` : ''}?`}
      loading={sending}
      onPress={onHelpStart}
      style={{ alignSelf: 'flex-start' }}
    />
  );
}

function FeedbackTab(p: Props) {
  const { check, stale } = p;
  if (!check) {
    return (
      <View style={[styles.empty, { gap: 12 }]}>
        <Text style={styles.emptyText}>Write your work, then tap Check. Feedback for this page shows up here and as marks in the margin.</Text>
        <StartButton {...p} />
      </View>
    );
  }
  const r = check.result;
  const counts = r.lines.reduce<Record<string, number>>((acc, l) => ((acc[l.verdict] = (acc[l.verdict] ?? 0) + 1), acc), {});
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {stale && <Text style={styles.staleBanner}>Page changed since this check. Tap Check again.</Text>}
      {!!r.question && (
        <View style={styles.questionCard}>
          <Text style={styles.questionLabel}>Question for you</Text>
          <Text style={styles.question}>{r.question}</Text>
        </View>
      )}
      <View style={styles.countRow}>
        {(['valid', 'partial', 'incorrect', 'unreadable'] as const).map((v) =>
          counts[v] ? (
            <Text key={v} style={[styles.count, { color: VERDICT_STYLE[v].color, backgroundColor: VERDICT_STYLE[v].bg }]}>
              {VERDICT_STYLE[v].symbol} {counts[v]}
            </Text>
          ) : null
        )}
      </View>
      {typeof check.costUSD === 'number' && check.costUSD > 0 && (
        <Text style={styles.cost}>
          This check {formatCost(check.costUSD)} · this assignment {formatCost(assignmentSpend(p.assignment.events))}
        </Text>
      )}
      {r.parts.length > 0 && (
        <View style={styles.chips}>
          {r.parts.map((part) => {
            const s = STATUS_STYLE[part.status] ?? STATUS_STYLE.in_progress;
            return (
              <View key={part.label} style={[styles.chip, { backgroundColor: s.bg }]}>
                <Text style={[styles.chipText, { color: s.color }]}>
                  {part.label} · {s.label}
                </Text>
                {part.missing.map((m, i) => (
                  <Text key={i} style={styles.chipMissing}>
                    – {m}
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
      )}
      {r.fixedSinceLast.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.valid }]}>Fixed since last check</Text>
          {r.fixedSinceLast.map((f, i) => (
            <Text key={i} style={styles.listItem}>
              ✓ {f}
            </Text>
          ))}
        </View>
      )}
      {r.stillOpen.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.incorrect }]}>Still open</Text>
          {r.stillOpen.map((f, i) => (
            <Text key={i} style={styles.listItem}>
              • {f}
            </Text>
          ))}
        </View>
      )}
      <View style={styles.section}>
        <Markdown text={r.feedback} />
      </View>
      {!!r.revealed?.length && (
        <Text style={styles.meta}>
          This feedback showed: {[...new Set(r.revealed.map((x) => REVEAL_LABEL[x.kind] ?? x.kind))].join(', ')}
          {r.overLevel?.length ? ' (more than your help level allows; logged)' : ''}
        </Text>
      )}
      <Text style={styles.meta}>
        {new Date(check.at).toLocaleTimeString()} · {r.model}
        {r.usage ? ` · ${r.usage.inputTokens + r.usage.cacheReadTokens} in / ${r.usage.outputTokens} out` : ''}
      </Text>
    </ScrollView>
  );
}

function ChatTab(p: Props) {
  const { assignment, draft, onDraft, onSend, sending, onInputFocus, onInputBlur } = p;
  const [attach, setAttach] = React.useState(true);
  const scrollRef = React.useRef<ScrollView>(null);
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={80}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {assignment.chat.length === 0 && (
          <Text style={styles.emptyText}>
            Ask a question, push back on feedback, or describe a fix in words ("I changed L4 to 26/7 − 3").
          </Text>
        )}
        {assignment.chat.length === 0 && <StartButton {...p} />}
        {assignment.chat.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.botBubble]}>
            {m.role === 'user' ? <Text style={styles.userText}>{m.text}</Text> : <Markdown text={m.text} />}
            {m.role === 'assistant' && typeof m.costUSD === 'number' && m.costUSD > 0 && <Text style={styles.cost}>{formatCost(m.costUSD)}</Text>}
          </View>
        ))}
        {sending && <ActivityIndicator style={{ marginTop: 8 }} />}
      </ScrollView>
      <View style={styles.inputRow}>
        <View style={styles.attachRow}>
          <Switch value={attach} onValueChange={setAttach} />
          <Text style={styles.attachText}>Include current page</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={onDraft}
            placeholder="Message your tutor…"
            multiline
            onFocus={onInputFocus}
            onBlur={onInputBlur}
          />
          <Button
            kind="primary"
            title="Send"
            disabled={!draft.trim()}
            loading={sending}
            onPress={() => {
              onSend(draft.trim(), attach);
            }}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function LogTab({ assignment }: Props) {
  const summary = disclosureSummary(assignment);
  const o = issueOutcomes(assignment);
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {o.unaided + o.helped + o.open > 0 && (
        <View style={styles.countRow}>
          <Text style={[styles.count, { color: C.valid, backgroundColor: C.validSoft }]}>{o.unaided} on your own</Text>
          <Text style={[styles.count, { color: C.partial, backgroundColor: C.partialSoft }]}>{o.helped} with help</Text>
          <Text style={[styles.count, { color: C.unknown, backgroundColor: C.unknownSoft }]}>{o.open} open</Text>
        </View>
      )}
      <Text style={styles.sectionTitle}>AI use disclosure</Text>
      <View style={styles.disclosure}>
        <Text style={styles.disclosureText}>{summary}</Text>
      </View>
      <Button title="Share / copy" onPress={() => Share.share({ message: summary })} style={{ alignSelf: 'flex-start' }} />
      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Session log</Text>
      {[...assignment.events].reverse().map((e, i) => (
        <Text key={i} style={styles.logItem}>
          {new Date(e.t).toLocaleString()} · {e.type}
          {e.page ? ` · p${e.page}` : ''}
          {e.level !== undefined ? ` · ${HELP_LEVELS[e.level].name}` : ''}
          {e.detail ? ` · ${e.detail}` : ''}
          {e.revealed?.length ? ` · showed ${e.revealed.join('/')}` : ''}
          {e.overLevel?.length ? ` · ⚠ above level: ${e.overLevel.join('/')}` : ''}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingHorizontal: 8 },
  tab: { paddingVertical: 12, paddingHorizontal: 10 },
  tabActive: { borderBottomWidth: 2, borderColor: C.primary },
  tabText: { fontSize: 15, color: C.sub, fontWeight: '600' },
  tabTextActive: { color: C.primary },
  close: { marginLeft: 'auto', padding: 8 },
  closeText: { fontSize: 18, color: C.sub },
  scroll: { padding: 14, gap: 10, paddingBottom: 40 },
  empty: { padding: 20 },
  emptyText: { color: C.sub, fontSize: 15, lineHeight: 21 },
  staleBanner: { backgroundColor: C.partialSoft, color: C.partial, padding: 8, borderRadius: 8, fontWeight: '600' },
  questionCard: { backgroundColor: C.primarySoft, borderRadius: 12, padding: 12, gap: 4 },
  questionLabel: { fontSize: 12, fontWeight: '700', color: C.primary, textTransform: 'uppercase' },
  question: { fontSize: 17, lineHeight: 24, color: C.ink, fontWeight: '600' },
  countRow: { flexDirection: 'row', gap: 6 },
  count: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontWeight: '700', overflow: 'hidden' },
  chips: { gap: 6 },
  chip: { borderRadius: 8, padding: 8 },
  chipText: { fontWeight: '700', fontSize: 14 },
  chipMissing: { fontSize: 13, color: C.ink, marginTop: 2 },
  section: { gap: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  listItem: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12, color: C.faint },
  bubble: { borderRadius: 12, padding: 10, maxWidth: '92%' },
  userBubble: { backgroundColor: C.primary, alignSelf: 'flex-end' },
  botBubble: { backgroundColor: C.card, alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  inputRow: { padding: 10, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line, backgroundColor: C.card },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachText: { color: C.sub, fontSize: 13 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  problem: { backgroundColor: C.card, borderRadius: 10, padding: 10, gap: 4 },
  problemLabel: { fontWeight: '800', color: C.primary },
  problemText: { fontSize: 14, lineHeight: 20, color: C.ink },
  asks: { fontSize: 13, color: C.sub, fontStyle: 'italic' },
  disclosure: { backgroundColor: C.card, borderRadius: 10, padding: 12 },
  disclosureText: { fontSize: 14, lineHeight: 20, color: C.ink },
  logItem: { fontSize: 12, color: C.sub, fontFamily: 'Menlo' },
  cost: { fontSize: 12, color: C.sub, fontVariant: ['tabular-nums'], marginTop: 4 },
});
