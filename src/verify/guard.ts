import type { CheckResult, HelpLevel, LineVerdict } from '../ai/types';
import { fallbackQuestion, scrubText, type Leak, type LeakContext } from './leak.ts';
import { checkChain, checkLineUnits, checkStep } from './expr.ts';

const lineNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;
/** Tolerate a malformed transcription (missing or non-string) rather than throwing. */
const rd = (v: { reading?: unknown }): string => (typeof v.reading === 'string' ? v.reading : '');
const isMath = (v: LineVerdict) => v.verdict !== 'context' && v.verdict !== 'unreadable' && rd(v).trim() !== '';

/**
 * Redundant algebra check on the model's own transcription. If the model calls a line valid but the
 * line contradicts the previous (valid) line, or a chain `a = b = c` has a false link, lower it to
 * "partial" and say what to re-check, never the fix. Only ever lowers a verdict; unreadable or
 * unparseable lines are left alone. A prior line that isn't valid is skipped so a student's own
 * correction of a wrong line is not penalised.
 */
export function applyAlgebraGuard(lines: LineVerdict[]): LineVerdict[] {
  const order = [...lines].sort((a, b) => lineNo(a.id) - lineNo(b.id));
  const lowered = new Map<string, string>();
  let prev: LineVerdict | undefined;
  for (const cur of order) {
    if (!isMath(cur)) {
      prev = undefined; // never bridge across a line we could not read
      continue;
    }
    if (cur.verdict === 'valid') {
      const chain = checkChain(rd(cur));
      if (checkLineUnits(rd(cur))?.kind === 'inconsistent') {
        lowered.set(cur.id, 'Units check: the two sides of an "=" on this line have different units. Which side is right?');
      } else if (chain?.kind === 'inconsistent') {
        lowered.set(cur.id, 'Algebra check: one link in this chain of equalities is not an identity. Which one?');
      } else if (prev && prev.verdict === 'valid' && (prev.part ?? '') === (cur.part ?? '')) {
        const rel = checkStep(rd(prev), rd(cur));
        if (rel.kind === 'inconsistent') {
          lowered.set(cur.id, `Algebra check: this does not follow from ${prev.id} (${rel.detail}). What changed between the two lines?`);
        }
      }
    }
    prev = cur;
  }
  if (lowered.size === 0) return lines;
  return lines.map((l) =>
    lowered.has(l.id)
      ? { ...l, verdict: 'partial', guard: 'algebra', modelVerdict: l.verdict, note: `${l.note ? l.note.replace(/\s+$/, '') + ' ' : ''}${lowered.get(l.id)}` }
      : l
  );
}

/**
 * Read before judging: a verdict on a line the model itself could not read confidently is not evidence. Lower any
 * graded verdict (valid, partial, incorrect) on a LOW-confidence reading to "unreadable" and ask the student to
 * confirm what they wrote, quoting only their own characters. A false ✓ from a misread is the worst bug, and a false
 * ✗ on a misread costs trust. Downgrade-only; medium/high or missing confidence is left alone.
 */
export function applyReadingGuard(lines: LineVerdict[], confirmed: ReadonlySet<string> = new Set()): LineVerdict[] {
  let changed = false;
  const out = lines.map((l) => {
    // a reading the student confirmed is what they wrote: grade it as read
    if (l.readConfidence !== 'low' || l.verdict === 'context' || l.verdict === 'unreadable' || confirmed.has(l.id)) return l;
    changed = true;
    const what = l.uncertain ? `“${l.uncertain}” in this line` : 'this line';
    return {
      ...l,
      verdict: 'unreadable' as const,
      guard: 'reading' as const,
      modelVerdict: l.verdict,
      obstacle: undefined,
      note: `I'm not sure I read ${what} right. Confirm what you wrote below, then check again.`,
    };
  });
  return changed ? out : lines;
}

/**
 * Withhold answer leaks from every piece of tutor text in a check result. A removed question is replaced
 * by a content-free one that mentions only line IDs. The result records what was blocked.
 */
export function applyLeakGuard(r: CheckResult, level: HelpLevel): CheckResult {
  const ctx: LeakContext = { level, lines: r.lines.map((l) => ({ id: l.id, reading: rd(l), verdict: l.verdict })) };
  const blocked: Leak[] = [];
  const clean = (t: string) => {
    const s = scrubText(t, ctx);
    blocked.push(...s.leaks);
    return s.text;
  };
  const lines = r.lines.map((l) => {
    const note = clean(l.note);
    return note === l.note ? l : { ...l, note: note || 'Look at this line again.' };
  });
  const feedback = clean(r.feedback);
  let question = clean(r.question);
  if (!question && r.question.trim()) {
    const ordered = [...r.lines].sort((a, b) => lineNo(a.id) - lineNo(b.id));
    const idx = ordered.findIndex((l) => l.verdict === 'incorrect' || l.verdict === 'partial');
    question = fallbackQuestion(level, idx >= 0 ? ordered[idx].id : undefined, idx > 0 ? ordered[idx - 1].id : undefined);
  }
  if (blocked.length === 0) return r;
  return { ...r, lines, feedback, question, leaksBlocked: blocked.map((b) => ({ fragment: b.fragment, why: b.why })) };
}

/** Same protection for chat replies: withhold leaking sentences; if nothing is left, ask a content-free question. */
export function applyReplyLeakGuard(reply: string, lines: { id: string; reading: string; verdict: string }[], level: HelpLevel): string {
  if (lines.length === 0) return reply;
  const { text, leaks } = scrubText(reply, { level, lines: lines.map((l) => ({ ...l, reading: rd(l) })) });
  if (leaks.length === 0) return reply;
  if (text) return text;
  const ordered = [...lines].sort((a, b) => lineNo(a.id) - lineNo(b.id));
  const idx = ordered.findIndex((l) => l.verdict === 'incorrect' || l.verdict === 'partial');
  return fallbackQuestion(level, idx >= 0 ? ordered[idx].id : undefined, idx > 0 ? ordered[idx - 1].id : undefined);
}
