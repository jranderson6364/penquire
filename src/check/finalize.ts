/**
 * Guards on the MERGED page. The provider's guards (src/ai/index.ts guarded()) only see the lines the model was asked
 * to grade, so a new line written right after a settled line was never step-checked against it, and the leak guard
 * could not see settled readings. After carry-over merges settled and fresh lines, run both guards again on the whole
 * page in reading order. Downgrade-only like every guard; a guard bug falls back to the merged result.
 */
import type { CheckResult, HelpLevel } from '../ai/types';
import { applyAlgebraGuard, applyLeakGuard } from '../verify/guard.ts';

export function guardMerged(r: CheckResult, level: HelpLevel): CheckResult {
  try {
    const lines = applyAlgebraGuard(r.lines);
    const before = { ...r, lines };
    const g = applyLeakGuard(before, level);
    if (g === before || !g.leaksBlocked?.length) return lines === r.lines ? r : before;
    const seen = new Set<string>();
    const leaksBlocked = [...(r.leaksBlocked ?? []), ...g.leaksBlocked].filter((b) => !seen.has(b.fragment) && (seen.add(b.fragment), true));
    return { ...g, leaksBlocked };
  } catch (e) {
    console.warn('merged-page guards failed; keeping the merged check', e);
    return r;
  }
}
