/**
 * Units in handwritten physics lines (v1). Pure, no dependencies.
 *
 * The algebra checker (expr.ts) sees numbers and letters. A unit written as \mathrm{m/s} or \text{kg} would be
 * unreadable to it, and a bare conversion like 20 m/s = 72 km/h is only true once both sides are in SI. This module:
 *   1. recognises unit groups (\mathrm{...}, \text{...}, \operatorname{...}) whose content is a known unit expression,
 *   2. rewrites each as a multiplication by its SI scale, so expr.ts compares SI magnitudes,
 *   3. reports each side's dimension, so "5 N = 5 J" is caught as a units mismatch.
 *
 * Invariant (same as every guard): never cause a false downgrade. So:
 *   - anything unrecognised is left untouched (the checker then refuses to judge the line, as before);
 *   - degrees (°, ^\circ) are NOT handled: stripping them would turn sin(30°) into sin(30 rad);
 *   - a numeric comparison is only allowed between sides that agree on whether they carry units at all
 *     (a dropped unit, "x = 5 cm" then "x = 5", is not evidence of an error).
 */

/** SI exponents: m, kg, s, A, K, mol, cd */
export type Dim = readonly [number, number, number, number, number, number, number];
type Unit = { scale: number; dim: Dim };

const D = (m = 0, kg = 0, s = 0, A = 0, K = 0, mol = 0, cd = 0): Dim => [m, kg, s, A, K, mol, cd];

const BASE: Record<string, Unit> = {
  m: { scale: 1, dim: D(1) },
  g: { scale: 1e-3, dim: D(0, 1) },
  s: { scale: 1, dim: D(0, 0, 1) },
  A: { scale: 1, dim: D(0, 0, 0, 1) },
  K: { scale: 1, dim: D(0, 0, 0, 0, 1) },
  mol: { scale: 1, dim: D(0, 0, 0, 0, 0, 1) },
  cd: { scale: 1, dim: D(0, 0, 0, 0, 0, 0, 1) },
  N: { scale: 1, dim: D(1, 1, -2) },
  J: { scale: 1, dim: D(2, 1, -2) },
  W: { scale: 1, dim: D(2, 1, -3) },
  Pa: { scale: 1, dim: D(-1, 1, -2) },
  Hz: { scale: 1, dim: D(0, 0, -1) },
  C: { scale: 1, dim: D(0, 0, 1, 1) },
  V: { scale: 1, dim: D(2, 1, -3, -1) },
  Ω: { scale: 1, dim: D(2, 1, -3, -2) },
  ohm: { scale: 1, dim: D(2, 1, -3, -2) },
  F: { scale: 1, dim: D(-2, -1, 4, 2) },
  T: { scale: 1, dim: D(0, 1, -2, -1) },
  Wb: { scale: 1, dim: D(2, 1, -2, -1) },
  H: { scale: 1, dim: D(2, 1, -2, -2) },
  L: { scale: 1e-3, dim: D(3) },
  eV: { scale: 1.602176634e-19, dim: D(2, 1, -2) },
  min: { scale: 60, dim: D(0, 0, 1) },
  h: { scale: 3600, dim: D(0, 0, 1) },
  hr: { scale: 3600, dim: D(0, 0, 1) },
  hour: { scale: 3600, dim: D(0, 0, 1) },
  sec: { scale: 1, dim: D(0, 0, 1) },
  atm: { scale: 101325, dim: D(-1, 1, -2) },
  rad: { scale: 1, dim: D() },
};
/** Prefixes allowed on these units only (keeps "min", "mol", "cd" from being read as prefixed units). */
const PREFIXABLE = new Set(['m', 'g', 's', 'A', 'N', 'J', 'W', 'Pa', 'Hz', 'C', 'V', 'Ω', 'F', 'T', 'L', 'eV', 'K']);
const PREFIX: Record<string, number> = { G: 1e9, M: 1e6, k: 1e3, c: 1e-2, m: 1e-3, μ: 1e-6, u: 1e-6, n: 1e-9, p: 1e-12 };

function symbol(sym: string): Unit | null {
  if (BASE[sym]) return BASE[sym];
  for (const [p, f] of Object.entries(PREFIX)) {
    const rest = sym.slice(p.length);
    if (sym.startsWith(p) && PREFIXABLE.has(rest)) return { scale: f * BASE[rest].scale, dim: BASE[rest].dim };
  }
  return null;
}

const mulDim = (a: Dim, b: Dim, k = 1): Dim => a.map((x, i) => x + k * b[i]) as unknown as Dim;
export const sameDim = (a: Dim, b: Dim) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

