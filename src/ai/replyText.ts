/**
 * Chat replies must be plain markdown. The model sometimes imitates the structured check output it has seen in the
 * context and answers with a JSON object (or a fenced JSON block). This turns such output back into prose, and says
 * whether anything usable was left so the caller can retry once instead of showing raw JSON.
 */

const PROSE_KEYS = ['reply', 'message', 'response', 'answer', 'text', 'feedback', 'question', 'hint', 'note'];

const stripFence = (s: string): string => {
  const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(s.trim());
  return m ? m[1].trim() : s.trim();
};

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/** Prose strings found in a parsed JSON value, in a sensible order (known prose keys first, depth-limited). */
function prose(v: unknown, depth = 0): string[] {
  if (depth > 3 || v == null) return [];
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.flatMap((x) => prose(x, depth + 1));
  if (typeof v !== 'object') return [];
  const o = v as Record<string, unknown>;
  const out: string[] = [];
  for (const k of PROSE_KEYS) if (typeof o[k] === 'string' && (o[k] as string).trim()) out.push((o[k] as string).trim());
  // A check-shaped object: surface the open items as bullets, never the per-line records.
  if (Array.isArray(o.still_open) || Array.isArray(o.stillOpen)) {
    const items = ((o.still_open ?? o.stillOpen) as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (items.length) out.push(items.map((x) => `- ${x}`).join('\n'));
  }
  return [...new Set(out)];
}

const looksLikeJson = (s: string): boolean => /^[\[{]/.test(s) && /"[A-Za-z_]+"\s*:/.test(s);

export type CleanedReply = { text: string; wasJson: boolean };

export function cleanReply(raw: string): CleanedReply {
  const body = stripFence(raw);
  if (!looksLikeJson(body)) {
    // Prose that merely contains a stray JSON block: drop fenced JSON blocks, keep the sentences.
    const withoutBlocks = raw.replace(/```json[\s\S]*?```/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    return { text: withoutBlocks, wasJson: withoutBlocks !== raw.trim() };
  }
  const parsed = tryParse(body);
  const parts = parsed === undefined ? [] : prose(parsed);
  return { text: parts.join('\n\n'), wasJson: true };
}
