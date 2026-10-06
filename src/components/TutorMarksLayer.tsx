import * as React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { boxToScreen, type Viewport } from '../page';
import { C, R, T } from '../theme';
import type { TutorMark } from '../tutor/marks';
import { latexToUnicode } from '../ui/mathText';
import { Icon } from './Icon';

type Props = {
  marks: TutorMark[];
  viewport: Viewport;
  /** marks of this chat turn are drawn emphasised (the student tapped "show on page") */
  focusTurn?: number;
  onDismiss: (id: string) => void;
  onClear: () => void;
};

/**
 * The tutor's own layer: highlights, rings, underlines and short captions that point at lines of the student's work.
 * Drawn above the ink, never part of the drawing; every touch goes through to the canvas except a caption (tap to
 * dismiss it) and the Clear button.
 */
export function TutorMarksLayer({ marks, viewport, focusTurn, onDismiss, onClear }: Props) {
  if (marks.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {marks.map((m, i) => (
        <MarkView key={m.id} mark={m} index={i} viewport={viewport} emphasised={focusTurn === m.turn} onDismiss={onDismiss} />
      ))}
      <Pressable onPress={onClear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear the tutor's marks from the page">
        <Icon name="close" size={12} color={C.primary} />
        <Text style={styles.clearText}>Clear tutor marks</Text>
      </Pressable>
    </View>
  );
}

function MarkView({ mark, index, viewport, emphasised, onDismiss }: { mark: TutorMark; index: number; viewport: Viewport; emphasised: boolean; onDismiss: (id: string) => void }) {
  const fade = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 220, delay: index * 160, useNativeDriver: true }).start();
  }, [fade, index]);

  const s = viewport.scale;
  const pad = 6 * s;
  const b = boxToScreen(mark.box, viewport);
  const x = b.x - pad;
  const y = b.y - pad * 0.6;
  const w = b.w + pad * 2;
  const h = b.h + pad * 1.2;
  const weight = emphasised ? 4 : 2.5;

  if (mark.kind === 'highlight') {
    return <Animated.View pointerEvents="none" style={[styles.highlight, { left: x, top: y, width: w, height: h, opacity: fade, borderWidth: emphasised ? 2 : 0 }]} />;
  }
  if (mark.kind === 'circle') {
    return <Animated.View pointerEvents="none" style={[styles.ring, { left: x - pad, top: y - pad * 0.4, width: w + pad * 2, height: h + pad * 0.8, borderRadius: Math.min(w, h) / 1.6, borderWidth: weight, opacity: fade }]} />;
  }
  if (mark.kind === 'underline') {
    return <Animated.View pointerEvents="none" style={[styles.underline, { left: x, top: y + h - 1, width: w, height: weight + 0.5, opacity: fade }]} />;
  }
  // note: a caption to the right of the line (below it when there is no room)
  const room = viewport.viewWidth - (x + w);
  const right = room > 150;
  const text = mark.note ? latexToUnicode(mark.note) : '';
  return (
    <Animated.View
      style={[
        styles.noteWrap,
        right ? { left: x + w + 6, top: y + h / 2 - 16 } : { left: Math.max(6, Math.min(x, viewport.viewWidth - 236)), top: y + h + 4 },
        { opacity: fade },
      ]}
    >
      <Pressable onPress={() => onDismiss(mark.id)} accessibilityRole="button" accessibilityLabel={`Tutor note: ${text}. Tap to dismiss.`} style={[styles.note, emphasised && styles.noteOn]}>
        <Text style={styles.noteText}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

const TUTOR = C.primary;

const styles = StyleSheet.create({
  highlight: { position: 'absolute', backgroundColor: 'rgba(47,107,235,0.18)', borderRadius: 6, borderColor: TUTOR },
  ring: { position: 'absolute', borderColor: TUTOR },
  underline: { position: 'absolute', backgroundColor: TUTOR, borderRadius: 2 },
  noteWrap: { position: 'absolute', maxWidth: 230 },
  note: { backgroundColor: C.card, borderColor: TUTOR, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 6 },
  noteOn: { backgroundColor: C.primarySoft, borderWidth: 2.5 },
  noteText: { fontSize: T.small, lineHeight: 18, color: C.ink, fontWeight: '500' },
  clear: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: C.card, borderWidth: 1, borderColor: C.primary },
  clearText: { fontSize: T.caption + 1, fontWeight: '600', color: C.primary },
});
