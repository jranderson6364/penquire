// Independent-submission assessment against the pack rubric (T04). Deterministic: the provider reads and grades
// the lines, this decides the label. A matching final number never approves invalid or missing reasoning.
import type { CheckResult, LineVerdict } from '../ai/types';
import { checkStep, exprEquivalent, normalize, parseExpr, variablesOf } from '../verify/expr.ts';
import { DEMO_PACK, TASK_EQUATIONS } from './demoPack.ts';
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

/** "6y + 3 = 33" written out (either order of sides), not the original with its parentheses. */
function isKeyStep(src: string, accepted: string): boolean {
  if (/[()]/.test(normalize(src))) return false;
  const s = sides(src);
  const a = sides(accepted);
  if (!s || !a) return false;
  return (sameExpr(s[0], a[0]) && sameExpr(s[1], a[1])) || (sameExpr(s[0], a[1]) && sameExpr(s[1], a[0]));
}

/** "y = 5" / "5 = y": a lone variable equals a number. */
function isSolvedForm(src: string): boolean {
  const s = sides(src);
  if (!s) return false;
  const [a, b] = s.map((x) => parseExpr(x));
  if (!a.ok || !b.ok) return false;
  const lone = (n: typeof a) => n.ok && n.ast.t === 'var';
  const num = (n: typeof a) => n.ok && variablesOf(n.ast).length === 0;
  return (lone(a) && num(b)) || (lone(b) && num(a));
}

/**
 * The equations on one written line: "6y = 30 so y = 5", "6y + 3 = 33 → 6y = 30", a chain "3(2y+1) = 6y + 3 = 33"
 * (as consecutive pairs) and "y = 5." all count, not only a line holding exactly one equation.
 */
function equations(src: string): string[] {
  const pieces = src.split(/\s*(?:→|⇒|=>|\\Rightarrow|\\implies|;|,|\b(?:so|then|and|therefore|thus|hence)\b)\s*/i);
  return pieces.flatMap((p) => {
    const sidesOf = p.replace(/[.!?:]+\s*$/, '').split('=');
    const out: string[] = [];
    for (let i = 0; i + 1 < sidesOf.length; i++) {
      const eq = `${sidesOf[i].trim()} = ${sidesOf[i + 1].trim()}`;
      if (sides(eq)) out.push(eq);
    }
    return out;
  });
}

const isProse = (src: string) => equations(src).length === 0 && (src.match(/[A-Za-z]{2,}/g) ?? []).length >= 3;

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
  // assessing the rest would grade only part of the submission.
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

  const equation = TASK_EQUATIONS[task.id];
  const eqs = new Map(lines.map((l) => [l, equations(reading(l))]));
  const math = lines.filter((l) => eqs.get(l)!.length > 0);
  const prose = lines.filter((l) => isProse(reading(l)));
  const reasons: string[] = [];

  // the final answer is the last solved form, so a substitution check written after it doesn't hide it
  const solved = math.flatMap((l) => eqs.get(l)!.filter(isSolvedForm).map((eq) => ({ l, eq })));
  const last = solved[solved.length - 1];
  const finalOk = !!last && checkStep(task.expected.finalAnswer, last.eq).kind === 'equivalent';
  if (!last) reasons.push('There is no final value written as a single variable equal to a number.');
  else if (!finalOk) reasons.push(`The final value on ${last.l.id} is not right yet.`);

  const badSteps = math.filter((l) => l.verdict !== 'valid' || (!!equation && eqs.get(l)!.some((eq) => checkStep(equation, eq).kind === 'inconsistent')));
  if (badSteps.length > 0) {
    const where = badSteps.map((l) => l.id).join(', ');
    reasons.push(finalOk ? `The final number is right, but ${where} does not follow from the step before it.` : `${where} does not follow from the step before it.`);
  }

  if (!math.some((l) => eqs.get(l)!.some((eq) => task.expected.acceptedSteps.some((s) => isKeyStep(eq, s))))) {
    reasons.push('The step that multiplies out the parentheses (or divides both sides first) is not shown.');
  }

  const otherBad = lines.filter((l) => !math.includes(l) && (l.verdict === 'incorrect' || l.verdict === 'partial'));
  if (otherBad.length > 0) reasons.push(`${otherBad.map((l) => l.id).join(', ')} is not quite right yet.`);

  if (task.asksForExplanation) {
    const missing = check.parts.flatMap((p) => p.missing);
    if (!prose.some((l) => l.verdict === 'valid')) reasons.push('The written explanation of how the multiplication applies to the parentheses is missing.');
    else if (missing.length > 0) reasons.push(`Still missing: ${missing.join('; ')}.`);
  }

  if (reasons.length > 0) return done('needs_practice', reasons);
  const pass = ['The final value is right.', 'Every step follows from the one before.', 'The key step is shown.'];
  if (task.asksForExplanation) pass.push('The explanation is there.');
  return done('pass', pass);
}
