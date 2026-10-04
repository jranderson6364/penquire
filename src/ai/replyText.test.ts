import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply } from './replyText.ts';

test('plain prose passes through untouched', () => {
  const r = cleanReply('Good start. What does the 1/2 multiply?');
  assert.deepEqual(r, { text: 'Good start. What does the 1/2 multiply?', wasJson: false });
});

test('a JSON object reply becomes its prose fields', () => {
  const r = cleanReply('{"feedback":"Line 2 holds up.","question":"What is g times t?","lines":[{"id":"L1","verdict":"valid"}]}');
  assert.equal(r.wasJson, true);
  assert.equal(r.text, 'Line 2 holds up.\n\nWhat is g times t?');
  assert.ok(!r.text.includes('verdict'));
});

test('a fenced JSON block is unwrapped', () => {
  const r = cleanReply('```json\n{"reply":"Try the units first."}\n```');
  assert.deepEqual(r, { text: 'Try the units first.', wasJson: true });
});

test('a fenced block inside prose is dropped, the prose is kept', () => {
  const r = cleanReply('Here is my read.\n\n```json\n{"lines":[]}\n```\n\nWhat do you think?');
  assert.equal(r.wasJson, true);
  assert.match(r.text, /^Here is my read\./);
  assert.match(r.text, /What do you think\?$/);
  assert.ok(!r.text.includes('lines'));
});

test('JSON with no prose in it comes back empty so the caller can retry', () => {
  const r = cleanReply('{"lines":[{"id":"L1","verdict":"valid"}],"parts":[]}');
  assert.equal(r.wasJson, true);
  assert.equal(r.text, '');
});

test('broken JSON that looks like JSON is reported as JSON with nothing usable', () => {
  const r = cleanReply('{"feedback": "cut off mid');
  assert.deepEqual(r, { text: '', wasJson: true });
});

test('math braces in prose are not mistaken for JSON', () => {
  const r = cleanReply('{x} is a set; compare $\\frac{a}{b}$.');
  assert.equal(r.wasJson, false);
});
