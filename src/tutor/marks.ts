/**
 * Tutor marks: what the tutor draws on its own layer above the page (highlight, circle, underline, note).
 * Principle: the model never outputs coordinates. It names a line ID from the labelled page image; code looks the
 * line's box up and stores it (in PAGE space), so a mark keeps its place when line IDs change on a later check.
 * Marks only ever point at where to look (a "location" reveal, allowed at every help level); any note text is
 * leak-guarded by the caller like every other tutor sentence.
 */
import type { Box, Line } from '../ink/lines';

export type MarkKind = 'highlight' | 'circle' | 'underline' | 'note';
export const MARK_KINDS: readonly MarkKind[] = ['highlight', 'circle', 'underline', 'note'];

/** What the model asks for. */
export type RawMark = { kind: string; line: string; note?: string };

/** What is stored and drawn. */
export type TutorMark = {
  id: string;
  /** index of the chat turn (the assistant message) that drew it */
  turn: number;
  kind: MarkKind;
  lineId: string;
  /** the line's box in page points when the mark was drawn */
  box: Box;
  note?: string;
};

const MAX_MARKS = 4;
const MAX_NOTE = 140;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Untrusted model output -> at most MAX_MARKS well-formed marks on lines that exist on the page it was shown. */
export function sanitizeMarks(raw: unknown, knownLineIds: ReadonlySet<string>): RawMark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RawMark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const kind = str(r.kind).toLowerCase();
    const line = str(r.line).toUpperCase();
    if (!(MARK_KINDS as readonly string[]).includes(kind) || !knownLineIds.has(line)) continue;
    const key = `${kind}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = str(r.note).replace(/\s+/g, ' ').slice(0, MAX_NOTE);
    // a note mark with nothing to say is just clutter
    if (kind === 'note' && !note) continue;
    out.push({ kind, line, ...(note ? { note } : {}) });
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

export function resolveMarks(raw: readonly RawMark[], lines: readonly Line[], turn: number, newId: () => string): TutorMark[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: TutorMark[] = [];
  for (const m of raw) {
    const line = byId.get(m.line);
    if (!line) continue;
    out.push({ id: newId(), turn, kind: m.kind as MarkKind, lineId: line.id, box: { x: line.x, y: line.y, w: line.w, h: line.h }, ...(m.note ? { note: m.note } : {}) });
  }
  return out;
}

/** Keep the marks of the latest `keepTurns` tutor turns; older ones are noise on the page. */
export function pruneMarks(marks: readonly TutorMark[], currentTurn: number, keepTurns = 2): TutorMark[] {
  return marks.filter((m) => m.turn > currentTurn - keepTurns);
}
