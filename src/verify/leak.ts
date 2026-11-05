import type { HelpLevel } from '../ai/types';
import { checkStep, normalize, parseExpr, variablesOf, type Node } from './expr.ts';
import { plainQuantities } from './units.ts';

/**
 * Answer-leak guard for tutor text. Keyword filters miss paraphrased math; this checks the MATH: if a
 * formula in a hint is the corrected step, a solved form, or a final answer for the student's own
 * problem (decided with the algebra checker, not wording), the hint is withheld. Redundant to the prompt rules.
 *
 *  levels 0-3: block the corrected step, any solved form, final answers and a hidden setup restated
 *  level 4   : one step may be explained, but a final numeric answer is still blocked
 */

/**
 * A line the guard judges against. `role` (T15) marks lines that are not the student's ink:
 *  - 'hidden': a task's setup worked out from the prompt but not printed in it (src/learning/demoPack.ts TASK_GIVENS).
 *    Judged against like a valid line, never treated as on the page: restating it, or an equivalent equation, is a
 *    'setup' leak unless the student already wrote an equivalent line.
 *  - 'sayable': a value the tutor may name, e.g. a root to reject ("t = -1"). Never judged against, never a leak.
 */
export type LeakLine = { id: string; reading: string; verdict: string; role?: 'hidden' | 'sayable' };
export type LeakContext = { level: HelpLevel; lines: LeakLine[] };
export type Leak = { fragment: string; why: 'final-answer' | 'solved-form' | 'corrected-step' | 'setup' };

const squash = (s: string) => normalize(s).replace(/\s+/g, '').toLowerCase();
/** "t = 4\,\mathrm{s}" and "t = 4 seconds" are "t = 4" to the checker (src/verify/units.ts plainQuantities). */
const plain = (s: string) => plainQuantities(s).text;

/** Math-looking fragments inside prose: $..$, `..`, and runs around each "=" with leading prose words trimmed. */
export function extractMath(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$([^$]+)\$|`([^`]+)`|\\\(([^)]*)\\\)/g)) out.add((m[1] ?? m[2] ?? m[3]).trim());
  const bare = text.replace(/\$[^$]*\$|`[^`]*`/g, ' ');
  for (const sentence of bare.split(/(?<=[.?!])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    // every "=" in the sentence, not only the first ("Factor t^2 - 3t - 4 = 0 to get t = 4.")
    for (let eq = 0; eq < words.length; eq++) {
      if (!words[eq].includes('=')) continue;
      let a = eq;
      let b = eq;
      while (a > 0 && mathWord(words[a - 1])) a--;
      while (b + 1 < words.length && mathWord(words[b + 1])) b++;
      out.add(words.slice(a, b + 1).join(' ').replace(/[.,;:!?]+$/, ''));
      eq = b;
    }
  }
  return [...out].filter((f) => f.length > 0 && f.length < 120);
}

const SHORT_PROSE = new Set(['we', 'it', 'is', 'as', 'an', 'in', 'on', 'so', 'to', 'of', 'by', 'at', 'or', 'if', 'be', 'do', 'go', 'he', 'me', 'my', 'no', 'up', 'us', 'am', 'ok', 'a', 'i']);
const FUNC_WORDS = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'pi']);

/** A token that can belong to a formula: has a digit/operator/bracket, or is a 1-2 letter symbol (not a small word). */
function mathWord(w: string): boolean {
  const t = w.replace(/[.,;:!?]+$/, '');
  if (!t) return false;
  if (/[0-9=+\-*/^_\\(){}−·×²³]/.test(t)) return true;
  const lower = t.toLowerCase();
  if (FUNC_WORDS.has(lower)) return true;
  return /^[A-Za-z]{1,2}$/.test(t) && !SHORT_PROSE.has(lower);
}

/**
 * "4 seconds", "after 4 s", "4\,\mathrm{s}" with no "=": a time, read as "t = 4" when the work has a time t. Spelled
 * numbers ("four seconds") are not caught.
 */
const TIME = /(?<![\w.^])([-−]?\d+(?:\.\d+)?)\s*(?:\\[,;! ]\s*)*(?:\\(?:mathrm|text)\s*\{\s*(?:s|sec|secs|seconds?)\s*\}|(?:s|sec|secs|seconds?)\b)/g;
function timeFragments(text: string): string[] {
  return [...text.matchAll(TIME)].map((m) => `t = ${m[1]}`);
}

const isVar = (n: Node) => n.t === 'var';
const isNumeric = (n: Node) => variablesOf(n).length === 0;

/** "x = 4", "4 = x" : a lone variable equals a number. */
function numericSolvedForm(fragment: string): boolean {
  const parts = normalize(fragment).replace(/\\approx|≈/g, '=').split('=');
  if (parts.length !== 2) return false;
  const a = parseExpr(parts[0]);
  const b = parseExpr(parts[1]);
  return a.ok && b.ok && ((isVar(a.ast) && isNumeric(b.ast)) || (isVar(b.ast) && isNumeric(a.ast)));
}

function soleVarSolved(fragment: string): boolean {
  const parts = normalize(fragment).split('=');
  if (parts.length !== 2) return false;
  const a = parseExpr(parts[0]);
  const b = parseExpr(parts[1]);
  return a.ok && b.ok && ((isVar(a.ast) && !variablesOf(b.ast).includes((a.ast as { name: string }).name)) || (isVar(b.ast) && !variablesOf(a.ast).includes((b.ast as { name: string }).name)));
}

