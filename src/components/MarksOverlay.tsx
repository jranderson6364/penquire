import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { LineVerdict, Verdict } from '../ai/types';
import type { MarkFeedback, Rating } from '../store/evalRecords';
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
  feedbackFor: (lineId: string) => MarkFeedback | undefined;
  onRate: (fb: Omit<MarkFeedback, 'checkId' | 'at'>) => void;
  onInputBlur?: () => void;
};

type Correction = 'wrong' | 'misread';
const CORRECT_VERDICTS: { v: Verdict; label: string }[] = [
  { v: 'valid', label: '✓ valid' },
  { v: 'partial', label: '~ partial' },
  { v: 'incorrect', label: '✗ incorrect' },
];

const MARK = 26;
const POPOVER_W = 300;
const POPOVER_H = 290;

/**
 * Margin marks (✓ ~ ✗ ?) drawn over the canvas. Only the marks themselves take touches
 * (pointerEvents="box-none"), so the Pencil keeps writing everywhere else.
 */
export function MarksOverlay({ width, height, lines, verdicts, stale, onAsk, feedbackFor, onRate, onInputBlur }: Props) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [correcting, setCorrecting] = React.useState<Correction | null>(null);
  const [reading, setReading] = React.useState('');
  React.useEffect(() => {
    setCorrecting(null);
    setReading('');
  }, [open]);
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
              top: active.y + MARK + 6 > height - POPOVER_H ? Math.max(8, active.y - POPOVER_H + MARK) : active.y + MARK + 6,
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
          <FeedbackRow
            verdict={active.v}
            saved={feedbackFor(active.v.id)}
            correcting={correcting}
            setCorrecting={setCorrecting}
            reading={reading}
            setReading={setReading}
            onRate={(fb) => {
              onRate({ lineId: active.v.id, ...fb });
              setCorrecting(null);
            }}
            onInputBlur={onInputBlur}
          />
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

type RowProps = {
  verdict: LineVerdict;
  saved?: MarkFeedback;
  correcting: Correction | null;
  setCorrecting: (c: Correction | null) => void;
  reading: string;
  setReading: (s: string) => void;
  onRate: (fb: { rating: Rating; correctVerdict?: Verdict; correctReading?: string }) => void;
  onInputBlur?: () => void;
};

/** Was this mark right? Wrong verdicts (esp. a false ✓) and misreadings are recorded separately. */
function FeedbackRow({ verdict, saved, correcting, setCorrecting, reading, setReading, onRate, onInputBlur }: RowProps) {
  const chip = (label: string, on: boolean, press: () => void) => (
    <Pressable key={label} onPress={press} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.fb}>
      <View style={styles.chips}>
        {chip('👍', saved?.rating === 'up', () => onRate({ rating: 'up' }))}
        {chip('👎', saved?.rating === 'down', () => onRate({ rating: 'down' }))}
        {chip('Mark is wrong', saved?.rating === 'wrong' || correcting === 'wrong', () => setCorrecting(correcting === 'wrong' ? null : 'wrong'))}
        {chip('Misread', saved?.rating === 'misread' || correcting === 'misread', () => setCorrecting(correcting === 'misread' ? null : 'misread'))}
      </View>
      {correcting === 'wrong' && (
        <View style={styles.chips}>
          <Text style={styles.fbLabel}>Should be:</Text>
          {CORRECT_VERDICTS.filter((c) => c.v !== verdict.verdict).map((c) =>
            chip(c.label, false, () => onRate({ rating: 'wrong', correctVerdict: c.v }))
          )}
        </View>
      )}
      {correcting === 'misread' && (
        <TextInput
          style={styles.fbInput}
          value={reading}
          onChangeText={setReading}
          placeholder="What does the line actually say?"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onBlur={onInputBlur}
          onSubmitEditing={() => reading.trim() && onRate({ rating: 'misread', correctReading: reading.trim() })}
        />
      )}
      {!!saved && !correcting && <Text style={styles.fbSaved}>Saved: {saved.rating}{saved.correctVerdict ? ` → ${saved.correctVerdict}` : ''}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fb: { gap: 6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, backgroundColor: C.bg },
  chipOn: { backgroundColor: C.primarySoft, borderColor: C.primary },
  chipText: { fontSize: 13, color: C.ink },
  chipTextOn: { color: C.primary, fontWeight: '700' },
  fbLabel: { fontSize: 12, color: C.sub },
  fbInput: { borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, backgroundColor: C.bg },
  fbSaved: { fontSize: 12, color: C.valid },
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
