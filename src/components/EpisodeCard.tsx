import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { outcomeLabels } from '../learning/session';
import type { Episode } from '../learning/types';
import { C, F, LABEL, R, T } from '../theme';
import { OUTCOME_COPY, PHASE_COPY, helpUsed, reviewLine } from './episodeCardFormat';

/** Saved record of one demo episode: phase, earned labels (from outcomeLabels), help used and the review date. */
export function EpisodeCard({ episode, children }: { episode: Episode; children?: React.ReactNode }) {
  const labels = outcomeLabels(episode);
  const help = helpUsed(episode.assistance);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.label}>Practice record</Text>
        {episode.rehearsal && (
          <View style={styles.rehearsal} accessibilityLabel="Rehearsal: scripted run, not learner evidence">
            <Text style={styles.rehearsalText}>▶ Rehearsal · not learner evidence</Text>
          </View>
        )}
      </View>
      <Text style={styles.phase}>{PHASE_COPY[episode.phase]}</Text>
      {labels.length > 0 && (
        <View style={{ gap: 4 }}>
          {labels.map((l) => (
            <Text key={l} style={styles.outcome}>
              <Text style={styles.symbol}>{OUTCOME_COPY[l].symbol}</Text> {OUTCOME_COPY[l].text}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.meta}>{help.length ? `Help used: ${help.join(', ')}` : 'No help recorded yet'}</Text>
      <Text style={styles.meta}>{reviewLine(episode)}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // primary-tinted outline, unlike the plain assignment cards and their parts bar (logistics)
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 18, gap: 6, borderWidth: 1.5, borderColor: C.primary },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { ...LABEL },
  rehearsal: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.unknownSoft },
  rehearsalText: { fontSize: T.caption, fontWeight: '600', color: C.unknown },
  phase: { fontSize: T.lead, fontWeight: '600', color: C.ink },
  outcome: { fontSize: T.body, color: C.ink },
  symbol: { fontFamily: F.mono, fontWeight: '700' },
  meta: { fontSize: T.small, color: C.sub },
});
