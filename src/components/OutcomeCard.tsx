import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LineVerdict } from '../ai/types';
import { outcomeRows, reviewDateText } from '../learning/independentFlow';
import type { Episode } from '../learning/types';
import { C, LABEL, R, T, VERDICT_STYLE } from '../theme';

type Props = {
  ep: Episode;
  /** findings on the submitted snapshot (shown only after submission) */
  findings?: LineVerdict[];
};

/**
 * Two separate rows: the supported repair and the fresh problem. Never merged into one score, and no percentages,
 * "mastered" or "retained". The review line is a due date, not a delayed result.
 */
export function OutcomeCard({ ep, findings }: Props) {
  const rows = outcomeRows(ep);
  const tone = rows.fresh.label === 'passed_independent' ? C.valid : rows.fresh.label === 'needs_practice' ? C.partial : C.unknown;
  const shown = (findings ?? []).filter((l) => l.verdict !== 'context');

  return (
    <View style={styles.card} accessibilityLabel="Outcome">
      {ep.rehearsal && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Rehearsal — scripted responses</Text>
        </View>
      )}

      <View style={styles.row}>
        <Text style={styles.label}>Supported repair</Text>
        <Text style={[styles.value, { color: rows.repair.verified ? C.ink : C.sub }]}>{rows.repair.text}</Text>
      </View>

      <View style={[styles.row, styles.divider]}>
        <Text style={styles.label}>Fresh problem</Text>
        <Text style={[styles.value, { color: tone }]}>{rows.fresh.text}</Text>
        {rows.fresh.reasons.map((r, i) => (
          <Text key={i} style={styles.reason}>
            • {r}
          </Text>
        ))}
      </View>

      {shown.length > 0 && (
        <View style={[styles.row, styles.divider]}>
          <Text style={styles.label}>What the check read on your submitted page</Text>
          {shown.map((l) => {
            const v = l.verdict === 'context' ? undefined : VERDICT_STYLE[l.verdict];
            return (
              <View key={l.id} style={styles.finding}>
                <Text style={[styles.symbol, { color: v?.color ?? C.sub }]}>{v?.symbol ?? '·'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reading}>
                    {l.id}: {l.reading}
                  </Text>
                  {!!l.note && <Text style={styles.note}>{l.note}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {ep.reviewDueAt !== undefined && (
        <View style={[styles.row, styles.divider]}>
          <Text style={styles.value}>Review scheduled for {reviewDateText(ep.reviewDueAt)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.md, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: 16, gap: 12 },
  badge: { alignSelf: 'flex-start', backgroundColor: C.partialSoft, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: C.partial, fontWeight: '700', fontSize: T.small },
  row: { gap: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingTop: 12 },
  label: LABEL,
  value: { fontSize: T.lead, fontWeight: '700', color: C.ink },
  reason: { fontSize: T.body, color: C.sub, lineHeight: 21 },
  finding: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  symbol: { fontSize: T.body, fontWeight: '800', width: 16 },
  reading: { fontSize: T.body, color: C.ink },
  note: { fontSize: T.small, color: C.sub },
});
