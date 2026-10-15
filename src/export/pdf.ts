import { BLOCK_FONT } from '../blocks.ts';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../page.ts';
import type { Assignment } from '../store/types.ts';
import { latexToUnicode } from '../ui/mathText.ts';

/**
 * What the native exportPDF draws (modules/pencil-canvas/ios/PdfExport.swift): every page of the assignment in order,
 * its saved ink, and the question blocks placed on it (math as Unicode, since the PDF has no LaTeX typesetter).
 * Tutor marks are not included: submitted work is the student's own. Pure (the page reader is injected).
 */
export type PdfRequest = {
  title: string;
  pageWidth: number;
  pageHeight: number;
  pages: { drawing: string; blocks: { x: number; y: number; w: number; heading?: string; lines: string[]; fontSize: number }[] }[];
};

export function buildPdfRequest(a: Pick<Assignment, 'title' | 'pageIds' | 'blocks'>, readPage: (pageId: string) => string): PdfRequest {
  return {
    title: a.title.trim() || 'Penquire',
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    pages: a.pageIds.map((id) => ({
      drawing: readPage(id),
      blocks: (a.blocks?.[id] ?? []).map((b) => ({
        x: b.x,
        y: b.y,
        w: b.w,
        heading: b.heading || undefined,
        lines: b.lines.map((l) => latexToUnicode(l.replace(/\$/g, ''))),
        fontSize: BLOCK_FONT,
      })),
    })),
  };
}
