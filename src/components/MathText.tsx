import * as React from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { C, PAPER } from '../theme';
import { latexToUnicode } from '../ui/mathText';

/**
 * Problem text with LaTeX shown as readable math. A [Figure: ...] placeholder is a MACHINE-written description of a
 * drawing (it can be wrong), so it is shown in its own style and labeled, never as if it were the printed text.
 */
/** onPaper: drawn on the white page (question blocks), so it keeps paper colors in dark mode. */
export function MathText({ text, style, numberOfLines, onPaper }: { text: string; style?: TextStyle; numberOfLines?: number; onPaper?: boolean }) {
  const segments = text.split(/(\[Figure:[^\]]*\])/g).filter((s) => s !== '');
  return (
    <Text style={[styles.base, onPaper && styles.paper, style]} numberOfLines={numberOfLines}>
      {segments.map((seg, i) =>
        seg.startsWith('[Figure:') ? (
          <Text key={i} style={[styles.figure, onPaper && styles.paperFigure]}>
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
  paper: { color: PAPER.ink },
  paperFigure: { color: PAPER.sub, backgroundColor: PAPER.figure },
});
