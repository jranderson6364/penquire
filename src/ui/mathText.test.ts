import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asciiScripts, latexToUnicode as t } from './mathText.ts';

test('vectors get a real arrow over the letter, and bold works too', () => {
  assert.equal(t('\\vec{w}'), 'w⃗');
  assert.equal(t('\\vec w'), 'w⃗');
  assert.equal(t('\\vec{F}_{net}'), 'F⃗ₙₑₜ');
  assert.equal(t('\\vec{F}_{fric}'), 'F⃗_(fric)'); // 'f' and 'c' have no subscript form, so it stays readable
  assert.equal(t('\\overrightarrow{AB}'), 'A⃗B⃗');
  assert.equal(t('\\mathbf{F}'), '\u{1D405}');
  assert.equal(t('\\hat{x} + \\hat{y}'), 'x̂ + ŷ');
});

test('the exact failing case from the Problems tab', () => {
  const out = t('Find $\\vec{w}$ given \\vec{v} = 3\\hat{i} + 4\\hat{j}.');
  assert.ok(!out.includes('\\'), out);
  assert.ok(out.includes('w⃗') && out.includes('v⃗'), out);
});

test('fractions, roots', () => {
  assert.equal(t('\\frac{1}{2}mv^2'), '1/2mv²');
  assert.equal(t('\\frac{a+b}{c}'), '(a+b)/c');
  assert.equal(t('\\sqrt{2}'), '√2');
  assert.equal(t('\\sqrt{x+1}'), '√(x+1)');
  assert.equal(t('\\sqrt[3]{8}'), '∛8');
  assert.equal(t('\\frac{\\sqrt{3}}{2}'), '√3/2');
});

test('sub and superscripts use Unicode when every character has one', () => {
  assert.equal(t('x^2 + y^{10}'), 'x² + y¹⁰');
  assert.equal(t('v_0 + a_{12}'), 'v₀ + a₁₂');
  assert.equal(t('e^{-x}'), 'e⁻ˣ');
  assert.equal(t('x_f'), 'x_f'); // no Unicode subscript f: left readable
  assert.equal(t('10^{23}'), '10²³');
});

test('Greek and operators', () => {
  assert.equal(t('\\theta = \\omega t'), 'θ = ω t');
  assert.equal(t('\\Delta x \\approx 3 \\times 10^{8}'), 'Δ x ≈ 3 × 10⁸');
  assert.equal(t('\\int_0^1 x\\,dx'), '∫₀¹ x dx');
  assert.equal(t('\\nabla \\cdot \\vec{E} = \\rho / \\epsilon_0'), '∇ · E⃗ = ρ / ε₀');
  assert.equal(t('a \\leq b \\neq c'), 'a ≤ b ≠ c');
});

test('delimiters, \\left \\right, text and function names', () => {
  assert.equal(t('$$\\left( x + 1 \\right)$$'), '( x + 1 )');
  assert.equal(t('\\text{if } x > 0'), 'if x > 0');
  assert.equal(t('\\sin\\theta'), 'sinθ');
  assert.equal(t('\\mathbb{R}^3'), 'ℝ³');
});

test('unknown commands are left as written, never silently dropped', () => {
  assert.equal(t('\\weirdcommand{x}'), '\\weirdcommand x');
  assert.ok(t('\\weirdcommand').includes('weirdcommand'));
});

test('plain text without LaTeX is unchanged', () => {
  assert.equal(t('Find the speed of the block after 3 s.'), 'Find the speed of the block after 3 s.');
});

test('hostile input terminates quickly', () => {
  const t0 = Date.now();
  t('\\frac'.repeat(300) + '{'.repeat(500));
  t('\\vec{'.repeat(200));
  t('^'.repeat(5000));
  assert.ok(Date.now() - t0 < 1500);
});

test('unit vectors: \\hat{\\imath} and \\hat{\\jmath} render as i-hat and j-hat', () => {
  assert.equal(t('\\hat{\\imath} + 2\\hat{\\jmath}'), 'î + 2ĵ');
  assert.equal(t('\\vec{v} = v_x\\hat{\\imath} - v_y\\hat{\\jmath}'), 'v⃗ = vₓî - v_yĵ');
});

test('an operator directly before a vector command does not glue to the vector letter', () => {
  assert.equal(t('\\vec{A}\\times\\vec{B}'), 'A⃗×B⃗');
  assert.equal(t('-\\vec{r}\\cdot\\vec{r} + 5\\,\\text{m}^2'), '-r⃗·r⃗ + 5 m²');
  assert.equal(t('(\\vec{A}\\times\\vec{B})\\times\\vec{C}'), '(A⃗×B⃗)×C⃗');
  assert.equal(t('\\sin\\vec{x}'), 'sinx⃗');
  assert.ok(!t('\\pm\\hat{k}').includes('\\'));
});

test('matrices and column vectors render readably', () => {
  assert.equal(t('\\begin{bmatrix} -4 \\\\ 2+2t_1 \\\\ 7+3t_1 \\end{bmatrix}'), '[-4; 2+2t₁; 7+3t₁]');
  assert.equal(t('\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}'), '[1, 2; 3, 4]');
  assert.equal(t('\\begin{pmatrix} a \\\\ b \\end{pmatrix}'), '(a; b)');
  assert.equal(t('\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}'), '|1, 2; 3, 4|');
  assert.equal(t('\\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix} + t\\begin{bmatrix} 0 \\\\ 1 \\end{bmatrix}'), '[1; 2] + t[0; 1]');
  assert.equal(t('\\vec{p} = \\begin{bmatrix} x_1 \\\\ x_2 \\end{bmatrix}'), 'p⃗ = [x₁; x₂]');
});

test('degrees: ^\\circ is the degree sign', () => {
  assert.equal(t('30^\\circ\\text{-}60^{\\circ}'), '30°-60°');
  assert.equal(t('45^\\circ'), '45°');
});

test('asciiScripts maps Unicode sub/superscripts back for loose comparison', () => {
  assert.equal(asciiScripts('vₓ + v² + x₁₀'), 'vx + v2 + x10');
  assert.equal(asciiScripts('plain'), 'plain');
});
