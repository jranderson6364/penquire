import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkChain, checkStep } from './expr.ts';
import { applyAlgebraGuard } from './guard.ts';
import type { LineVerdict } from '../ai/types.ts';

// Realistic physics/math steps a student writes. NONE of these may ever be called 'inconsistent'.
// This is the false-downgrade gate: a wrong downgrade on valid work costs the student's trust.
const VALID_STEPS: Array<[string, string]> = [
  ['v = v_0 + a t', 'v = 6'], // plugging in values
  ['v = v_0 + a t', 'v = 2 + 4(1)'],
  ['F = ma', 'a = 9.8'],
  ['F = ma', 'F = (2)(9.8)'],
  ['x + y = 5', 'x = 3'], // a free variable remains
  ['x^2 = 10', 'x = 3.16'], // rounded value written with '='
  ['x^2 = 10', 'x \\approx 3.2'],
  ['F = ma', 'a = F/m'],
  ['K = \\frac{1}{2} m v^2', 'K = \\frac{1}{2}(2)(3)^2'],
  ['K = \\frac{1}{2}(2)(3)^2', 'K = 9'],
  ['\\Delta x = x_f - x_i', '\\Delta x = 5 - 2'],
  ['\\theta = \\omega t', '\\theta = (3)(2)'],
  ['d = v t', 'd = 12'],
  ['(2)(9.81)', '19.6'],
  ['2x + 3 = 7', 'x = 2'],
  ['\\sin\\theta = \\frac{3}{5}', '\\theta = \\arcsin(0.6)'],
  ['T = 2\\pi\\sqrt{\\frac{L}{g}}', 'T = 2\\pi\\sqrt{\\frac{1}{9.8}}'],
];

test('valid physics steps are never called inconsistent', () => {
  for (const [a, b] of VALID_STEPS) {
    const r = checkStep(a, b);
    assert.notEqual(r.kind, 'inconsistent', `${a}  ->  ${b}  (${r.detail})`);
  }
});

test('chains through substitution are not judged link by link', () => {
  assert.notEqual(checkChain('F = ma = (2)(9.8) = 19.6')?.kind, 'inconsistent');
  assert.notEqual(checkChain('K = \\frac{1}{2}mv^2 = \\frac{1}{2}(2)(9) = 9')?.kind, 'inconsistent');
  assert.equal(checkChain('(2)(9.81) = 19.62 = 19.6')?.kind, 'equivalent');
});

test('real slips are still caught', () => {
  assert.equal(checkStep('2x+3=7', '2x=10').kind, 'inconsistent');
  assert.equal(checkStep('x^2 = 10', 'x = 3.5').kind, 'inconsistent');
  assert.equal(checkStep('(2)(9.81)', '21.6').kind, 'inconsistent');
  assert.equal(checkStep('v = v_0 + a t', 'a = (v + v_0)/t').kind, 'inconsistent');
  assert.equal(checkChain('(2)(9.81) = 19.6 = 30')?.kind, 'inconsistent');
});

test('Greek letters and Delta are single quantities, not products of letters', () => {
  assert.notEqual(checkStep('\\theta = \\omega t', '\\omega = \\theta / t').kind, 'inconsistent');
  assert.notEqual(checkStep('\\Delta x = v t', '\\Delta x = (3)(2)').kind, 'inconsistent');
  assert.notEqual(checkStep('\\omega = \\theta / t', 'e = 2').kind, 'inconsistent');
});

const L = (id: string, reading: string, verdict: LineVerdict['verdict'] = 'valid'): LineVerdict => ({ id, reading, verdict, note: 'ok', part: 'a' });

test('guard does not bridge across an unreadable line', () => {
  const out = applyAlgebraGuard([L('L1', '2x+3=7'), L('L2', '???', 'unreadable'), L('L3', 'y = 10')]);
  assert.equal(out[2].verdict, 'valid');
});

test('guard leaves a whole realistic derivation untouched', () => {
  const full = [L('L1', 'v = v_0 + a t'), L('L2', 'v = 2 + 4(1)'), L('L3', 'v = 6')];
  assert.equal(applyAlgebraGuard(full), full);
});
