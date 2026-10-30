import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HelpLevel } from '../ai/types';
import { clampMove } from '../learning/session';
import type { Assistance, EpisodePolicy, HelpMove, Phase } from '../learning/types';
import { C, R, S, T } from '../theme';
import { Button } from './Button';

// ---- pure helpers (no React; kept small so they can move to src/learning/ with tests) ----

/** docs/03 "Required learning states" */
export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'attempt':
      return 'Attempting';
    case 'repair':
      return 'Repairing with help';
    case 'repair_verified':
      return 'Repair verified';
    case 'independent':
      return 'Independent attempt';
    case 'independent_submitted':
      return 'Independent attempt submitted';
    case 'outcome':
      return 'Result recorded';
  }
}

/** The move a stored HelpLevel stands for (typed chat, voice): 0 check … 4 step. */
export function levelMove(level: HelpLevel): HelpMove {
  return (['check', 'pointer', 'explain', 'example', 'step'] as const)[level];
}

const STRONGEST_FIRST: HelpMove[] = ['step', 'example', 'explain', 'pointer', 'check'];

/** The strongest move below `move` that the policy allows (for a denied move), or undefined. */
export function fallbackMove(move: HelpMove, policy: EpisodePolicy): HelpMove | undefined {
  const from = STRONGEST_FIRST.indexOf(move === 'start' ? 'explain' : move === 'dispute' ? 'check' : move);
  return STRONGEST_FIRST.slice(from + 1).find((m) => 'level' in clampMove(m, policy));
}

const HELP_NAME: Record<HelpLevel, string> = { 0: 'a check', 1: 'a pointer', 2: 'an explanation', 3: 'an example', 4: 'a step' };

/** "Repaired after an explanation": the strongest help actually delivered in this episode. */
export function repairedAfter(assistance: Assistance[]): string {
  if (assistance.length === 0) return 'Repaired';
  const top = Math.max(...assistance.map((x) => x.level)) as HelpLevel;
  return `Repaired after ${HELP_NAME[top]}`;
}

export const MOVE_TITLE: Record<HelpMove, string> = {
  check: 'Check',
  pointer: 'Find the issue',
  explain: 'Explain the idea',
  example: 'Show another example',
  step: 'Show one step',
  start: 'Help me start',
  dispute: 'I think this is right',
};

// ---- the bar ------------------------------------------------------------------------------

type Props = {
  phase: Phase;
  repairedText?: string;
  busy: boolean;
  denied?: { reason: string; alt?: HelpMove };
  onMove: (m: HelpMove) => void;
  onDismissDenied: () => void;
  onFresh: () => void;
  insetLeft: number;
  insetRight: number;
};

/** Pivot-flow strip under the top bar: phase, demo tag, direct help moves, and the hand-off to a fresh problem. */
export function LearningBar({ phase, repairedText, busy, denied, onMove, onDismissDenied, onFresh, insetLeft, insetRight }: Props) {
  const [later, setLater] = React.useState(false);
  const verified = phase === 'repair_verified';
  const working = phase === 'attempt' || phase === 'repair' || verified;
  return (
    <View style={[styles.bar, { paddingLeft: S.md + insetLeft, paddingRight: S.md + insetRight }]}>
      <View style={styles.row}>
        <Text style={styles.phase}>{phaseLabel(phase)}</Text>
        <View style={styles.tag}>
          <Text style={styles.tagText}>Original demo practice</Text>
        </View>
        <Text style={styles.note}>Feedback when you ask</Text>
        {verified && repairedText ? <Text style={styles.repaired}>{repairedText}</Text> : null}
        <View style={{ flex: 1 }} />
        {working &&
          (['pointer', 'explain', 'example', 'start'] as const).map((m) => <Button key={m} small title={MOVE_TITLE[m]} disabled={busy} onPress={() => onMove(m)} />)}
      </View>
      {denied && (
        <View style={styles.row}>
          <Text style={styles.denied}>{denied.reason}</Text>
          {denied.alt && <Button small title={`${MOVE_TITLE[denied.alt]} instead`} disabled={busy} onPress={() => onMove(denied.alt!)} />}
          <Button small kind="ghost" title="OK" onPress={onDismissDenied} />
        </View>
      )}
      {verified &&
        (later ? (
          <View style={styles.row}>
            <View style={{ flex: 1 }} />
            <Button small title="Try a fresh problem" onPress={onFresh} />
          </View>
        ) : (
          <View style={[styles.row, styles.fresh]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.freshTitle}>Try a fresh problem</Text>
              <Text style={styles.freshSub}>See whether the idea carries over</Text>
            </View>
            <Button small kind="primary" title="Try a fresh problem" onPress={onFresh} />
            <Button small kind="ghost" title="Not now" onPress={() => setLater(true)} />
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingVertical: S.sm, gap: S.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' },
  phase: { fontSize: T.body, fontWeight: '800', color: C.ink },
  tag: { backgroundColor: C.bg, borderRadius: R.pill, paddingHorizontal: S.sm, paddingVertical: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  tagText: { fontSize: T.caption, fontWeight: '700', color: C.sub },
  note: { fontSize: T.caption, color: C.sub },
  repaired: { fontSize: T.small, fontWeight: '700', color: C.valid },
  denied: { flexShrink: 1, fontSize: T.small, color: C.partial },
  fresh: { backgroundColor: C.bg, borderRadius: R.md, padding: S.sm },
  freshTitle: { fontSize: T.body, fontWeight: '700', color: C.ink },
  freshSub: { fontSize: T.caption, color: C.sub },
});
