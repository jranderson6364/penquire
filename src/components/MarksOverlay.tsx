import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import { C, VERDICT_STYLE } from '../theme';
import { Button } from './Button';

type Props = {
  width: number;
  height: number;
  lines: Line[];
  verdicts: LineVerdict[];
  stale: boolean;
  onAsk: (v: LineVerdict) => void;
};

const MARK = 26;
const POPOVER_W = 300;

/**
 * Margin marks (✓ ~ ✗ ?) drawn over the canvas. Only the marks themselves take touches
 * (pointerEvents="box-none"), so the Pencil keeps writing everywhere else.
 */
export function MarksOverlay({ width, height, lines, verdicts, stale, onAsk }: Props) {
  const [open, setOpen] = React.useState<string | null>(null);
  const byId = React.useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  React.useEffect(() => setOpen(null), [verdicts]);

  const placed = verdicts
    .filter((v) => v.verdict !== 'context')
    .map((v) => {
      const line = byId.get(v.id);
      if (!line) return null;
      const x = Math.min(width - MARK - 6, line.x + line.w + 8);
      const y = Math.max(4, line.y + line.h / 2 - MARK / 2);
      return { v, line, x, y };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const active = placed.find((p) => p.v.id === open);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {placed.map(({ v, line, x, y }) => {
        const s = VERDICT_STYLE[v.verdict as keyof typeof VERDICT_STYLE];
        return (
          <React.Fragment key={v.id}>
            {open === v.id && (
              <View
                pointerEvents="none"
                style={[styles.highlight, { left: line.x - 4, top: line.y - 4, width: line.w + 8, height: line.h + 8, borderColor: s.color }]}
              />
            )}
            <Pressable
              hitSlop={8}
              onPress={() => setOpen(open === v.id ? null : v.id)}
              style={[styles.mark, { left: x, top: y, backgroundColor: s.bg, borderColor: s.color, opacity: stale ? 0.45 : 1 }]}
            >
              <Text style={[styles.markText, { color: s.color }]}>{s.symbol}</Text>
            </Pressable>
          </React.Fragment>
        );
      })}

      {active && (
        <View
          style={[
            styles.popover,
            {
              left: Math.max(8, Math.min(active.x - POPOVER_W + MARK, width - POPOVER_W - 8)),
              top: active.y + MARK + 6 > height - 180 ? Math.max(8, active.y - 170) : active.y + MARK + 6,
            },
          ]}
        >
          <Text style={styles.popTitle}>
            {active.v.id}
            {active.v.part ? ` · ${active.v.part}` : ''} ·{' '}
            <Text style={{ color: VERDICT_STYLE[active.v.verdict as keyof typeof VERDICT_STYLE].color }}>
              {VERDICT_STYLE[active.v.verdict as keyof typeof VERDICT_STYLE].label}
            </Text>
          </Text>
          {!!active.v.reading && (
            <Text style={styles.reading} numberOfLines={3}>
              read as: {active.v.reading}
            </Text>
          )}
          <Text style={styles.note}>{active.v.note}</Text>
          <View style={styles.popActions}>
            <Button small kind="ghost" title="Close" onPress={() => setOpen(null)} />
            <Button
              small
              kind="primary"
              title="Ask about this"
              onPress={() => {
                onAsk(active.v);
                setOpen(null);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    position: 'absolute',
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: 15, fontWeight: '800' },
  highlight: { position: 'absolute', borderWidth: 2, borderRadius: 6, borderStyle: 'dashed' },
  popover: {
    position: 'absolute',
    width: POPOVER_W,
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  popTitle: { fontSize: 13, fontWeight: '700', color: C.sub },
  reading: { fontFamily: 'Menlo', fontSize: 12, color: C.sub },
  note: { fontSize: 15, lineHeight: 21, color: C.ink },
  popActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
