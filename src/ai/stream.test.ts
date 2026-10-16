import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishedSentences, partialStringField, StreamAssembler } from './stream.ts';

const sse = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;

test('a streamed tool call rebuilds the same response a normal call returns, with usage', () => {
  const a = new StreamAssembler();
  const parts = [
    sse({ type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 4000 } } }),
    sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    sse({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'reply_to_student' } }),
    sse({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"message": "Look at ' } }),
    sse({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'the sign.", "marks": []}' } }),
    sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } }),
    sse({ type: 'message_stop' }),
  ].join('');
  // arbitrary chunk boundaries, including mid-line
  const seen: string[] = [];
  for (let i = 0; i < parts.length; i += 37) for (const g of a.push(parts.slice(i, i + 37)).toolJson) seen.push(g.json);
  const r = a.result();
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.usage, { input_tokens: 900, output_tokens: 42, cache_read_input_tokens: 4000 });
  const tool = r.content.find((b) => b.type === 'tool_use');
  assert.deepEqual(tool?.input, { message: 'Look at the sign.', marks: [] });
  assert.ok(seen.length >= 2);
});

test('text blocks accumulate; an API error event throws', () => {
  const a = new StreamAssembler();
  a.push(sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  a.push(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } }));
  a.push(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there.' } }));
  assert.equal(a.result().content[0].text, 'Hello there.');
  const b = new StreamAssembler();
  b.push(sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
  assert.throws(() => b.result(), /Overloaded/);
});

test('a half-streamed string field is read safely, escapes included', () => {
  assert.equal(partialStringField('{"message": "Look at ', 'message'), 'Look at ');
  assert.equal(partialStringField('{"message": "a \\"b\\" c\\nd', 'message'), 'a "b" c\nd');
  assert.equal(partialStringField('{"message": "split \\', 'message'), 'split ');
  assert.equal(partialStringField('{"message": "done", "marks": [', 'message'), 'done');
  assert.equal(partialStringField('{"marks": [', 'message'), undefined);
});

test('only finished sentences are released', () => {
  assert.equal(finishedSentences('First idea. Then th'), 'First idea.');
  assert.equal(finishedSentences('Is it 2.5 or 3? Hmm'), 'Is it 2.5 or 3?');
  assert.equal(finishedSentences('no end yet'), '');
});
