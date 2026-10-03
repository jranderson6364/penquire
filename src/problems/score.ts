import { latexToUnicode } from '../ui/mathText.ts';
import { partText } from './flatten.ts';
import { flatLabel, normalizePartLabel, normalizeProblemLabel } from './labels.ts';
import type { ParseIssue, ProblemGroup } from './types.ts';
import { squash, validateGroups } from './validate.ts';

/**
 * Scores a parse against a hand-written gold file. The scorer is public and tested on invented text; the gold
 * files themselves quote real course material and live outside the repo (evals-private/).
 */
export type GoldPart = { label: string; keys?: string[]; hint_keys?: string[]; subparts?: GoldPart[] };
export type GoldProblem = {
  label: string;
  title_keys?: string[];
  context_keys?: string[];
  closing_keys?: string[];
  figure?: boolean;
  parts: GoldPart[];
};
export type Gold = { id: string; notes_keys?: string[]; problems: GoldProblem[] };

type Counter = { total: number; found: number; missing: string[] };
const counter = (): Counter => ({ total: 0, found: 0, missing: [] });

export type Score = {
  id: string;
  problemLabels: { gold: number; matched: number; missing: string[]; extra: string[] };
  partLabels: { gold: number; matched: number; missing: string[]; extra: string[] };
  subpartLabels: { gold: number; matched: number; missing: string[]; extra: string[] };
  keys: { context: Counter; title: Counter; parts: Counter; hints: Counter; closing: Counter; notes: Counter; misplaced: string[]; anywhere: { total: number; found: number } };
  figures: { expected: number; marked: number };
  partsRepeatingContext: number;
  unsupportedWords: { count: number; total: number; sample: string[] };
  issues: ParseIssue[];
  /** 0..1 summaries */
  summary: { structureF1: number; keyRecall: number; anywhereRecall: number; placement: number; fidelity: number; overall: number };
};

const f1 = (matched: number, gold: number, found: number) => {
  if (gold === 0 && found === 0) return 1;
  const p = found === 0 ? 0 : matched / found;
  const r = gold === 0 ? 0 : matched / gold;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
};

function setCompare(gold: string[], found: string[]) {
  const g = new Set(gold);
  const f = new Set(found);
  return {
    gold: g.size,
    matched: [...g].filter((x) => f.has(x)).length,
    missing: [...g].filter((x) => !f.has(x)),
    extra: [...f].filter((x) => !g.has(x)),
  };
}

const norm = (s: string) => squash(s);

/** Words of 5+ letters in `text`, after removing markup and [Figure: ...] descriptions (those are the model's own words). */
export function contentWords(text: string): string[] {
  const plain = latexToUnicode(text.replace(/\[figure[^\]]*\]/gi, ' '))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return plain.match(/[a-z]{5,}/g) ?? [];
}

/** Source text from a PDF text layer: undo hyphenation across line breaks, drop replacement characters. */
export function normalizeSourceText(raw: string): string {
  return raw
    .replace(/�/g, ' ')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[ﬀ-ﬆ]/g, (c) => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' })[c] ?? c)
    .replace(/\s+/g, ' ');
}

