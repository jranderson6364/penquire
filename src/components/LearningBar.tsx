import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Assistance, HelpMove, Phase } from '../learning/types';
import { MOVE_TITLE, phaseLabel, repairedAfter } from '../learning/workspaceFlow';
import { C, LABEL, R, S, SHADOW, T } from '../theme';
import { Button } from './Button';
import { helpUsed } from './episodeCardFormat';

// The pivot flow's page chrome (T14C). There is no always-visible strip any more: the help moves are in the top bar's
// Help menu, the status is in the ⓘ popover, and only two things float on the page when they matter: a denied move
// (one notice) and the verified-repair hand-off (one card).

/** Content of the ⓘ popover next to the title: phase, the feedback rule and the help record. */
export function PracticeStatus({ phase, assistance }: { phase: Phase; assistance: Assistance[] }) {
  const help = helpUsed(assistance);
  return (
    <View style={styles.status}>
      <Text style={LABEL}>Original demo practice</Text>
      <Text style={styles.phase}>{phaseLabel(phase)}</Text>
      {phase === 'repair_verified' && <Text style={styles.repaired}>{repairedAfter(assistance)}</Text>}
      <Text style={styles.line}>Feedback when you ask</Text>
      <Text style={styles.line}>{help.length ? `Help used: ${help.join(', ')}` : 'No help recorded yet'}</Text>
    </View>
  );
}

/** A help move the policy does not allow, with the strongest allowed one instead. Shown in the page's notice slot. */
export function DeniedNotice({ reason, alt, busy, onMove, onDismiss }: { reason: string; alt?: HelpMove; busy: boolean; onMove: (m: HelpMove) => void; onDismiss: () => void }) {
  return (
    <View style={styles.denied} accessibilityRole="alert">
      <Text style={styles.deniedText}>{reason}</Text>
      {alt && <Button small kind="primary" title={`${MOVE_TITLE[alt]} instead`} disabled={busy} onPress={() => onMove(alt)} />}
      <Button small kind="ghost" title="OK" onPress={onDismiss} />
    </View>
  );
}

/** The repair was verified: one compact card with the honest label ("Repaired after …") and the one next step. */
export function RepairCard({ repairedText, onFresh }: { repairedText: string; onFresh: () => void }) {
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.cardTitle}>{repairedText}</Text>
        <Text style={styles.cardSub}>See whether the idea carries over to a new problem</Text>
      </View>
      <Button small kind="primary" title="Try a fresh problem" onPress={onFresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  status: { padding: S.sm, gap: 4 },
  phase: { fontSize: T.lead, fontWeight: '700', color: C.ink, marginTop: 2 },
  repaired: { fontSize: T.small, fontWeight: '700', color: C.valid },
  line: { fontSize: T.small, color: C.sub },
  denied: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    flexWrap: 'wrap',
    maxWidth: 620,
    backgroundColor: C.card,
    borderRadius: R.lg,
    paddingLeft: S.lg,
    paddingRight: S.sm,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    ...SHADOW,
  },
  deniedText: { flexShrink: 1, fontSize: T.small, color: C.partial, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    maxWidth: 640,
    backgroundColor: C.card,
    borderRadius: R.lg,
    paddingLeft: S.lg,
    paddingRight: S.sm,
    paddingVertical: S.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.lineStrong,
    ...SHADOW,
  },
  cardTitle: { fontSize: T.body, fontWeight: '700', color: C.valid },
  cardSub: { fontSize: T.caption, color: C.sub },
  pillWrap: { borderRadius: R.sm, ...SHADOW },
});
