import * as React from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { C } from '../theme';
import { latexToUnicode } from '../ui/mathText';

/**
 * Problem text with LaTeX shown as readable math. A [Figure: ...] placeholder is a MACHINE-written description of a
 * drawing (it can be wrong), so it is shown in its own style and labeled, never as if it were the printed text.
 */
export function MathText({ text, style, numberOfLines }: { text: string; style?: TextStyle; numberOfLines?: number }) {
  const segments = text.split(/(\[Figure:[^\]]*\])/g).filter((s) => s !== '');
  return (
    <Text style={[styles.base, style]} numberOfLines={numberOfLines}>
      {segments.map((seg, i) =>
        seg.startsWith('[Figure:') ? (
          <Text key={i} style={styles.figure}>
            {'  🖼 Figure (auto-described, may be imperfect): ' + latexToUnicode(seg.slice(8, -1).trim()) + '  '}
          </Text>
        ) : (
          <Text key={i}>{latexToUnicode(seg)}</Text>
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { fontSize: 15, lineHeight: 22, color: C.ink },
  figure: { fontStyle: 'italic', color: C.sub, backgroundColor: C.unknownSoft },
});
