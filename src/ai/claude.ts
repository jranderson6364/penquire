import { TUTOR_RULES, contextBlock, intentBlock, levelBlock } from './prompts';
import { PARSE_RULES, parseTask, repairTask } from './parsePrompt';
import { HttpError, TimeoutError, parseRetryAfter, withRetry } from './retry';
import { flatten } from '../problems/flatten';
import { sanitizeParsed } from '../problems/sanitize';
import { hasErrors, validateGroups } from '../problems/validate';
import { sanitizeCheck } from './sanitize';
import { cleanReply } from './replyText';
import { effortParam } from './models';
import { sanitizeMarks } from '../tutor/marks';
import type {
  CheckInput,
  CheckResult,
  ParseInput,
  ParseResult,
  ReplyInput,
  ReplyResult,
  TutorProvider,
  Usage,
} from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

type ContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

/**
 * Thinking can't be disabled on current models and its tokens count toward max_tokens, so a full-page vision
 * grade needs headroom (4000 truncated before the tool call). Effort trades thoroughness for speed; tune with evals.
 */
const MAX_TOKENS = 16000;
const CHECK_EFFORT = 'medium';

type Tool = { name: string; description: string; input_schema: Record<string, unknown>; strict?: boolean };

type ApiResponse = {
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

const CHECK_TOOL: Tool = {
  name: 'report_check',
  description: "Report step-by-step feedback on the student's handwritten page.",
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        description: 'One entry per labeled line (L1, L2, ...) on the page, in order.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Line label from the gutter, e.g. "L4"' },
            part: {
              type: 'string',
              description:
                'The problem part this line belongs to: exactly one label from the problem list (e.g. "2a", "3.10c"), or "none" for headings, margin scratch and anything that belongs to no part. Prefer the label the student wrote next to the work ("2a)"); otherwise work continues the previous line\'s part until the student starts another.',
            },
            reading: {
              type: 'string',
              description:
                'EXACT transcription of what is written, mistakes included (LaTeX for math, one equation per line, no prose). Units exactly as written, each in \\mathrm{...} (e.g. 9.8\\,\\mathrm{m/s^2}); never add a unit the student did not write. Never correct, simplify or complete it.',
            },
            read_confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description:
                'How sure you are that `reading` is exactly what is written, judged BEFORE grading: high = every symbol clear; medium = one symbol could be something else but the meaning is probably right; low = a symbol that matters (a sign, digit, exponent, subscript, fraction scope) could be read another way.',
            },
            uncertain: {
              type: 'string',
              description: 'The exact characters of `reading` you are unsure of (e.g. "-2" or "^2"), or "" when read_confidence is high.',
            },
            verdict: {
              type: 'string',
              enum: ['valid', 'partial', 'incorrect', 'unreadable', 'context'],
              description:
                '"context" = headings, labels, restated givens, or diagrams with no claim to grade. "unreadable" = could not read confidently.',
            },
            note: {
              type: 'string',
              description: 'One short clause: what is right about it, or WHERE the problem is. Never the corrected expression (below help level 4).',
            },
            obstacle: {
              type: 'string',
              enum: ['slip', 'method', 'notation', 'prerequisite', 'misconception', 'no_work', 'incomplete', 'alt_path', 'unclear'],
              description:
                'Only for lines that are not valid/context: the kind of obstacle the work shows (slip = sound plan, local error; method = inapplicable method; notation; prerequisite = missing earlier skill; misconception = coherent wrong idea; no_work = correct result without reasoning; incomplete = missing deliverable; alt_path = valid but unexpected approach; unclear = the work does not tell these apart).',
            },
          },
          required: ['id', 'part', 'reading', 'read_confidence', 'verdict', 'note'],
        },
      },
      parts: {
        type: 'array',
        description: 'Status of every problem part in the assignment that appears on this page or should have.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            status: {
              type: 'string',
              enum: ['complete', 'in_progress', 'missing_items', 'not_started'],
              description:
                'complete = every line for this part holds up AND everything the part asks for is on the page (its final answer, units, requested explanation). Use it as soon as that is true: do not hold it back for style, extra checking, or because an earlier check flagged the part. in_progress = the work so far holds up but stops before the answer, or a line is still partly wrong. missing_items = the work is written but a specific requested item is absent (list it in missing). not_started = nothing written for this part.',
            },
            missing: { type: 'array', items: { type: 'string' }, description: 'What the part asks for that is not yet addressed. Empty when the part is complete.' },
          },
          required: ['label', 'status', 'missing'],
        },
      },
      feedback: {
        type: 'string',
        description:
          'Short markdown summary in the tutor format, about the lines you were asked to grade ONLY: per part, the key steps with **valid** / **partially valid** / **incorrect** and why; missing pieces; presentation only if it makes the meaning unclear. Name the part each point is about. Never discuss settled lines. Keep it tight.',
      },
      question: { type: 'string', description: 'ONE question or next action for the earliest REAL issue, chosen to fit its obstacle. Empty string "" when the work holds up: do not invent a question.' },
      revealed: {
        type: 'array',
        description: 'Everything the feedback, notes and question gave away beyond the student\'s own work. [] if you only marked lines.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['location', 'principle', 'example', 'subgoal', 'step'] },
            what: { type: 'string', description: 'A few words, e.g. "error is in L4", "energy conservation".' },
          },
          required: ['kind', 'what'],
        },
      },
      fixed_since_last: { type: 'array', items: { type: 'string' }, description: 'Previously open issues that are now fixed' },
      still_open: { type: 'array', items: { type: 'string' }, description: 'Issues that remain open (short phrases, reused next round)' },
    },
    required: ['lines', 'parts', 'feedback', 'question', 'revealed', 'fixed_since_last', 'still_open'],
  },
};

