/**
 * Label normalization. Models emit "Problem 6", "6.", "(b)", "1(b)(ii)", "b.", "Q3"; everything downstream
 * (part picker, ladder keys, eval snapshots, check part statuses) joins on one canonical form.
 */

/** "Problem 6." -> "6"; "Q3" -> "3"; "Exercise 3.10" -> "3.10"; "(6)" -> "6". */
export function normalizeProblemLabel(raw: string): string {
  let s = String(raw ?? '').trim();
  s = s.replace(/^(problem|question|exercise|ex\.?|prob\.?|q)\s*/i, '');
  s = s.replace(/[()\[\]:]/g, '').replace(/[.\s]+$/, '');
  return s.trim();
}

/** "(b)" -> "b"; "b." -> "b"; "(ii)" -> "ii"; "(A)" -> "A". Case is kept: (A)/(B) and (a)/(b) are different families. */
export function normalizePartLabel(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[()\[\]:]/g, '')
    .replace(/[.\s]+$/, '')
    .replace(/^part\s+/i, '')
    .trim();
}

/** Flat label used by the tutor, the part picker and snapshots: group "6" + part "a" = "6a"; subpart "ii" = "1b.ii". */
export function flatLabel(group: string, part?: string, sub?: string): string {
  let out = group;
  if (part) out += part;
  if (sub) out += '.' + sub;
  return out;
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

/** The index of a label inside its family ("a" -> 0, "c" -> 2, "iii" -> 2, "B" -> 1), or -1 when unknown. */
export function labelIndex(label: string): number {
  const l = label.trim();
  const roman = ROMAN.indexOf(l.toLowerCase());
  // "i" is both the letter i and roman one: a single "i" counts as roman one
  if (roman >= 0 && (l.length > 1 || l === 'i' || l === 'I')) return roman;
  if (/^[a-z]$/i.test(l)) return l.toLowerCase().charCodeAt(0) - 97;
  const n = Number(l);
  return Number.isInteger(n) && n > 0 ? n - 1 : -1;
}

/** Labels that should exist between the first and last seen but do not (e.g. a, b, d -> ["c"]). */
export function missingInSequence(labels: string[]): string[] {
  const idx = labels.map(labelIndex);
  if (idx.some((i) => i < 0) || idx.length < 2) return [];
  const upper = labels.every((l) => /^[A-Z]$/.test(l));
  const roman = labels.every((l) => ROMAN.includes(l.toLowerCase()));
  const seen = new Set(idx);
  const out: string[] = [];
  for (let i = Math.min(...idx); i <= Math.max(...idx); i++) {
    if (seen.has(i)) continue;
    out.push(roman ? ROMAN[i] : String.fromCharCode((upper ? 65 : 97) + i));
  }
  return out;
}

/** Natural order of problem labels: "2" < "10", "3.8" < "3.10". */
export function compareProblemLabels(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x));
  const pb = b.split('.').map((x) => Number(x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (Number.isNaN(x) || Number.isNaN(y)) return a.localeCompare(b, undefined, { numeric: true });
    if (x !== y) return x - y;
  }
  return 0;
}
