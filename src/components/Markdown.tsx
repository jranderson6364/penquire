import * as React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { C } from '../theme';
import { latexToUnicode } from '../ui/mathText';

/** Minimal markdown: paragraphs, "- " bullets, **bold**, `code`. Enough for tutor feedback. */
type Tagging = { style: (tag: number) => TextStyle | undefined; onPress?: (tag: number) => void };

function inline(text: string, base: TextStyle, tagging?: Tagging) {
  // tutor replies name their marks as [[tag|words]]; without `tagging` the markup is dropped and only the words stay
  const plain = tagging ? text : text.replace(/\[\[\s*\d\s*\|([^\]]*)\]\]/g, '$1');
  const parts = plain.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[\s*\d\s*\|[^\]]*\]\])/g).filter(Boolean);
  return parts.map((p, i) => {
    const t = tagging ? /^\[\[\s*(\d)\s*\|([^\]]*)\]\]$/.exec(p) : null;
    if (t && tagging) {
      const tag = Number(t[1]);
      return (
        <Text key={i} style={[base, styles.tagged, tagging.style(tag)]} onPress={tagging.onPress ? () => tagging.onPress!(tag) : undefined} suppressHighlighting>
          {latexToUnicode(t[2])}
        </Text>
      );
    }
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

/** `tags` colors the [[n|words]] phrases a tutor reply uses to name its marks on the page; without it the markup is shown as plain words. */
export function Markdown({ text, style, tags }: { text: string; style?: TextStyle; tags?: Tagging }) {
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
              <Text style={[base, { flex: 1 }]}>{inline(content, base, tags)}</Text>
            </View>
          );
        }
        return (
          <Text key={i} style={[base, heading && styles.bold]}>
            {inline(content, heading ? { ...base, ...styles.bold } : base, tags)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 21, color: C.ink },
  bold: { fontWeight: '700' },
  tagged: { fontWeight: '600', borderRadius: 4, overflow: 'hidden' },
  code: { fontFamily: 'Menlo', fontSize: 13, backgroundColor: '#F1F3F5' },
  bulletRow: { flexDirection: 'row', gap: 6, marginVertical: 1 },
});
