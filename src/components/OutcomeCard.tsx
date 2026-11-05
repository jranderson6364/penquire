import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LineVerdict } from '../ai/types';
import { outcomeFall, outcomeRows, reviewDateText } from '../learning/independentFlow';
import type { Episode } from '../learning/types';
import { C, LABEL, R, T } from '../theme';

type Props = {
  ep: Episode;
  /** the check's lines on the submitted snapshot: used to say whether the fall came back, not listed */
  findings?: LineVerdict[];
};

/**
 * Two separate rows: the supported repair and the fresh problem. Never merged into one score, and no percentages,
 * "mastered" or "retained". The review line is a due date, not a delayed result.
 */
export function OutcomeCard({ ep, findings }: Props) {
  const rows = outcomeRows(ep);
  const tone = rows.fresh.label === 'passed_independent' ? C.valid : rows.fresh.label === 'needs_practice' ? C.partial : C.unknown;
  const fall = outcomeFall(ep, findings);
  const followUp = !!ep.followUpOf;
  const earlier = !followUp && rows.repair.verified ? `Earlier: ${rows.repair.text.charAt(0).toLowerCase()}${rows.repair.text.slice(1)}` : undefined;

  // result first, then what tripped you up, then the earlier repair and the review date as quiet lines
  return (
    <View style={styles.card} accessibilityLabel="Outcome">
      {ep.rehearsal && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Rehearsal — scripted responses</Text>
        </View>
      )}

      <View style={styles.row}>
        <Text style={styles.label}>{followUp ? 'Follow-up problem' : 'Fresh problem'}</Text>
        <Text style={[styles.result, { color: tone }]}>{rows.fresh.text}</Text>
        {rows.fresh.reasons.map((r, i) => (
          <Text key={i} style={styles.reason}>
            {r}
          </Text>
        ))}
      </View>

      {fall && (
        <View style={[styles.row, styles.divider]}>
          <Text style={styles.label}>What tripped you up</Text>
          <Text style={styles.fallText}>{fall.first}</Text>
          {!!fall.now && <Text style={styles.fallText}>{fall.now}</Text>}
        </View>
      )}

      {(earlier || ep.reviewDueAt !== undefined) && (
        <View style={[styles.row, styles.divider]}>
          {!!earlier && <Text style={styles.quiet}>{earlier}</Text>}
          {ep.reviewDueAt !== undefined && <Text style={styles.quiet}>Review scheduled for {reviewDateText(ep.reviewDueAt)}</Text>}
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
  result: { fontSize: T.title, fontWeight: '700', color: C.ink },
  quiet: { fontSize: T.body, color: C.sub, lineHeight: 21 },
  reason: { fontSize: T.body, color: C.sub, lineHeight: 21 },
  fallText: { fontSize: T.body, color: C.ink, lineHeight: 21 },
});
