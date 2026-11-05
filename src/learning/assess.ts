// Independent-submission assessment against the pack rubric (T04). Deterministic: the provider reads and grades
// the lines, this decides the label. A matching final number never approves invalid or missing reasoning.
import type { CheckResult, LineVerdict } from '../ai/types';
import { checkStep, exprEquivalent, normalize, parseExpr, variablesOf } from '../verify/expr.ts';
import { plainQuantities, sameDim, type Unit } from '../verify/units.ts';
import { DEMO_PACK, TASK_GIVENS } from './demoPack.ts';
import type { Assessment, AssessmentResult, DemoTask } from './types';

export const COULD_NOT_ASSESS = 'Could not assess this reading';

const lineNo = (id: string) => Number(id.replace(/\D/g, '')) || 0;
const reading = (l: LineVerdict) => (typeof l.reading === 'string' ? l.reading.trim() : '');

/** Both sides of a single "=" parse as math. */
function sides(src: string): [string, string] | null {
  const parts = normalize(src).split('=');
  if (parts.length !== 2) return null;
  return parseExpr(parts[0]).ok && parseExpr(parts[1]).ok ? [parts[0], parts[1]] : null;
}

const sameExpr = (a: string, b: string) => {
  const pa = parseExpr(a);
  const pb = parseExpr(b);
  return pa.ok && pb.ok && exprEquivalent(pa.ast, pb.ast) === 'equivalent';
};

/**
 * The key step: any equation equivalent to an accepted one ("20 + 15t - 5t^2 = 0", "t^2 - 3t - 4 = 0",
 * "(t - 4)(t + 1) = 0", sides swapped), or, for an accepted "A = 0", a quantity set to A ("y = 20 + 15t - 5t^2").
 */
function isKeyStep(eq: string, accepted: string): boolean {
  if (checkStep(accepted, eq).kind === 'equivalent') return true;
  const s = sides(eq);
  const a = sides(accepted);
  if (!s || !a || !sameExpr(a[1], '0')) return false;
  const pa = parseExpr(a[0]);
  const vars = pa.ok ? variablesOf(pa.ast) : [];
  return ([[0, 1], [1, 0]] as const).some(([i, j]) => {
    const lone = parseExpr(s[i]);
    return lone.ok && lone.ast.t === 'var' && !vars.includes(lone.ast.name) && sameExpr(s[j], a[0]);
  });
}

/** "t = 4" / "4 = t": a lone variable equals a number. Returns the variable. */
function solvedVar(eq: string): string | undefined {
  const s = sides(eq);
  if (!s) return undefined;
  const [a, b] = s.map((x) => parseExpr(x));
  if (!a.ok || !b.ok) return undefined;
  if (a.ast.t === 'var' && variablesOf(b.ast).length === 0) return a.ast.name;
  if (b.ast.t === 'var' && variablesOf(a.ast).length === 0) return b.ast.name;
  return undefined;
}

export type WrittenEquation = { eq: string; units: Unit[] };

/**
 * The equations on one written line: "6y = 30 so y = 5", "6y + 3 = 33 → 6y = 30", a chain "3(2y+1) = 6y + 3 = 33"
 * (as consecutive pairs), "t = 4 or t = -1" and "t = 4\,\mathrm{s}." all count, not only a line holding exactly one
 * equation. A whole side that is a number with a scale-1 unit is read as the number (src/verify/units.ts), and the
 * unit is kept so the caller can check its dimension.
 */
export function equationsOf(src: string): WrittenEquation[] {
  // a remark in brackets, "t = 3 s (t = -1 s is before the throw)", is its own piece
  const remarks = src.replace(/\(([^()]*)\)/g, (m, inner: string) =>
    (inner.match(/(?<!\\)\b[A-Za-z]{4,}\b/g) ?? []).some((w) => !/^(?:sqrt|sinh|cosh|tanh|asin|acos|atan)$/i.test(w)) ? `; ${inner};` : m);
  const pieces = remarks.split(/\s*(?:→|⇒|=>|\\Rightarrow|\\implies|(?<!\\)[;,]|\\(?:text|mathrm)\s*\{\s*(?:or|and|so)\s*\}|\b(?:so|then|and|or|therefore|thus|hence)\b)\s*/i);
  return pieces.flatMap((p) => {
    const { text, units } = plainQuantities(p.replace(/[.!?:]+\s*$/, ''));
    const sidesOf = text.split('=');
    const out: WrittenEquation[] = [];
    for (let i = 0; i + 1 < sidesOf.length; i++) {
      const eq = `${sidesOf[i].trim()} = ${sidesOf[i + 1].trim()}`;
      if (sides(eq)) out.push({ eq, units });
    }
    return out;
  });
}

