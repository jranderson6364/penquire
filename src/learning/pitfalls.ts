// Naming the fall (demo pack only). After the fresh problem is submitted, the outcome says what went wrong the first
// time and whether it came back, in words written here, never by the model. Pure: readings in, sentences out.
//
// Shown only after submission: naming the pitfall before the fresh attempt would be a cue inside it.
import { evaluate, normalize, parseExpr, variablesOf, type Node } from '../verify/expr.ts';
import { equationsOf } from './assess.ts';
import { TASK_GIVENS, type TaskGiven } from './demoPack.ts';
import type { AssessmentResult, Fall } from './types';

export type Pitfall = 'start_height' | 'start_sign' | 'gravity_sign' | 'wrong_root' | 'slip';

type Quad = { a: number; b: number; c: number };

const EPS = 1e-6;

/** f(t) = lhs − rhs of one equation in t, if it parses with t as its only variable. */
function difference(eq: string): Node | null {
  const parts = normalize(eq).split('=');
  if (parts.length !== 2) return null;
  const p = parseExpr(`(${parts[0]}) - (${parts[1]})`);
  if (!p.ok) return null;
  const vars = variablesOf(p.ast);
  return vars.length === 1 && vars[0] === 't' ? p.ast : null;
}

/** The equation as a·t² + b·t + c = 0 when it really is a quadratic in t (a ≠ 0); null for anything else. */
export function quadraticOf(eq: string): Quad | null {
  const f = difference(eq);
  if (!f) return null;
  const at = (t: number) => evaluate(f, { t });
  const c = at(0);
  const p = at(1);
  const m = at(-1);
  const q = { a: (p + m) / 2 - c, b: (p - m) / 2, c };
  if (![q.a, q.b, q.c].every(Number.isFinite) || Math.abs(q.a) < EPS) return null;
  for (const t of [2, 3, -2.5, 0.5]) {
    const want = q.a * t * t + q.b * t + q.c;
    if (Math.abs(at(t) - want) > 1e-6 * Math.max(1, Math.abs(want))) return null;
  }
  return q;
}

/** k with s ≈ k·r for every coefficient, or null. */
function scale(s: Quad, r: Quad): number | null {
  const rr = r.a * r.a + r.b * r.b + r.c * r.c;
  const k = (s.a * r.a + s.b * r.b + s.c * r.c) / rr;
  const ok = (x: number, y: number) => Math.abs(x - k * y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(k * y));
  return Math.abs(k) > EPS && ok(s.a, r.a) && ok(s.b, r.b) && ok(s.c, r.c) ? k : null;
}

const sign = (x: number) => (Math.abs(x) < EPS ? 0 : x > 0 ? 1 : -1);

/** How a written quadratic differs from the task's setup: 'ok' when it is the setup (any rearrangement or scaling). */
export function compareSetup(q: Quad, model: Quad): 'ok' | Exclude<Pitfall, 'wrong_root'> {
  if (scale(q, model)) return 'ok';
  if (sign(q.c) === 0 && sign(model.c) !== 0) return 'start_height';
  if (sign(model.b) !== 0 && sign(q.b) !== 0) {
    if (sign(q.a / q.b) !== sign(model.a / model.b)) return 'gravity_sign';
    if (sign(q.c / q.b) !== sign(model.c / model.b)) return 'start_sign';
  } else if (sign(q.a * q.c) !== sign(model.a * model.c)) {
    return 'gravity_sign';
  }
  return 'slip';
}

const modelOf = (given: TaskGiven): Quad | null => quadraticOf(given.equation);

/** The rejected root's value ("t = -1" → -1). */
const rejectedValues = (given: TaskGiven): number[] =>
  (given.rejected ?? []).flatMap((r) => {
    const m = /=\s*(-?\d+(?:\.\d+)?)/.exec(normalize(r));
    return m ? [Number(m[1])] : [];
  });

/** "t = 3", "t = -1 s": a single t equal to a number. */
function statedValue(eq: string): number | null {
  const m = /^\s*t\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(normalize(eq).replace(/\s*(?:s|sec|seconds?)\s*$/, ''));
  return m ? Number(m[1]) : null;
}

/**
 * The first pitfall among one task's readings: a height equation that differs from the setup wins; then a rejected
 * root given as a value; then a generic slip when anything was flagged at all.
 */
export function classify(given: TaskGiven, readings: readonly string[]): { pitfall: Pitfall; restRight: boolean } | undefined {
  const model = modelOf(given);
  if (!model) return undefined;
  for (const r of readings) {
    for (const { eq } of equationsOf(r)) {
      const q = quadraticOf(eq);
      if (!q) continue;
      const how = compareSetup(q, model);
      if (how === 'ok') continue;
      return { pitfall: how, restRight: how === 'start_height' && restRightOf(q, model) };
    }
  }
  const bad = rejectedValues(given);
  if (readings.some((r) => equationsOf(r).some(({ eq }) => {
    const v = statedValue(eq);
    return v !== null && bad.some((b) => Math.abs(b - v) < EPS);
  }))) return { pitfall: 'wrong_root', restRight: false };
  return readings.length > 0 ? { pitfall: 'slip', restRight: false } : undefined;
}

