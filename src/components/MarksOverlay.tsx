import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { LineVerdict, Verdict } from '../ai/types';
import type { MarkFeedback, Rating } from '../store/evalRecords';
import type { Line } from '../ink/lines';
import { placeMarks } from '../check/placeMarks';
import { C, VERDICT_STYLE } from '../theme';
import { latexToUnicode } from '../ui/mathText';
import { Button } from './Button';

type Props = {
  width: number;
  height: number;
  lines: Line[];
  verdicts: LineVerdict[];
  stale: boolean;
  onAsk: (v: LineVerdict) => void;
  /** raise the hint rung for this issue and ask again */
  onMoreHelp: (v: LineVerdict) => void;
  /** "I think this is right": the tutor re-checks the line against the page */
  onDispute: (v: LineVerdict) => void;
  /** the same issue was still flagged on a later check (time to change the kind of help) */
  repeats: (v: LineVerdict) => boolean;
  /** label of the rung currently in force for this issue, e.g. "Nudge" */
  rungName: (v: LineVerdict) => string;
  feedbackFor: (lineId: string) => MarkFeedback | undefined;
  onRate: (fb: Omit<MarkFeedback, 'checkId' | 'at'>) => void;
  /** the student says what this (unchanged) line reads: the next check grades it as written */
  onConfirmReading?: (v: LineVerdict, reading: string) => void;
  onInputBlur?: () => void;
};

type Correction = 'wrong' | 'misread';
const CORRECT_VERDICTS: { v: Verdict; label: string }[] = [
  { v: 'valid', label: '✓ valid' },
  { v: 'partial', label: '~ partial' },
  { v: 'incorrect', label: '✗ incorrect' },
];

const MARK = 26;
const MARK_OK = 20; // a check that holds up is quieter than one that needs attention
const POPOVER_W = 300;
const POPOVER_H = 340;

/**
 * Margin marks (✓ ~ ✗ ?) drawn over the canvas. Only the marks themselves take touches
 * (pointerEvents="box-none"), so the Pencil keeps writing everywhere else.
 */
