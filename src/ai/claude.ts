import { TUTOR_RULES, contextBlock, levelBlock } from './prompts';
import type {
  CheckInput,
  CheckResult,
  ParseInput,
  ParseResult,
  ReplyInput,
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

type Tool = { name: string; description: string; input_schema: Record<string, unknown> };

type ApiResponse = {
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: string;
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
            part: { type: 'string', description: 'Problem part this line belongs to, e.g. "3.10c", if identifiable' },
            reading: { type: 'string', description: 'How you read the line (LaTeX for math)' },
            verdict: {
              type: 'string',
              enum: ['valid', 'partial', 'incorrect', 'unreadable', 'context'],
              description:
                '"context" = headings, labels, restated givens, or diagrams with no claim to grade. "unreadable" = could not read confidently.',
            },
            note: {
              type: 'string',
              description: 'One short clause: why it is valid, or WHERE the problem is (as a question if possible). Never the corrected expression.',
            },
          },
          required: ['id', 'reading', 'verdict', 'note'],
        },
      },
      parts: {
        type: 'array',
        description: 'Status of every problem part in the assignment that appears on this page or should have.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            status: { type: 'string', enum: ['complete', 'in_progress', 'missing_items', 'not_started'] },
            missing: { type: 'array', items: { type: 'string' }, description: 'What the part asks for that is not yet addressed' },
          },
          required: ['label', 'status', 'missing'],
        },
      },
      feedback: {
        type: 'string',
        description:
          'Short markdown summary in the tutor format: per part, the key steps with **valid** / **partially valid** / **incorrect** and why; missing pieces; one line on presentation if relevant. Keep it tight.',
      },
      question: { type: 'string', description: 'Exactly ONE guiding question that moves the student to the next micro-step.' },
      fixed_since_last: { type: 'array', items: { type: 'string' }, description: 'Previously open issues that are now fixed' },
      still_open: { type: 'array', items: { type: 'string' }, description: 'Issues that remain open (short phrases, reused next round)' },
    },
    required: ['lines', 'parts', 'feedback', 'question', 'fixed_since_last', 'still_open'],
  },
};

const PARSE_TOOL: Tool = {
  name: 'report_problems',
  description: 'Report the problems in the assignment, split into the smallest gradable parts.',
  input_schema: {
    type: 'object',
    properties: {
      course: { type: 'string', description: 'Course name/number if stated' },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'e.g. "3.10c" or "2b". Combine problem number and part letter.' },
            text: {
              type: 'string',
              description: 'Verbatim problem text for this part, math in LaTeX. Include the shared problem stem for each part so parts stand alone.',
            },
            asks_for: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Every distinct thing a complete answer must contain, including the required final form and any "explain/justify" requirement.',
            },
          },
          required: ['label', 'text', 'asks_for'],
        },
      },
    },
    required: ['problems'],
  },
};

export type ClaudeOptions = { apiKey: string; checkModel: string; parseModel: string };

export class ClaudeProvider implements TutorProvider {
  readonly id = 'anthropic';
  constructor(private opts: ClaudeOptions) {}

  private async call(body: Record<string, unknown>): Promise<ApiResponse> {
    if (!this.opts.apiKey) throw new Error('No Anthropic API key. Add one in Settings or .env.');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = await res.text();
      try {
        detail = JSON.parse(detail)?.error?.message ?? detail;
      } catch {}
      throw new Error(`Claude API ${res.status}: ${detail}`);
    }
    return (await res.json()) as ApiResponse;
  }

  /**
   * Forced tool_choice ('tool'/'any') is a 400 on Sonnet 5.5, Opus 5.5 and Fable 5.1, so ask for the tool by
   * name (tool_choice auto) and retry once if the model answers in prose instead.
   */
  private async callTool<T>(body: Record<string, unknown>, tool: Tool, instruction: string): Promise<{ res: ApiResponse; out: T }> {
    const messages = (body.messages as Message[]).map((m, i, all) => {
      if (i !== all.length - 1 || typeof m.content === 'string') return m;
      return { ...m, content: [...m.content, { type: 'text', text: instruction } as ContentBlock] };
    });
    const req = { ...body, messages, tools: [tool], tool_choice: { type: 'auto' } };
    let last: ApiResponse | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await this.call(req);
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
    content.push({
      type: 'text',
      text: `Extract the problems from this assignment ("${input.title}").${
        input.onlyProblems?.trim() ? ` Only include these problems: ${input.onlyProblems.trim()}.` : ''
      } Split into the smallest gradable parts (a, b, c...). Copy wording verbatim; math in LaTeX. For asks_for, list every distinct deliverable, especially bundled asks ("is it valid? if not, give a minimal fix") and required forms ("find the cosine of the angle").`,
    });
    const { out } = await this.callTool<{ course?: string; problems: Array<{ label: string; text: string; asks_for: string[] }> }>(
      { model: this.opts.parseModel, max_tokens: 8000, messages: [{ role: 'user', content }] },
      PARSE_TOOL,
      `Respond only by calling the ${PARSE_TOOL.name} tool.`
    );
    return {
      course: out.course,
      problems: (out.problems ?? []).map((p) => ({ label: p.label, text: p.text, asksFor: p.asks_for ?? [] })),
    };
  }

  async check(input: CheckInput): Promise<CheckResult> {
    const lineList = input.lines.length
      ? input.lines.map((l) => `${l.id}: box x=${Math.round(l.x)} y=${Math.round(l.y)} w=${Math.round(l.w)} h=${Math.round(l.h)}`).join('\n')
      : '(no lines detected)';
    const previous = input.previous
      ? `PREVIOUS ROUND (line IDs may have changed since):\nFeedback: ${input.previous.feedback}\nStill open: ${input.previous.stillOpen.join('; ') || 'none'}\nSay explicitly which of these are now fixed.`
      : 'This is the first check of this page.';

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
      max_tokens: 4000,
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

This is page ${input.pageNumber} of the student's work.${input.focusPart ? ` The student is currently working on ${input.focusPart}.` : ''}
Detected lines (boxes in page points; labels are drawn in the gutter):
${lineList}

${previous}

Check my work. Label every line, report part status (including parts the page should address but doesn't), and ask one guiding question about the most important issue.`,
            },
          ],
        },
      ],
      },
      CHECK_TOOL,
      `Respond only by calling the ${CHECK_TOOL.name} tool.`
    );

    return {
      lines: out.lines ?? [],
      parts: out.parts ?? [],
      feedback: out.feedback ?? '',
      question: out.question ?? '',
      fixedSinceLast: out.fixed_since_last ?? [],
      stillOpen: out.still_open ?? [],
      model: res.model,
      usage: ClaudeProvider.usage(res),
    };
  }

  async reply(input: ReplyInput): Promise<string> {
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
      text: `${levelBlock(input)}\n\nSTUDENT: ${input.message}\n\n(Reply conversationally in a few sentences of markdown. If they describe a fix in words, check it. One question max.)`,
    });
    messages.push({ role: 'user', content: finalContent });

    const res = await this.call({
      model: this.opts.checkModel,
      max_tokens: 1200,
      system: this.system(),
      messages,
    });
    return res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
  }
}
