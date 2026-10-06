import { flatLabel } from './labels.ts';
import type { ProblemGroup } from './types.ts';

/**
 * The assignment as the tutor reads it: each problem's setup ONCE, then its parts. Cheaper and clearer than
 * repeating the setup inside every part, and it keeps the closing instructions and hints attached to the right scope.
 */
export function formatGroups(groups: ProblemGroup[], opts: { subpartLabels?: boolean } = {}): string {
  // The check tool assigns each line to a FLAT label ("1b"); sub-parts then show as "(ii)" so they aren't mistaken for one.
  const sub = (g: ProblemGroup, p: ProblemGroup['parts'][number], s: { label: string }) => (opts.subpartLabels === false ? `(${s.label})` : `[${flatLabel(g.label, p.label, s.label)}]`);
  return groups
    .map((g) => {
      const lines: string[] = [`PROBLEM ${g.label}${g.title ? `: ${g.title}` : ''}`];
      if (g.context) lines.push(`Setup: ${g.context}`);
      if (g.asksFor.length) lines.push(`A complete answer to the whole problem must include: ${g.asksFor.join('; ')}`);
      for (const p of g.parts) {
        lines.push(`[${flatLabel(g.label, p.label)}] ${p.text}${p.hint ? ` (Hint: ${p.hint})` : ''}`);
        for (const s of p.subparts) lines.push(`    ${sub(g, p, s)} ${s.text}${s.hint ? ` (Hint: ${s.hint})` : ''}`);
        if (p.asksFor.length) lines.push(`    A complete answer to ${flatLabel(g.label, p.label)} must include: ${p.asksFor.join('; ')}`);
      }
      if (g.closing) lines.push(`Applies to all parts: ${g.closing}`);
      if (g.hint) lines.push(`Hint (whole problem): ${g.hint}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
