import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLines, type StrokeLike } from './lines.ts';

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

type Spec = { baseline: number; x0?: number; glyphs: number; slope?: number; height?: number };

/** Build strokes for one page of handwriting. Returns strokes and the true line of each stroke. */
function page(specs: Spec[], seed: number, opts: { subscripts?: boolean } = {}) {
  const r = rng(seed);
  const strokes: StrokeLike[] = [];
  const truth: number[] = [];
  let i = 0;
  specs.forEach((sp, lineNo) => {
    const h = sp.height ?? 22;
    for (let k = 0; k < sp.glyphs; k++) {
      const x = (sp.x0 ?? 30) + k * 17 + r() * 3;
      const drift = (sp.slope ?? 0) * k;
      const gh = h * (0.7 + r() * 0.5); // x-height vs ascender variation
      const y = sp.baseline + drift - gh + (r() - 0.5) * 3; // bottoms sit on a (tilted) baseline
      strokes.push({ i, x, y, w: 8 + r() * 6, h: gh, t: i });
      truth.push(lineNo);
      i++;
      if (opts.subscripts && k % 7 === 3) {
        strokes.push({ i, x: x + 9, y: sp.baseline + drift - gh * 0.25, w: 5, h: gh * 0.4, t: i });
        truth.push(lineNo);
        i++;
      }
    }
  });
  return { strokes, truth };
}

/** Each true line must map to exactly one found line, and no found line may mix two true lines. */
function purity(strokes: StrokeLike[], truth: number[], found: ReturnType<typeof groupLines>) {
  const lineOf = new Map<number, number>();
  found.forEach((l, idx) => l.strokes.forEach((s) => lineOf.set(s, idx)));
  const trueToFound = new Map<number, Set<number>>();
  const foundToTrue = new Map<number, Set<number>>();
  strokes.forEach((s, k) => {
    const f = lineOf.get(s.i);
    assert.notEqual(f, undefined, 'every stroke must be assigned');
    (trueToFound.get(truth[k]) ?? trueToFound.set(truth[k], new Set()).get(truth[k])!).add(f!);
    (foundToTrue.get(f!) ?? foundToTrue.set(f!, new Set()).get(f!)!).add(truth[k]);
  });
  const split = [...trueToFound.values()].filter((s) => s.size > 1).length;
  const merged = [...foundToTrue.values()].filter((s) => s.size > 1).length;
  return { split, merged, lines: found.length };
}

const LEVEL = (n: number, gap: number, extra: Partial<Spec> = {}): Spec[] => Array.from({ length: n }, (_, k) => ({ baseline: 80 + k * gap, glyphs: 26, ...extra }));

test('every stroke lands in exactly one line, deterministically, whatever the input order', () => {
  const { strokes } = page(LEVEL(6, 48), 1, { subscripts: true });
  const a = groupLines(strokes);
  const shuffled = [...strokes].sort(() => 0.5 - rng(5)());
  const rnd = rng(9);
  for (let k = shuffled.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
  }
  const b = groupLines(shuffled);
  assert.deepEqual(b.map((l) => l.strokes), a.map((l) => l.strokes));
  assert.equal(a.flatMap((l) => l.strokes).length, strokes.length);
});

for (const [name, gap] of [['comfortable (56pt)', 56], ['normal (44pt)', 44], ['cramped ruled (36pt)', 36]] as const) {
  test(`level lines, ${name}: no splits or merges across 20 random pages`, () => {
    let bad = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { strokes, truth } = page(LEVEL(7, gap), seed, { subscripts: true });
      const p = purity(strokes, truth, groupLines(strokes));
      if (p.split || p.merged || p.lines !== 7) bad++;
    }
    assert.equal(bad, 0, `${bad}/20 pages mis-grouped`);
  });
}

for (const slope of [0.3, 0.6, 0.9]) {
  test(`tilted writing (${slope} pt drift per glyph): lines stay whole and separate`, () => {
    let bad = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { strokes, truth } = page(LEVEL(6, 52, { slope }), seed);
      const p = purity(strokes, truth, groupLines(strokes));
      if (p.split || p.merged || p.lines !== 6) bad++;
    }
    assert.equal(bad, 0, `${bad}/20 pages mis-grouped`);
  });
}

test('work in a left margin and work to its right at the same height are separate lines', () => {
  // e.g. "3.10 (a)" label column and the derivation, or a side calculation
  const specs: Spec[] = [
    { baseline: 80, x0: 20, glyphs: 5 },
    { baseline: 80, x0: 330, glyphs: 14 },
    { baseline: 140, x0: 20, glyphs: 5 },
    { baseline: 140, x0: 330, glyphs: 14 },
  ];
  const { strokes, truth } = page(specs, 3);
  const found = groupLines(strokes);
  const p = purity(strokes, truth, found);
  assert.deepEqual({ split: p.split, merged: p.merged }, { split: 0, merged: 0 });
  // reading order: label then work, row by row
  assert.deepEqual(found.map((l) => l.id), ['L1', 'L2', 'L3', 'L4']);
  assert.ok(found[0].x < found[1].x && found[2].x < found[3].x && found[1].y < found[2].y);
});
