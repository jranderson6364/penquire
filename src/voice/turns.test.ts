import { test } from 'node:test';
import assert from 'node:assert/strict';
import { END_OF_TURN_MS, HOLD_END_MS, IDLE_END_MS, QUESTION_END_MS, createVoiceActivity, endDelay, listenState, turnDecision } from './turns.ts';

const at = (text: string, lastChangeAt = 5000, extra: { lastVoiceAt?: number; sendNow?: boolean } = {}) => ({ startedAt: 0, lastChangeAt, text, ...extra });

test('a finished statement is sent after the base pause', () => {
  const s = at('I distributed the two to both terms first');
  assert.equal(turnDecision(s, 5000 + END_OF_TURN_MS - 1), 'wait');
  assert.equal(turnDecision(s, 5000 + END_OF_TURN_MS), 'send');
});

test('mid-clause holds longer: "so I distributed the two and" (also with the period the recognizer adds)', () => {
  for (const text of ['so I distributed the two and', 'so I distributed the two and.', 'then I subtract four because', 'and the left side equals']) {
    assert.equal(endDelay(text), HOLD_END_MS, text);
    assert.equal(turnDecision(at(text), 5000 + END_OF_TURN_MS + 500), 'wait', text);
    assert.equal(turnDecision(at(text), 5000 + HOLD_END_MS), 'send', text);
  }
});

test('a question is sent quickly: "is that right?"', () => {
  assert.equal(endDelay('is that right?'), QUESTION_END_MS);
  assert.equal(turnDecision(at('is that right?'), 5000 + QUESTION_END_MS), 'send');
});

test('digit strings with pauses hold: the student is still saying the number or operator', () => {
  for (const text of ['so six x minus four equals 10', 'I got x equals three point', 'it is 6x +', 'then 2 times']) assert.equal(endDelay(text), HOLD_END_MS, text);
});

test('a short turn (under four words) holds longer, one word is never cut off at once', () => {
  assert.equal(endDelay('okay so'), HOLD_END_MS);
  assert.equal(turnDecision(at('hmm'), 5000 + 1300), 'wait');
});

test('voice activity keeps the turn open even when the transcript has not changed', () => {
  const s = at('I distributed the two to both terms first', 5000, { lastVoiceAt: 9000 });
  assert.equal(turnDecision(s, 5000 + END_OF_TURN_MS + 100), 'wait');
  assert.equal(turnDecision(s, 9000 + END_OF_TURN_MS), 'send');
  assert.equal(listenState(s, 9200), 'listening');
  assert.equal(listenState(s, 9000 + 1000), 'waiting');
});

test('send now sends at once, but only once something was said', () => {
  assert.equal(turnDecision(at('so I distributed the two and', 5000, { sendNow: true }), 5001), 'send');
  assert.equal(turnDecision(at('', 0, { sendNow: true }), 100), 'wait');
});

test('silence with nothing said keeps listening, then ends the conversation', () => {
  const s = at('', 0);
  assert.equal(turnDecision(s, IDLE_END_MS - 1), 'wait');
  assert.equal(turnDecision(s, IDLE_END_MS), 'give_up');
});

test('speech that is still changing is never cut off', () => {
  assert.equal(turnDecision({ startedAt: 0, lastChangeAt: 40_000, text: 'so then the' }, 40_500), 'wait');
});

test('voice activity follows the noise floor', () => {
  const va = createVoiceActivity();
  for (let i = 0; i < 20; i++) assert.equal(va.sample(-1.5), false, 'quiet room');
  assert.equal(va.sample(4), true, 'talking');
  const noisy = createVoiceActivity();
  for (let i = 0; i < 20; i++) noisy.sample(3);
  assert.equal(noisy.sample(3.5), false, 'steady noise is not speech');
  assert.equal(noisy.sample(7), true);
  assert.equal(va.sample(Number.NaN), false);
});
