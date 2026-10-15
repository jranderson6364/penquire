import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointedLine, sentences, speakable } from './text.ts';

test('a reply becomes something a voice can say', () => {
  const s = speakable('Look at **[[1|the sign]]** in L4: is $x^2 = 4$ the step you meant?\n- check units');
  assert.doesNotMatch(s, /\[\[|\*\*|\$|L4|^-/m);
  assert.match(s, /the sign/);
  assert.match(s, /line 4/);
  assert.match(s, /equals/);
  assert.match(s, /check units/);
});

test('sentences split for speech start-up', () => {
  assert.deepEqual(sentences('First idea. Then this? And that'), ['First idea.', 'Then this?', 'And that']);
  assert.deepEqual(sentences(''), []);
});

test('"this" is the line holding the most recent stroke', () => {
  const lines = [
    { id: 'L1', strokes: [0, 1] },
    { id: 'L2', strokes: [2] },
  ];
  assert.equal(pointedLine(lines, [{ i: 0, t: 10 }, { i: 2, t: 30 }, { i: 1, t: 20 }]), 'L2');
  assert.equal(pointedLine(lines, []), undefined);
});
