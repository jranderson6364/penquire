import type { CheckResult, HelpLevel, LineVerdict } from '../ai/types';
import { fallbackQuestion, scrubText, type Leak, type LeakContext } from './leak.ts';
import { checkChain, checkStep } from './expr.ts';

const lineNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;
const isMath = (v: LineVerdict) => v.verdict !== 'context' && v.verdict !== 'unreadable' && v.reading.trim() !== '';

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
      const chain = checkChain(cur.reading);
      if (chain?.kind === 'inconsistent') {
        lowered.set(cur.id, 'Algebra check: one link in this chain of equalities is not an identity. Which one?');
      } else if (prev && prev.verdict === 'valid' && (prev.part ?? '') === (cur.part ?? '')) {
        const rel = checkStep(prev.reading, cur.reading);
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
 * Withhold answer leaks from every piece of tutor text in a check result. A removed question is replaced
 * by a content-free one that mentions only line IDs. The result records what was blocked.
 */
export function applyLeakGuard(r: CheckResult, level: HelpLevel): CheckResult {
  const ctx: LeakContext = { level, lines: r.lines.map((l) => ({ id: l.id, reading: l.reading, verdict: l.verdict })) };
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
