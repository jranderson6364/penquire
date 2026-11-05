import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStep, normalize, parseExpr, realRoots } from '../verify/expr.ts';
import { DEMO_TASK_IDS, FOLLOW_UP_TASKS, TASK_EQUATIONS, TASK_GIVENS, demoTask, learnerText } from './demoPack.ts';
import { carried, classify, compareSetup, fallSummary, quadraticOf, stripLineId } from './pitfalls.ts';

const rec = TASK_GIVENS[DEMO_TASK_IDS.recovery];
const ind = TASK_GIVENS[DEMO_TASK_IDS.independent];
const fall = (readings: string[]) => ({ taskId: DEMO_TASK_IDS.recovery, readings, at: 1 });

test('a quadratic in t is read off any rearrangement, scaling or factoring; other lines are not quadratics', () => {
  assert.deepEqual(quadraticOf('20 + 15t - 5t^2 = 0'), { a: -5, b: 15, c: 20 });
  const f = quadraticOf('(t - 4)(t + 1) = 0')!;
  assert.equal(compareSetup(f, quadraticOf('20 + 15t - 5t^2 = 0')!), 'ok');
  assert.equal(compareSetup(quadraticOf('5t^2 = 15t + 20')!, quadraticOf('20 + 15t - 5t^2 = 0')!), 'ok');
  assert.equal(quadraticOf('t = 3'), null);
  assert.equal(quadraticOf('y = 20 + 15t - 5t^2'), null, 'two variables');
  assert.equal(quadraticOf('t^3 = 1'), null);
});

test('the device fall (forgot the cliff) is the missing starting height, with the rest right', () => {
  assert.deepEqual(classify(rec, ['15t - \\frac{10}{2}t^2 = 0', 't = 3']), { pitfall: 'start_height', restRight: true });
  assert.deepEqual(classify(rec, ['15t + 5t^2 = 0']), { pitfall: 'start_height', restRight: false });
});

test('the other built-in falls are told apart', () => {
  assert.equal(classify(rec, ['20 + 15t + 5t^2 = 0'])?.pitfall, 'gravity_sign');
  assert.equal(classify(rec, ['-20 + 15t - 5t^2 = 0'])?.pitfall, 'start_sign');
  assert.equal(classify(rec, ['t^2 - 3t + 4 = 0'])?.pitfall, 'start_sign');
  assert.equal(classify(rec, ['t = -1'])?.pitfall, 'wrong_root');
  assert.equal(classify(rec, ['t^2 - 3t - 4 = 0', 't = 5'])?.pitfall, 'slip');
  assert.equal(classify(rec, []), undefined);
});

test('the fresh problem says whether the same fall came back', () => {
  assert.equal(carried('start_height', ind, ['15 + 10t - 5t^2 = 0', 't^2 - 2t - 3 = 0', 't = 3']), 'avoided');
  assert.equal(carried('start_height', ind, ['10t - 5t^2 = 0', 't = 2']), 'repeated');
  assert.equal(carried('start_height', ind, ['t = 3']), undefined, 'no equation shown: say nothing');
  assert.equal(carried('wrong_root', ind, ['t = 3'], 'pass'), 'avoided');
  assert.equal(carried('wrong_root', ind, ['t = -1']), 'repeated');
  assert.equal(carried('slip', ind, ['t = 3'], 'needs_practice'), undefined);
});

test('the outcome sentences use the right heights and never come from the model', () => {
  const s = fallSummary(fall(['15t - \\frac{10}{2}t^2 = 0']), DEMO_TASK_IDS.independent, ['15 + 10t - 5t^2 = 0', 't = 3'], 'pass')!;
  assert.equal(s.pitfall, 'start_height');
  assert.match(s.first, /started the ball at 0 instead of 20 m up, so it found when the ball came back down/);
  assert.equal(s.now, 'This time your equation started from 15 m up.');
  const again = fallSummary(fall(['15t - 5t^2 = 0']), DEMO_TASK_IDS.independent, ['10t - 5t^2 = 0'], 'needs_practice')!;
  assert.match(again.now!, /same thing came back.*15 m up/);
  assert.equal(fallSummary(undefined, DEMO_TASK_IDS.independent, [], 'pass'), undefined);
  assert.equal(fallSummary(fall([]), DEMO_TASK_IDS.independent, [], 'pass'), undefined);
  // the twist follow-up compares against its own setup (thrown down from 30 m)
  const tw = fallSummary(fall(['15t - 5t^2 = 0']), DEMO_TASK_IDS.twist, ['30 - 5t - 5t^2 = 0', 't = 2'], 'pass')!;
  assert.equal(tw.now, 'This time your equation started from 30 m up.');
  assert.equal(stripLineId('L2: t = 3'), 't = 3');
});

test('follow-up tasks: setups check out, one positive root, the stated rejected root, no keys in the prompt', () => {
  const want: Record<string, [number, number]> = { [DEMO_TASK_IDS.twist]: [-3, 2], [DEMO_TASK_IDS.again]: [-2, 3] };
  for (const t of FOLLOW_UP_TASKS) {
    assert.equal(demoTask(t.id), t);
    const eq = TASK_EQUATIONS[t.id];
    const [l, r] = normalize(eq).split('=');
    const p = parseExpr(`(${l}) - (${r})`);
    assert.ok(p.ok);
    assert.deepEqual(realRoots(p.ast, 't').map((x) => Math.round(x * 1e6) / 1e6), want[t.id], t.id);
    assert.deepEqual(TASK_GIVENS[t.id].rejected, [`t = ${want[t.id][0]}`]);
    assert.equal(checkStep(eq, t.expected.finalAnswer.replace(/\s*s$/, '')).kind, 'solution');
    for (const s of t.expected.acceptedSteps) assert.equal(checkStep(eq, s).kind, 'equivalent');
    const text = learnerText(t.id).replace(/\s/g, '');
    for (const k of [t.expected.finalAnswer, eq, ...t.expected.acceptedSteps]) assert.ok(!text.includes(k.replace(/\s/g, '')), `${t.id} leaks ${k}`);
  }
});