/** The t² and t terms match the setup (only the starting height is missing). */
function restRightOf(q: Quad, model: Quad): boolean {
  if (sign(model.b) === 0 || sign(q.b) === 0) return false;
  return Math.abs(q.a / q.b - model.a / model.b) <= 1e-6 * Math.max(1, Math.abs(model.a / model.b));
}

/** Did the submitted work on another task write the setup right, or fall the same way again? */
export function carried(pitfall: Pitfall, given: TaskGiven, readings: readonly string[], result?: AssessmentResult): 'avoided' | 'repeated' | undefined {
  const model = modelOf(given);
  if (!model) return undefined;
  if (pitfall === 'wrong_root' || pitfall === 'slip') {
    const again = classify(given, readings);
    if (again && again.pitfall === pitfall && pitfall === 'wrong_root') return 'repeated';
    return result === 'pass' ? 'avoided' : undefined;
  }
  let sawSetup = false;
  for (const r of readings) {
    for (const { eq } of equationsOf(r)) {
      const q = quadraticOf(eq);
      if (!q) continue;
      const how = compareSetup(q, model);
      if (how === pitfall) return 'repeated';
      if (how === 'ok') sawSetup = true;
    }
  }
  return sawSetup ? 'avoided' : undefined;
}

const fmt = (n: number) => String(Math.round(Math.abs(n) * 100) / 100);

const FALL_TEXT: Record<Pitfall, (h: string, restRight: boolean) => string> = {
  start_height: (h, rest) =>
    `Your first height equation started the ball at 0 instead of ${h} m up${rest ? ', so it found when the ball came back down to where it was thrown from, not when it hit the ground' : ''}.`,
  start_sign: (h) => `Your first height equation put the start below the ground. With up as positive, the ball starts at +${h} m.`,
  gravity_sign: () => 'Your first height equation had gravity pushing the ball up. With up as positive, the t² term has to be negative.',
  wrong_root: () => 'Your first answer kept the negative time too, but that is before the ball was thrown.',
  slip: () => 'Your first attempt had a step that did not follow from the one before it.',
};

const AVOIDED_TEXT: Record<Pitfall, (h: string) => string> = {
  start_height: (h) => `This time your equation started from ${h} m up.`,
  start_sign: (h) => `This time your equation started above the ground, at +${h} m.`,
  gravity_sign: () => 'This time gravity pulled down in your equation: the t² term was negative.',
  wrong_root: () => 'This time you kept only the time after the throw.',
  slip: () => 'This time every step held up.',
};

const REPEATED_TEXT: Record<Pitfall, (h: string) => string> = {
  start_height: (h) => `The same thing came back: the equation started at 0 instead of ${h} m up.`,
  start_sign: () => 'The same thing came back: the start was below the ground.',
  gravity_sign: () => 'The same thing came back: gravity pushed the ball up in the equation.',
  wrong_root: () => 'The same thing came back: the negative time was kept as an answer.',
  slip: () => 'A step still did not follow.',
};

export type FallSummary = { pitfall: Pitfall; first: string; now?: string };

/**
 * Two sentences for the outcome card: what tripped the student up on the first task, and how that went on the
 * submitted task. `now` is left out when the submitted work doesn't show either way.
 */
export function fallSummary(fall: Fall | undefined, submittedTaskId: string, submittedReadings: readonly string[], result?: AssessmentResult): FallSummary | undefined {
  if (!fall) return undefined;
  const firstGiven = TASK_GIVENS[fall.taskId];
  const nowGiven = TASK_GIVENS[submittedTaskId];
  if (!firstGiven || !nowGiven) return undefined;
  const c = classify(firstGiven, fall.readings);
  if (!c) return undefined;
  // every setup in the pack is written "h + v·t − 5t² = 0", so the constant term is the starting height
  const h0 = fmt(modelOf(firstGiven)!.c);
  const h1 = fmt(modelOf(nowGiven)?.c ?? 0);
  const how = carried(c.pitfall, nowGiven, submittedReadings, result);
  const now = how === 'avoided' ? AVOIDED_TEXT[c.pitfall](h1) : how === 'repeated' ? REPEATED_TEXT[c.pitfall](h1) : undefined;
  return { pitfall: c.pitfall, first: FALL_TEXT[c.pitfall](h0, c.restRight), ...(now ? { now } : {}) };
}

/** A submitted line as the outcome uses it: "L2: 15 + 10t - 5t^2 = 0" → "15 + 10t - 5t^2 = 0". */
export const stripLineId = (r: string) => r.replace(/^\s*L\d+\s*:\s*/, '');
