import { OBSTACLES, REVEAL_KINDS, type CheckResult, type LineVerdict, type Obstacle, type PartStatus, type RevealKind, type Revealed, type Verdict } from './types.ts';

/**
 * The model's tool output is untrusted input: strict schemas are not guaranteed, fields can be missing or
 * the wrong type. Normalize it BEFORE any guard or UI touches it. The rule that matters most: anything we
 * cannot interpret as a verdict becomes "unreadable" (never "valid"), because a false ✓ is the worst bug.
 */
const VERDICTS: ReadonlySet<string> = new Set(['valid', 'partial', 'incorrect', 'unreadable', 'context']);
const PART_STATUS: ReadonlySet<string> = new Set(['complete', 'in_progress', 'missing_items', 'not_started']);

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const OBSTACLE_SET: ReadonlySet<string> = new Set(OBSTACLES);
const REVEAL_SET: ReadonlySet<string> = new Set(REVEAL_KINDS);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s.trim() !== '') : []);

export function sanitizeLines(raw: unknown): LineVerdict[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LineVerdict[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id).trim();
    if (!/^L\d+$/.test(id) || seen.has(id)) continue; // unknown or duplicate line IDs cannot be placed on the page
    seen.add(id);
    const claimed = str(r.verdict).trim().toLowerCase();
    const known = VERDICTS.has(claimed);
    const verdict = (known ? claimed : 'unreadable') as Verdict;
    const obstacle = str(r.obstacle).trim().toLowerCase();
    out.push({
      id,
      part: r.part == null || str(r.part) === '' ? undefined : str(r.part),
      reading: str(r.reading),
      verdict,
      note: known ? str(r.note) : `${str(r.note)} (The tutor's verdict for this line was not understood, so it is not marked.)`.trim(),
      // an obstacle only means something on a line that needs work; unknown values are dropped, not guessed
      ...(verdict !== 'valid' && verdict !== 'context' && OBSTACLE_SET.has(obstacle) ? { obstacle: obstacle as Obstacle } : {}),
    });
  }
  return out;
}

export function sanitizeParts(raw: unknown): PartStatus[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      label: str(p.label),
      status: (PART_STATUS.has(str(p.status)) ? str(p.status) : 'in_progress') as PartStatus['status'],
      missing: strList(p.missing),
    }))
    .filter((p) => p.label !== '');
}

/** Unknown kinds are kept as "step" (the most revealing), so a malformed report can't hide a reveal from the log. */
export function sanitizeRevealed(raw: unknown): Revealed[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): Revealed | null => {
      if (typeof item === 'string') return item.trim() ? { kind: 'step', what: item.trim() } : null;
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const kind = str(r.kind).trim().toLowerCase();
      const what = str(r.what).trim();
      if (!kind && !what) return null;
      return { kind: (REVEAL_SET.has(kind) ? kind : 'step') as RevealKind, what };
    })
    .filter((r): r is Revealed => r !== null);
}

export function sanitizeCheck(out: Record<string, unknown>, model: string, usage?: CheckResult['usage']): CheckResult {
  return {
    lines: sanitizeLines(out.lines),
    parts: sanitizeParts(out.parts),
    feedback: str(out.feedback),
    question: str(out.question),
    fixedSinceLast: strList(out.fixed_since_last),
    stillOpen: strList(out.still_open),
    revealed: sanitizeRevealed(out.revealed),
    model,
    usage,
  };
}