/** A sentence, possibly with maths in it ("t = -1 s is before the throw, so ..."): three or more words outside LaTeX commands. */
const isProse = (src: string) => (src.replace(/\\[A-Za-z]+/g, ' ').match(/[A-Za-z]{2,}/g) ?? []).length >= 3;

/** Words that say a value is being thrown out ("t = -1 is before the throw, reject it"), not given as an answer. */
const REJECTS = /\b(?:reject\w*|discard\w*|ignor\w*|not|no|never|cannot|can'?t|isn'?t|doesn'?t|impossible|invalid|extraneous|unphysical|physical\w*|negative|positive|before|earlier|past|sense|only|keep\w*)\b|≠|\\neq|✗|✘/i;

/** The number a "t = -1" answer key states, as a pattern that finds "-1" / "−1" written on a line (not "-10" or "2-1"). */
function valuePattern(answer: string): RegExp | null {
  const m = /=\s*([-−]?)\s*(\d+(?:\.\d+)?)/.exec(normalize(answer));
  if (!m) return null;
  const sign = m[1] ? '[-−]\\s*' : '(?<![-−]\\s*)';
  return new RegExp(`(?<![\\d.])${sign}${m[2].replace('.', '\\.')}(?![\\d.])`);
}

/**
 * Map the provider's check of the submitted independent work to an Assessment.
 *
 * `submittedLineIds` are the submitted snapshot's line ids; any the check left out make the result unassessable.
 *
 * Only call this with a check that actually came back. On a provider or guard error the caller keeps the work and
 * offers retry; it must not call this or invent a result.
 */
export function assessSubmission(task: DemoTask, check: CheckResult, snapshotId: string, now: number, submittedLineIds?: string[]): Assessment {
  const done = (result: AssessmentResult, reasons: string[]): Assessment => ({
    result,
    reasons,
    source: 'provider+rubric',
    packVersion: DEMO_PACK.version,
    snapshotId,
    at: now,
  });

  // A submitted line the check never returned, or one it could not read at all (empty reading), is unread work:
  // assessing the rest would grade only part of the submission. A sketch the model labelled 'context' is not work.
  const returned = new Set(check.lines.map((l) => l.id));
  const unread = [
    ...(submittedLineIds ?? []).filter((id) => !returned.has(id)),
    ...check.lines.filter((l) => l.verdict !== 'context' && reading(l) === '').map((l) => l.id),
  ];
  if (unread.length > 0) {
    return done('unassessable', [COULD_NOT_ASSESS, `${unread.join(', ')} could not be read. Rewrite it more clearly, then submit again.`]);
  }

  const lines = check.lines.filter((l) => l.verdict !== 'context' && reading(l) !== '').sort((a, b) => lineNo(a.id) - lineNo(b.id));
  if (lines.length === 0) return done('unassessable', [COULD_NOT_ASSESS, 'No written work was found on the page.']);

  const unsure = lines.filter((l) => l.verdict === 'unreadable' || l.readConfidence === 'low' || l.guard === 'reading');
  if (unsure.length > 0) {
    return done('unassessable', [COULD_NOT_ASSESS, `The reading of ${unsure.map((l) => l.id).join(', ')} is uncertain. Confirm what you wrote, then check again.`]);
  }

  const given = TASK_GIVENS[task.id];
  const equation = given?.equation;
  const eqs = new Map(lines.map((l) => [l, equationsOf(reading(l))]));
  const math = lines.filter((l) => eqs.get(l)!.length > 0);
  const prose = lines.filter((l) => isProse(reading(l)));
  const reasons: string[] = [];

  // The final answer is the last solved form of the answer's own variable ("t = 4 s"), so a substitution check
  // written after it, or a "g = 10" restated later, doesn't hide it.
  const answer = equationsOf(task.expected.finalAnswer)[0];
  const answerVar = answer ? solvedVar(answer.eq) : undefined;
  // A rejected root on a line that throws it out ("t = -1 s is before the throw") is not an answer.
  const thrownOut = (l: LineVerdict, eq: string) => REJECTS.test(reading(l)) && (given?.rejected ?? []).some((r) => checkStep(r, eq).kind === 'equivalent');
  const solved = math.flatMap((l) => eqs.get(l)!.filter((w) => !!answerVar && solvedVar(w.eq) === answerVar && !thrownOut(l, w.eq)).map((w) => ({ l, w })));
  const last = solved[solved.length - 1];
  const finalOk = !!last && !!answer && checkStep(answer.eq, last.w.eq).kind === 'equivalent';
  if (!last) reasons.push('There is no final value written as a single variable equal to a number.');
  else if (!finalOk) reasons.push(`The final value on ${last.l.id} is not right yet.`);
  else if (answer.units.length > 0 && last.w.units.some((u) => !answer.units.some((a) => sameDim(a.dim, u.dim)))) {
    reasons.push(`The unit on ${last.l.id} is not a unit of the quantity asked for.`);
  }

  // A root that solves the equation but isn't the answer ("t = -1"), still given as an answer on the final line or
  // after it ("t = 4, -1", "t = 4 or t = -1"), fails unless that line throws it out.
  if (last) {
    for (const rej of given?.rejected ?? []) {
      const pattern = valuePattern(rej);
      const keeps = lines.filter((l) => lineNo(l.id) >= lineNo(last.l.id) && !!pattern?.test(normalize(reading(l))) && !REJECTS.test(reading(l)));
      if (keeps.length > 0) reasons.push(`${keeps.map((l) => l.id).join(', ')} still gives a solution that does not answer the question.`);
    }
  }

  const badSteps = math.filter((l) => l.verdict !== 'valid' || (!!equation && eqs.get(l)!.some((w) => checkStep(equation, w.eq).kind === 'inconsistent')));
  if (badSteps.length > 0) {
    const where = badSteps.map((l) => l.id).join(', ');
    reasons.push(finalOk ? `The final number is right, but ${where} does not follow from the situation or the step before it.` : `${where} does not follow from the situation or the step before it.`);
  }

  if (!math.some((l) => eqs.get(l)!.some((w) => task.expected.acceptedSteps.some((s) => isKeyStep(w.eq, s))))) {
    reasons.push(`The key step is not shown: ${task.expected.keyStep}.`);
  }

  const otherBad = lines.filter((l) => !math.includes(l) && (l.verdict === 'incorrect' || l.verdict === 'partial'));
  if (otherBad.length > 0) reasons.push(`${otherBad.map((l) => l.id).join(', ')} is not quite right yet.`);

  if (task.asksForExplanation) {
    const missing = check.parts.flatMap((p) => p.missing);
    if (!prose.some((l) => l.verdict === 'valid')) reasons.push('The written explanation the problem asks for is missing.');
    else if (missing.length > 0) reasons.push(`Still missing: ${missing.join('; ')}.`);
  }

  if (reasons.length > 0) return done('needs_practice', reasons);
  const pass = ['The final value is right.', 'Every step follows from the one before.', 'The key step is shown.'];
  if (task.asksForExplanation) pass.push('The explanation is there.');
  return done('pass', pass);
}

/**
 * The last solved value of the task's unknown on a checked page does not fit the task: it doesn't solve the model
 * setup (15t − 5t² = 0 → t = 3, the time back at the cliff edge) or it is a rejected root. A check that says "done"
 * on such a page is wrong, whatever its verdicts (src/learning/workspaceFlow.ts doneVerdict). False when unsure.
 */
export function finalMisfits(lines: readonly Pick<LineVerdict, 'id' | 'reading' | 'verdict'>[], taskId: string | undefined, answerVar = 't'): boolean {
  const given = taskId ? TASK_GIVENS[taskId] : undefined;
  if (!given) return false;
  const solved = [...lines]
    .filter((l) => l.verdict !== 'context' && typeof l.reading === 'string')
    .sort((a, b) => lineNo(a.id) - lineNo(b.id))
    .flatMap((l) => equationsOf(l.reading).filter((w) => solvedVar(w.eq) === answerVar));
  const last = solved[solved.length - 1];
  if (!last) return false;
  if (checkStep(given.equation, last.eq).kind === 'inconsistent') return true;
  return (given.rejected ?? []).some((r) => checkStep(r, last.eq).kind === 'equivalent');
}
