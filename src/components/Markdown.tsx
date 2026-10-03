import * as React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { C } from '../theme';
import { latexToUnicode } from '../ui/mathText';

/** Minimal markdown: paragraphs, "- " bullets, **bold**, `code`. Enough for tutor feedback. */
function inline(text: string, base: TextStyle) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <Text key={i} style={[base, styles.bold]}>
          {p.slice(2, -2)}
        </Text>
      );
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <Text key={i} style={[base, styles.code]}>
          {p.slice(1, -1)}
        </Text>
      );
    }
    return (
      <Text key={i} style={base}>
        {latexToUnicode(p)}
      </Text>
    );
  });
}

export function Markdown({ text, style }: { text: string; style?: TextStyle }) {
  const base: TextStyle = { ...styles.text, ...style };
  const blocks = text.split('\n');
  return (
    <View>
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 6 }} />;
        const bullet = /^[-*•]\s+/.test(trimmed);
        const heading = /^#{1,4}\s+/.test(trimmed);
        const content = trimmed.replace(/^[-*•]\s+/, '').replace(/^#{1,4}\s+/, '');
        if (bullet) {
          return (
            <View key={i} style={styles.bulletRow}>
              <Text style={base}>•</Text>
              <Text style={[base, { flex: 1 }]}>{inline(content, base)}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[base, heading && styles.bold]}>
            {inline(content, heading ? { ...base, ...styles.bold } : base)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 21, color: C.ink },
  bold: { fontWeight: '700' },
  code: { fontFamily: 'Menlo', fontSize: 13, backgroundColor: '#F1F3F5' },
  bulletRow: { flexDirection: 'row', gap: 6, marginVertical: 1 },
});