/** A reply that looks at the page has to do the maths itself: 'low' effort told a student with a correct answer it was wrong. */
const REPLY_EFFORT_WITH_PAGE = 'medium';

const REPLY_TOOL: Tool = {
  name: 'reply_to_student',
  description: "Send a short reply to the student, pointing at the exact spots on their page that you are talking about.",
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'Your reply: a few sentences of plain markdown prose, one question at most. Never JSON. When you mark a spot, wrap the words that talk about it in [[tag|words]] using that mark’s tag, e.g. "Check [[1|this sign]] against [[2|the term above it]]", so the student sees which mark you mean (each tag is a color). The student cannot see the gutter labels (L1, L2...), so never write them in the message or in a note: say "this line" or use a tagged phrase.',
      },
      marks: {
        type: 'array',
        description:
          "0 to 4 drawings on the student's page that point at where to look. Be SPECIFIC: mark the smallest stretch that holds the issue (one term, one sign, one number), not a whole line, and use different lines or different stretches for different points. Only POINT: never write the fix, an answer or a corrected expression. If the student asks you to show, point at, highlight, circle or underline something, you MUST draw it. Otherwise use none when pointing would not help, and do not mark a correct line unless the student asked about it.",
        items: {
          type: 'object',
          properties: {
            tag: { type: 'integer', description: 'A different number 1 to 4 for each mark; the message names the mark as [[tag|words]].' },
            kind: { type: 'string', enum: ['highlight', 'circle', 'underline', 'note'], description: 'highlight = marker wash over the stretch (good for a whole line or phrase); circle = a loop around a small expression; underline = line under it; note = a short caption beside it (7 words or fewer, a pointer or a question, never the fix).' },
            line: { type: 'string', description: 'The gutter label of the line, e.g. "L4".' },
            line_text: { type: 'string', description: 'When you mean only part of the line: the whole line as you read it, written exactly (same symbols, in order).' },
            quote: { type: 'string', description: 'When you mean only part of the line: the exact characters of line_text that you mean (a term, a sign, a number), copied from line_text.' },
            from: { type: 'number', description: 'Left edge of the stretch you mean, as a fraction of that line’s width (0 = left end of the line, 1 = right end). Prefer line_text + quote; use from/to only if you cannot quote. Omit all of them for the whole line.' },
            to: { type: 'number', description: 'Right edge of the stretch, as a fraction of the line’s width.' },
            note: { type: 'string', description: 'Caption text; required for kind note, optional otherwise. Never include a line label like L4.' },
          },
          required: ['tag', 'kind', 'line'],
        },
      },
    },
    required: ['message', 'marks'],
  },
};

