/**
 * Deterministic math checker: parses a transcribed line (plain text or light LaTeX) and tests algebra
 * between consecutive lines by evaluating at pseudo-random points. Independent of any model, so it is a
 * redundant check on the tutor's verdicts. It may only DOWNGRADE trust; it never proves a step "right".
 * Pure TypeScript, no dependencies (runs under `node --test`).
 */

import { dimensionMismatch, unitize } from './units.ts';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; a: Node };

export type Parsed = { ok: true; ast: Node } | { ok: false; reason: string };

const FUNCS = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh']);
/** Prose in a transcription means the line is not pure math; refuse to guess rather than read "or" as o*r. */
const PROSE = new Set(['or', 'and', 'if', 'then', 'so', 'is', 'are', 'for', 'when', 'where', 'thus', 'hence', 'since', 'because', 'with', 'by', 'to', 'of', 'at', 'the', 'not', 'no', 'yes', 'let', 'any', 'all', 'such', 'that', 'unit', 'units']);
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

// ---------------------------------------------------------------- normalization

/** LaTeX-ish / unicode text -> plain ASCII the tokenizer understands. */
export function normalize(src: string): string {
  let s = src;
  s = s.replace(/\\left|\\right|\\,|\\;|\\!|\\ |\$/g, '');
  s = s.replace(/\\cdot|\\times|[×·⋅]/g, '*').replace(/[−–—]/g, '-').replace(/÷/g, '/');
  s = s.replace(/\\pi|π/g, ' pi ').replace(/\\(sin|cos|tan|exp|ln|log|arcsin|arccos|arctan|sinh|cosh|tanh)/g, ' $1 ');
  s = s.replace(/arcsin/g, 'asin').replace(/arccos/g, 'acos').replace(/arctan/g, 'atan');
  const GREEK: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Omega: 'Ω', Sigma: 'Σ', Gamma: 'Γ', Phi: 'Φ' };
  s = s.replace(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|rho|sigma|tau|phi|omega|Delta|Omega|Sigma|Gamma|Phi)(?![A-Za-z])/g, (_m, n: string) => ' ' + GREEK[n] + ' ');
  s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/√\s*\(/g, 'sqrt(');
  // \frac{a}{b} and \sqrt{a}, repeatedly (handles nesting from the inside out)
  for (let i = 0; i < 12; i++) {
    const before = s;
    s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
    s = s.replace(/\^\s*\{([^{}]*)\}/g, '^($1)');
    s = s.replace(/_\s*\{([^{}]*)\}/g, (_m, g: string) => '_' + g.replace(/[^A-Za-z0-9]/g, ''));
    if (s === before) break;
  }
  return s.replace(/\{/g, '(').replace(/\}/g, ')');
}

// ---------------------------------------------------------------- tokenizer

type Tok = { k: 'num' | 'id' | 'op' | 'lp' | 'rp'; s: string; v?: number };

