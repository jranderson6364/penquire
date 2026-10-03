import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChain, checkStep, evaluate, exprEquivalent, parseExpr, type Node } from './expr.ts';
import { applyAlgebraGuard, applyLeakGuard } from './guard.ts';
import { findLeak } from './leak.ts';
import type { CheckResult, LineVerdict } from '../ai/types.ts';

// Seeded PRNG so failures reproduce.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARS = ['x', 'y', 'v_0', 't'];

function randomAst(r: () => number, depth: number): Node {
  const pick = r();
  if (depth <= 0 || pick < 0.25) return r() < 0.5 ? { t: 'num', v: Math.floor(r() * 9) + 1 } : { t: 'var', name: VARS[Math.floor(r() * VARS.length)] };
  if (pick < 0.35) return { t: 'neg', a: randomAst(r, depth - 1) };
  if (pick < 0.45) return { t: 'call', fn: ['sin', 'cos', 'exp', 'sqrt', 'abs'][Math.floor(r() * 5)], a: randomAst(r, depth - 1) };
  const ops = ['+', '-', '*', '/', '^'] as const;
  const op = ops[Math.floor(r() * ops.length)];
  // keep exponents small and integer so values stay finite and comparable
  const b: Node = op === '^' ? { t: 'num', v: Math.floor(r() * 3) + 1 } : randomAst(r, depth - 1);
  return { t: 'bin', op, a: randomAst(r, depth - 1), b };
}

/** Fully parenthesized text, so any parse that disagrees with direct evaluation is a parser bug. */
function show(n: Node): string {
  switch (n.t) {
    case 'num':
      return String(n.v);
    case 'var':
      return n.name;
    case 'neg':
      return `(-${show(n.a)})`;
    case 'call':
      return `${n.fn}(${show(n.a)})`;
    case 'bin':
      return `(${show(n.a)} ${n.op} ${show(n.b)})`;
  }
}

const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test('round trip: parsing the printed form evaluates like the original tree (500 random trees)', () => {
  const r = rng(12345);
  const env = { x: 1.7, y: 0.6, v_0: 2.3, t: 0.9 };
  for (let i = 0; i < 500; i++) {
    const ast = randomAst(r, 4);
    const text = show(ast);
    const p = parseExpr(text);
    assert.ok(p.ok, `failed to parse ${text}: ${p.ok ? '' : p.reason}`);
    if (p.ok) assert.ok(same(evaluate(p.ast, env), evaluate(ast, env)), `mismatch for ${text}`);
  }
});

test('reflexive: a line is never inconsistent with itself, and equals itself (300 random lines)', () => {
  const r = rng(777);
  for (let i = 0; i < 300; i++) {
    const text = `${show(randomAst(r, 3))} = ${show(randomAst(r, 3))}`;
    assert.notEqual(checkStep(text, text).kind, 'inconsistent', text);
    const e = parseExpr(show(randomAst(r, 3)));
    if (e.ok) assert.notEqual(exprEquivalent(e.ast, e.ast), 'different');
  }
});

test('adding the same term to both sides is never inconsistent (rearrangement property)', () => {
  const r = rng(99);
  for (let i = 0; i < 200; i++) {
    const a = show(randomAst(r, 2));
    const b = show(randomAst(r, 2));
    const c = show(randomAst(r, 2));
    const before = `${a} = ${b}`;
    const after = `${a} + ${c} = ${b} + ${c}`;
    assert.notEqual(checkStep(before, after).kind, 'inconsistent', `${before} -> ${after}`);
  }
});

test('garbage never throws and always yields a value (1000 random strings)', () => {
  const r = rng(2024);
  const alphabet = 'abxyz019 .+-*/^=()[]{}\\_$,;:!?<>%&|~"\'frac sqrt sin cos pi ΔθΩ';
  for (let i = 0; i < 1000; i++) {
    const len = Math.floor(r() * 60);
    let s = '';
    for (let k = 0; k < len; k++) s += alphabet[Math.floor(r() * alphabet.length)];
    assert.doesNotThrow(() => {
      parseExpr(s);
      checkStep(s, 'x = 2');
      checkStep('x = 2', s);
      checkChain(s);
      findLeak(s, { level: 1, lines: [{ id: 'L1', reading: 'x + 1 = 3', verdict: 'valid' }] });
    }, JSON.stringify(s));
  }
});

test('hostile inputs are rejected quickly instead of overflowing the stack or hanging', () => {
  const t0 = Date.now();
  const deep = '('.repeat(20000) + 'x' + ')'.repeat(20000);
  assert.equal(parseExpr(deep).ok, false);
  assert.equal(parseExpr('x+'.repeat(5000) + 'x').ok, false); // too long
  assert.doesNotThrow(() => checkStep(deep, deep));
  assert.doesNotThrow(() => checkStep('9^9^9^9 = x', 'x = 9^9^9'));
  assert.ok(Date.now() - t0 < 2000, 'took too long');
});

const L = (id: string, reading: string, verdict: LineVerdict['verdict'] = 'valid'): LineVerdict => ({ id, reading, verdict, note: 'ok' });

test('a full-page check (25 lines, long hint text) stays well under a second', () => {
  const lines = Array.from({ length: 25 }, (_, i) => L(`L${i + 1}`, `${i + 1}x + 3 = ${7 * (i + 1)}`));
  const result: CheckResult = {
    lines,
    parts: [],
    feedback: 'Compare L3 with L4. Does $2x + 1 = 5$ matter? Also look at $x = 1$ and $y = 2x$. Then $3x = 9$ vs $4x = 8$. Why?',
    question: 'What happens to both sides between L7 and L8 when x = 2 is tried?',
    fixedSinceLast: [],
    stillOpen: [],
    model: 'm',
  };
  const t0 = Date.now();
  applyLeakGuard({ ...result, lines: applyAlgebraGuard(result.lines) }, 1);
  assert.ok(Date.now() - t0 < 1000, `guards took ${Date.now() - t0} ms`);
});

test('guards never crash a check even if a checker internal fails', () => {
  const bad = { id: 'L1', reading: null as unknown as string, verdict: 'valid', note: 'x' } as LineVerdict;
  assert.doesNotThrow(() => applyAlgebraGuard([bad, L('L2', 'x = 1')]));
  assert.doesNotThrow(() =>
    applyLeakGuard({ lines: [bad], parts: [], feedback: 'x = 2', question: 'q', fixedSinceLast: [], stillOpen: [], model: 'm' }, 1)
  );
});
