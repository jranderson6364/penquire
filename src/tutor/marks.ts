/**
 * Tutor marks: what the tutor draws on its own layer above the page (highlight, circle, underline, note), and the
 * colored phrases in its message that name each mark.
 *
 * Principle: the model never outputs coordinates. It names a gutter line ID and, to be specific, which stretch of that
 * line (fractions of its width). Code snaps the stretch to whole handwriting chunks and stores the box in PAGE space,
 * so a mark keeps its place when line IDs change on a later check. Marks only point at where to look (a "location"
 * reveal, allowed at every help level); any note text is leak-guarded by the caller like every other tutor sentence.
 */
import type { Box, Line } from '../ink/lines';
import { latexToUnicode } from '../ui/mathText.ts';
import { snapSpan, snapSymbol } from './chunks.ts';

/** arrow = points at a spot (the start of a line, or just before a stretch) where something is missing or to look */
export type MarkKind = 'highlight' | 'circle' | 'underline' | 'note' | 'arrow';
export const MARK_KINDS: readonly MarkKind[] = ['highlight', 'circle', 'underline', 'note', 'arrow'];

/** A circle wider than this many line-heights is drawn as an underline: a loop around a long stretch reads as "all wrong". */
export const CIRCLE_MAX_ASPECT = 3;

/** Marks of one reply get tags 1..MAX_TAG; a tag is a color and the name the message uses for the mark. */
export const MAX_TAG = 4;

/** What the model asks for. */
export type RawMark = {
  kind: string;
  line: string;
  /** 1..MAX_TAG; the message refers to this mark as [[tag|words]] */
  tag?: number;
  /** the part of the line meant, as fractions of its width (0 = left edge, 1 = right edge) */
  from?: number;
  to?: number;
  note?: string;
  /** the quote is a single symbol (a sign, a digit, a letter): snap to its own strokes, not the surrounding chunk */
  symbol?: boolean;
  /** a quote was given but could not be found in the line: never fall back to marking the whole line */
  unplaced?: boolean;
};

/** What is stored and drawn. */
export type TutorMark = {
  id: string;
  /** index of the chat turn (the assistant message) that drew it */
  turn: number;
  /** 1..MAX_TAG: its color, and which [[tag|...]] phrase in the message names it */
  tag: number;
  kind: MarkKind;
  lineId: string;
  /** the marked stretch (a whole line, or the chunks inside it) in page points when the mark was drawn */
  box: Box;
  note?: string;
  /** the marked line's ink signature when drawn: once it is gone from the page, the mark is hidden (older marks lack it) */
  sig?: string;
};

/** Marks whose line is still on the page as it was drawn. Unknown signatures (older marks, no live reading) stay. */
export function marksOnCurrentInk<M extends { sig?: string }>(marks: readonly M[], liveSigs: ReadonlySet<string> | null): M[] {
  return liveSigs ? marks.filter((m) => !m.sig || liveSigs.has(m.sig)) : [...marks];
}

/** One mark is the norm; two only to contrast two spots (device runs: four marks read as "everything is wrong"). */
const MAX_MARKS = 2;
const MAX_NOTE = 140;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const frac = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);

/**
 * Plain, compact form of a line for locating a quote: LaTeX turned into the symbols that are actually written
 * (\frac{10}{2} -> 10⁄2, ^2 -> ²), so a position in the text is close to a position in the ink. Spaces are dropped.
 */