const SUBPART_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Roman numeral as printed without parentheses: "i", "ii".' },
    text: { type: 'string', description: 'Verbatim text of this sub-part, math in LaTeX.' },
    hint: { type: 'string', description: 'Hint that follows this sub-part, or "".' },
  },
  required: ['label', 'text', 'hint'],
  additionalProperties: false,
};

const PART_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Letter as printed without parentheses: "a", "b" ("A" if printed as a capital).' },
    text: { type: 'string', description: "This part's own wording only (its lead-in if it has sub-parts). Never the problem setup." },
    hint: { type: 'string', description: 'Hint that belongs to this part, or "".' },
    asks_for: { type: 'array', items: { type: 'string' }, description: 'Every distinct deliverable of this part.' },
    subparts: { type: 'array', items: SUBPART_SCHEMA, description: 'Roman-numeral items under this part, or [].' },
  },
  required: ['label', 'text', 'hint', 'asks_for', 'subparts'],
  additionalProperties: false,
};

const PARSE_TOOL: Tool = {
  name: 'report_problems',
  description: 'Report the assignment as structured problems: setup once, then parts, sub-parts, hints and closing text.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      course: { type: 'string', description: 'Course name or number if stated, else "".' },
      notes: { type: 'array', items: { type: 'string' }, description: 'Assignment-level text that is not a problem (reading, logistics, policies).' },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Problem number as printed without the word "Problem": "6", "3.10".' },
            title: { type: 'string', description: 'Printed title, or "".' },
            context: { type: 'string', description: 'The problem setup before the first part, verbatim, stored once. Figures as [Figure: ...].' },
            parts: { type: 'array', items: PART_SCHEMA, description: 'Lettered parts, or [] if the problem has none.' },
            closing: { type: 'string', description: 'Text after the last part that applies to all parts, or "".' },
            hint: { type: 'string', description: 'A hint for the whole problem, or "".' },
            asks_for: { type: 'array', items: { type: 'string' }, description: 'Deliverables of the whole problem (main use: problems with no parts).' },
          },
          required: ['label', 'title', 'context', 'parts', 'closing', 'hint', 'asks_for'],
          additionalProperties: false,
        },
      },
    },
    required: ['course', 'notes', 'problems'],
    additionalProperties: false,
  },
};

export type UsageKind = 'check' | 'reply' | 'parse';
export type ClaudeOptions = {
  apiKey: string;
  checkModel: string;
  parseModel: string;
  /** thinking effort for assignment parsing (a one-time cost per assignment, so quality wins over speed) */
  parseEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** called once per API response that was billed, including truncated ones */
  onUsage?: (e: { kind: UsageKind; model: string; usage: Usage }) => void;
};

/** Vision + thinking can legitimately take a while; beyond this the request is abandoned. */
const REQUEST_TIMEOUT_MS = 180_000;

export class ClaudeProvider implements TutorProvider {
  readonly id = 'anthropic';
  constructor(private opts: ClaudeOptions) {}

  private async call(body: Record<string, unknown>, kind: UsageKind): Promise<ApiResponse> {
    if (!this.opts.apiKey) throw new Error('No Anthropic API key. Add one in Settings or .env.');
    const res = await withRetry(() => this.post(body), {
      onRetry: (n, delay, e) => console.warn(`Claude API retry ${n} in ${delay} ms:`, e instanceof Error ? e.message : e),
    });
    const usage = ClaudeProvider.usage(res);
    if (usage) {
      try {
        this.opts.onUsage?.({ kind, model: res.model, usage });
      } catch (e) {
        console.warn('usage recording failed', e); // metering must never break a check
      }
    }
    return res;
  }

