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

const isProse = (src: string) => !sides(src) && (src.match(/[A-Za-z]{2,}/g) ?? []).length >= 3;

/**
 * Map the provider's check of the submitted independent work to an Assessment.
 *
 * Only call this with a check that actually came back. On a provider or guard error the caller keeps the work and
 * offers retry; it must not call this or invent a result.
 */
export function assessSubmission(task: DemoTask, check: CheckResult, snapshotId: string, now: number): Assessment {
  const done = (result: AssessmentResult, reasons: string[]): Assessment => ({
    result,
    reasons,
    source: 'provider+rubric',
    packVersion: DEMO_PACK.version,
    snapshotId,
    at: now,
  });

  const lines = check.lines.filter((l) => l.verdict !== 'context' && reading(l) !== '').sort((a, b) => lineNo(a.id) - lineNo(b.id));
  if (lines.length === 0) return done('unassessable', [COULD_NOT_ASSESS, 'No written work was found on the page.']);

  const unsure = lines.filter((l) => l.verdict === 'unreadable' || l.readConfidence === 'low' || l.guard === 'reading');
  if (unsure.length > 0) {
    return done('unassessable', [COULD_NOT_ASSESS, `The reading of ${unsure.map((l) => l.id).join(', ')} is uncertain. Confirm what you wrote, then check again.`]);
  }

  const equation = TASK_EQUATIONS[task.id];
  const math = lines.filter((l) => sides(reading(l)));
  const prose = lines.filter((l) => isProse(reading(l)));
  const reasons: string[] = [];

  const last = math[math.length - 1];
  const finalOk = !!last && isSolvedForm(reading(last)) && checkStep(task.expected.finalAnswer, reading(last)).kind === 'equivalent';
  if (!last || !isSolvedForm(reading(last))) reasons.push('There is no final value written as a single variable equal to a number.');
  else if (!finalOk) reasons.push(`The final value on ${last.id} is not right yet.`);

  const badSteps = math.filter((l) => l.verdict !== 'valid' || (!!equation && checkStep(equation, reading(l)).kind === 'inconsistent'));
  if (badSteps.length > 0) {
    const where = badSteps.map((l) => l.id).join(', ');
    reasons.push(finalOk ? `The final number is right, but ${where} does not follow from the step before it.` : `${where} does not follow from the step before it.`);
  }

  if (!math.some((l) => task.expected.acceptedSteps.some((s) => isKeyStep(reading(l), s)))) {
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
