import type { HelpLevel } from '../ai/types';
import { checkStep, normalize, parseExpr, variablesOf, type Node } from './expr.ts';

/**
 * Answer-leak guard for tutor text. Keyword filters miss paraphrased math; this checks the MATH: if a
 * formula in a hint is the corrected step, a solved form, or a final answer for the student's own
 * problem (decided with the algebra checker, not wording), the hint is withheld. Redundant to the prompt rules.
 *
 *  levels 0-3: block the corrected step, any solved form, and final answers
 *  level 4   : one step may be explained, but a final numeric answer is still blocked
 */

export type LeakLine = { id: string; reading: string; verdict: string };
export type LeakContext = { level: HelpLevel; lines: LeakLine[] };
export type Leak = { fragment: string; why: 'final-answer' | 'solved-form' | 'corrected-step' };

const squash = (s: string) => normalize(s).replace(/\s+/g, '').toLowerCase();

/** Math-looking fragments inside prose: $..$, `..`, and runs around "=" with leading prose words trimmed. */
export function extractMath(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\$([^$]+)\$|`([^`]+)`|\\\(([^)]*)\\\)/g)) out.add((m[1] ?? m[2] ?? m[3]).trim());
  const bare = text.replace(/\$[^$]*\$|`[^`]*`/g, ' ');
  for (const sentence of bare.split(/(?<=[.?!])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    const eq = words.findIndex((w) => w.includes('='));
    if (eq < 0) continue;
    let a = eq;
    let b = eq;
    while (a > 0 && mathWord(words[a - 1])) a--;
    while (b + 1 < words.length && mathWord(words[b + 1])) b++;
    out.add(words.slice(a, b + 1).join(' ').replace(/[.,;:!?]+$/, ''));
  }
  return [...out].filter((f) => f.length > 0 && f.length < 120);
}

const SHORT_PROSE = new Set(['we', 'it', 'is', 'as', 'an', 'in', 'on', 'so', 'to', 'of', 'by', 'at', 'or', 'if', 'be', 'do', 'go', 'he', 'me', 'my', 'no', 'up', 'us', 'am', 'ok', 'a', 'i']);
const FUNC_WORDS = new Set(['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs', 'pi']);

/** A token that can belong to a formula: has a digit/operator/bracket, or is a 1-2 letter symbol (not a small word). */
function mathWord(w: string): boolean {
  const t = w.replace(/[.,;:!?]+$/, '');
  if (!t) return false;
  if (/[0-9=+\-*/^_\\(){}]/.test(t)) return true;
  const lower = t.toLowerCase();
  if (FUNC_WORDS.has(lower)) return true;
  return /^[A-Za-z]{1,2}$/.test(t) && !SHORT_PROSE.has(lower);
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

const ADVANCES = new Set(['equivalent', 'solution', 'implied']);

export function findLeak(text: string, ctx: LeakContext): Leak | null {
  const math = ctx.lines.filter((l) => l.reading.trim() && l.verdict !== 'unreadable' && l.verdict !== 'context');
  if (math.length === 0) return null;
  const onPage = new Set(math.map((l) => squash(l.reading)));

  for (const fragment of extractMath(text)) {
    if (onPage.has(squash(fragment))) continue; // quoting the student's own line is fine
    if (!parseExpr(fragment.split('=')[0]).ok) continue; // not math
    const rel = math.map((l) => ({ l, kind: checkStep(l.reading, fragment).kind }));
    if (!rel.some((r) => ADVANCES.has(r.kind))) continue; // unrelated to the student's work (e.g. a different example)

    if (numericSolvedForm(fragment) && rel.some((r) => r.kind === 'solution' || r.kind === 'equivalent')) {
      return { fragment, why: 'final-answer' };
    }
    if (ctx.level >= 4) continue;
    if (soleVarSolved(fragment) && rel.some((r) => ADVANCES.has(r.kind))) {
      return { fragment, why: 'solved-form' };
    }
    // corrected step: follows from the last valid line, while the student's wrong line does not
    for (let i = 0; i < math.length; i++) {
      const wrong = math[i];
      if (wrong.verdict !== 'incorrect' && wrong.verdict !== 'partial') continue;
      const prevValid = [...math.slice(0, i)].reverse().find((l) => l.verdict === 'valid');
      if (!prevValid) continue;
      if (checkStep(prevValid.reading, wrong.reading).kind === 'inconsistent' && ADVANCES.has(checkStep(prevValid.reading, fragment).kind)) {
        return { fragment, why: 'corrected-step' };
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
