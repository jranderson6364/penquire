import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { boxToScreen, type Viewport } from '../page';
import { C, R, T } from '../theme';
import { ring, toSegments, underline, wash, type Stroke } from '../tutor/handdrawn';
import { tagColor, type TutorMark } from '../tutor/marks';
import { latexToUnicode } from '../ui/mathText';
import { Icon } from './Icon';

type Props = {
  marks: TutorMark[];
  viewport: Viewport;
  /** marks of this chat turn are drawn bolder (the student tapped "show on page" or a colored phrase) */
  focusTurn?: number;
  /** with focusTurn: only this tag is emphasised (the phrase the student tapped) */
  focusTag?: number;
  onDismiss: (id: string) => void;
  onClear: () => void;
};

/**
 * The tutor's own layer, drawn to look like a person marked your paper: a marker pass over a stretch of work, a quick
 * loop around a term, a pen underline, a handwritten aside. Each mark has a color and the tutor's message uses the same
 * color for the words about it. Drawn above the ink, never part of the drawing; every touch goes through to the canvas
 * except a note (tap to dismiss) and the Clear button.
 */
export function TutorMarksLayer({ marks, viewport, focusTurn, focusTag, onDismiss, onClear }: Props) {
  if (marks.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {marks.map((m, i) => (
        <MarkView key={m.id} mark={m} index={i} viewport={viewport} emphasised={focusTurn === m.turn && (focusTag === undefined || focusTag === m.tag)} onDismiss={onDismiss} />
      ))}
      <Pressable onPress={onClear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear the tutor's marks from the page">
        <Icon name="close" size={12} color={C.sub} />
        <Text style={styles.clearText}>Clear marks</Text>
      </Pressable>
    </View>
  );
}

/** 0 -> 1 over `ms` after `delay`, in ~16 steps, so a stroke is drawn in rather than appearing. */
function useReveal(ms: number, delay: number): number {
  const [p, setP] = React.useState(0);
  React.useEffect(() => {
    let step = 0;
    const steps = 16;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        step++;
        setP(Math.min(1, step / steps));
        if (step >= steps && timer) clearInterval(timer);
      }, ms / steps);
    }, delay);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [ms, delay]);
  return p;
}

function MarkView({ mark, index, viewport, emphasised, onDismiss }: { mark: TutorMark; index: number; viewport: Viewport; emphasised: boolean; onDismiss: (id: string) => void }) {
  const progress = useReveal(mark.kind === 'highlight' ? 380 : mark.kind === 'note' ? 220 : 520, index * 260);
  const s = viewport.scale;
  const col = tagColor(mark.tag);
  const b = boxToScreen(mark.box, viewport);
  const thick = (emphasised ? 4.2 : 3) * Math.max(0.75, Math.min(1.4, s));

  const geometry = React.useMemo(() => {
    if (mark.kind === 'circle') return ring(b, mark.id, 7 * s);
    if (mark.kind === 'underline') return underline(b, mark.id);
    return undefined;
    // the box moves with pan and zoom, so the shape is rebuilt from the screen box each time
  }, [mark.kind, mark.id, b.x, b.y, b.w, b.h, s]);

  if (mark.kind === 'highlight') {
    const w = wash(b, mark.id);
    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: w.x,
          top: w.y,
          width: w.w * progress,
          height: w.h,
          backgroundColor: col.wash,
          borderTopLeftRadius: w.radius,
          borderBottomLeftRadius: w.radius,
          borderTopRightRadius: w.radiusRight,
          borderBottomRightRadius: w.radiusRight,
          transform: [{ rotate: `${w.rotateDeg}deg` }],
          borderWidth: emphasised ? 2 : 0,
          borderColor: col.pen,
        }}
      />
    );
  }

  if ((mark.kind === 'circle' || mark.kind === 'underline') && geometry) {
    return <HandStroke stroke={geometry} color={col.pen} thickness={thick} progress={progress} />;
  }

  // note: a handwritten aside to the right of the stretch (below it when there is no room)
  const text = mark.note ? latexToUnicode(mark.note) : '';
  const room = viewport.viewWidth - (b.x + b.w);
  const right = room > 170;
  const size = 17 * Math.max(0.85, Math.min(1.3, s));
  return (
    <View
      style={[styles.noteWrap, right ? { left: b.x + b.w + 10, top: b.y + b.h / 2 - size } : { left: Math.max(6, Math.min(b.x, viewport.viewWidth - 240)), top: b.y + b.h + 6 }, { opacity: progress }]}
    >
      <Pressable onPress={() => onDismiss(mark.id)} accessibilityRole="button" accessibilityLabel={`Tutor note: ${text}. Tap to dismiss.`}>
        <Text style={[styles.noteText, { color: col.pen, fontSize: size, lineHeight: size * 1.2 }, emphasised && styles.noteOn]}>{text}</Text>
      </Pressable>
    </View>
  );
}

/** A pen stroke drawn as a chain of short rounded segments, revealed up to `progress`. */
function HandStroke({ stroke, color, thickness, progress }: { stroke: Stroke; color: string; thickness: number; progress: number }) {
  const segs = React.useMemo(() => toSegments(stroke, thickness), [stroke, thickness]);
  const shown = Math.ceil(segs.length * progress);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {segs.slice(0, shown).map((g, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: g.cx - (g.len + g.th * 0.5) / 2,
            top: g.cy - g.th / 2,
            width: g.len + g.th * 0.5,
            height: g.th,
            borderRadius: g.th / 2,
            backgroundColor: color,
            transform: [{ rotate: `${g.angleDeg}deg` }],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  noteWrap: { position: 'absolute', maxWidth: 230, transform: [{ rotate: '-1.5deg' }] },
  noteText: { fontFamily: 'Bradley Hand', fontWeight: '700', textShadowColor: 'rgba(255,255,255,0.9)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  noteOn: { textDecorationLine: 'underline' },
  clear: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: C.line },
  clearText: { fontSize: T.caption, fontWeight: '600', color: C.sub },
});