export function plainMath(s: string): string {
  return latexToUnicode(s)
    .replace(/\\[A-Za-z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '');
}

const ALNUM = /[0-9A-Za-z.]/;

/**
 * Where `quote` sits inside `lineText`, as fractions of its plain length (handwriting is not monospaced but is close).
 * A quote that appears more than once prefers a whole token ("0" in "= 0", not the 0 of "20"), then the occurrence
 * nearest `hint` (the model's rough position, a fraction of the line).
 */
export function quoteSpan(lineText: string, quote: string, hint?: number): { from: number; to: number } | undefined {
  const t = plainMath(lineText);
  const q = plainMath(quote);
  if (q.length === 0 || t.length === 0 || q.length >= t.length) return undefined;
  const hits: number[] = [];
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) hits.push(i);
  if (hits.length === 0) return undefined;
  const whole = (i: number) =>
    !(ALNUM.test(q[0]) && i > 0 && ALNUM.test(t[i - 1])) && !(ALNUM.test(q[q.length - 1]) && i + q.length < t.length && ALNUM.test(t[i + q.length]));
  const tokens = hits.filter(whole);
  const pool = tokens.length > 0 ? tokens : hits;
  const centre = (i: number) => (i + q.length / 2) / t.length;
  const i = hint === undefined ? pool[0] : pool.reduce((best, x) => (Math.abs(centre(x) - hint) < Math.abs(centre(best) - hint) ? x : best));
  return { from: i / t.length, to: (i + q.length) / t.length };
}

