import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointedLine, sentences, speakable, unspoken } from './text.ts';

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

test('a decimal point is not a sentence end (the old splitter dropped text before "3.5")', () => {
  assert.deepEqual(sentences('So x is 3.5 now. Next step.'), ['So x is 3.5 now.', 'Next step.']);
  assert.deepEqual(sentences('Line one\nLine two?'), ['Line one', 'Line two?']);
});

test('math is said the way a tutor says it', () => {
  assert.equal(speakable('2(3x − 4) = 10'), '2 times the quantity 3x minus 4, equals 10');
  assert.equal(speakable('Is $2(3x-4)=10$ right?'), 'Is 2 times the quantity 3x minus 4, equals 10 right?');
  assert.equal(speakable('So 6x - 8 = 10, and x = 3.'), 'So 6x minus 8 equals 10, and x equals 3.');
  assert.equal(speakable('Try -3, then x^2 + 1 and 6/2.'), 'Try negative 3, then x squared plus 1 and 6 over 2.');
  assert.equal(speakable('It is 3.5 - 1.2 on L3.'), 'It is 3.5 minus 1.2 on line 3.');
});

test('ordinary words with hyphens, slashes and parentheses are left alone', () => {
  assert.equal(speakable('A step-by-step idea, and/or f(x).'), 'A step-by-step idea, and/or f(x).');
});

test('streaming speech: each sentence is said once, the final text adds only what is new', () => {
  const said: string[] = [];
  const say = (t: string, final: boolean) => {
    const n = unspoken(said, t, final);
    said.push(...n);
    return n;
  };
  assert.deepEqual(say('A one.', false), ['A one.']);
  assert.deepEqual(say('A one. B two.', false), ['B two.']);
  assert.deepEqual(say('A one. B two.', false), []);
  // the last sentence only ever arrives with the final text
  assert.deepEqual(say('A one. B two. C three?', true), ['C three?']);
  assert.deepEqual(said, ['A one.', 'B two.', 'C three?']);
});

test('streaming speech: a final reply that changed a spoken sentence says only the unsaid ones', () => {
  const said = ['A one.', 'B two.'];
  assert.deepEqual(unspoken(said, 'A one. B changed. C three.', false), [], 'while streaming: wait for the final');
  assert.deepEqual(unspoken(said, 'A one. B changed. C three.', true), ['B changed.', 'C three.']);
  assert.deepEqual(unspoken(said, 'A one, B two', true).length, 1);
});

test('streaming speech: no stream at all speaks the whole final reply', () => {
  assert.deepEqual(unspoken([], 'Look at line 2. What did you do to the 4?', true), ['Look at line 2.', 'What did you do to the 4?']);
});