function tokenize(s: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) return `bad number at ${i}`;
      out.push({ k: 'num', s: m[0], v: Number(m[0]) });
      i += m[0].length;
    } else if (/[Ͱ-Ͽ]/.test(c)) {
      // a Greek letter is one quantity (optionally subscripted); "Δx" is one quantity too
      const m = c === 'Δ' ? /^Δ[A-Za-z]?(_[A-Za-z0-9]+)?/.exec(s.slice(i))! : /^.(_[A-Za-z0-9]+)?/.exec(s.slice(i))!;
      out.push({ k: 'id', s: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z]/.test(c)) {
      // a word: known function/constant, or letters (implicit product of single-letter variables), with _subscript
      const m = /^[A-Za-z]+(_[A-Za-z0-9]+)?/.exec(s.slice(i))!;
      let word = m[0];
      i += word.length;
      if (PROSE.has(word.toLowerCase())) return `prose word "${word}"`;
      if (word.includes('_')) {
        out.push({ k: 'id', s: word });
        continue;
      }
      while (word.length) {
        const fn = [...FUNCS].filter((f) => word.startsWith(f)).sort((a, b) => b.length - a.length)[0];
        if (fn) {
          out.push({ k: 'id', s: fn });
          word = word.slice(fn.length);
        } else if (word.startsWith('pi')) {
          out.push({ k: 'id', s: 'pi' });
          word = word.slice(2);
        } else {
          out.push({ k: 'id', s: word[0] });
          word = word.slice(1);
        }
      }
    } else if ('+-*/^'.includes(c)) {
      out.push({ k: 'op', s: c });
      i++;
    } else if (c === '(' || c === '[') {
      out.push({ k: 'lp', s: '(' });
      i++;
    } else if (c === ')' || c === ']') {
      out.push({ k: 'rp', s: ')' });
      i++;
    } else {
      return `unsupported character "${c}"`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- parser (recursive descent)

class Parser {
  private p = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  private peek = () => this.toks[this.p];
  private startsPrimary(t?: Tok): boolean {
    return !!t && (t.k === 'num' || t.k === 'id' || t.k === 'lp');
  }
  parse(): Node {
    const n = this.additive();
    if (this.p < this.toks.length) throw new Error(`unexpected "${this.peek().s}"`);
    return n;
  }
  private additive(): Node {
    let a = this.term();
    for (let t = this.peek(); t?.k === 'op' && (t.s === '+' || t.s === '-'); t = this.peek()) {
      this.p++;
      a = { t: 'bin', op: t.s as '+' | '-', a, b: this.term() };
    }
    return a;
  }
  private term(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && (t.s === '*' || t.s === '/')) {
        this.p++;
        a = { t: 'bin', op: t.s as '*' | '/', a, b: this.unary() };
      } else if (this.startsPrimary(t)) {
        a = { t: 'bin', op: '*', a, b: this.unary() }; // implicit multiplication: 2x, x(y+1), (a)(b)
      } else return a;
    }
  }
  private unary(): Node {
    const t = this.peek();
    if (t?.k === 'op' && (t.s === '-' || t.s === '+')) {
      this.p++;
      const a = this.unary();
      return t.s === '-' ? { t: 'neg', a } : a;
    }
    return this.power();
  }
  private power(): Node {
    const base = this.primary();
    const t = this.peek();
    if (t?.k === 'op' && t.s === '^') {
      this.p++;
      return { t: 'bin', op: '^', a: base, b: this.unary() }; // right-associative, allows x^-2
    }
    return base;
  }
  private primary(): Node {
    const t = this.toks[this.p++];
    if (!t) throw new Error('unexpected end');
    if (t.k === 'num') return { t: 'num', v: t.v! };
    if (t.k === 'lp') {
      const n = this.additive();
      if (this.toks[this.p]?.k !== 'rp') throw new Error('missing )');
      this.p++;
      return n;
    }
    if (t.k === 'id') {
      if (FUNCS.has(t.s)) {
        // sin(x) or sin x ; sin^2 x is not supported
        const next = this.peek();
        if (!this.startsPrimary(next)) throw new Error(`${t.s} needs an argument`);
        // sin(x)^2 means (sin x)^2 : a parenthesized argument binds tighter than ^ ; sin x^2 means sin(x^2)
        return { t: 'call', fn: t.s, a: next!.k === 'lp' ? this.primary() : this.power() };
      }
      if (t.s in CONSTS) return { t: 'num', v: CONSTS[t.s] };
      return { t: 'var', name: t.s };
    }
    throw new Error(`unexpected "${t.s}"`);
  }
}

/** Hostile or runaway input guard: transcriptions are short; reject anything absurd before recursing. */
const MAX_LEN = 400;

