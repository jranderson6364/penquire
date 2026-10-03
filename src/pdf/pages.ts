import { PDFDocument } from '@cantoo/pdf-lib';

/**
 * Large PDFs (a 739-page course text) cannot be sent whole: the document API caps pages and size, and paying for
 * 700 pages to read 3 problems would be absurd. The student gives the page range; we slice it out on-device.
 * Pure JS (no native code), so this needs no rebuild.
 */

/** Documents above this are never sent whole. The API limit is higher (about 600 pages / 32 MB); cost is the real reason. */
export const MAX_WHOLE_PDF_PAGES = 40;
/** Largest slice we will send. */
export const MAX_SLICE_PAGES = 40;

export type PageRange = { pages: number[]; error?: undefined } | { pages?: undefined; error: string };

/** "80-82, 90" -> [80, 81, 82, 90] (1-based, sorted, unique). Rejects garbage, reversed or out-of-range input. */
export function parsePageRange(input: string, pageCount?: number): PageRange {
  const text = input.trim().replace(/\s*[-–—]\s*/g, '-');
  if (!text) return { error: 'Enter the pages that contain your problems, like 80-82.' };
  const set = new Set<number>();
  for (const piece of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?$/.exec(piece);
    if (!m) return { error: `"${piece}" is not a page or a range like 80-82.` };
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < 1) return { error: 'Pages start at 1.' };
    if (to < from) return { error: `The range ${from}-${to} runs backwards.` };
    if (pageCount !== undefined && to > pageCount) return { error: `This PDF only has ${pageCount} pages.` };
    if (to - from + 1 > MAX_SLICE_PAGES) return { error: `Pick at most ${MAX_SLICE_PAGES} pages at a time.` };
    for (let p = from; p <= to; p++) set.add(p);
    if (set.size > MAX_SLICE_PAGES) return { error: `Pick at most ${MAX_SLICE_PAGES} pages in total.` };
  }
  return { pages: [...set].sort((a, b) => a - b) };
}

export async function pdfPageCount(base64: string): Promise<number> {
  const doc = await PDFDocument.load(base64, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** A new PDF (base64) containing only `pages` (1-based) of the source. */
export async function slicePdf(base64: string, pages: number[]): Promise<string> {
  const src = await PDFDocument.load(base64, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();
  const bad = pages.find((p) => p < 1 || p > total);
  if (bad !== undefined) throw new Error(`Page ${bad} is outside this ${total}-page PDF.`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  copied.forEach((page) => out.addPage(page));
  return out.saveAsBase64();
}