export function MarksOverlay({ width, height, lines, verdicts, stale, onAsk, onMoreHelp, onDispute, repeats, feedbackFor, onRate, onConfirmReading, onInputBlur }: Props) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [correcting, setCorrecting] = React.useState<Correction | null>(null);
  const [reading, setReading] = React.useState('');
  const [offOpen, setOffOpen] = React.useState(false);
  React.useEffect(() => {
    setCorrecting(null);
    setReading('');
    setOffOpen(false);
  }, [open]);
  const byId = React.useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  React.useEffect(() => setOpen(null), [verdicts]);

  const visible = verdicts
    .filter((v) => v.verdict !== 'context')
    .map((v) => ({ v, line: byId.get(v.id) }))
    .filter((p): p is { v: LineVerdict; line: Line } => !!p.line)
    // zoomed or panned away: no mark for a line that is outside the view
    .filter((p) => p.line.x + p.line.w > 0 && p.line.x < width && p.line.y + p.line.h > 0 && p.line.y < height);
  const sizeOf = (v: LineVerdict) => (v.verdict === 'valid' ? MARK_OK : MARK);
  const spots = placeMarks(
    visible.map(({ v, line }) => ({ id: v.id, box: line, size: sizeOf(v), priority: v.verdict !== 'valid' })),
    width,
    height
  );
  const spotOf = new Map(spots.map((p) => [p.id, p]));
  const placed = visible.map(({ v, line }) => ({ v, line, x: spotOf.get(v.id)!.x, y: spotOf.get(v.id)!.y, size: sizeOf(v) }));

  const active = placed.find((p) => p.v.id === open);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {placed.map(({ v, line, x, y, size }) => {
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
              style={[styles.mark, { left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: s.bg, borderColor: s.color, opacity: stale ? 0.45 : 1 }]}
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
              left: Math.max(8, Math.min(active.x - POPOVER_W + active.size, width - POPOVER_W - 8)),
              top: active.y + active.size + 6 > height - POPOVER_H ? Math.max(8, active.y - POPOVER_H + active.size) : active.y + active.size + 6,
            },
          ]}
        >
          <View style={styles.popHead}>
            <Text style={styles.popTitle}>
              {active.v.part ? `${active.v.part} · ` : ''}
              <Text style={{ color: VERDICT_STYLE[active.v.verdict as keyof typeof VERDICT_STYLE].color }}>
                {VERDICT_STYLE[active.v.verdict as keyof typeof VERDICT_STYLE].label}
              </Text>
            </Text>
            <Pressable hitSlop={12} onPress={() => setOpen(null)} accessibilityLabel="Close" style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.note}>{latexToUnicode(active.v.note)}</Text>
          {active.v.verdict !== 'valid' && repeats(active.v) && (
            <Text style={styles.repeat}>Still flagged after another check. Help me see it gives a different kind of hint.</Text>
          )}
          <Evidence v={active.v} />

          {offOpen ? (
            <SomethingOff
              verdict={active.v}
              saved={feedbackFor(active.v.id)}
              correcting={correcting}
              setCorrecting={setCorrecting}
              reading={reading}
              setReading={setReading}
              onRate={(fb) => {
                onRate({ lineId: active.v.id, ...fb });
                if (fb.rating === 'misread' && fb.correctReading) onConfirmReading?.(active.v, fb.correctReading);
                setCorrecting(null);
                setOffOpen(false);
              }}
              onInputBlur={onInputBlur}
            />
          ) : (
            <View style={styles.popActions}>
              {(active.v.verdict === 'incorrect' || active.v.verdict === 'partial') && (
                <>
                  <Button
                    small
                    kind="primary"
                    title="Help me see it"
                    onPress={() => {
                      onMoreHelp(active.v);
                      setOpen(null);
                    }}
                  />
                  <Button
                    small
                    title="I think this is right"
                    onPress={() => {
                      onDispute(active.v);
                      setOpen(null);
                    }}
                  />
                </>
              )}
              {active.v.verdict === 'unreadable' && active.v.guard === 'reading' && !!active.v.reading && !!onConfirmReading && (
                <Button
                  small
                  kind="primary"
                  title="Yes, that's what I wrote"
                  onPress={() => {
                    onConfirmReading(active.v, active.v.reading);
                    setOpen(null);
                  }}
                />
              )}
              {active.v.verdict === 'unreadable' && (
                <Button
                  small
                  kind={active.v.guard === 'reading' ? 'secondary' : 'primary'}
                  title="That's not what I wrote"
                  onPress={() => {
                    setCorrecting('misread');
                    setOffOpen(true);
                  }}
                />
              )}
              {(active.v.verdict === 'valid' || active.v.verdict === 'unreadable') && (
                <Button
                  small
                  title="Ask about this"
                  onPress={() => {
                    onAsk(active.v);
                    setOpen(null);
                  }}
                />
              )}
            </View>
          )}
          {!offOpen && (
            <Pressable onPress={() => setOffOpen(true)} hitSlop={8} style={styles.offLink} accessibilityLabel="Something is off with this mark: it is wrong or I was misread">
              <Text style={styles.offLinkText}>{feedbackFor(active.v.id) ? 'Feedback saved · change' : "Something's off?"}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Why the mark is what it is: what the tutor read, and which deterministic check (if any) set it. Quiet, never shouty. */
function Evidence({ v }: { v: LineVerdict }) {
  if (!v.reading && !v.guard) return null;
  const unsure = v.uncertain && v.reading.includes(v.uncertain) ? v.uncertain : '';
  const [before, after] = unsure ? [v.reading.slice(0, v.reading.indexOf(unsure)), v.reading.slice(v.reading.indexOf(unsure) + unsure.length)] : [v.reading, ''];
  const source = v.guard === 'algebra' ? 'Flagged by the algebra check, not only the tutor.' : v.guard === 'reading' ? 'Not marked: the tutor wasn’t sure it read this right.' : '';
  return (
    <View style={styles.evidence}>
      {!!v.reading && (
        <Text style={styles.reading} numberOfLines={3}>
          <Text style={styles.readLabel}>Read as </Text>
          {latexToUnicode(before)}
          {!!unsure && <Text style={styles.unsure}>{latexToUnicode(unsure)}</Text>}
          {!!unsure && latexToUnicode(after)}
        </Text>
      )}
      {!!source && <Text style={styles.source}>{source}</Text>}
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

/** "Something's off": the mark is wrong (a false ✓ matters most) or the line was misread. Saved as eval data. */
function SomethingOff({ verdict, saved, correcting, setCorrecting, reading, setReading, onRate, onInputBlur }: RowProps) {
  const chip = (label: string, on: boolean, press: () => void) => (
    <Pressable key={label} onPress={press} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.fb}>
      <View style={styles.chips}>
        {chip('The mark is wrong', saved?.rating === 'wrong' || correcting === 'wrong', () => setCorrecting(correcting === 'wrong' ? null : 'wrong'))}
        {chip('It misread me', saved?.rating === 'misread' || correcting === 'misread', () => setCorrecting(correcting === 'misread' ? null : 'misread'))}
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
          autoFocus
          returnKeyType="done"
          onBlur={onInputBlur}
          onSubmitEditing={() => reading.trim() && onRate({ rating: 'misread', correctReading: reading.trim() })}
        />
      )}
      {!!saved && !correcting && <Text style={styles.fbSaved}>Saved: {saved.rating}{saved.correctVerdict ? ` → ${saved.correctVerdict}` : ''}. Thanks, this improves the checker.</Text>}
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
  popHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  popTitle: { fontSize: 13, fontWeight: '700', color: C.sub },
  close: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, color: C.faint },
  note: { fontSize: 15, lineHeight: 21, color: C.ink },
  repeat: { fontSize: 13, lineHeight: 18, color: C.partial, fontWeight: '600' },
  evidence: { gap: 2, paddingTop: 2 },
  reading: { fontFamily: 'Menlo', fontSize: 12, color: C.sub },
  readLabel: { fontFamily: undefined, color: C.faint },
  unsure: { color: C.partial, fontWeight: '700', textDecorationLine: 'underline' },
  source: { fontSize: 12, color: C.faint },
  popActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  offLink: { alignSelf: 'flex-end', paddingTop: 2 },
  offLinkText: { fontSize: 12, color: C.faint },
});