export function parseExpr(src: string): Parsed {
  if (src.length > MAX_LEN) return { ok: false, reason: 'too long' };
  const toks = tokenize(normalize(src));
  if (typeof toks === 'string') return { ok: false, reason: toks };
  if (toks.length === 0) return { ok: false, reason: 'empty' };
  try {
    return { ok: true, ast: new Parser(toks).parse() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- evaluation

export function evaluate(n: Node, env: Record<string, number>): number {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'var':
      return n.name in env ? env[n.name] : NaN;
    case 'neg':
      return -evaluate(n.a, env);
    case 'bin': {
      const a = evaluate(n.a, env);
      const b = evaluate(n.b, env);
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? NaN : a / b;
        case '^':
          return a < 0 && !Number.isInteger(b) ? NaN : Math.pow(a, b);
      }
      return NaN;
    }
    case 'call': {
      const x = evaluate(n.a, env);
      switch (n.fn) {
        case 'sqrt':
          return x < 0 ? NaN : Math.sqrt(x);
        case 'ln':
        case 'log':
          return x <= 0 ? NaN : Math.log(x);
        case 'asin':
        case 'acos':
          return Math.abs(x) > 1 ? NaN : n.fn === 'asin' ? Math.asin(x) : Math.acos(x);
        default: {
          const f = (Math as unknown as Record<string, (v: number) => number>)[n.fn];
          return f ? f(x) : NaN;
        }
      }
    }
  }
}

export function variablesOf(n: Node, acc = new Set<string>()): string[] {
  if (n.t === 'var') acc.add(n.name);
  else if (n.t === 'neg' || n.t === 'call') variablesOf(n.a, acc);
  else if (n.t === 'bin') {
    variablesOf(n.a, acc);
    variablesOf(n.b, acc);
  }
  return [...acc].sort();
}

export function substitute(n: Node, name: string, repl: Node): Node {
  switch (n.t) {
    case 'var':
      return n.name === name ? repl : n;
    case 'neg':
      return { t: 'neg', a: substitute(n.a, name, repl) };
    case 'call':
      return { t: 'call', fn: n.fn, a: substitute(n.a, name, repl) };
    case 'bin':
      return { t: 'bin', op: n.op, a: substitute(n.a, name, repl), b: substitute(n.b, name, repl) };
    default:
      return n;
  }
}

// ---------------------------------------------------------------- sampling

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = 40;
const MIN_VALID = 8;
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)) + 1e-12;

/** Deterministic sample points over positive reals (physics quantities), so results are reproducible. */
function points(vars: string[]): Array<Record<string, number>> {
  const rnd = mulberry32(0x9e3779b9);
  return Array.from({ length: SAMPLES }, () => Object.fromEntries(vars.map((v) => [v, 0.35 + rnd() * 2.9])));
}

/**
 * Students write rounded values with "=". Allow the precision they wrote: half a unit in the last digit
 * of each decimal literal (relative), times a safety factor for error growth through powers. Looser means
 * fewer flags, so this errs toward silence. Capped at 5%.
 */
export function roundingTol(src: string, base = 1e-9): number {
  let rel = 0;
  for (const m of src.matchAll(/(\d*)\.(\d+)/g)) {
    const v = Math.abs(Number(m[0]));
    if (v > 0) rel = Math.max(rel, (0.5 * Math.pow(10, -m[2].length)) / v);
  }
  // Significant figures: a whole number ending in zeros may be rounded at its last non-zero digit ("19.6 = 20" at
  // 2 s.f., "9.8 · 31 = 300" at 1 s.f.), the ambiguity STACK's NumSigFigs also allows. Not scaled by the safety
  // factor and capped lower, so it only covers honest rounding.
  let sig = 0;
  // (a base 10 of scientific notation, "\times 10^{8}", is exact, not a rounded value)
  for (const m of src.matchAll(/(?<![\d.])([1-9]\d*?)(0+)(?![\d.]|\s*\^)/g)) {
    const v = Number(m[0]);
    sig = Math.max(sig, (0.5 * Math.pow(10, m[2].length)) / v);
  }
  return Math.min(0.05, Math.max(base, rel * 4, Math.min(sig, 0.03)));
}

const sameVars = (a: Node, b: Node) => variablesOf(a).join(',') === variablesOf(b).join(',');

export type Equiv = 'equivalent' | 'different' | 'inconclusive';

/** Are two expressions equal as functions? (positive-real sampling) */
export function exprEquivalent(a: Node, b: Node, tol = 1e-9): Equiv {
  const vars = variablesOf({ t: 'bin', op: '+', a, b });
  let valid = 0;
  for (const env of points(vars)) {
    const x = evaluate(a, env);
    const y = evaluate(b, env);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    valid++;
    if (!close(x, y, tol)) return 'different';
  }
  return valid >= MIN_VALID ? 'equivalent' : 'inconclusive';
}

// ---------------------------------------------------------------- lines and steps

export type StepKind =
  | 'equivalent' // same expression / same equation (up to a nonzero constant multiple)
  | 'solution' // next is a solved form that satisfies the previous equation
  | 'implied' // every solution of the previous equation satisfies the next (e.g. squaring both sides)
  | 'inconsistent' // next contradicts the previous line
  | 'unrelated' // can't relate them with simple algebra (e.g. squaring, new information)
  | 'unparsed'; // could not read one of the lines as math

export type StepRelation = { kind: StepKind; detail: string };

type Line = { eq: [Node, Node] | null; expr: Node | null };

