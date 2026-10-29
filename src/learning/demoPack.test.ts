import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PACK, DEMO_TASK_IDS, TASK_EQUATIONS, demoTask, learnerText } from './demoPack.ts';
import { checkStep, normalize } from '../verify/expr.ts';
import { extractMath } from '../verify/leak.ts';
import { applyReplyLeakGuard } from '../verify/guard.ts';

const squash = (s: string) => normalize(s).replace(/\s+/g, '').toLowerCase();

test('pack version, policy and one task per role', () => {
  assert.equal(DEMO_PACK.version, 'algebra-distribution-v1');
  assert.deepEqual(DEMO_PACK.policy, { maxLevel: 3, allowExplain: true, allowExample: true });
  assert.deepEqual(DEMO_PACK.tasks.map((t) => t.role), ['recovery', 'example', 'independent', 'review']);
  assert.equal(new Set(DEMO_PACK.tasks.map((t) => t.id)).size, 4);
  for (const t of DEMO_PACK.tasks) assert.ok(TASK_EQUATIONS[t.id], t.id);
  assert.equal(demoTask(DEMO_TASK_IDS.independent).asksForExplanation, true);
  assert.ok(demoTask(DEMO_TASK_IDS.example).workedSolution);
  for (const t of DEMO_PACK.tasks.filter((t) => t.role !== 'example')) assert.equal(t.workedSolution, undefined);
});

test('expected values check out with the algebra checker', () => {
  const expected: Record<string, [string, string[]]> = {
    [DEMO_TASK_IDS.recovery]: ['x = 3', ['6x - 8 = 10']],
    [DEMO_TASK_IDS.example]: ['z = 4', ['6z - 3 = 21']],
    [DEMO_TASK_IDS.independent]: ['y = 5', ['6y + 3 = 33', '2y + 1 = 11']],
    [DEMO_TASK_IDS.review]: ['w = 4', ['10w - 15 = 25']],
  };
  for (const t of DEMO_PACK.tasks) {
    const eq = TASK_EQUATIONS[t.id];
    assert.deepEqual([t.expected.finalAnswer, t.expected.acceptedSteps], expected[t.id], t.id);
    assert.equal(checkStep(eq, t.expected.finalAnswer).kind, 'equivalent', `${t.id} final answer`);
    for (const s of t.expected.acceptedSteps) {
      assert.equal(checkStep(eq, s).kind, 'equivalent', `${t.id} ${s}`);
      assert.equal(checkStep(s, t.expected.finalAnswer).kind, 'equivalent', `${t.id} ${s} → answer`);
    }
    // the equation shown to the learner (both sides, possibly in prose) is the one the checker uses
    for (const side of eq.split('=')) assert.ok(squash(t.prompt).includes(squash(side)), `${t.id} ${side}`);
  }
  // the deliberate first error in the spec is not a valid transition
  assert.equal(checkStep(TASK_EQUATIONS[DEMO_TASK_IDS.recovery], '6x - 4 = 10').kind, 'inconsistent');
});

test('learner text never contains answer keys or the worked solution', () => {
  const keys = DEMO_PACK.tasks.flatMap((t) => [
    t.expected.finalAnswer,
    ...t.expected.acceptedSteps,
    t.expected.keyIdea,
    ...t.expected.rubric,
    ...(t.workedSolution ? [t.workedSolution, ...t.workedSolution.split('\n').filter(Boolean)] : []),
  ]);
  for (const t of DEMO_PACK.tasks) {
    const text = learnerText(t.id);
    assert.equal(text, t.prompt);
    for (const k of keys) assert.ok(!squash(text).includes(squash(k)), `${t.id} contains "${k}"`);
    // and no formula in the prompt is a key step or final answer
    const keyMath = new Set(DEMO_PACK.tasks.flatMap((x) => [x.expected.finalAnswer, ...x.expected.acceptedSteps]).map(squash));
    for (const f of extractMath(text)) assert.ok(!keyMath.has(squash(f)), `${t.id} formula "${f}"`);
  }
  assert.throws(() => learnerText('nope'));
});

// T04 step 3: the different-task worked example through the real reply leak guard, with the recovery task's
// work (including the deliberate distribution error) as the guard's context at level 3.
const recoveryLines = [
  { id: 'L1', reading: '2(3x - 4) = 10', verdict: 'valid' },
  { id: 'L2', reading: '6x - 4 = 10', verdict: 'incorrect' },
];

test('the worked example survives the reply leak guard unchanged at level 3', () => {
  const worked = demoTask(DEMO_TASK_IDS.example).workedSolution!;
  assert.equal(applyReplyLeakGuard(worked, recoveryLines, 3), worked);
});

test('the recovery answer is still stripped next to the worked example', () => {
  const worked = demoTask(DEMO_TASK_IDS.example).workedSolution!;
  for (const leak of ['So for your problem, x = 3.', 'Your line should be 6x - 8 = 10.']) {
    const out = applyReplyLeakGuard(`${worked}\n${leak}`, recoveryLines, 3);
    assert.ok(!out.includes(leak), leak);
    assert.ok(out.includes('6z − 3 = 21'), 'example kept');
  }
});