/** "kg m/s^2", "N\cdot m", "m s^{-1}", "km/h" -> SI scale and dimension; null if anything is not a known unit. */
export function parseUnit(text: string): Unit | null {
  const s = text
    .replace(/\\cdot|\\,|\\;|\\ |[·⋅*]/g, ' ')
    .replace(/\\mu\s*/g, 'μ')
    .replace(/\\Omega/g, 'Ω')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\^\s*\{\s*([+-]?\d+)\s*\}/g, '^$1')
    .trim();
  if (!s || s.length > 40) return null;
  const groups = s.split('/');
  let scale = 1;
  let dim: Dim = D();
  for (let g = 0; g < groups.length; g++) {
    const sign = g === 0 ? 1 : -1;
    const factors = groups[g].trim().split(/\s+/).filter(Boolean);
    if (factors.length === 0) {
      if (g === 0 && groups.length > 1 && groups[0].trim() === '1') continue;
      return null;
    }
    for (const f of factors) {
      if (g === 0 && f === '1' && groups.length > 1) continue; // "1/s"
      const m = /^([A-Za-zΩμ]+)(?:\^([+-]?\d+))?$/.exec(f);
      if (!m) return null;
      const u = symbol(m[1]);
      if (!u) return null;
      const e = sign * (m[2] ? Number(m[2]) : 1);
      scale *= Math.pow(u.scale, e);
      dim = mulDim(dim, u.dim, e);
    }
  }
  return { scale, dim };
}

const GROUP = /\\(?:text|mathrm|operatorname|rm)\s*\{([^{}]*)\}/g;

export type SideUnits = {
  /** the side with every unit group replaced by "*(scale)" */
  src: string;
  /** true if this side wrote at least one unit */
  hasUnits: boolean;
  /** the side's dimension when it is a single product of terms with units (no top-level + or -), else undefined */
  dim?: Dim;
};

/** Split a raw line on = / \approx the way the checker does; null if it has relations we don't handle. */
function rawSides(src: string): string[] | null {
  if (/\\neq|≠|\\le|\\ge|≤|≥|<|>|!=|==|\\to|\\Rightarrow|\\implies/.test(src)) return null;
  return src.split(/\\approx|≈|=/);
}

function hasTopLevelSum(s: string): boolean {
  let depth = 0;
  const t = s.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if ((c === '+' || c === '-' || c === '−') && depth === 0 && i > 0) return true;
  }
  return false;
}

/** Is the text before a unit group a quantity it can attach to: "9.8\,", "(2)", "\frac{3}{2} "? Never a sub/superscript. */
function followsFactor(before: string): boolean {
  const t = before.replace(/(\\,|\\;|\\!|\\ |\s)+$/, '');
  if (/[_^]\s*\{?\s*$/.test(t)) return false; // F_{\mathrm{N}}, A^\mathrm{T}
  if (/[0-9]$/.test(t)) return !/[_^]\s*\{?\s*[0-9]+$/.test(t); // 9.8 m, but not x_{1} m
  if (/[)\]]$/.test(t)) return true; // (2.0) kg
  if (/\}$/.test(t)) return /\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}$/.test(t); // \frac{3}{2} m; not a closed subscript
  return false;
}

/**
 * Rewrite a line's unit groups to SI multipliers. Returns null when the line has no unit groups at all (callers keep
 * the old behaviour), or when a unit group is not a recognised unit (callers must not judge the line: return the
 * original text so the checker reports it unparsed).
 */
export function unitize(src: string): { sides: SideUnits[]; joined: string } | null {
  if (!/\\(?:text|mathrm|operatorname|rm)\s*\{/.test(src)) return null;
  const sides = rawSides(src);
  if (!sides) return null;
  const out: SideUnits[] = [];
  for (const side of sides) {
    let ok = true;
    let hasUnits = false;
    let dim: Dim = D();
    const rewritten = side.replace(GROUP, (_m, inner: string, at: number) => {
      const u = parseUnit(inner);
      // Upright text is also how labels are written: F_{\mathrm{N}}, A^{\mathrm{T}}, m_\mathrm{A}. Only a group that
      // directly follows a number (or a closing bracket of one) is a unit; anything else leaves the line unjudged.
      if (!u || !followsFactor(side.slice(0, at))) {
        ok = false;
        return _m;
      }
      hasUnits = true;
      dim = mulDim(dim, u.dim);
      return ` *(${u.scale}) `;
    });
    if (!ok) return null;
    out.push({ src: rewritten, hasUnits, dim: hasUnits && !hasTopLevelSum(side) ? dim : undefined });
  }
  return { sides: out, joined: out.map((s) => s.src).join(' = ') };
}

/**
 * Within one line: two sides that each carry units of a known, different dimension contradict each other
 * ("W = 5 N = 5 J"). Returns the pair of side indexes, or null.
 */
export function dimensionMismatch(sides: SideUnits[]): [number, number] | null {
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      const a = sides[i].dim;
      const b = sides[j].dim;
      if (a && b && !sameDim(a, b)) return [i, j];
    }
  }
  return null;
}
