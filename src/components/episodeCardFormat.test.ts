import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_COPY, PHASE_COPY, helpUsed, latestEpisode, localDate, resumeTarget, reviewLine } from './episodeCardFormat.ts';
import type { Assistance, Episode } from '../learning/types';

const help = (move: Assistance['move'], revealed: Assistance['revealed'] = []): Assistance => ({
  id: `${move}-${Math.random()}`, episodeId: 'e', attemptId: 'a', move, level: 1, channels: ['text'], revealed, at: 1,
});

test('helpUsed dedupes in first-use order and names moves', () => {
  assert.deepEqual(helpUsed([help('pointer'), help('explain'), help('pointer'), help('example')]), ['pointer', 'explanation', 'worked example']);
  assert.deepEqual(helpUsed([]), []);
});

test('helpUsed keeps unknown exposure visible, even if another use of the move was known', () => {
  assert.deepEqual(helpUsed([help('pointer'), help('pointer', 'unknown'), help('step')]), ['pointer (content unknown)', 'step']);
});

test('localDate uses device-local calendar fields', () => {
  // constructed in local time, so the expected string holds in any timezone (including late evening)
  assert.equal(localDate(new Date(2026, 10, 5, 23, 30).getTime()), 'Thu, Nov 5, 2026');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 5).getTime()), 'Thu, Jan 1, 2026');
});

test('reviewLine: scheduled date or an honest "none"', () => {
  assert.equal(reviewLine({}), 'No review scheduled');
  assert.equal(reviewLine({ reviewDueAt: new Date(2026, 10, 9, 8).getTime() }), 'Review scheduled for Mon, Nov 9, 2026');
});

test('resumeTarget opens the independent screen once an independent attempt exists', () => {
  assert.equal(resumeTarget({ independentAttemptId: 'e:independent' }), 'independent');
  assert.equal(resumeTarget({}), 'workspace');
});

test('latestEpisode picks the newest episode of that assignment only', () => {
  const ep = (id: string, assignmentId: string, createdAt: number) => ({ id, assignmentId, createdAt }) as Episode;
  const list = [ep('a', 'demo', 1), ep('b', 'demo', 3), ep('c', 'other', 9), ep('d', 'demo', 2)];
  assert.equal(latestEpisode(list, 'demo')?.id, 'b');
  assert.equal(latestEpisode(list, 'none'), undefined);
});

test('copy avoids mastery, retention and "on your own" claims', () => {
  const all = [...Object.values(OUTCOME_COPY).map((c) => c.text), ...Object.values(PHASE_COPY)].join(' ').toLowerCase();
  for (const bad of ['master', 'retain', 'retention', 'on your own', 'unaided', 'no hints']) assert.ok(!all.includes(bad), bad);
  for (const c of Object.values(OUTCOME_COPY)) assert.ok(c.symbol.length > 0);
});