/**
 * "10 + 10 - 20 = 0": every side a plain number. A true numeric identity is "implied" by any one-unknown equation, so it
 * says nothing about the student's problem (a substituted check of their own answer is not caught: a known gap).
 */
function numbersOnly(fragment: string): boolean {
  const parts = normalize(fragment).split('=');
  return parts.length >= 2 && parts.every((p) => {
    const e = parseExpr(p);
    return e.ok && isNumeric(e.ast);
  });
}

/** The single equations of a written line ("t = 4 or t = -1", "a = b = c" as pairs), units dropped, squashed. */
function pieces(reading: string): string[] {
  return reading
    .split(/\s*(?:→|⇒|=>|\\Rightarrow|\\implies|(?<!\\)[;,]|\\text\{\s*(?:or|and|so)\s*\}|\b(?:or|and|so|then)\b)\s*/i)
    .flatMap((p) => {
      const s = plain(p).split('=');
      return s.slice(0, -1).map((x, i) => squash(`${x}=${s[i + 1]}`));
    });
}

const ADVANCES = new Set(['equivalent', 'solution', 'implied']);

export function findLeak(text: string, ctx: LeakContext): Leak | null {
  const usable = (l: LeakLine) => !!l.reading.trim() && l.verdict !== 'unreadable';
  const math = ctx.lines.filter((l) => usable(l) && l.role !== 'sayable' && l.verdict !== 'context');
  if (math.length === 0) return null;
  // the student's own ink (headings and restated givens included): quoting any of it is fine
  const page = ctx.lines.filter((l) => usable(l) && !l.role);
  const onPage = new Set(page.flatMap((l) => [squash(l.reading), squash(plain(l.reading)), ...pieces(l.reading)]));
  const sayable = ctx.lines.filter((l) => usable(l) && l.role === 'sayable');
  const hasTime = math.some((l) => normalize(plain(l.reading)).split('=').some((side) => {
    const p = parseExpr(side);
    return p.ok && variablesOf(p.ast).includes('t');
  }));

  const fragments = [...extractMath(text), ...(hasTime ? timeFragments(text) : [])];
  for (const raw of fragments) {
    const fragment = plain(raw);
    if (onPage.has(squash(raw)) || onPage.has(squash(fragment))) continue; // quoting the student's own line is fine
    if (sayable.some((s) => squash(plain(s.reading)) === squash(fragment) || checkStep(plain(s.reading), fragment).kind === 'equivalent')) continue;
    if (!parseExpr(fragment.split('=')[0]).ok) continue; // not math
    if (numbersOnly(fragment)) continue;
    const rel = math.map((l) => ({ l, kind: checkStep(plain(l.reading), fragment).kind }));
    if (!rel.some((r) => ADVANCES.has(r.kind))) continue; // unrelated to the student's work (e.g. a different example)

    if (numericSolvedForm(fragment) && rel.some((r) => r.kind === 'solution' || r.kind === 'equivalent')) {
      return { fragment: raw, why: 'final-answer' };
    }
    if (ctx.level >= 4) continue;
    if (soleVarSolved(fragment) && rel.some((r) => ADVANCES.has(r.kind))) {
      return { fragment: raw, why: 'solved-form' };
    }
    // a hidden setup restated (in any equivalent form), unless the student already wrote an equivalent line
    if (rel.some((r) => r.l.role === 'hidden' && r.kind === 'equivalent') && !rel.some((r) => !r.l.role && r.l.verdict === 'valid' && r.kind === 'equivalent')) {
      return { fragment: raw, why: 'setup' };
    }
    // corrected step: follows from the last valid line, while the student's wrong line does not
    for (let i = 0; i < math.length; i++) {
      const wrong = math[i];
      if (wrong.verdict !== 'incorrect' && wrong.verdict !== 'partial') continue;
      const prevValid = [...math.slice(0, i)].reverse().find((l) => l.verdict === 'valid');
      if (!prevValid) continue;
      if (checkStep(plain(prevValid.reading), plain(wrong.reading)).kind === 'inconsistent' && ADVANCES.has(checkStep(plain(prevValid.reading), fragment).kind)) {
        return { fragment: raw, why: 'corrected-step' };
      }
    }
  }
  return null;
}

/** Drop every sentence containing a leak, keeping the line structure (markdown bullets) of the rest. */
export function scrubText(text: string, ctx: LeakContext): { text: string; leaks: Leak[] } {
  const leaks: Leak[] = [];
  const lines = text.split('\n').flatMap((line) => {
    if (!line.trim()) return [line];
    const kept = line.split(/(?<=[.?!])\s+/).filter((sentence) => {
      const leak = findLeak(sentence, ctx);
      if (leak) leaks.push(leak);
      return !leak;
    });
    return kept.length ? [kept.join(' ')] : [];
  });
  return { text: lines.join('\n').trim(), leaks };
}

/** A content-free guiding question used when the model's own question leaks. Mentions only line IDs. */
export function fallbackQuestion(level: HelpLevel, focusId?: string, prevId?: string): string {
  const here = focusId ? `line ${focusId}` : 'the flagged line';
  if (level === 0) return `Re-examine ${here}.`;
  if (prevId) return `Compare ${here} with ${prevId}: what changed between them, and was it done to both sides?`;
  return `What exactly did you do to get ${here}, and why is that step allowed?`;
}
