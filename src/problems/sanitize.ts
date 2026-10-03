import { compareProblemLabels, normalizePartLabel, normalizeProblemLabel } from './labels.ts';
import type { ParsedAssignment, Part, ProblemGroup, Subpart } from './types.ts';

/**
 * The parser's tool output is untrusted input (see src/ai/sanitize.ts for the same rule on checks). Normalize
 * labels, coerce types, drop junk and merge repeated labels so everything downstream can rely on the shape.
 */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function sanitizeSubparts(raw: unknown): Subpart[] {
  if (!Array.isArray(raw)) return [];
  const out: Subpart[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const r = obj(item);
    if (!r) continue;
    const label = normalizePartLabel(str(r.label));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, text: str(r.text), hint: str(r.hint) || undefined });
  }
  return out;
}

function sanitizeParts(raw: unknown): Part[] {
  if (!Array.isArray(raw)) return [];
  const out: Part[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const r = obj(item);
    if (!r) continue;
    const label = normalizePartLabel(str(r.label));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      text: str(r.text),
      hint: str(r.hint) || undefined,
      asksFor: strList(r.asks_for ?? r.asksFor),
      subparts: sanitizeSubparts(r.subparts),
    });
  }
  return out;
}

export function sanitizeParsed(raw: unknown): ParsedAssignment {
  const r = obj(raw) ?? {};
  const groups: ProblemGroup[] = [];
  const byLabel = new Map<string, ProblemGroup>();
  for (const item of Array.isArray(r.problems) ? r.problems : []) {
    const p = obj(item);
    if (!p) continue;
    const label = normalizeProblemLabel(str(p.label));
    if (!label) continue;
    const group: ProblemGroup = {
      label,
      title: str(p.title) || undefined,
      context: str(p.context),
      parts: sanitizeParts(p.parts),
      closing: str(p.closing) || undefined,
      hint: str(p.hint) || undefined,
      asksFor: strList(p.asks_for ?? p.asksFor),
    };
    const existing = byLabel.get(label);
    if (existing) {
      // the same problem reported twice (e.g. split across a page break): keep one, merge what the other adds
      existing.context = existing.context || group.context;
      existing.title = existing.title ?? group.title;
      const have = new Set(existing.parts.map((x) => x.label));
      existing.parts.push(...group.parts.filter((x) => !have.has(x.label)));
      existing.asksFor = [...new Set([...existing.asksFor, ...group.asksFor])];
      existing.closing = existing.closing ?? group.closing;
      existing.hint = existing.hint ?? group.hint;
    } else {
      byLabel.set(label, group);
      groups.push(group);
    }
  }
  groups.sort((a, b) => compareProblemLabels(a.label, b.label));
  return { course: str(r.course) || undefined, notes: strList(r.notes), groups };
}
