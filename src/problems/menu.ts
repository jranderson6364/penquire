import type { Problem } from '../ai/types';
import { flatLabel } from './labels.ts';
import type { ProblemGroup } from './types.ts';

/**
 * The question menu (QuestionMenu): one row per problem, its parts as small chips. Built from the structured parse when
 * there is one, otherwise from the flat list. Only parts the tutor actually knows (the flat `problems`, which may be
 * filtered to "only these problems") are offered, so every chip maps to a label the rest of the app keys on. Pure.
 */
export type MenuItem = { flat: string; short: string };
export type MenuRow = { label: string; title: string; items: MenuItem[] };

const oneLine = (s: string, n = 64) => {
  const t = s.replace(/\$[^$]*\$/g, '…').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

export function menuModel(groups: ProblemGroup[] | undefined, problems: Problem[]): MenuRow[] {
  const known = new Set(problems.map((p) => p.label));
  if (groups?.length) {
    const rows: MenuRow[] = [];
    for (const g of groups) {
      const title = g.title?.trim() || oneLine(g.context || g.parts[0]?.text || '');
      if (g.parts.length === 0) {
        if (known.has(g.label)) rows.push({ label: g.label, title, items: [{ flat: g.label, short: g.label }] });
        continue;
      }
      const items = g.parts.map((p) => ({ flat: flatLabel(g.label, p.label), short: p.label })).filter((it) => known.has(it.flat));
      if (items.length) rows.push({ label: g.label, title, items });
    }
    if (rows.length) return rows;
  }
  // flat list only: each problem is its own row
  return problems.map((p) => ({ label: p.label, title: oneLine(p.text), items: [{ flat: p.label, short: p.label }] }));
}
