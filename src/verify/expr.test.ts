import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChain, checkStep, evaluate, exprEquivalent, parseExpr, type Node } from './expr.ts';

const ast = (s: string): Node => {
  const p = parseExpr(s);
  if (!p.ok) throw new Error(`${s}: ${p.reason}`);
  return p.ast;
};
const VALID = ['equivalent', 'solution', 'implied'];
const val = (s: string, env: Record<string, number> = {}) => evaluate(ast(s), env);

test('precedence, unary minus, right-associative power', () => {
  assert.equal(val('2+3*4'), 14);
  assert.equal(val('-2^2'), -4);
  assert.equal(val('2^3^2'), 512);
  assert.equal(val('2^-1'), 0.5);
  assert.equal(val('10-4-3'), 3);
  assert.equal(val('8/2/2'), 2);
});

test('implicit multiplication and variables', () => {
  assert.equal(val('2x', { x: 3 }), 6);
  assert.equal(val('x(y+1)', { x: 2, y: 3 }), 8);
  assert.equal(val('(a+1)(a-1)', { a: 3 }), 8);
  assert.equal(val('xy', { x: 2, y: 5 }), 10);
  assert.equal(val('v_0 t', { v_0: 3, t: 2 }), 6);
});

test('functions and constants', () => {
  assert.ok(Math.abs(val('sin(pi/2)') - 1) < 1e-12);
  assert.ok(Math.abs(val('\\sin\\pi')) < 1e-12);
  assert.equal(val('sqrt(16)'), 4);
  assert.equal(val('\\sqrt{x}', { x: 9 }), 3);
  assert.ok(Number.isNaN(val('ln(0)')));
  assert.ok(Number.isNaN(val('1/0')));
});

test('LaTeX fractions, powers, unicode', () => {
  assert.equal(val('\\frac{x+1}{2}', { x: 5 }), 3);
  assert.equal(val('\\frac{\\frac{1}{2}}{2}'), 0.25);
  assert.equal(val('x^{2}', { x: 3 }), 9);
  assert.equal(val('3 \\cdot 4'), 12);
  assert.equal(val('3×4'), 12);
  assert.equal(val('x²', { x: 3 }), 9);
});

test('prose and unknown LaTeX commands are rejected, never guessed', () => {
  for (const bad of ['x = 2 or x = 3', 'x=2 and y=3', String.raw`3 \text{ m/s}`, 'for all x']) assert.equal(parseExpr(bad).ok, false, bad);
  assert.equal(parseExpr('mv').ok, true);
});

test('parse errors are values, not exceptions', () => {
  for (const bad of ['', '2+', '(1+2', 'x # y', '*3']) {
    const p = parseExpr(bad);
    assert.equal(p.ok, false, bad);
  }
});

test('expression equivalence', () => {
  assert.equal(exprEquivalent(ast('(x+1)^2'), ast('x^2+2x+1')), 'equivalent');
  assert.equal(exprEquivalent(ast('(x+1)^2'), ast('x^2+1')), 'different');
  assert.equal(exprEquivalent(ast('sin(x)^2 + cos(x)^2'), ast('1')), 'equivalent');
  assert.equal(exprEquivalent(ast('\\frac{1}{2}mv^2'), ast('mv^2/2')), 'equivalent');
});

test('steps: valid rearrangements', () => {
  assert.equal(checkStep('2x+3=7', '2x=4').kind, 'equivalent');
  assert.equal(checkStep('2x+3=7', 'x=2').kind, 'equivalent');
  assert.equal(checkStep('x^2-1=0', '(x-1)(x+1)=0').kind, 'equivalent');
  assert.ok(VALID.includes(checkStep('F = ma', 'a = F/m').kind));
  assert.equal(checkStep('x^2=4', 'x=2').kind, 'solution');
  assert.equal(checkStep('(x+1)^2', 'x^2+2x+1').kind, 'equivalent');
});

test('steps: algebra mistakes are inconsistent', () => {
  assert.equal(checkStep('2x+3=7', 'x=3').kind, 'inconsistent');
  assert.equal(checkStep('2x+3=7', '2x=10').kind, 'inconsistent');
  assert.equal(checkStep('3x-5=10', '3x=5').kind, 'inconsistent');
  assert.equal(checkStep('(x+1)^2', 'x^2+1').kind, 'inconsistent');
  assert.equal(checkStep('x^2=4', 'x=3').kind, 'inconsistent');
});

test('steps: other variables are handled symbolically', () => {
  assert.ok(VALID.includes(checkStep('v = v_0 + a t', 'a = (v - v_0)/t').kind));
  assert.ok(!VALID.includes(checkStep('v = v_0 + a t', 'a = (v + v_0)/t').kind));
  assert.ok(VALID.includes(checkStep('y = 3x + 1', 'x = (y-1)/3').kind));
});

test('steps: unreadable input is reported, never guessed', () => {
  assert.equal(checkStep('2x+3=7', 'x = ???').kind, 'unparsed');
  assert.equal(checkStep('x < 3', 'x < 2').kind, 'unparsed');
  assert.equal(checkStep('x^2 = 4', 'x = 2 or x = -2').kind, 'unparsed');
});

test('steps: a new equation that is not a rearrangement is unrelated, not wrong', () => {
  assert.equal(checkStep('x+1=3', '(x+1)^2=9').kind, 'implied');
  assert.equal(checkStep('x+1=3', 'y=2').kind, 'unrelated');
});

test('approximate values use a loose tolerance', () => {
  assert.equal(checkStep('x^2 = 10', 'x \\approx 3.16').kind, 'solution');
  assert.equal(checkStep('x^2 = 10', 'x = 3.5').kind, 'inconsistent');
});

test('chains', () => {
  assert.equal(checkChain('(x+1)^2 = x^2+2x+1 = 25')?.kind, 'unrelated'); // value substitution is not judged
  assert.equal(checkChain('(x+1)^2 = x^2+2x+1')?.kind ?? 'none', 'none');
  assert.equal(checkChain('(x+1)(x-1) = x^2 - 1 = x^2-1')?.kind, 'equivalent');
  assert.equal(checkChain('(x+1)^2 = x^2+1 = 2')?.kind, 'inconsistent');
});
