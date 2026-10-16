/**
 * Streaming Messages API responses, assembled without the SDK (the app calls the API with fetch). Pure and tested:
 *  - parse server-sent events (message_start, content_block_start/delta/stop, message_delta, message_stop, error),
 *  - rebuild the same response shape a non-streamed call returns, so everything downstream (sanitize, guards, usage
 *    metering) is unchanged,
 *  - read a string field out of a tool input that is still streaming (the reply's "message"), and
 *  - cut text at the last finished sentence, so only whole sentences are guarded and shown.
 */
export type AssembledResponse = {
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: string;
  stop_details?: { category?: string | null; explanation?: string } | null;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
};

type Block = { type: string; text?: string; name?: string; input?: unknown; json?: string };

export class StreamAssembler {
  private buf = '';
  private blocks: Block[] = [];
  private model = '';
  private stop = '';
  private stopDetails: AssembledResponse['stop_details'] = null;
  private usage: NonNullable<AssembledResponse['usage']> = { input_tokens: 0, output_tokens: 0 };
  private error: string | null = null;

  /** Feed raw bytes-as-text from the response body. Returns the tool-input JSON so far for each tool block that grew. */
  push(chunk: string): { toolJson: Array<{ index: number; name: string; json: string }> } {
    this.buf += chunk;
    const grown: Array<{ index: number; name: string; json: string }> = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'message_start': {
          const m = ev.message ?? {};
          this.model = m.model ?? this.model;
          if (m.usage) this.usage = { ...this.usage, ...m.usage };
          break;
        }
        case 'content_block_start': {
          const b = ev.content_block ?? {};
          this.blocks[ev.index] = { type: b.type, text: b.type === 'text' ? (b.text ?? '') : undefined, name: b.name, json: b.type === 'tool_use' ? '' : undefined };
          break;
        }
        case 'content_block_delta': {
          const b = this.blocks[ev.index];
          const d = ev.delta ?? {};
          if (!b) break;
          if (d.type === 'text_delta') b.text = (b.text ?? '') + (d.text ?? '');
          else if (d.type === 'input_json_delta') {
            b.json = (b.json ?? '') + (d.partial_json ?? '');
            grown.push({ index: ev.index, name: b.name ?? '', json: b.json });
          }
          break;
        }
        case 'message_delta': {
          if (ev.delta?.stop_reason) this.stop = ev.delta.stop_reason;
          if (ev.delta?.stop_details !== undefined) this.stopDetails = ev.delta.stop_details;
          if (ev.usage) this.usage = { ...this.usage, ...ev.usage };
          break;
        }
        case 'error':
          this.error = ev.error?.message ?? 'stream error';
          break;
      }
    }
    return { toolJson: grown };
  }

  /** The finished response (tool inputs parsed; an unparseable input stays undefined, so callers treat it as missing). */
  result(): AssembledResponse {
    if (this.error) throw new Error(`Claude API stream: ${this.error}`);
    return {
      model: this.model,
      stop_reason: this.stop,
      stop_details: this.stopDetails,
      usage: this.usage,
      content: this.blocks.filter(Boolean).map((b) => {
        if (b.type !== 'tool_use') return { type: b.type, text: b.text };
        let input: unknown;
        try {
          input = b.json ? JSON.parse(b.json) : {};
        } catch {
          input = undefined;
        }
        return { type: 'tool_use', name: b.name, input };
      }),
    };
  }
}

/** The value so far of a string field in JSON that is still arriving: `{"message": "Look at the si` -> "Look at the si". */
export function partialStringField(json: string, field: string): string | undefined {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return undefined;
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = json[i + 1];
    if (n === undefined) return out; // the escape is split across chunks: wait for the rest
    i++;
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '';
    else if (n === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else out += n; // \" \\ \/
  }
  return out;
}

/** Everything up to the last finished sentence (a . ! ? or line break followed by whitespace). "" if none yet. */
export function finishedSentences(text: string): string {
  let cut = -1;
  const re = /[.!?](?=\s)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) cut = m.index + 1;
  return cut > 0 ? text.slice(0, cut).trimEnd() : '';
}
