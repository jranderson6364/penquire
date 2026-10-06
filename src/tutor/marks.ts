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
import { snapSpan } from './chunks.ts';

export type MarkKind = 'highlight' | 'circle' | 'underline' | 'note';
export const MARK_KINDS: readonly MarkKind[] = ['highlight', 'circle', 'underline', 'note'];

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
};

const MAX_MARKS = 4;
const MAX_NOTE = 140;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const frac = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);

const squash = (s: string) => s.replace(/\s+/g, '');

/** Where `quote` sits inside `lineText`, as fractions of its length (spaces ignored, handwriting is not monospaced but is close). */
export function quoteSpan(lineText: string, quote: string): { from: number; to: number } | undefined {
  const t = squash(lineText);
  const q = squash(quote);
  if (q.length === 0 || t.length === 0 || q.length >= t.length) return undefined;
  const i = t.indexOf(q);
  if (i < 0) return undefined;
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
    // Words beat coordinates: when the model quotes the expression it means, its place in the line's text gives the stretch.
    const q = quoteSpan(str(r.line_text), str(r.quote));
    if (q) {
      from = q.from;
      to = q.to;
    }
    if (from === undefined || to === undefined || to - from < 0.03) {
      from = undefined;
      to = undefined;
    }
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
    out.push({ kind, line, tag, ...(from !== undefined ? { from, to } : {}), ...(note ? { note } : {}) });
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

/** Place marks from the line boxes (and, when a span is given, the line's chunks); all in page space. */
export function resolveMarks(
  raw: readonly RawMark[],
  lines: readonly Line[],
  chunksByLine: Readonly<Record<string, readonly Box[]>>,
  turn: number,
  newId: () => string
): TutorMark[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: TutorMark[] = [];
  for (const m of raw) {
    const line = byId.get(m.line);
    if (!line) continue;
    const whole: Box = { x: line.x, y: line.y, w: line.w, h: line.h };
    const box = m.from !== undefined && m.to !== undefined ? snapSpan(whole, chunksByLine[line.id] ?? [], m.from, m.to) : whole;
    out.push({ id: newId(), turn, tag: m.tag ?? out.length + 1, kind: m.kind as MarkKind, lineId: line.id, box, ...(m.note ? { note: m.note } : {}) });
  }
  return out;
}

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

/** Pen colors for tags 1..4 (index = tag - 1): the ink of the mark, the translucent wash behind its phrase. */
export const TAG_COLORS: ReadonlyArray<{ pen: string; wash: string; solid: string }> = [
  { pen: '#D9480F', wash: 'rgba(255,196,0,0.42)', solid: '#FFC400' },
  { pen: '#C2255C', wash: 'rgba(255,107,170,0.32)', solid: '#FF6BAA' },
  { pen: '#1971C2', wash: 'rgba(77,171,247,0.32)', solid: '#4DABF7' },
  { pen: '#2B8A3E', wash: 'rgba(105,219,124,0.38)', solid: '#69DB7C' },
];
export const tagColor = (tag: number) => TAG_COLORS[Math.max(0, Math.min(TAG_COLORS.length - 1, tag - 1))];
