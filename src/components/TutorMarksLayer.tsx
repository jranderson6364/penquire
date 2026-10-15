import * as React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Mask, Path } from 'react-native-svg';

import { nativeApiVersion } from '../../modules/pencil-canvas';
import { boxToLayer, PAGE_WIDTH } from '../page';
import { C, PAGE_TYPE, R, T } from '../theme';
import { centerPath, outlinePath, ring, toSegments, underline, wash, type Stroke } from '../tutor/handdrawn';
import { tagColor, type TutorMark } from '../tutor/marks';
import { latexToUnicode } from '../ui/mathText';
import { Icon } from './Icon';

/** react-native-svg ships in native build 3+; an older binary has no SVG views, so it gets the segment renderer. */
const SVG = nativeApiVersion >= 3;
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  marks: TutorMark[];
  /** settled zoom: marks are laid out in layer units (page * k) inside PageLayer */
  k: number;
  /** marks of this chat turn are drawn bolder (the student tapped "show on page" or a colored phrase) */
  focusTurn?: number;
  /** with focusTurn: only this tag is emphasised (the phrase the student tapped) */
  focusTag?: number;
  onDismiss: (id: string) => void;
};

/**
 * The tutor's own layer, drawn to look like a person marked your paper: a marker pass over a stretch of work, a quick
 * loop around a term, a pen underline, a handwritten aside. Each mark has a color and the tutor's message uses the same
 * color for the words about it. Lives inside PageLayer, so it moves with the page as one piece. Every touch goes
 * through to the canvas except a note (tap to dismiss).
 *
 * Timing follows Manim's Write: each mark draws on with ease-in-out, the next one starts a fraction later
 * (lag ratio min(4/n, 0.2) of the total), so a turn's marks arrive as one gesture, not one after another.
 */
export function TutorMarksLayer({ marks, k, focusTurn, focusTag, onDismiss }: Props) {
  if (marks.length === 0) return null;
  const lag = Math.min(4 / marks.length, 0.2) * 900;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {marks.map((m, i) => (
        <MarkView key={m.id} mark={m} delay={i * lag} k={k} emphasised={focusTurn === m.turn && (focusTag === undefined || focusTag === m.tag)} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

/** "Clear marks", in screen space (top-right of the page view), outside the moving layer. */
export function ClearMarksButton({ onClear }: { onClear: () => void }) {
  return (
    <Pressable onPress={onClear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear the tutor's marks from the page">
      <Icon name="close" size={12} color={C.sub} />
      <Text style={styles.clearText}>Clear marks</Text>
    </Pressable>
  );
}

/** A mark draws on once, the first time it appears (0 -> 1), with ease-in-out. */
function useDrawOn(ms: number, delay: number): Animated.Value {
  const p = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const anim = Animated.timing(p, { toValue: 1, duration: ms, delay, easing: Easing.inOut(Easing.cubic), useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [p, ms, delay]);
  return p;
}

function MarkView({ mark, delay, k, emphasised, onDismiss }: { mark: TutorMark; delay: number; k: number; emphasised: boolean; onDismiss: (id: string) => void }) {
  const progress = useDrawOn(mark.kind === 'highlight' ? 420 : mark.kind === 'note' ? 360 : 620, delay);
  const col = tagColor(mark.tag);
  const b = boxToLayer(mark.box, k);
  const thick = (emphasised ? 4.4 : 3.2) * Math.max(0.75, Math.min(1.4, k));

  const geometry = React.useMemo(() => {
    if (mark.kind === 'circle') return ring(b, mark.id, 7 * k);
    if (mark.kind === 'underline') return underline(b, mark.id);
    return undefined;
  }, [mark.kind, mark.id, b.x, b.y, b.w, b.h, k]);

  if (mark.kind === 'highlight') {
    const w = wash(b, mark.id);
    return (
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: w.x,
          top: w.y,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: [0, w.w] }),
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
    return SVG ? (
      <InkStroke id={mark.id} stroke={geometry} color={col.pen} thickness={thick} progress={progress} />
    ) : (
      <SegmentStroke stroke={geometry} color={col.pen} thickness={thick} progress={progress} />
    );
  }

  // note: a handwritten aside to the right of the stretch (below it when the page edge is too close)
  const text = mark.note ? latexToUnicode(mark.note) : '';
  const room = PAGE_WIDTH * k - (b.x + b.w);
  const right = room > 170 * k;
  // page units, like the placed questions: the note reads at the same size as the rest of the page at any zoom
  const size = PAGE_TYPE.note * k;
  return (
    <Animated.View
      style={[styles.noteWrap, { maxWidth: 230 * k }, right ? { left: b.x + b.w + 10 * k, top: b.y + b.h / 2 - size } : { left: Math.max(6 * k, Math.min(b.x, PAGE_WIDTH * k - 240 * k)), top: b.y + b.h + 6 * k }, { opacity: progress }]}
    >
      <Pressable onPress={() => onDismiss(mark.id)} accessibilityRole="button" accessibilityLabel={`Tutor note: ${text}. Tap to dismiss.`}>
        <Text style={[styles.noteText, { color: col.pen, fontSize: size, lineHeight: size * 1.2 }, emphasised && styles.noteOn]}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A pen stroke as one pressure-shaped filled outline (continuous, tapered, round caps), revealed along the pen's own
 * path: a mask stroked along the centerline whose dash grows from 0 to the full length. No beads, no re-render per frame.
 */
function InkStroke({ id, stroke, color, thickness, progress }: { id: string; stroke: Stroke; color: string; thickness: number; progress: Animated.Value }) {
  const shape = React.useMemo(() => outlinePath(stroke, thickness), [stroke, thickness]);
  const pen = React.useMemo(() => centerPath(stroke), [stroke]);
  const len = Math.max(1, pen.length);
  const maskId = `m_${id.replace(/[^A-Za-z0-9_]/g, '')}`;
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <Mask id={maskId} maskUnits="userSpaceOnUse">
          <AnimatedPath
            d={pen.d}
            stroke="#fff"
            strokeWidth={thickness * 3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={`${len} ${len}`}
            strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [len, 0] })}
          />
        </Mask>
      </Defs>
      <Path d={shape} fill={color} mask={`url(#${maskId})`} />
    </Svg>
  );
}

/** Older binaries (no SVG): the stroke as a chain of short rounded segments, revealed up to `progress`. */
function SegmentStroke({ stroke, color, thickness, progress }: { stroke: Stroke; color: string; thickness: number; progress: Animated.Value }) {
  const segs = React.useMemo(() => toSegments(stroke, thickness), [stroke, thickness]);
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const id = progress.addListener(({ value }) => setShown(Math.ceil(segs.length * value)));
    return () => progress.removeListener(id);
  }, [progress, segs.length]);
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
  noteWrap: { position: 'absolute', transform: [{ rotate: '-1.5deg' }] },
  noteText: { fontFamily: 'Bradley Hand', fontWeight: '700', textShadowColor: 'rgba(255,255,255,0.9)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  noteOn: { textDecorationLine: 'underline' },
  clear: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: R.pill, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  clearText: { fontSize: T.caption, fontWeight: '600', color: C.sub },
});
