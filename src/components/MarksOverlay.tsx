import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { LineVerdict, PartStatus, Verdict } from '../ai/types';
import type { MarkFeedback, Rating } from '../store/evalRecords';
import type { Line } from '../ink/lines';
import Svg, { Path } from 'react-native-svg';

import { nativeApiVersion } from '../../modules/pencil-canvas';
import { placeMarks } from '../check/placeMarks';
import { marksToShow } from '../check/verdictMarks';
import { outlinePath, verdictStrokes } from '../tutor/handdrawn';
import { C, PAPER_VERDICT, VERDICT_STYLE } from '../theme';
import { latexToUnicode } from '../ui/mathText';
import { Button } from './Button';

type Props = {
  /** layer size (page * settled zoom): the marks live inside PageLayer and move with the page */
  width: number;
  height: number;
  /** the on-screen part of the layer, so the popover opens where it can be read */
  visible: { x: number; y: number; w: number; h: number };
  /** line boxes in layer units */
  lines: Line[];
  verdicts: LineVerdict[];
  /** part statuses of the check: a ✓ goes only on the answer line of a complete part */
  parts: PartStatus[];
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
  /**
   * Controlled open mark (optional). With popoverOutside the overlay draws only the marks and the dashed outline; the
   * caller shows MarkPopover in screen space, so it keeps its size at any zoom and can be dragged.
   */
  open?: string | null;
  onOpenChange?: (id: string | null) => void;
  popoverOutside?: boolean;
  /** demo: a pared-down popover (MarkPopover minimal) */
  minimal?: boolean;
};

export type MarkPopoverProps = Pick<Props, 'onAsk' | 'onMoreHelp' | 'onDispute' | 'repeats' | 'feedbackFor' | 'onRate' | 'onConfirmReading' | 'onInputBlur' | 'minimal'> & {
  v: LineVerdict;
  onClose: () => void;
};

type Correction = 'wrong' | 'misread';
const CORRECT_VERDICTS: { v: Verdict; label: string }[] = [
  { v: 'valid', label: '✓ valid' },
  { v: 'partial', label: '~ partial' },
  { v: 'incorrect', label: '✗ incorrect' },
];

/** react-native-svg is in native build 3+: pen-drawn marks; before that, the symbol-in-a-circle marks. */
const PEN_MARKS = nativeApiVersion >= 3;

const MARK = 26;
const MARK_OK = 20; // a check that holds up is quieter than one that needs attention
export const POPOVER_W = 300;
export const POPOVER_H = 340;

/**
 * Margin marks (✓ ~ ✗ ?) drawn over the canvas. Only the marks themselves take touches
 * (pointerEvents="box-none"), so the Pencil keeps writing everywhere else.
 */
export function MarksOverlay(props: Props) {
  const { width, height, visible: view, lines, verdicts, parts, stale, open: openProp, onOpenChange, popoverOutside } = props;
  const [openState, setOpenState] = React.useState<string | null>(null);
  const open = openProp !== undefined ? openProp : openState;
  const changeRef = React.useRef(onOpenChange);
  changeRef.current = onOpenChange;
  const setOpen = React.useCallback((id: string | null) => {
    setOpenState(id);
    changeRef.current?.(id);
  }, []);
  const byId = React.useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  React.useEffect(() => setOpen(null), [verdicts, setOpen]);

  // mark like a teacher: tick the answer, mark what needs attention, leave the rest alone (src/check/verdictMarks.ts)
  const visible = marksToShow(verdicts, parts)
    .map((v) => ({ v, line: byId.get(v.id) }))
    .filter((p): p is { v: LineVerdict; line: Line } => !!p.line);
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
        // the circle sits on white paper in both modes; the popover below follows the theme
        const s = PAPER_VERDICT[v.verdict as keyof typeof PAPER_VERDICT];
        return (
          <React.Fragment key={v.id}>
            {open === v.id && (
              <View
                pointerEvents="none"
                style={[styles.highlight, { left: line.x - 4, top: line.y - 4, width: line.w + 8, height: line.h + 8, borderColor: s.color }]}
              />
            )}
            {PEN_MARKS ? (
              // a teacher's pen mark on the paper (tick, cross, squiggle, ?); the touch target stays a comfortable size
              <Pressable
                hitSlop={10}
                onPress={() => setOpen(open === v.id ? null : v.id)}
                accessibilityRole="button"
                accessibilityLabel={`${v.id}: ${s.label}. Show details`}
                style={[styles.penMark, { left: x - 4, top: y - 4, width: size + 8, height: size + 8, opacity: stale ? 0.45 : 1 }]}
              >
                <PenMark verdict={v.verdict} id={v.id} size={size + 8} color={s.color} />
              </Pressable>
            ) : (
              <Pressable
                hitSlop={8}
                onPress={() => setOpen(open === v.id ? null : v.id)}
                style={[styles.mark, { left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: s.bg, borderColor: s.color, opacity: stale ? 0.45 : 1 }]}
              >
                <Text style={[styles.markText, { color: s.color }]}>{s.symbol}</Text>
              </Pressable>
            )}
          </React.Fragment>
        );
      })}

      {active && !popoverOutside && (
        <View
          style={[
            styles.popover,
            {
              left: Math.max(view.x + 8, Math.min(active.x - POPOVER_W + active.size, view.x + view.w - POPOVER_W - 8)),
              top: active.y + active.size + 6 > view.y + view.h - POPOVER_H ? Math.max(view.y + 8, active.y - POPOVER_H + active.size) : active.y + active.size + 6,
            },
          ]}
        >
          <MarkPopover key={active.v.id} {...props} v={active.v} onClose={() => setOpen(null)} />
        </View>
      )}
    </View>
  );
}