function splitEq(src: string): string[] {
  // '=' that is not part of <=, >=, !=, ==, or an arrow
  return normalize(src)
    .replace(/\\approx|≈/g, '=')
    .replace(/\\neq|≠|\\le|\\ge|≤|≥|<=|>=|!=|==/g, ' ?? ')
    .split('=')
    .map((x) => x.trim());
}

function parseLine(src: string): Line | string {
  const parts = splitEq(src);
  if (parts.some((p) => p.includes('??'))) return 'inequality or relation not supported';
  if (parts.length === 1) {
    const p = parseExpr(parts[0]);
    return p.ok ? { eq: null, expr: p.ast } : p.reason;
  }
  const asts: Node[] = [];
  for (const part of parts) {
    const p = parseExpr(part);
    if (!p.ok) return p.reason;
    asts.push(p.ast);
  }
  if (asts.length === 2) return { eq: [asts[0], asts[1]], expr: null };
  return 'chain';
}

const residual = (eq: [Node, Node]): Node => ({ t: 'bin', op: '-', a: eq[0], b: eq[1] });

/** A side that is a pure number (no quantities), e.g. "19.6" or "2 \cdot 9.8". */
function isNumericSide(src: string): boolean {
  const p = parseExpr(src);
  return p.ok && variablesOf(p.ast).length === 0;
}

/** Unit groups (\mathrm{...}) never carry digits that mean precision: drop them before reading the written decimals. */
const tolOf = (src: string) => roundingTol(src.replace(/\\(?:text|mathrm|operatorname|rm)\s*\{[^{}]*\}/g, ' '));

/** One line whose sides carry units of different dimensions ("5 N = 5 J") is wrong whatever the numbers say. */
export function checkLineUnits(src: string): StepRelation | null {
  const u = unitize(src);
  if (!u) return null;
  const mm = dimensionMismatch(u.sides);
  return mm ? { kind: 'inconsistent', detail: `the units on the two sides of an "=" don't match` } : null;
}

/** a = b = c ... : every adjacent pair must be identically equal. Returns null if the line isn't a chain. */
export function checkChain(raw: string, minSides = 3): StepRelation | null {
  // Units are compared in SI (src/verify/units.ts); a link between a side with units and one without is not judged.
  const u = unitize(raw);
  const src = u ? u.joined : raw;
  const parts = splitEq(src);
  if (parts.length < minSides || parts.some((p) => p.includes('??'))) return null;
  if (u && u.sides.length !== parts.length) return { kind: 'unparsed', detail: 'units: sides did not line up' };
  const asts: Node[] = [];
  for (const part of parts) {
    const p = parseExpr(part);
    if (!p.ok) return { kind: 'unparsed', detail: p.reason };
    asts.push(p.ast);
  }
  const tol = Math.max(tolOf(raw), /\\approx|≈/.test(raw) ? 2e-2 : 0);
  let skipped = 0;
  for (let i = 0; i + 1 < asts.length; i++) {
    // F = ma = (2)(9.8) = 19.6 : links that substitute numbers for variables are not identities.
    // "19.6 N = 19.6" (a unit dropped on one side) is not evidence either.
    if (!sameVars(asts[i], asts[i + 1]) || (u && u.sides[i].hasUnits !== u.sides[i + 1].hasUnits)) {
      skipped++;
      continue;
    }
    const r = exprEquivalent(asts[i], asts[i + 1], tol);
    if (r === 'different') return { kind: 'inconsistent', detail: `link ${i + 1} of the chain is not an identity` };
    if (r === 'inconclusive') skipped++;
  }
  return skipped
    ? { kind: 'unrelated', detail: `${skipped} link(s) not judged` }
    : { kind: 'equivalent', detail: 'every link of the chain is an identity' };
}

const CONTINUES = /^\s*(=|\\approx|≈)/;

/**
 * A line that starts with "=" continues the previous line's chain ("v = 90/1.5 = 60" then "= 60·1000/3600 = 16.7").
 * Judges it as a chain: its own links always, and the link to the previous line's last side ONLY when both sides
 * write their units. Without units that first "=" is often a silent conversion (60 [km/h] = 60·1000/3600 [m/s]),
 * and flagging it would be a false downgrade. Returns null if the line is not a continuation.
 */
