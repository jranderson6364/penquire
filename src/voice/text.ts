import { latexToUnicode } from '../ui/mathText.ts';

/**
 * Turning a tutor reply into something a voice can say, and finding what "this" points at. Pure (tested).
 *
 * The reply was already through the leak guard and the help-level cap (src/ai/index.ts guarded()); speaking it adds
 * nothing it didn't say in writing. Here we only remove what doesn't read aloud: color tags, markdown, LaTeX commands.
 */
const SAY: Record<string, string> = { '=': ' equals ', '≈': ' is about ', '≠': ' is not equal to ', '≤': ' is at most ', '≥': ' is at least ', '→': ' goes to ', '×': ' times ', '·': ' times ', '√': ' root ', '²': ' squared', '³': ' cubed', '−': ' minus ', '±': ' plus or minus ', '+': ' plus ' };

export function speakable(reply: string): string {
  let s = reply
    .replace(/\[\[\d+\|([^\]]*)\]\]/g, '$1') // [[2|the sign]] -> the sign
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\bL(\d+)\b/g, 'line $1');
  s = s.replace(/\$([^$]+)\$/g, (_m, tex: string) => latexToUnicode(tex));
  s = latexToUnicode(s);
  s = mathAloud(s);
  for (const [k, v] of Object.entries(SAY)) s = s.split(k).join(v);
  return s.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/,([.,;:!?])/g, '$1').trim();
}

/** an operator inside parentheses: this is math, not an aside */
const MATH_IN_PARENS = /\(([^()]*[\d=+\-−×·/][^()]*)\)/g;

/**
 * Written math a voice mangles, said the way a tutor would: "2(3x − 4)" is "2 times the quantity 3x minus 4",
 * "x^2" is "x squared", "6/2" is "6 over 2", "-3" is "negative 3". Digits stay digits (the voice reads them well, and
 * "line 3" or "3.5" must not change). Words like "step-by-step" and "and/or" are left alone.
 */
function mathAloud(text: string): string {
  return text
    .replace(/\^\s*\{?\s*2\s*\}?(?![\d.])/g, ' squared')
    .replace(/\^\s*\{?\s*3\s*\}?(?![\d.])/g, ' cubed')
    .replace(/\^\s*\{?\s*(-?\w+)\s*\}?/g, ' to the power $1')
    .replace(/(\d|\))\((?=[^()]*[\d=+\-−×·/][^()]*\))/g, '$1 times the quantity (')
    .replace(MATH_IN_PARENS, ' $1,')
    .replace(/(\d+|\b[a-zA-Z])\s*\/\s*(?=\d|[a-zA-Z]\b)/g, '$1 over ')
    .replace(/(\d)\s*\*\s*(?=\d)/g, '$1 times ')
    .replace(/(^|[\s=(,])[-−](?=\d|[a-zA-Z]\b)/g, '$1negative ')
    .replace(/(\d[a-zA-Z]?|\b[a-zA-Z])\s*-\s*(?=\d|[a-zA-Z]\b)/g, '$1 minus ')
    .replace(/\s-\s/g, ' minus ');
}

/**
 * Sentences, so speech can start on the first one and a mark can be timed to the sentence that mentions it. A period
 * inside a number ("3.5") is not a sentence end; one followed by a space or a new line is.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Speaking a reply while it streams: which sentences of `text` (the guarded reply so far, or the final reply) are
 * still to be said, given those already said. While streaming, a reply that no longer starts with what was said waits
 * for the final text; the final text then says only the sentences not said yet. The last sentence always comes from
 * the final text (the stream releases a sentence only once something follows it).
 */
export function unspoken(said: string[], text: string, final: boolean): string[] {
  const all = sentences(text);
  let k = 0;
  while (k < said.length && k < all.length && norm(all[k]) === norm(said[k])) k++;
  if (k === said.length) return all.slice(k);
  if (!final) return [];
  const done = new Set(said.map(norm));
  return all.filter((s) => !done.has(norm(s)));
}

/**
 * The line the student last wrote on: the line holding the most recently created stroke. "Is this right?" means this
 * line. Stroke boxes carry their creation time (ms); lines list their stroke indexes.
 */
export function pointedLine(lines: { id: string; strokes: number[] }[], strokes: { i: number; t: number }[]): string | undefined {
  if (strokes.length === 0) return undefined;
  const latest = strokes.reduce((a, b) => (b.t > a.t ? b : a));
  return lines.find((l) => l.strokes.includes(latest.i))?.id;
}
