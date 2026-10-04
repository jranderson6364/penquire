import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineSignature, mergeParts, mergeVerdicts, planCarry, type SavedLine } from './carry.ts';

const saved = (id: string, sig: string, part: string, verdict: SavedLine['verdict'] = 'valid'): SavedLine => ({ id, sig, part, reading: `r-${id}`, verdict, note: '' });
const cur = (...sigs: string[]) => sigs.map((sig, k) => ({ id: `L${k + 1}`, sig }));

test('signature: order independent, jitter tolerant, any added or moved stroke changes it', () => {
  const boxes = new Map([[0, { x: 10, y: 10, w: 20, h: 20 }], [1, { x: 40, y: 12, w: 8, h: 18 }], [2, { x: 40.4, y: 12.3, w: 8, h: 18 }], [3, { x: 80, y: 10, w: 5, h: 5 }]]);
  const a = lineSignature({ strokes: [0, 1] }, boxes);
  assert.equal(lineSignature({ strokes: [1, 0] }, boxes), a);
  assert.equal(lineSignature({ strokes: [0, 2] }, boxes), a, 'sub-point jitter does not change it');
  assert.notEqual(lineSignature({ strokes: [0, 1, 3] }, boxes), a);
  assert.notEqual(lineSignature({ strokes: [0] }, boxes), a);
});

test('nothing carries without an earlier check, without signatures, or when forced', () => {
  const c = cur('a', 'b');
  assert.equal(planCarry(c, undefined).settled.size, 0);
  assert.equal(planCarry(c, [{ ...saved('L1', 'a', '1a'), sig: undefined }]).settled.size, 0);
  assert.equal(planCarry(c, [saved('L1', 'a', '1a'), saved('L2', 'b', '1a')], true).settled.size, 0);
});

test('moving on to 2a: unchanged valid 1a lines are settled, only the new lines are graded', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a')];
  const plan = planCarry(cur('a', 'b', 'c', 'd'), prev);
  assert.deepEqual([...plan.settled.keys()], ['L1', 'L2']);
  assert.deepEqual(plan.toGrade, ['L3', 'L4']);
});

test('ids shift when lines are inserted, but settled lines are still found by signature', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'c', '2a')];
  const plan = planCarry(cur('a', 'x', 'c'), prev); // a new line between the parts pushes 2a from L2 to L3
  assert.deepEqual([...plan.settled.keys()], ['L1', 'L3']);
  assert.equal(plan.settled.get('L3')!.reading, 'r-L2');
  assert.deepEqual(plan.toGrade, ['L2']);
});

test('flagged lines are never carried', () => {
  const prev = [saved('L1', 'a', '1a', 'valid'), saved('L2', 'b', '1a', 'partial'), saved('L3', 'c', '2a', 'incorrect'), saved('L4', 'd', '2b', 'unreadable')];
  const plan = planCarry(cur('a', 'b', 'c', 'd'), prev);
  assert.deepEqual([...plan.settled.keys()], ['L1']);
  assert.equal(plan.reason.get('L2'), 'flagged-before');
});

test('an edit in the middle of a part re-grades the later lines of THAT part only', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a'), saved('L3', 'c', '1a'), saved('L4', 'd', '2a')];
  const plan = planCarry(cur('a', 'B2', 'c', 'd'), prev); // L2 rewritten
  assert.deepEqual([...plan.settled.keys()], ['L1', 'L4']);
  assert.deepEqual(plan.toGrade, ['L2', 'L3']);
  assert.equal(plan.reason.get('L3'), 'follows-change');
  assert.ok(plan.dirtyParts.has('1a') && !plan.dirtyParts.has('2a'));
});

test('an erased line re-grades later lines of its part and marks the part dirty even with nothing below it', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a'), saved('L3', 'c', '1a')];
  const mid = planCarry(cur('a', 'c'), prev); // L2 erased
  assert.deepEqual([...mid.settled.keys()], ['L1']);
  assert.deepEqual(mid.toGrade, ['L2']);
  const last = planCarry(cur('a', 'b'), prev); // final line erased
  assert.deepEqual([...last.settled.keys()], ['L1', 'L2']);
  assert.ok(last.dirtyParts.has('1a'), 'the part status must be refreshed: its final line is gone');
});

test('a new line at the very top invalidates the first part below it', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a'), saved('L3', 'c', '2a')];
  const plan = planCarry(cur('new', 'a', 'b', 'c'), prev);
  assert.deepEqual([...plan.settled.keys()], ['L4']);
});

test('untouched pages settle completely, so the caller can skip the API call', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1b', 'context')];
  const plan = planCarry(cur('a', 'b'), prev);
  assert.equal(plan.toGrade.length, 0);
  assert.equal(plan.dirtyParts.size, 0);
});

test('merge: carried verdicts keep their text, new ids and signatures; the model may only downgrade them', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a')];
  const c = cur('a', 'b', 'x');
  const plan = planCarry(c, prev);
  const graded = [
    { id: 'L1', part: '1a', reading: 'model says wrong now', verdict: 'incorrect' as const, note: 'n' }, // downgrade of a settled line
    { id: 'L3', part: '2a', reading: 'new', verdict: 'valid' as const, note: '' },
  ];
  const out = mergeVerdicts(c, plan, graded);
  assert.deepEqual(out.map((l) => [l.id, l.verdict, l.sig]), [['L1', 'incorrect', 'a'], ['L2', 'valid', 'b'], ['L3', 'valid', 'x']]);
  assert.equal(out[1].reading, 'r-L2');
});

test('merge: the model cannot upgrade a settled line, and unknown ids are ignored', () => {
  const prev = [saved('L1', 'a', '1a', 'valid')];
  const c = cur('a');
  const out = mergeVerdicts(c, planCarry(c, prev), [{ id: 'L9', reading: '', verdict: 'valid' as const, note: '' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'valid');
});

test('garbage in: empty current, empty previous', () => {
  assert.deepEqual(planCarry([], []).toGrade, []);
  assert.deepEqual(planCarry([], [saved('L1', 'a', '1a')]).toGrade, []);
  assert.deepEqual(mergeVerdicts([], planCarry([], []), []), []);
});

test('part chips: an untouched part keeps its earlier status, a graded or dirty part takes the new one', () => {
  const prev = [saved('L1', 'a', '1a'), saved('L2', 'b', '1a')];
  const c = cur('a', 'b', 'x');
  const plan = planCarry(c, prev);
  const merged = mergeVerdicts(c, plan, [{ id: 'L3', part: '2a', reading: 'q', verdict: 'valid', note: '' }]);
  const before = [{ label: '1a', status: 'complete' as const, missing: [] }];
  const model = [
    { label: '1a', status: 'in_progress' as const, missing: ['re-judged by a model that never saw it'] },
    { label: '2a', status: 'in_progress' as const, missing: [] },
  ];
  const out = mergeParts(model, before, plan, merged);
  assert.deepEqual(out.map((p) => [p.label, p.status]), [['1a', 'complete'], ['2a', 'in_progress']]);
  // erase 1a's last line: 1a is dirty, so the model's fresh status wins
  const plan2 = planCarry(cur('a'), prev);
  assert.equal(mergeParts(model, before, plan2, mergeVerdicts(cur('a'), plan2, []))[0].status, 'in_progress');
});

test('part chips: no earlier check or nothing settled means the model decides', () => {
  const model = [{ label: '1a', status: 'complete' as const, missing: [] }];
  const plan = planCarry(cur('a'), undefined);
  assert.deepEqual(mergeParts(model, undefined, plan, []), model);
});