  private async post(body: Record<string, unknown>): Promise<ApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = await res.text();
        try {
          detail = JSON.parse(detail)?.error?.message ?? detail;
        } catch {}
        throw new HttpError(res.status, `Claude API ${res.status}: ${detail}`, parseRetryAfter(res.headers.get('retry-after')));
      }
      return (await res.json()) as ApiResponse;
    } catch (e) {
      if (controller.signal.aborted) throw new TimeoutError(REQUEST_TIMEOUT_MS);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Forced tool_choice ('tool'/'any') is a 400 on Sonnet 5.5, Opus 5.5 and Fable 5.1, so ask for the tool by
   * name (tool_choice auto) and retry once if the model answers in prose instead.
   */
  private async callTool<T>(body: Record<string, unknown>, tool: Tool, instruction: string, kind: UsageKind): Promise<{ res: ApiResponse; out: T }> {
    const messages = (body.messages as Message[]).map((m, i, all) => {
      if (i !== all.length - 1 || typeof m.content === 'string') return m;
      return { ...m, content: [...m.content, { type: 'text', text: instruction } as ContentBlock] };
    });
    const req = { ...body, messages, tools: [tool], tool_choice: { type: 'auto' } };
    let last: ApiResponse | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.call(req, kind);
      // Retrying a truncated or refused request would fail identically; only retry a prose answer.
      if (last.stop_reason === 'max_tokens') throw new Error('The answer was cut off before it finished. Try again, or check fewer lines at once.');
      if (last.stop_reason === 'refusal') throw new Error(`The model declined this request${last.stop_details?.category ? ` (${last.stop_details.category})` : ''}.`);
      const block = last.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
      if (block?.input) return { res: last, out: block.input as T };
    }
    throw new Error(`Model did not return ${tool.name} (stop_reason: ${last?.stop_reason})`);
  }

  private static usage(res: ApiResponse): Usage | undefined {
    if (!res.usage) return undefined;
    return {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
  }

  private system() {
    return [{ type: 'text', text: TUTOR_RULES, cache_control: { type: 'ephemeral' } }];
  }

  async parseAssignment(input: ParseInput): Promise<ParseResult> {
    const content: ContentBlock[] = [];
    if (input.pdfBase64) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdfBase64 } });
    }
    if (input.text?.trim()) content.push({ type: 'text', text: `ASSIGNMENT TEXT:\n${input.text.trim()}` });
    content.push({ type: 'text', text: parseTask(input.title, input.onlyProblems) });

    const call = async (messages: Message[]) => {
      const { out } = await this.callTool<Record<string, unknown>>(
        { model: this.opts.parseModel, max_tokens: MAX_TOKENS, ...effortParam(this.opts.parseModel, this.opts.parseEffort ?? 'high'), system: PARSE_RULES, messages },
        PARSE_TOOL,
        `Respond only by calling the ${PARSE_TOOL.name} tool.`,
        'parse'
      );
      return out;
    };

    let raw = await call([{ role: 'user', content }]);
    let parsed = sanitizeParsed(raw);
    let issues = validateGroups(parsed.groups);

    // One repair pass: show the model its own answer and exactly what the checker found. Keep whichever is better.
    if (hasErrors(issues)) {
      try {
        const messages: Message[] = [
          { role: 'user', content },
          { role: 'user', content: [{ type: 'text', text: repairTask(JSON.stringify(raw), issues.filter((i) => i.severity === 'error').map((i) => i.message)) }] },
        ];
        const fixedRaw = await call(messages);
        const fixed = sanitizeParsed(fixedRaw);
        const fixedIssues = validateGroups(fixed.groups);
        if (fixedIssues.filter((i) => i.severity === 'error').length <= issues.filter((i) => i.severity === 'error').length) {
          raw = fixedRaw;
          parsed = fixed;
          issues = fixedIssues;
        }
      } catch (e) {
        console.warn('parse repair pass failed; keeping the first parse', e);
      }
    }

    return { course: parsed.course, problems: flatten(parsed.groups), groups: parsed.groups, notes: parsed.notes, issues };
  }

  async check(input: CheckInput): Promise<CheckResult> {
    const lineList = input.lines.length
      ? input.lines.map((l) => `${l.id}: box x=${Math.round(l.x)} y=${Math.round(l.y)} w=${Math.round(l.w)} h=${Math.round(l.h)}`).join('\n')
      : '(no lines detected)';
    const previous = input.previous
      ? `PREVIOUS ROUND (line IDs may have changed since):\nFeedback: ${input.previous.feedback}\nStill open: ${input.previous.stillOpen.join('; ') || 'none'}\nSay explicitly which of these are now fixed.`
      : 'This is the first check of this page.';
    const settledIds = new Set((input.settled ?? []).map((s) => s.id));
    const settled = input.settled?.length
      ? `SETTLED LINES (already verified in an earlier check and unchanged since; they are context for the lines below, nothing more):\n${input.settled
          .map((s) => `${s.id} [${s.part || 'none'}]: ${s.reading}`)
          .join('\n')}\nDo NOT re-grade, re-transcribe or return an entry for a settled line, and do not mention settled lines or their parts anywhere in the feedback or question, not even to say they are unchanged or still fine. Write only about the lines you grade. If a graded line shows that a settled line was wrong after all, say so in the feedback (the settled line will be re-checked next time).`
      : '';
    // The student told us what these lines say (and the ink hasn't changed since): grade what they wrote, don't re-read it.
    const confirmed = input.confirmed?.length
      ? `READINGS CONFIRMED BY THE STUDENT (the ink is unchanged since they confirmed): use exactly this text as the line's reading, with read_confidence "high", then grade it normally. A confirmed reading is what they wrote, not a claim that it is correct.\n${input.confirmed
          .map((c) => `${c.id}: ${c.reading.slice(0, 200)}`)
          .join('\n')}\n\n`
      : '';
    const gradeList = settledIds.size ? `\nLines to grade: ${input.lines.filter((l) => !settledIds.has(l.id)).map((l) => l.id).join(', ')}` : '';

    const { res, out } = await this.callTool<{
      lines: CheckResult['lines'];
      parts: CheckResult['parts'];
      feedback: string;
      question: string;
      fixed_since_last: string[];
      still_open: string[];
    }>(
      {
      model: this.opts.checkModel,
      max_tokens: MAX_TOKENS,
      ...effortParam(this.opts.checkModel, CHECK_EFFORT),
      system: this.system(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: contextBlock(input), cache_control: { type: 'ephemeral' } },
            { type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.base64 } },
            {
              type: 'text',
              text: `${levelBlock(input)}

This is page ${input.pageNumber} of the student's work.${input.focusPart ? ` The student is currently working on part ${input.focusPart}: put your detailed feedback and your one question there, but still report the status of every part (including parts the page should address but does not).` : ''}
Detected lines (boxes in page points; labels are drawn in the gutter):
${lineList}${gradeList}

${confirmed}${settled ? settled + '\n\n' : ''}${previous}

Check my work. First verify each line yourself, including steps I did in my head. Label every line you are asked to grade, and give each one its problem part. Diagnose an obstacle only on a line that is actually wrong, incomplete or ambiguous. Report part status (including parts the page should address but doesn't). Give one question or next action ONLY if there is a real issue; if my work holds up, leave the question empty and say so in the feedback. List what you revealed.`,
            },
          ],
        },
      ],
      },
      CHECK_TOOL,
      `Respond only by calling the ${CHECK_TOOL.name} tool.`,
      'check'
    );

    return sanitizeCheck(out as unknown as Record<string, unknown>, res.model, ClaudeProvider.usage(res), input.problems.length ? input.problems.map((p) => p.label) : undefined);
  }

  async reply(input: ReplyInput): Promise<ReplyResult> {
    const last = input.lastCheck
      ? `\n\nLATEST CHECK RESULT:\n${input.lastCheck.feedback}\nStill open: ${input.lastCheck.stillOpen.join('; ') || 'none'}`
      : '';
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: contextBlock(input) + last, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: '(Conversation begins.)' },
        ],
      },
      { role: 'assistant', content: 'Ready. What are you working on?' },
    ];
    for (const turn of input.history.slice(-16)) messages.push({ role: turn.role, content: turn.text });

    const finalContent: ContentBlock[] = [];
    if (input.image) {
      finalContent.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.base64 } });
    }
    finalContent.push({
      type: 'text',
      text: `${levelBlock(input)}${input.intent ? `\n\n${intentBlock(input.intent, input.part, input.evidence)}` : ''}\n\nSTUDENT: ${input.message}\n\n(Reply conversationally in a few sentences of plain markdown prose. Never output JSON or a code block, even though the context above came from structured data. If they describe a fix in words, check it. One question max.)`,
    });
    messages.push({ role: 'user', content: finalContent });

    // With a labelled page image the tutor may also point at lines. If it will not use the tool, fall back to prose.
    const known = new Set((input.markLineIds ?? []).map((id) => id.toUpperCase()));
    if (!(input.image && known.size > 0)) console.warn(`[penquire] reply without marks: image=${!!input.image}, labelled lines=${known.size}`);
    if (input.image && known.size > 0) {
      try {
        const { out } = await this.callTool<{ message?: unknown; marks?: unknown }>(
          { model: this.opts.checkModel, max_tokens: MAX_TOKENS, ...effortParam(this.opts.checkModel, REPLY_EFFORT_WITH_PAGE), system: this.system(), messages },
          REPLY_TOOL,
          `Respond only by calling the ${REPLY_TOOL.name} tool.`,
          'reply'
        );
        // the student cannot see gutter labels; reading order makes "line 3" mean something to them
        const message = cleanReply(typeof out.message === 'string' ? out.message : '').text.replace(/\bL(\d+)\b/g, 'line $1');
        const marks = sanitizeMarks(out.marks, known);
        console.warn(`[penquire] reply with marks: ${known.size} labelled lines, tutor drew ${marks.length}`);
        if (message) return { text: message, marks };
      } catch (e) {
        console.warn('reply with marks failed; answering in prose', e);
      }
    }

    const ask = async (msgs: Message[]) => {
      const res = await this.call(
        {
          model: this.opts.checkModel,
          max_tokens: MAX_TOKENS,
          ...effortParam(this.opts.checkModel, 'low'),
          system: this.system(),
          messages: msgs,
        },
        'reply'
      );
      if (res.stop_reason === 'refusal') throw new Error(`The model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`);
      const raw = res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim();
      return { raw, stop: res.stop_reason };
    };

    let { raw, stop } = await ask(messages);
    let cleaned = cleanReply(raw);
    // The model sometimes answers in the JSON shape of a check result. Salvage its prose, or ask once more in prose.
    if (cleaned.wasJson && !cleaned.text) {
      const retry = [...messages, { role: 'assistant' as const, content: raw }, { role: 'user' as const, content: 'That was JSON. Answer again as a short plain-text message to me, no JSON, no code blocks.' }];
      ({ raw, stop } = await ask(retry));
      cleaned = cleanReply(raw);
    }
    if (!cleaned.text) throw new Error(stop === 'max_tokens' ? 'The reply was cut off before it finished. Try again.' : 'The model returned an empty reply. Try again.');
    return { text: cleaned.text, marks: [] };
  }
}
