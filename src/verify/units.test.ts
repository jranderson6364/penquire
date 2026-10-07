import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnit, unitize, sameDim } from './units.ts';
import { checkChain, checkLineUnits, checkStep, roundingTol } from './expr.ts';
import { applyAlgebraGuard } from './guard.ts';
import type { LineVerdict } from '../ai/types.ts';

const L = (id: string, reading: string): LineVerdict => ({ id, reading, verdict: 'valid', note: '', part: '1a' });
const verdicts = (ls: LineVerdict[]) => ls.map((l) => l.verdict);

// ---------------------------------------------------------------- unit parsing

test('common units parse to SI scale and dimension', () => {
  const ms2 = parseUnit('m/s^2')!;
  assert.equal(ms2.scale, 1);
  assert.deepEqual([...ms2.dim], [1, 0, -2, 0, 0, 0, 0]);
  assert.ok(sameDim(parseUnit('kg m/s^2')!.dim, parseUnit('N')!.dim));
  assert.ok(sameDim(parseUnit('N \\cdot m')!.dim, parseUnit('J')!.dim));
  assert.ok(Math.abs(parseUnit('km/h')!.scale - 1000 / 3600) < 1e-12);
  assert.equal(parseUnit('cm')!.scale, 0.01);
  assert.ok(sameDim(parseUnit('m s^{-1}')!.dim, parseUnit('m/s')!.dim));
  assert.ok(sameDim(parseUnit('1/s')!.dim, parseUnit('Hz')!.dim));
  assert.ok(Math.abs(parseUnit('\\mu C')!.scale - 1e-6) < 1e-18);
});

test('words and unknown symbols are not units', () => {
  for (const s of ['so', 'and', 'apples', 'x', 'm/', '', 'kg m/s^2 extra words here please']) assert.equal(parseUnit(s), null, s);
});

test('a line without unit groups is not touched', () => {
  assert.equal(unitize('v = 3t + 2'), null);
});

// ---------------------------------------------------------------- never a false downgrade

test('a correct unit conversion is not flagged (compared in SI)', () => {
  assert.notEqual(checkChain('v = 20\\,\\mathrm{m/s} = 72\\,\\mathrm{km/h}')?.kind, 'inconsistent');
  assert.notEqual(checkStep('x = 5\\,\\mathrm{cm}', 'x = 0.05\\,\\mathrm{m}').kind, 'inconsistent');
  assert.notEqual(checkStep('t = 2\\,\\mathrm{min}', 't = 120\\,\\mathrm{s}').kind, 'inconsistent');
});

test('a dropped unit is never evidence of an error', () => {
  assert.equal(checkStep('x = 5\\,\\mathrm{cm}', 'x = 5').kind, 'unrelated');
  assert.notEqual(checkChain('F = 2 \\cdot 9.8 = 19.6\\,\\mathrm{N}')?.kind, 'inconsistent');
  assert.notEqual(checkChain('d = 5\\,\\mathrm{km} = 5000')?.kind, 'inconsistent');
});

test('physics substitution with units in a chain is fine', () => {
  const lines = [L('L1', 'F = ma'), L('L2', 'F = (2\\,\\mathrm{kg})(9.8\\,\\mathrm{m/s^2}) = 19.6\\,\\mathrm{N}')];
  assert.deepEqual(verdicts(applyAlgebraGuard(lines)), ['valid', 'valid']);
});

test('degrees are left alone (stripping them would turn sin 30° into sin 30 rad)', () => {
  assert.notEqual(checkChain('\\sin(30^\\circ) = 0.5 = \\frac{1}{2}')?.kind, 'inconsistent');
});

test('an unrecognised \\text group means the line is not judged', () => {
  assert.equal(unitize('x = 5 \\text{ so } y = 2'), null);
  assert.notEqual(checkChain('x = 5 \\text{ so } y = 2 = 2')?.kind, 'inconsistent');
});

test('sums of quantities with units: numbers compared, dimension not inferred', () => {
  assert.notEqual(checkChain('d = 2\\,\\mathrm{m} + 3\\,\\mathrm{m} = 5\\,\\mathrm{m}')?.kind, 'inconsistent');
  assert.equal(checkLineUnits('d = 2\\,\\mathrm{m} + 3\\,\\mathrm{m}'), null);
});

