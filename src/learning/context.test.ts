import { test } from 'node:test';
import assert from 'node:assert/strict';
import { independentCheckInput } from './context.ts';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask, learnerText } from './demoPack.ts';
import type { Snapshot } from './types';

const snap: Snapshot = {
  id: 'snap-1',
  pageFile: 'page-indep.drawing',
  strokeCount: 5,
  lines: [
    { id: 'L1', x: 10, y: 20, w: 300, h: 40, strokes: [0, 1] },
    { id: 'L2', x: 10, y: 80, w: 280, h: 40, strokes: [2, 3, 4] },
  ],
  at: 1000,
};
const page = { base64: 'AAAA', mediaType: 'image/png' as const };
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

test('independent check input has only the independent prompt and the submitted page', () => {
  const task = demoTask(DEMO_TASK_IDS.independent);
  const input = independentCheckInput(task, snap, page);
  assert.equal(input.problems.length, 1);
  assert.equal(input.problems[0].text, learnerText(task.id));
  assert.equal(input.helpLevel, DEMO_PACK.policy.maxLevel);
  assert.equal(input.image, page);
  assert.equal(input.pageNumber, 1);
  assert.deepEqual(input.lines, [
    { id: 'L1', x: 10, y: 20, w: 300, h: 40 },
    { id: 'L2', x: 10, y: 80, w: 280, h: 40 },
  ]);
  assert.ok(input.problems[0].asksFor.some((a) => /explanation/.test(a)));
});

test('no prior history, settled lines, last check or focus', () => {
  const input = independentCheckInput(demoTask(DEMO_TASK_IDS.independent), snap, page) as Record<string, unknown>;
  for (const k of ['previous', 'settled', 'confirmed', 'groups', 'focusPart', 'history', 'lastCheck', 'style']) {
    assert.ok(!(k in input), `${k} present`);
  }
});

test('no answer key or other task content reaches the provider input', () => {
  const task = demoTask(DEMO_TASK_IDS.independent);
  const { image: _image, ...rest } = independentCheckInput(task, snap, page);
  const text = squash(JSON.stringify(rest));
  const forbidden = [
    ...DEMO_PACK.tasks.flatMap((t) => [t.expected.finalAnswer, ...t.expected.acceptedSteps, t.expected.keyIdea, ...t.expected.rubric]),
    ...DEMO_PACK.tasks.filter((t) => t.id !== task.id).map((t) => t.prompt),
    demoTask(DEMO_TASK_IDS.example).workedSolution!,
  ];
  for (const f of forbidden) assert.ok(!text.includes(squash(JSON.stringify(f).slice(1, -1))), `contains "${f}"`);
});
