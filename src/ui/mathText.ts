/**
 * LaTeX -> readable Unicode, for problem text and tutor messages shown in plain <Text>.
 * Not a typesetter: it covers what intro physics/math problems use (vectors, hats, fractions, roots,
 * sub/superscripts, Greek, operators). Unknown commands are left as written, never dropped, so nothing
 * silently disappears. Pure and dependency-free. (Real typesetting via KaTeX needs a native WebView: see BACKLOG.)
 */

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  sim: '∼', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', int: '∫', iint: '∬',
  iiint: '∭', oint: '∮', sum: '∑', prod: '∏', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', in: '∈', notin: '∉',
  subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱', degree: '°', circ: '∘', bullet: '•', angle: '∠', perp: '⊥',
  parallel: '∥', hbar: 'ℏ', ell: 'ℓ', prime: '′', langle: '⟨', rangle: '⟩', lVert: '‖', rVert: '‖', ll: '≪', gg: '≫',
  star: '⋆', oplus: '⊕', otimes: '⊗', dagger: '†', hat: '^',
};

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
  '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ',
  l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋',
  '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const COMBINING: Record<string, string> = {
  vec: '⃗', overrightarrow: '⃗', hat: '̂', widehat: '̂', bar: '̄', overline: '̄', dot: '̇',
  ddot: '̈', tilde: '̃', widetilde: '̃', check: '̌', breve: '̆',
};

const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };

/** Mathematical bold for \mathbf / \boldsymbol (bold letters are how many texts write vectors). */
function bold(s: string): string {
  return [...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + c - 48);
      return ch;
    })
    .join('');
}

/** Find the {group} starting at index i (which must be '{'); returns [content, indexAfter] or null. */
function group(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}' && --depth === 0) return [s.slice(i + 1, k), k + 1];
  }
  return null;
}

/** Argument of a command: {group} or the next single character / command. */
function arg(s: string, i: number): [string, number] | null {
  while (s[i] === ' ') i++;
  if (i >= s.length) return null;
  const g = group(s, i);
  if (g) return g;
  if (s[i] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
    return m ? [m[0], i + m[0].length] : null;
  }
  return [s[i], i + 1];
}

function script(table: Record<string, string>, body: string, marker: '^' | '_'): string {
  const chars = [...body];
  if (chars.length > 0 && chars.every((c) => table[c] !== undefined)) return chars.map((c) => table[c]).join('');
  return body.length <= 1 ? marker + body : `${marker}(${body})`;
}

const needsParens = (s: string) => !/^[\p{L}\p{N}.̀-ͯ⃗√∛∜]+$/u.test(s);

export function latexToUnicode(input: string): string {
  let s = input;
  // math delimiters and layout commands
  s = s.replace(/\$\$|\$|\\\(|\\\)|\\\[|\\\]/g, '');
  s = s.replace(/\\(left|right|big|Big|bigg|Bigg)(?![A-Za-z])\s*/g, '');
  s = s.replace(/\\(quad|qquad)(?![A-Za-z])/g, '  ').replace(/\\[,;:! ]/g, ' ').replace(/\\\\/g, '\n');

  // commands that take arguments: scan left to right, splice each result in place (arguments recurse)
  let from = 0;
  for (let guard = 0; guard < 400; guard++) {
    const m = /\\([A-Za-z]+)/g;
    m.lastIndex = from;
    const hit = m.exec(s);
    if (!hit) break;
    const done = rewrite(s, hit[1], hit.index + hit[0].length);
    if (!done) {
      from = hit.index + hit[0].length; // plain symbol or unknown command: handled later
      continue;
    }
    s = s.slice(0, hit.index) + done.out + s.slice(done.end);
    from = hit.index + done.out.length;
  }

  // plain symbols and Greek
  s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? SYMBOLS[name] ?? (/^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|ln|log|exp|lim|max|min|det|dim|ker|sup|inf|Pr|gcd)$/.test(name) ? name : m));

  // sub/superscripts, then drop leftover braces
  for (let pass = 0; pass < 10; pass++) {
    const before = s;
    s = s.replace(/\^\{([^{}]*)\}/g, (_m, b: string) => script(SUP, b, '^'));
    s = s.replace(/_\{([^{}]*)\}/g, (_m, b: string) => script(SUB, b, '_'));
    if (s === before) break;
  }
  s = s.replace(/\^([A-Za-z0-9+\-])/g, (_m, b: string) => script(SUP, b, '^')).replace(/_([A-Za-z0-9])/g, (_m, b: string) => script(SUB, b, '_'));
  s = s.replace(/(\\[A-Za-z]+)\{/g, '$1 {').replace(/[{}]/g, '');
  return s.replace(/[ \t]{3,}/g, '  ').trim();
}

// ---- argument-taking commands -------------------------------------------------------------

type Rewrite = { out: string; end: number } | null;

function rewrite(s: string, name: string, at: number): Rewrite {
  if (COMBINING[name]) {
    const a = arg(s, at);
    if (!a) return null;
    const inner = latexToUnicode(a[0]);
    // an arrow/hat over a multi-letter name goes on each letter ("AB" -> "A⃗B⃗") except over a whole expression
    const mark = COMBINING[name];
    const out = /^[\p{L}\p{N}]+$/u.test(inner) ? [...inner].map((c) => c + mark).join('') : inner + mark;
    return { out, end: a[1] };
  }
  switch (name) {
    case 'mathbf':
    case 'boldsymbol':
    case 'bm':
    case 'textbf': {
      const a = arg(s, at);
      return a ? { out: bold(latexToUnicode(a[0])), end: a[1] } : null;
    }
    case 'mathrm':
    case 'text':
    case 'textrm':
    case 'mathit':
    case 'operatorname':
    case 'mathcal':
    case 'mathsf': {
      const a = arg(s, at);
      return a ? { out: latexToUnicode(a[0]), end: a[1] } : null;
    }
    case 'mathbb': {
      const a = arg(s, at);
      return a ? { out: [...a[0]].map((c) => BLACKBOARD[c] ?? c).join(''), end: a[1] } : null;
    }
    case 'frac':
    case 'dfrac':
    case 'tfrac': {
      const n = arg(s, at);
      if (!n) return null;
      const d = arg(s, n[1]);
      if (!d) return null;
      const top = latexToUnicode(n[0]);
      const bottom = latexToUnicode(d[0]);
      const out = `${needsParens(top) ? `(${top})` : top}/${needsParens(bottom) ? `(${bottom})` : bottom}`;
      return { out, end: d[1] };
    }
    case 'sqrt': {
      let i = at;
      let root = '√';
      if (s[i] === '[') {
        const close = s.indexOf(']', i);
        if (close > 0) {
          const n = s.slice(i + 1, close);
          root = n === '3' ? '∛' : n === '4' ? '∜' : (script(SUP, n, '^') + '√');
          i = close + 1;
        }
      }
      const a = arg(s, i);
      if (!a) return null;
      const inner = latexToUnicode(a[0]);
      return { out: root + (needsParens(inner) ? `(${inner})` : inner), end: a[1] };
    }
    case 'binom': {
      const n = arg(s, at);
      const k = n && arg(s, n[1]);
      return n && k ? { out: `C(${latexToUnicode(n[0])}, ${latexToUnicode(k[0])})`, end: k[1] } : null;
    }
    default:
      return null;
  }
}
