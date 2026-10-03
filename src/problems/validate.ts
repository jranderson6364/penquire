import { asciiScripts, latexToUnicode } from '../ui/mathText.ts';
import { compareProblemLabels, missingInSequence } from './labels.ts';
import type { ParseIssue, ProblemGroup } from './types.ts';

/** Compare text loosely: no markup, case, spacing or punctuation. */
export function squash(s: string): string {
  return asciiScripts(latexToUnicode(s))
    .replace(/[_^]/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ⃗]/g, '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/−/g, '-')
    .replace(/[\s.,;:!?'"`]+/g, '');
}

function latexProblems(text: string): string | null {
  const dollars = (text.match(/(?<!\\)\$/g) ?? []).length;
  if (dollars % 2 === 1) return 'an odd number of $ delimiters';
  let depth = 0;
  for (const ch of text.replace(/\\[{}]/g, '')) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return 'a closing } without an opening {';
  }
  if (depth !== 0) return 'an unclosed {';
  const left = latexToUnicode(text).match(/\\[A-Za-z]+/);
  return left ? `an unsupported command ${left[0]}` : null;
}

/**
 * Structural checks on a parsed assignment. Errors mean "parsing is probably incomplete or wrong" (worth a repair
 * pass); warnings mean "check this". `sourceText` (the PDF's text layer, when it has one) enables the
 * missing-problem check.
 */
export function validateGroups(groups: ProblemGroup[], opts: { sourceText?: string } = {}): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const add = (i: ParseIssue) => issues.push(i);
  const seen = new Set<string>();

  groups.forEach((g, idx) => {
    if (seen.has(g.label)) add({ severity: 'error', code: 'duplicate-problem', problem: g.label, message: `Problem ${g.label} appears twice.` });
    seen.add(g.label);
    if (idx > 0 && compareProblemLabels(groups[idx - 1].label, g.label) > 0) {
      add({ severity: 'warn', code: 'order', problem: g.label, message: `Problem ${g.label} comes after problem ${groups[idx - 1].label}.` });
    }
    if (!g.context && g.parts.length === 0 && g.asksFor.length === 0) {
      add({ severity: 'error', code: 'empty-problem', problem: g.label, message: `Problem ${g.label} has no text.` });
    }

    const gap = missingInSequence(g.parts.map((p) => p.label));
    if (gap.length) add({ severity: 'error', code: 'part-gap', problem: g.label, message: `Problem ${g.label}: part ${gap.join(', ')} is missing between the parts that were found.` });

    const ctx = squash(g.context);
    const partTexts = new Map<string, string>();
    for (const p of g.parts) {
      if (!p.text.trim() && p.subparts.length === 0) {
        add({ severity: 'error', code: 'empty-text', problem: g.label, part: p.label, message: `Part ${g.label}${p.label} has no text.` });
      }
      const subGap = missingInSequence(p.subparts.map((s) => s.label));
      if (subGap.length) {
        add({ severity: 'error', code: 'part-gap', problem: g.label, part: p.label, message: `Part ${g.label}${p.label}: sub-part ${subGap.join(', ')} is missing.` });
      }
      for (const s of p.subparts) {
        if (!s.text.trim()) add({ severity: 'error', code: 'empty-text', problem: g.label, part: p.label, message: `Sub-part ${g.label}${p.label}(${s.label}) has no text.` });
      }
      const sq = squash(p.text);
      if (ctx.length >= 60 && sq.includes(ctx.slice(0, 60))) {
        add({ severity: 'warn', code: 'part-repeats-context', problem: g.label, part: p.label, message: `Part ${g.label}${p.label} repeats the problem's setup instead of storing it once.` });
      }
      if (sq.length > 12) {
        const dup = partTexts.get(sq);
        if (dup) add({ severity: 'warn', code: 'duplicate-part', problem: g.label, part: p.label, message: `Parts ${g.label}${dup} and ${g.label}${p.label} have identical text.` });
        else partTexts.set(sq, p.label);
      }
    }

    const fields: Array<[string, string | undefined, string?]> = [
      ['setup', g.context],
      ['title', g.title],
      ['closing', g.closing],
      ['hint', g.hint],
      ...g.parts.flatMap((p): Array<[string, string, string]> => [
        [`part ${p.label}`, p.text, p.label],
        ...p.subparts.map((s): [string, string, string] => [`sub-part ${p.label}(${s.label})`, s.text, p.label]),
      ]),
    ];
    for (const [where, text, part] of fields) {
      const bad = text ? latexProblems(text) : null;
      if (bad) add({ severity: 'warn', code: 'latex', problem: g.label, part, message: `Problem ${g.label} ${where} has ${bad}.` });
    }
  });

  if (opts.sourceText) {
    const found = new Set<string>();
    // Only real headings ("Problem 4. Title..." at the start of a line); cross-references such as
    // "Problem 1.6 (Pole in barn) on p. 45 in the textbook" must not count as assignment problems.
    for (const m of opts.sourceText.matchAll(/^[ \t]*Problem\s+(\d+(?:\.\d+)?)\.(?=\s)/gim)) found.add(m[1]);
    for (const label of found) {
      if (!seen.has(label)) add({ severity: 'error', code: 'missing-problem', problem: label, message: `The document mentions Problem ${label}, but it was not parsed.` });
    }
  }
  return issues;
}

export const hasErrors = (issues: ParseIssue[]) => issues.some((i) => i.severity === 'error');