/** What a mark means and what can be done about it. Used inside the overlay, or in screen space (FloatingCard). */
export function MarkPopover({ v, onClose, onAsk, onMoreHelp, onDispute, repeats, feedbackFor, onRate, onConfirmReading, onInputBlur, minimal }: MarkPopoverProps) {
  const [correcting, setCorrecting] = React.useState<Correction | null>(null);
  const [reading, setReading] = React.useState('');
  const [offOpen, setOffOpen] = React.useState(false);
  return (
    <>
      <View style={styles.popHead}>
        <Text style={styles.popTitle}>
          {v.part ? `${v.part} · ` : ''}
          <Text style={{ color: VERDICT_STYLE[v.verdict as keyof typeof VERDICT_STYLE].color }}>
            {VERDICT_STYLE[v.verdict as keyof typeof VERDICT_STYLE].label}
          </Text>
        </Text>
        <Pressable hitSlop={12} onPress={() => onClose()} accessibilityLabel="Close" style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>{latexToUnicode(v.note)}</Text>
      {v.verdict !== 'valid' && repeats(v) && (
        <Text style={styles.repeat}>{minimal ? 'Still flagged after another check.' : 'Still flagged after another check. Help me see it gives a different kind of hint.'}</Text>
      )}
      <Evidence v={v} />

      {offOpen ? (
        <SomethingOff
          verdict={v}
          saved={feedbackFor(v.id)}
          correcting={correcting}
          setCorrecting={setCorrecting}
          reading={reading}
          setReading={setReading}
          onRate={(fb) => {
            onRate({ lineId: v.id, ...fb });
            if (fb.rating === 'misread' && fb.correctReading) onConfirmReading?.(v, fb.correctReading);
            setCorrecting(null);
            setOffOpen(false);
          }}
          onInputBlur={onInputBlur}
        />
      ) : (
        <View style={styles.popActions}>
          {(v.verdict === 'incorrect' || v.verdict === 'partial') && (
            <>
              {!minimal && <Button
                small
                kind="primary"
                title="Help me see it"
                onPress={() => {
                  onMoreHelp(v);
                  onClose();
                }}
              />}
              <Button
                small
                title="I think this is right"
                onPress={() => {
                  onDispute(v);
                  onClose();
                }}
              />
            </>
          )}
          {v.verdict === 'unreadable' && v.guard === 'reading' && !!v.reading && !!onConfirmReading && (
            <Button
              small
              kind="primary"
              title="Yes, that's what I wrote"
              onPress={() => {
                onConfirmReading(v, v.reading);
                onClose();
              }}
            />
          )}
          {v.verdict === 'unreadable' && (
            <Button
              small
              kind={v.guard === 'reading' ? 'secondary' : 'primary'}
              title="That's not what I wrote"
              onPress={() => {
                setCorrecting('misread');
                setOffOpen(true);
              }}
            />
          )}
          {(v.verdict === 'valid' || v.verdict === 'unreadable') && (
            <Button
              small
              title="Ask about this"
              onPress={() => {
                onAsk(v);
                onClose();
              }}
            />
          )}
        </View>
      )}
      {!offOpen && !minimal && (
        <Pressable onPress={() => setOffOpen(true)} hitSlop={8} style={styles.offLink} accessibilityLabel="Something is off with this mark: it is wrong or I was misread">
          <Text style={styles.offLinkText}>{feedbackFor(v.id) ? 'Feedback saved · change' : "Something's off?"}</Text>
        </Pressable>
      )}
    </>
  );
}

/** The card a MarkPopover sits on when it is shown outside the overlay. */
export function MarkPopoverCard({ children }: { children: React.ReactNode }) {
  return <View style={[styles.popover, styles.popoverFloating]}>{children}</View>;
}

/** A verdict drawn with a pen: pressure-shaped strokes (SVG), or a handwritten "?" for a line it couldn't read. */
function PenMark({ verdict, id, size, color }: { verdict: LineVerdict['verdict']; id: string; size: number; color: string }) {
  const strokes = React.useMemo(
    () => (verdict === 'valid' || verdict === 'incorrect' || verdict === 'partial' ? verdictStrokes(verdict, { x: size * 0.15, y: size * 0.15, w: size * 0.7, h: size * 0.7 }, id) : []),
    [verdict, id, size]
  );
  if (verdict === 'unreadable') return <Text style={[styles.penQuestion, { color, fontSize: size * 0.8, lineHeight: size }]}>?</Text>;
  return (
    <Svg width={size} height={size} pointerEvents="none">
      {strokes.map((st, i) => (
        <Path key={i} d={outlinePath(st, size * 0.11)} fill={color} />
      ))}
    </Svg>
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
        <TextInput placeholderTextColor={C.faint}
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
  fbInput: { color: C.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, backgroundColor: C.bg },
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
  penMark: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  penQuestion: { fontFamily: 'Bradley Hand', fontWeight: '700', textAlign: 'center' },
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
  popoverFloating: { position: 'relative' },
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