export function checkContinuation(prevSrc: string, curSrc: string): StepRelation | null {
  if (!CONTINUES.test(curSrc) || prevSrc.trim() === '') return null;
  const own = curSrc.trim().replace(CONTINUES, '').trim();
  const prevSides = prevSrc.split(/\\approx|≈|=/);
  const last = prevSides[prevSides.length - 1].trim();
  const ownSides = own.split(/\\approx|≈|=/);
  if (!last || !ownSides[0].trim()) return { kind: 'unparsed', detail: 'empty side' };
  const link = `${last} = ${ownSides[0].trim()}`;
  const u = unitize(link);
  if (u && u.sides.length === 2 && u.sides.every((s) => s.hasUnits)) {
    const units = checkLineUnits(link);
    if (units) return { ...units, detail: 'units differ from the line it continues' };
    const r = checkChain(link, 2);
    if (r?.kind === 'inconsistent') return { kind: 'inconsistent', detail: 'does not equal the end of the line it continues' };
  }
  if (ownSides.length >= 2) {
    const units = checkLineUnits(own);
    if (units) return units;
    const r = checkChain(own, 2);
    if (r) return r;
  }
  return { kind: 'unrelated', detail: 'continuation not judged' };
}

/** Does the step prev -> next follow by simple algebra? Conservative: 'unrelated' is not an accusation. */
export function checkStep(prevRaw: string, nextRaw: string): StepRelation {
  // Units: compare in SI, and only when both lines agree on writing units (a dropped unit is not an error signal).
  const up = unitize(prevRaw);
  const un = unitize(nextRaw);
  const withUnits = (u: ReturnType<typeof unitize>) => !!u && u.sides.some((s) => s.hasUnits);
  if (withUnits(up) !== withUnits(un)) return { kind: 'unrelated', detail: 'units written on one line only' };
  // "x = 5 cm = 5": a bare number next to a side with units says nothing about conversion
  const bareNumber = (u: ReturnType<typeof unitize>) => !!u && u.sides.some((s) => s.hasUnits) && u.sides.some((s) => !s.hasUnits && isNumericSide(s.src));
  if (bareNumber(up) || bareNumber(un)) return { kind: 'unrelated', detail: 'a number without its unit' };
  const prevSrc = up ? up.joined : prevRaw;
  const nextSrc = un ? un.joined : nextRaw;
  const prev = parseLine(prevSrc);
  const next = parseLine(nextSrc);
  if (typeof prev === 'string' || typeof next === 'string') {
    return { kind: 'unparsed', detail: typeof prev === 'string' ? `prev: ${prev}` : `next: ${next as string}` };
  }
  const loose = /\\approx|≈/.test(prevRaw + nextRaw);
  const tol = Math.max(tolOf(prevRaw + ' ' + nextRaw), loose ? 2e-2 : 0);

  if (prev.expr && next.expr) {
    // substituting numbers for variables (ma -> (2)(9.8)) is a normal step, not a comparison of functions
    if (!sameVars(prev.expr, next.expr)) return { kind: 'unrelated', detail: 'different quantities' };
    const r = exprEquivalent(prev.expr, next.expr, tol);
    if (r === 'equivalent') return { kind: 'equivalent', detail: 'same expression' };
    if (r === 'different') return { kind: 'inconsistent', detail: 'expression changed value' };
    return { kind: 'unrelated', detail: 'too few valid sample points' };
  }
  if (!prev.eq || !next.eq) return { kind: 'unrelated', detail: 'expression vs equation' };

  const r1 = residual(prev.eq);
  const r2 = residual(next.eq);
  const vars = variablesOf({ t: 'bin', op: '+', a: r1, b: r2 });

  // 1. residuals proportional by a nonzero constant: same equation (2x+3=7 -> x=2, x^2-1=0 -> (x-1)(x+1)=0)
  let c: number | undefined;
  let valid = 0;
  let proportional = true;
  for (const env of points(vars)) {
    const a = evaluate(r1, env);
    const b = evaluate(r2, env);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const scale = Math.max(Math.abs(evaluate(prev.eq[0], env)), Math.abs(evaluate(prev.eq[1], env)), 1e-12);
    if (Math.abs(a) < 1e-9 * scale) continue; // no information when r1 ~ 0
    const ratio = b / a;
    valid++;
    if (c === undefined) c = ratio;
    else if (!close(c, ratio, tol)) {
      proportional = false;
      break;
    }
  }
  if (proportional && valid >= MIN_VALID && c !== undefined && Math.abs(c) > 1e-12) {
    return { kind: 'equivalent', detail: `same equation (factor ${Number(c.toPrecision(6))})` };
  }

  // 2. next is a solved form  v = expr  (or expr = v) : substitute into the previous equation
  const solved = (['0', '1'] as const)
    .map((i) => {
      const lhs = next.eq![Number(i)];
      const rhs = next.eq![1 - Number(i)];
      return lhs.t === 'var' && !variablesOf(rhs).includes(lhs.name) ? { name: lhs.name, rhs } : null;
    })
    .find(Boolean);
  if (solved && variablesOf(r1).includes(solved.name)) {
    const sub = substitute(r1, solved.name, solved.rhs);
    const rest = variablesOf(sub);
    // Judge only a claimed rearrangement (rhs built from the previous line's other variables) or a full
    // numeric answer. "v = 6" after "v = v_0 + a t" leaves unknowns free: that is a substitution, not a claim.
    const otherVars = variablesOf(r1).filter((x) => x !== solved.name);
    const rhsVars = variablesOf(solved.rhs);
    const judgeable = rest.length === 0 || (rhsVars.length > 0 && rhsVars.every((x) => otherVars.includes(x)));
    if (!judgeable) return { kind: 'unrelated', detail: 'substitution leaves unknowns free' };
    let ok = 0;
    let bad = 0;
    for (const env of points(rest)) {
      const v = evaluate(sub, env);
      if (!Number.isFinite(v)) continue;
      const scale = Math.max(
        Math.abs(evaluate(substitute(prev.eq[0], solved.name, solved.rhs), env)),
        Math.abs(evaluate(substitute(prev.eq[1], solved.name, solved.rhs), env))
      );
      if (Math.abs(v) <= tol * scale + 1e-12) ok++;
      else bad++;
    }
    if (ok >= MIN_VALID && bad === 0) return { kind: 'solution', detail: `${solved.name} satisfies the previous equation` };
    if (bad >= MIN_VALID && ok === 0) return { kind: 'inconsistent', detail: `${solved.name} does not satisfy the previous equation` };
  }

  // 3. one unknown: find the real roots of the previous equation and test them against the next one
  if (vars.length === 1) {
    const v = vars[0];
    const roots = realRoots(r1, v);
    if (roots.length > 0) {
      let undefinedAtRoot = false;
      const holds = roots.filter((x) => {
        const val = evaluate(r2, { [v]: x });
        if (!Number.isFinite(val)) {
          undefinedAtRoot = true; // sqrt(-2), 1/0 ...: the next line says nothing there, so don't judge
          return false;
        }
        const scale = Math.max(Math.abs(evaluate(next.eq![0], { [v]: x })), Math.abs(evaluate(next.eq![1], { [v]: x })), 1);
        return Math.abs(val) <= Math.max(tol, 1e-6) * scale;
      });
      if (undefinedAtRoot) return { kind: 'unrelated', detail: 'next line is undefined at a solution' };
      if (holds.length === roots.length) return { kind: 'implied', detail: 'every solution of the previous line satisfies this line' };
      if (holds.length === 0) return { kind: 'inconsistent', detail: 'no solution of the previous line satisfies this line' };
    }
  }

  return { kind: 'unrelated', detail: 'not a simple rearrangement of the previous equation' };
}

/** Real roots of f(v)=0 on [-20,20] by sign-change scan + bisection (misses tangent roots; fine as evidence). */
export function realRoots(f: Node, v: string, lo = -20, hi = 20, steps = 4000): number[] {
  const roots: number[] = [];
  const g = (x: number) => evaluate(f, { [v]: x });
  let x0 = lo;
  let g0 = g(x0);
  for (let i = 1; i <= steps; i++) {
    const x1 = lo + ((hi - lo) * i) / steps;
    const g1 = g(x1);
    if (Number.isFinite(g0) && Number.isFinite(g1)) {
      if (g1 === 0) roots.push(x1);
      else if (g0 * g1 < 0) {
        let a = x0;
        let b = x1;
        for (let k = 0; k < 60; k++) {
          const m = (a + b) / 2;
          if (g(a) * g(m) <= 0) b = m;
          else a = m;
        }
        const r = (a + b) / 2;
        // a sign change at a pole (1/x) is not a root
        if (Math.abs(g(r)) < 1e-6 * Math.max(1, Math.abs(g0), Math.abs(g1))) roots.push(r);
      }
    }
    x0 = x1;
    g0 = g1;
  }
  return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-6);
}
