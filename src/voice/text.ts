import { latexToUnicode } from '../ui/mathText.ts';

/**
 * Turning a tutor reply into something a voice can say, and finding what "this" points at. Pure (tested).
 *
 * The reply was already through the leak guard and the help-level cap (src/ai/index.ts guarded()); speaking it adds
 * nothing it didn't say in writing. Here we only remove what doesn't read aloud: color tags, markdown, LaTeX commands.
 */
const SAY: Record<string, string> = { '=': ' equals ', '≈': ' is about ', '≠': ' is not equal to ', '≤': ' is at most ', '≥': ' is at least ', '→': ' goes to ', '×': ' times ', '·': ' times ', '√': ' root ', '²': ' squared', '³': ' cubed', '−': ' minus ', '±': ' plus or minus ' };

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
  for (const [k, v] of Object.entries(SAY)) s = s.split(k).join(v);
  return s.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

/** Sentences, so speech can start on the first one and a mark can be timed to the sentence that mentions it. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? []).map((x) => x.trim()).filter(Boolean);
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
