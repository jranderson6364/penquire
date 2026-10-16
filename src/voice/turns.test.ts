import { test } from 'node:test';
import assert from 'node:assert/strict';
import { END_OF_TURN_MS, IDLE_END_MS, turnDecision } from './turns.ts';

test('a turn is sent after silence that follows speech', () => {
  const s = { startedAt: 0, lastChangeAt: 5000, text: 'is this right' };
  assert.equal(turnDecision(s, 5000 + END_OF_TURN_MS - 1), 'wait');
  assert.equal(turnDecision(s, 5000 + END_OF_TURN_MS), 'send');
});

test('silence with nothing said keeps listening, then ends the conversation', () => {
  const s = { startedAt: 0, lastChangeAt: 0, text: '' };
  assert.equal(turnDecision(s, IDLE_END_MS - 1), 'wait');
  assert.equal(turnDecision(s, IDLE_END_MS), 'give_up');
});

test('speech that is still changing is never cut off', () => {
  assert.equal(turnDecision({ startedAt: 0, lastChangeAt: 40_000, text: 'so then the' }, 40_500), 'wait');
});