/** Untrusted model output -> at most MAX_MARKS well-formed marks on lines that exist on the page it was shown. */
export function sanitizeMarks(raw: unknown, knownLineIds: ReadonlySet<string>): RawMark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const usedTags = new Set<number>();
  const out: RawMark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const kind = str(r.kind).toLowerCase();
    const line = str(r.line).toUpperCase();
    if (!(MARK_KINDS as readonly string[]).includes(kind) || !knownLineIds.has(line)) continue;
    let from = frac(r.from);
    let to = frac(r.to);
    const hint = from !== undefined && to !== undefined ? (from + to) / 2 : undefined;
    // Words beat coordinates: when the model quotes the expression it means, its place in the line's text gives the stretch.
    const quote = str(r.quote);
    const q = quoteSpan(str(r.line_text), quote, hint);
    if (q) {
      from = q.from;
      to = q.to;
    }
    const symbol = !!q && plainMath(quote).length <= 2;
    if (from === undefined || to === undefined || to - from < (symbol ? 0.005 : 0.03)) {
      from = undefined;
      to = undefined;
    }
    // it meant part of the line but we can't tell which part: point at the line instead of covering all of it
    const unplaced = !!quote && from === undefined && kind !== 'note';
    const key = `${kind}:${line}:${from?.toFixed(2) ?? ''}:${to?.toFixed(2) ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = str(r.note).replace(/\s+/g, ' ').slice(0, MAX_NOTE);
    // a note mark with nothing to say is just clutter
    if (kind === 'note' && !note) continue;
    // tags: keep the model's if valid and unused, otherwise the lowest free one
    let tag = typeof r.tag === 'number' && Number.isInteger(r.tag) && r.tag >= 1 && r.tag <= MAX_TAG && !usedTags.has(r.tag) ? r.tag : 0;
    if (!tag) for (let t = 1; t <= MAX_TAG; t++) if (!usedTags.has(t)) { tag = t; break; }
    if (!tag) break;
    usedTags.add(tag);
    out.push({ kind, line, tag, ...(from !== undefined ? { from, to } : {}), ...(note ? { note } : {}), ...(symbol && from !== undefined ? { symbol } : {}), ...(unplaced ? { unplaced } : {}) });
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

/** Where an arrow points: a thin slice at the left edge of the box it points at. */
const tipBox = (b: Box): Box => ({ x: b.x, y: b.y, w: Math.min(b.w, b.h * 0.6), h: b.h });

/**
 * Place marks from the line boxes (and, when a span is given, the line's chunks or, for a single symbol, its strokes);
 * all in page space. A quote that couldn't be found becomes an arrow at the start of the line, never a mark over the
 * whole line, and a circle around a long stretch is drawn as an underline.
 */
export function resolveMarks(
  raw: readonly RawMark[],
  lines: readonly Line[],
  chunksByLine: Readonly<Record<string, readonly Box[]>>,
  turn: number,
  newId: () => string,
  strokesByLine: Readonly<Record<string, readonly Box[]>> = {}
): TutorMark[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: TutorMark[] = [];
  for (const m of raw) {
    const line = byId.get(m.line);
    if (!line) continue;
    const whole: Box = { x: line.x, y: line.y, w: line.w, h: line.h };
    let kind = m.kind as MarkKind;
    let box: Box;
    if (m.unplaced) {
      kind = 'arrow';
      box = whole;
    } else if (m.from !== undefined && m.to !== undefined) {
      const strokes = strokesByLine[line.id] ?? [];
      box = m.symbol && strokes.length > 0 ? snapSymbol(whole, strokes, m.from, m.to) : snapSpan(whole, chunksByLine[line.id] ?? [], m.from, m.to);
    } else {
      box = whole;
    }
    if (kind === 'arrow') box = tipBox(box);
    if (kind === 'circle' && box.w > CIRCLE_MAX_ASPECT * Math.max(box.h, 1)) kind = 'underline';
    out.push({ id: newId(), turn, tag: m.tag ?? out.length + 1, kind, lineId: line.id, box, ...(m.note ? { note: m.note } : {}) });
  }
  return out;
}

/**
 * The page's tutor marks after a reply: the reply's own marks, placed on the lines of the capture the reply was given,
 * REPLACE every earlier reply's marks, also when the reply drew none (an old underline otherwise outlives the issue it
 * pointed at; T11 run 1). A mark on a line the capture doesn't have is dropped. No capture, no marks.
 */
export function marksAfterReply(
  raw: readonly RawMark[],
  capture: { lines: readonly Line[]; chunksByLine: Readonly<Record<string, readonly Box[]>>; strokesByLine?: Readonly<Record<string, readonly Box[]>> } | null,
  turn: number,
  newId: () => string
): TutorMark[] {
  return capture ? resolveMarks(raw, capture.lines, capture.chunksByLine, turn, newId, capture.strokesByLine) : [];
}

/** A new check is the page's current verdict: reply marks drawn before it are cleared (they point at old ink). */
export const marksAfterCheck = (): TutorMark[] => [];

/** Keep the marks of the latest `keepTurns` tutor turns; older ones are noise on the page. */
export function pruneMarks(marks: readonly TutorMark[], currentTurn: number, keepTurns = 2): TutorMark[] {
  return marks.filter((m) => m.turn > currentTurn - keepTurns);
}

// ---- the colored phrases in the message -----------------------------------------------------------------------

export type Segment = { text: string; tag?: number };

/**
 * Split a message into plain and tagged segments. The model writes [[2|this sign]]; a tag with no mark behind it is
 * shown as plain words (the student never sees the markup), so a model slip cannot leak syntax into the chat.
 */
export function parseTagged(message: string, validTags: ReadonlySet<number>): Segment[] {
  const out: Segment[] = [];
  const re = /\[\[\s*(\d)\s*\|([^\]]*)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, tag?: number) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.tag === tag) prev.text += text;
    else out.push({ text, ...(tag !== undefined ? { tag } : {}) });
  };
  while ((m = re.exec(message))) {
    push(message.slice(last, m.index));
    const tag = Number(m[1]);
    push(m[2], validTags.has(tag) ? tag : undefined);
    last = m.index + m[0].length;
  }
  push(message.slice(last));
  return out;
}

/** The message with its markup removed (for logs, the leak guard and plain-text uses). */
export const stripTags = (message: string): string => parseTagged(message, new Set()).map((s) => s.text).join('');

/** Pen colors for tags 1..4 (index = tag - 1): the ink of the mark, its translucent wash on the page, and a lighter tint behind its phrase in chat. */
export const TAG_COLORS: ReadonlyArray<{ pen: string; wash: string; solid: string; tint: string }> = [
  { pen: '#D9480F', wash: 'rgba(255,196,0,0.42)', solid: '#FFC400', tint: 'rgba(255,196,0,0.16)' },
  { pen: '#C2255C', wash: 'rgba(255,107,170,0.32)', solid: '#FF6BAA', tint: 'rgba(255,107,170,0.14)' },
  { pen: '#1971C2', wash: 'rgba(77,171,247,0.32)', solid: '#4DABF7', tint: 'rgba(77,171,247,0.14)' },
  { pen: '#2B8A3E', wash: 'rgba(105,219,124,0.38)', solid: '#69DB7C', tint: 'rgba(105,219,124,0.16)' },
];
export const tagColor = (tag: number) => TAG_COLORS[Math.max(0, Math.min(TAG_COLORS.length - 1, tag - 1))];
