import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LineVerdict } from '../ai/types';
import type { Line } from '../ink/lines';
import { lineInkSig, recordAssistance, startEpisode } from './session.ts';
import type { Assistance, Snapshot } from './types';
import {
  MOVE_TITLE, fallbackMove, flagFrom, levelMove, needsInitialSnap, phaseLabel, pivotPolicy, repairedAfter, replacementValid,
  withSnapshot, workAttemptId,
} from './workspaceFlow.ts';

const line = (id: string, y: number, strokes: number[]): Line => ({ id, x: 10, y, w: 200, h: 30, strokes });
const v = (id: string, verdict: LineVerdict['verdict']): LineVerdict => ({ id, reading: id, verdict, note: '' });
const ep0 = () => startEpisode({
  id: 'e', assignmentId: 'a', skillId: 's', packVersion: 'v', policy: { maxLevel: 3, allowExplain: true, allowExample: true },
  taskId: 't', pageId: 'p', rehearsal: false, now: 1,
});
const snap = (id: string): Snapshot => ({ id, pageFile: `snapshots/${id}.pk`, strokeCount: 0, lines: [], at: 1 });

test('flagFrom takes the first incorrect or partial line, as its ink signature', () => {
  const lines = [line('L1', 0, [0]), line('L2', 40, [1, 2]), line('L3', 80, [3])];
  const f = flagFrom(lines, [v('L1', 'valid'), v('L2', 'partial'), v('L3', 'incorrect')]);
  assert.deepEqual(f, { sig: lineInkSig(lines[1]), before: lines });
  assert.equal(flagFrom(lines, [v('L1', 'valid'), v('L3', 'unreadable')]), null);
  assert.equal(flagFrom(lines, [v('L9', 'incorrect')]), null, 'a verdict for an unknown line');
});

test('replacementValid: every new line in the flagged place must be valid', () => {
  const before = [line('L1', 0, [0]), line('L2', 40, [1])];
  const flag = flagFrom(before, [v('L1', 'valid'), v('L2', 'incorrect')])!;
  const after = [line('L1', 0, [0]), line('L2', 42, [2, 3]), line('L3', 200, [4])];
  assert.equal(replacementValid(flag, after, [v('L1', 'valid'), v('L2', 'valid'), v('L3', 'incorrect')]), true, 'L3 is elsewhere');
  assert.equal(replacementValid(flag, after, [v('L2', 'partial')]), false);
  assert.equal(replacementValid(flag, after, []), false, 'no verdict is not valid');
  assert.equal(replacementValid(flag, before, [v('L2', 'valid')]), false, 'unchanged ink');
  assert.equal(replacementValid(flag, [line('L1', 0, [0])], [v('L1', 'valid')]), false, 'erased only');
  assert.equal(replacementValid({ sig: 'nope', before }, after, [v('L2', 'valid')]), false);
});

test('fallbackMove offers the strongest allowed move below the denied one', () => {
  const p = { maxLevel: 1 as const, allowExplain: true, allowExample: true };
  assert.equal(fallbackMove('example', p), 'pointer');
  assert.equal(fallbackMove('start', p), 'pointer');
  assert.equal(fallbackMove('step', { maxLevel: 3, allowExplain: true, allowExample: false }), 'explain');
  assert.equal(fallbackMove('check', p), undefined);
});

test('repairedAfter names the strongest delivered help', () => {
  const h = (level: Assistance['level']): Assistance => ({ id: `${level}`, episodeId: 'e', attemptId: 'x', move: levelMove(level), level, channels: ['text'], revealed: 'unknown', at: 1 });
  assert.equal(repairedAfter([]), 'Repaired');
  assert.equal(repairedAfter([h(1)]), 'Repaired after a pointer');
  assert.equal(repairedAfter([h(1), h(3), h(2)]), 'Repaired after an example');
});

test('labels and moves', () => {
  assert.equal(phaseLabel('repair'), 'Repairing with help');
  assert.equal(levelMove(0), 'check');
  assert.equal(levelMove(4), 'step');
  assert.equal(MOVE_TITLE.example, 'Show another example');
});

test('pivotPolicy never widens the assignment ceiling', () => {
  const ep = ep0();
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 0 }).maxLevel, 0);
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 4 }).maxLevel, 3);
  assert.equal(pivotPolicy(ep, { policyMaxLevel: 2 }).allowExample, true, 'flags come from the episode; the level gate still denies example at 2');
});

test('work attempt, initial snapshot, and snapshots are never replaced', () => {
  let ep = ep0();
  assert.equal(workAttemptId(ep), 'e:initial');
  assert.equal(needsInitialSnap(ep), true);
  ep = withSnapshot(ep, 'e:initial', snap('s1'));
  assert.equal(needsInitialSnap(ep), false);
  assert.equal(withSnapshot(ep, 'e:initial', snap('s2')), ep);
  assert.equal(withSnapshot(ep, 'missing', snap('s3')), ep);
  ep = recordAssistance(ep, { attemptId: 'e:initial', move: 'pointer', level: 1, channels: ['text'], revealed: 'unknown', at: 2 }, 'h1');
  assert.equal(workAttemptId(ep), 'e:repair');
});