export function scoreParse(parsed: { notes: string[]; groups: ProblemGroup[] }, gold: Gold, opts: { sourceText?: string } = {}): Score {
  const groups = parsed.groups;
  const byLabel = new Map(groups.map((g) => [normalizeProblemLabel(g.label), g]));
  const allText = (g: ProblemGroup) => [g.title ?? '', g.context, g.closing ?? '', g.hint ?? '', ...g.parts.map(partText)].join(' ');

  const problemLabels = setCompare(gold.problems.map((p) => p.label), groups.map((g) => g.label));
  const goldParts: string[] = [];
  const foundParts: string[] = [];
  const goldSub: string[] = [];
  const foundSub: string[] = [];
  for (const g of groups) {
    for (const p of g.parts) {
      foundParts.push(flatLabel(g.label, p.label));
      for (const s of p.subparts) foundSub.push(flatLabel(g.label, p.label, s.label));
    }
  }
  for (const gp of gold.problems) {
    for (const part of gp.parts) {
      goldParts.push(flatLabel(gp.label, normalizePartLabel(part.label)));
      for (const s of part.subparts ?? []) goldSub.push(flatLabel(gp.label, normalizePartLabel(part.label), normalizePartLabel(s.label)));
    }
  }
  const partLabels = setCompare(goldParts, foundParts);
  const subpartLabels = setCompare(goldSub, foundSub);

  const keys = { context: counter(), title: counter(), parts: counter(), hints: counter(), closing: counter(), notes: counter(), misplaced: [] as string[], anywhere: { total: 0, found: 0 } };
  const check = (c: Counter, where: string, key: string, inNode: string, elsewhere: string) => {
    c.total++;
    keys.anywhere.total++;
    const k = norm(key);
    if (norm(elsewhere).includes(k) || norm(inNode).includes(k)) keys.anywhere.found++;
    if (norm(inNode).includes(k)) c.found++;
    else {
      c.missing.push(`${where}: ${key}`);
      if (norm(elsewhere).includes(k)) keys.misplaced.push(`${where}: ${key}`);
    }
  };

  let figuresExpected = 0;
  let figuresMarked = 0;
  for (const gp of gold.problems) {
    const g = byLabel.get(gp.label);
    const everything = g ? allText(g) : '';
    const w = `P${gp.label}`;
    for (const k of gp.context_keys ?? []) check(keys.context, w, k, g ? `${g.title ?? ''} ${g.context} ${g.hint ?? ''}` : '', everything);
    for (const k of gp.title_keys ?? []) check(keys.title, w, k, g ? `${g.title ?? ''} ${g.context}` : '', everything);
    for (const k of gp.closing_keys ?? []) check(keys.closing, w, k, g ? `${g.closing ?? ''}` : '', everything);
    if (gp.figure) {
      figuresExpected++;
      if (g && /\[figure/i.test(`${g.context} ${g.parts.map(partText).join(' ')}`)) figuresMarked++;
    }
    for (const gpart of gp.parts) {
      const found = g?.parts.find((p) => normalizePartLabel(p.label) === normalizePartLabel(gpart.label));
      const here = found ? partText(found) : '';
      const wp = `${w}${gpart.label}`;
      for (const k of gpart.keys ?? []) check(keys.parts, wp, k, here + ' ' + (found?.hint ?? ''), everything);
      for (const k of gpart.hint_keys ?? []) check(keys.hints, wp, k, `${here} ${found?.hint ?? ''} ${g?.hint ?? ''}`, everything);
      for (const gs of gpart.subparts ?? []) {
        const fs = found?.subparts.find((s) => normalizePartLabel(s.label) === normalizePartLabel(gs.label));
        const wsp = `${wp}(${gs.label})`;
        for (const k of gs.keys ?? []) check(keys.parts, wsp, k, `${fs?.text ?? ''} ${fs?.hint ?? ''}`, everything);
        for (const k of gs.hint_keys ?? []) check(keys.hints, wsp, k, `${fs?.text ?? ''} ${fs?.hint ?? ''} ${found?.hint ?? ''}`, everything);
      }
    }
  }
  const allProblemText = groups.map(allText).join(' ');
  for (const k of gold.notes_keys ?? []) check(keys.notes, 'notes', k, parsed.notes.join(' '), allProblemText);

  const issues = validateGroups(groups, { sourceText: opts.sourceText });

  let unsupported = { count: 0, total: 0, sample: [] as string[] };
  if (opts.sourceText) {
    const source = new Set(contentWords(normalizeSourceText(opts.sourceText)));
    const words = contentWords([...parsed.notes, ...groups.map(allText)].join(' '));
    const bad = words.filter((x) => !source.has(x));
    unsupported = { count: bad.length, total: words.length, sample: [...new Set(bad)].slice(0, 15) };
  }

  const recall = (cs: Counter[]) => {
    const total = cs.reduce((a, c) => a + c.total, 0);
    return total === 0 ? 1 : cs.reduce((a, c) => a + c.found, 0) / total;
  };
  const structureF1 = (f1(problemLabels.matched, problemLabels.gold, groups.length) + f1(partLabels.matched, partLabels.gold, foundParts.length) + (subpartLabels.gold + foundSub.length === 0 ? 1 : f1(subpartLabels.matched, subpartLabels.gold, foundSub.length))) / 3;
  const keyRecall = recall([keys.parts, keys.hints, keys.context, keys.title, keys.closing, keys.notes]);
  const repeating = issues.filter((i) => i.code === 'part-repeats-context').length;
  const totalKeys = [keys.parts, keys.hints, keys.context, keys.title, keys.closing, keys.notes].reduce((a, c) => a + c.total, 0);
  const placement = totalKeys === 0 ? 1 : Math.max(0, 1 - (keys.misplaced.length + repeating) / totalKeys);
  const fidelity = unsupported.total === 0 ? 1 : 1 - unsupported.count / unsupported.total;
  const overall = 0.35 * structureF1 + 0.35 * keyRecall + 0.15 * placement + 0.15 * fidelity;

  return {
    id: gold.id,
    problemLabels,
    partLabels,
    subpartLabels,
    keys,
    figures: { expected: figuresExpected, marked: figuresMarked },
    partsRepeatingContext: repeating,
    unsupportedWords: unsupported,
    issues,
    summary: { structureF1, keyRecall, anywhereRecall: keys.anywhere.total === 0 ? 1 : keys.anywhere.found / keys.anywhere.total, placement, fidelity, overall },
  };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatScore(s: Score): string {
  const c = (name: string, k: Counter) => `${name} ${k.found}/${k.total}`;
  const lines = [
    `${s.id}: overall ${pct(s.summary.overall)}  (structure ${pct(s.summary.structureF1)}, key recall ${pct(s.summary.keyRecall)} (anywhere ${pct(s.summary.anywhereRecall)}), placement ${pct(s.summary.placement)}, fidelity ${pct(s.summary.fidelity)})`,
    `  problems ${s.problemLabels.matched}/${s.problemLabels.gold}${s.problemLabels.extra.length ? ` +extra ${s.problemLabels.extra.join(',')}` : ''}${s.problemLabels.missing.length ? ` missing ${s.problemLabels.missing.join(',')}` : ''}`,
    `  parts ${s.partLabels.matched}/${s.partLabels.gold}${s.partLabels.extra.length ? ` +extra ${s.partLabels.extra.join(',')}` : ''}${s.partLabels.missing.length ? ` missing ${s.partLabels.missing.join(',')}` : ''}`,
    `  subparts ${s.subpartLabels.matched}/${s.subpartLabels.gold}${s.subpartLabels.extra.length ? ` +extra ${s.subpartLabels.extra.join(',')}` : ''}${s.subpartLabels.missing.length ? ` missing ${s.subpartLabels.missing.join(',')}` : ''}`,
    `  keys: ${[c('parts', s.keys.parts), c('hints', s.keys.hints), c('context', s.keys.context), c('title', s.keys.title), c('closing', s.keys.closing), c('notes', s.keys.notes)].join(', ')}`,
    `  figures marked ${s.figures.marked}/${s.figures.expected}; parts repeating setup ${s.partsRepeatingContext}; invented words ${s.unsupportedWords.count}/${s.unsupportedWords.total}`,
  ];
  const missing = [s.keys.parts, s.keys.hints, s.keys.context, s.keys.title, s.keys.closing, s.keys.notes].flatMap((k) => k.missing);
  if (missing.length) lines.push('  MISSING: ' + missing.join(' | '));
  if (s.keys.misplaced.length) lines.push('  MISPLACED: ' + s.keys.misplaced.join(' | '));
  if (s.unsupportedWords.sample.length) lines.push('  not in source: ' + s.unsupportedWords.sample.join(', '));
  for (const i of s.issues) lines.push(`  [${i.severity}] ${i.code}: ${i.message}`);
  return lines.join('\n');
}