test('upright labels in subscripts/superscripts are not units (no false downgrade)', () => {
  const correct = [
    'F_{\\mathrm{N}} = F_{\\mathrm{g}}\\cos\\theta',
    '(AB)^{\\mathrm{T}} = B^{\\mathrm{T}}A^{\\mathrm{T}}',
    'F_{\\mathrm{N}} = m_{\\mathrm{A}} g',
    'E_{\\mathrm{k}} = \\frac{1}{2} m v^2',
    'A^\\mathrm{T} = A',
    'F_\\mathrm{N} = mg\\cos\\theta',
  ];
  for (const s of correct) {
    assert.notEqual(checkLineUnits(s)?.kind, 'inconsistent', s);
    assert.notEqual(checkChain(s + ' = ' + s.split('=')[1])?.kind, 'inconsistent', s);
    assert.deepEqual(verdicts(applyAlgebraGuard([L('L1', s)])), ['valid'], s);
  }
  assert.deepEqual(verdicts(applyAlgebraGuard([L('L1', 'F_{\\mathrm{N}} = mg\\cos\\theta'), L('L2', 'F_{\\mathrm{N}} = m g \\cos\\theta')])), ['valid', 'valid']);
});

test('a unit group only counts after a number (not at the start of a side or after a symbol)', () => {
  assert.equal(unitize('\\mathrm{N} = \\mathrm{J}'), null);
  assert.equal(checkLineUnits('x = \\mathrm{m} = \\mathrm{s}'), null);
  assert.notEqual(unitize('F = (2\\,\\mathrm{kg})(9.8\\,\\mathrm{m/s^2})'), null);
  assert.notEqual(unitize('d = \\frac{3}{2}\\,\\mathrm{m}'), null);
});

test('scientific notation does not loosen the rounding tolerance', () => {
  assert.ok(roundingTol('E = 3 \\times 10^{8}') < 1e-6);
  assert.ok(roundingTol('E = 3 \\cdot 10^8') < 1e-6);
});

// ---------------------------------------------------------------- real errors are caught

test('different units on the two sides of "=" are caught', () => {
  assert.equal(checkLineUnits('W = 5\\,\\mathrm{N} = 5\\,\\mathrm{J}')?.kind, 'inconsistent');
  const out = applyAlgebraGuard([L('L1', 'a = 9.8\\,\\mathrm{m/s} = 9.8\\,\\mathrm{m/s^2}')]);
  assert.equal(out[0].verdict, 'partial');
  assert.match(out[0].note, /Units check/);
  assert.doesNotMatch(out[0].note, /m\/s\^2/); // says where, never the fix
});

test('a wrong conversion is caught', () => {
  assert.equal(checkChain('v = 20\\,\\mathrm{m/s} = 20\\,\\mathrm{km/h}')?.kind, 'inconsistent');
  assert.equal(checkStep('x = 5\\,\\mathrm{cm}', 'x = 5\\,\\mathrm{m}').kind, 'inconsistent');
});

// ---------------------------------------------------------------- significant figures

test('honest rounding to the significant figures written is allowed', () => {
  assert.notEqual(checkChain('F = 2 \\cdot 9.8 = 19.6 = 20')?.kind, 'inconsistent');
  assert.notEqual(checkChain('E = 9.8 \\cdot 31 = 303.8 = 300')?.kind, 'inconsistent');
  assert.notEqual(checkStep('x = 2.0 \\cdot 9.81', 'x = 19.6').kind, 'inconsistent');
});

test('rounding tolerance stays small: real slips are still caught', () => {
  assert.ok(roundingTol('x = 20') <= 0.03);
  assert.equal(checkChain('F = 2 \\cdot 9.8 = 19.6 = 25')?.kind, 'inconsistent');
  assert.equal(checkStep('2x + 3 = 7', '2x = 10').kind, 'inconsistent');
  assert.equal(checkChain('x = 3 \\cdot 7 = 24')?.kind, 'inconsistent');
});
