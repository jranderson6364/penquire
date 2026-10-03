import type { Problem } from '../ai/types';
import { flatLabel } from './labels.ts';
import type { ProblemGroup } from './types.ts';

/** A part's own text with its subparts and hint, as one block. */
export function partText(part: ProblemGroup['parts'][number]): string {
  const lines = [part.text];
  for (const s of part.subparts) lines.push(`(${s.label}) ${s.text}${s.hint ? ` Hint: ${s.hint}` : ''}`);
  if (part.hint) lines.push(`Hint: ${part.hint}`);
  return lines.filter((l) => l.trim() !== '').join('\n');
}

/**
 * Flat per-part problems for the part picker, ladder keys, check part statuses and snapshots.
 * Each flat item is self-contained (setup + part + closing) so it can be read alone.
 */
export function flatten(groups: ProblemGroup[]): Problem[] {
  const out: Problem[] = [];
  for (const g of groups) {
    const head = [g.title ? `${g.title}` : '', g.context].filter(Boolean).join('\n');
    if (g.parts.length === 0) {
      out.push({ label: g.label, text: [head, g.hint ? `Hint: ${g.hint}` : '', g.closing ?? ''].filter(Boolean).join('\n'), asksFor: g.asksFor });
      continue;
    }
    for (const p of g.parts) {
      const text = [head, partText(p), g.closing ? `(Applies to all parts) ${g.closing}` : '', g.hint ? `Hint: ${g.hint}` : '']
        .filter((x) => x.trim() !== '')
        .join('\n\n');
      out.push({ label: flatLabel(g.label, p.label), text, asksFor: [...g.asksFor, ...p.asksFor] });
    }
  }
  return out;
}

/** Flat label -> the part's display parts, for UI that only has a label (the part picker). */
export function findPart(groups: ProblemGroup[], label: string): { group: ProblemGroup; part?: ProblemGroup['parts'][number] } | undefined {
  for (const g of groups) {
    if (g.label === label) return { group: g };
    for (const p of g.parts) if (flatLabel(g.label, p.label) === label) return { group: g, part: p };
  }
  return undefined;
}
