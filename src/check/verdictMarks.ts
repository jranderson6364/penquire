import type { LineVerdict, PartStatus } from '../ai/types';

/**
 * Which lines get a margin mark (docs/10: mark like a teacher). A teacher ticks the ANSWER, not every line on the way
 * there, and marks what needs attention:
 *  - every line that is incorrect, partially valid or unreadable gets its mark (✗ ~ ?),
 *  - a valid line gets a ✓ only when it is the last line of its part AND that part is complete,
 *  - every other valid line, and context lines, get no mark (the work speaks for itself).
 * Pure (tested).
 */
const lineNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;

export function marksToShow(verdicts: LineVerdict[], parts: PartStatus[]): LineVerdict[] {
  const complete = new Set(parts.filter((p) => p.status === 'complete').map((p) => p.label));
  const lastOfPart = new Map<string, LineVerdict>();
  for (const v of verdicts) {
    if (!v.part || v.verdict === 'context') continue;
    const cur = lastOfPart.get(v.part);
    if (!cur || lineNo(v.id) > lineNo(cur.id)) lastOfPart.set(v.part, v);
  }
  return verdicts.filter((v) => {
    if (v.verdict === 'context') return false;
    if (v.verdict !== 'valid') return true;
    return !!v.part && complete.has(v.part) && lastOfPart.get(v.part)?.id === v.id;
  });
}
