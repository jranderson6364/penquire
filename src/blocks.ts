/**
 * Question blocks: the problem text placed on the page itself (a typeset note above the ink, never part of the
 * drawing, never sent to the tutor as handwriting). Pure and tested. All coordinates are PAGE points.
 */
import { findPart } from './problems/flatten.ts';
import type { ProblemGroup } from './problems/types';
import type { Problem } from './ai/types';

export type BlockKind = 'part' | 'setup';

export type PageBlock = {
  id: string;
  kind: BlockKind;
  /** the flat part label the block was made from ("2c"), or the problem label for a setup */
  label: string;
  heading: string;
  /** paragraphs, math as LaTeX between $...$ (rendered by MathText) */
  lines: string[];
  x: number;
  y: number;
  w: number;
  /** estimated height when placed (for stacking the next block); the block lays itself out */
  h?: number;
};

export const BLOCK_WIDTH = 720;
export const BLOCK_MARGIN_X = 48;
export const BLOCK_FONT = 15;
const GAP = 24;

type Content = { heading: string; lines: string[] };

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** What a "place the part" block says: the lettered part and its numbered sub-parts, nothing else. */
export function partContent(groups: ProblemGroup[] | undefined, problems: Problem[], label: string): Content | null {
  const found = groups ? findPart(groups, label) : undefined;
  if (found?.part) {
    const { group, part } = found;
    const lines = [`(${part.label}) ${clean(part.text)}`.trim()];
    for (const s of part.subparts) lines.push(`(${s.label}) ${clean(s.text)}`);
    return { heading: `${group.label}${part.label}`, lines: lines.filter((l) => l.replace(/^\([^)]*\)\s*/, '') !== '') };
  }
  const flat = problems.find((p) => p.label === label);
  if (flat && clean(flat.text)) return { heading: flat.label, lines: [clean(flat.text)] };
  if (found?.group) return setupContent(groups, label);
  return null;
}

/** What a "place the setup" block says: the shared context for the whole problem, plus text that applies to all parts. */
export function setupContent(groups: ProblemGroup[] | undefined, label: string): Content | null {
  const found = groups ? findPart(groups, label) : undefined;
  if (!found) return null;
  const { group } = found;
  const lines = [clean(group.context), group.closing ? clean(group.closing) : ''].filter(Boolean);
  if (lines.length === 0) return null;
  return { heading: `Problem ${group.label}${group.title ? ` · ${clean(group.title)}` : ''}`, lines };
}

/** Rough height in page points (placement only; the real block lays itself out). */
export function estimateHeight(c: Content, w = BLOCK_WIDTH, font = BLOCK_FONT): number {
  const perLine = Math.max(10, Math.floor((w - 24) / (font * 0.52)));
  const body = c.lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.replace(/\$/g, '').length / perLine)), 0);
  return 12 + font * 1.5 + body * font * 1.45 + (c.lines.length - 1) * 4 + 12;
}

/** First free y below everything already on the page (ink and earlier blocks); stays inside the page. */
export function nextBlockY(inkBottom: number, blocks: Array<Pick<PageBlock, 'y'> & { h?: number }>, pageH: number, estH: number): number {
  let bottom = Number.isFinite(inkBottom) ? inkBottom : 0;
  for (const b of blocks) bottom = Math.max(bottom, b.y + (b.h ?? 80));
  const y = bottom > 0 ? bottom + GAP : 48;
  return Math.max(GAP, Math.min(y, pageH - estH - GAP));
}

/** Keep a dragged block on the page. */
export function clampBlock(b: { x: number; y: number; w: number }, pageW: number, pageH: number): { x: number; y: number } {
  return { x: Math.max(0, Math.min(pageW - Math.min(b.w, pageW), b.x)), y: Math.max(0, Math.min(pageH - 40, b.y)) };
}
