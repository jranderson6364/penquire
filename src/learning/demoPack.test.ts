import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PACK, DEMO_TASK_IDS, TASK_EQUATIONS, TASK_GIVENS, demoTask, learnerText } from './demoPack.ts';
import { checkStep, normalize, realRoots, parseExpr } from '../verify/expr.ts';
import { extractMath } from '../verify/leak.ts';
import { applyReplyLeakGuard } from '../verify/guard.ts';
import { plainQuantities } from '../verify/units.ts';
import { replyGuardLines } from './workspaceFlow.ts';

const squash = (s: string) => normalize(s).replace(/\s+/g, '').toLowerCase();
const plain = (s: string) => plainQuantities(s).text;

test('pack version, policy and one task per role', () => {
  assert.equal(DEMO_PACK.version, 'projectile-cliff-v1');
  assert.equal(DEMO_PACK.skillId, 'physics.kinematics.projectile_vertical');
  assert.equal(DEMO_PACK.title, 'Original demo practice: a ball thrown off a cliff');
  assert.deepEqual(DEMO_PACK.policy, { maxLevel: 3, allowExplain: true, allowExample: true });
  assert.deepEqual(DEMO_PACK.tasks.map((t) => t.role), ['recovery', 'example', 'independent', 'review']);
  assert.equal(new Set(DEMO_PACK.tasks.map((t) => t.id)).size, 4);
  for (const t of DEMO_PACK.tasks) assert.ok(TASK_EQUATIONS[t.id] && TASK_GIVENS[t.id], t.id);
  assert.equal(demoTask(DEMO_TASK_IDS.recovery).asksForExplanation, false);
  assert.equal(demoTask(DEMO_TASK_IDS.independent).asksForExplanation, true);
  assert.ok(demoTask(DEMO_TASK_IDS.example).workedSolution);
  for (const t of DEMO_PACK.tasks.filter((t) => t.role !== 'example')) assert.equal(t.workedSolution, undefined);
  assert.match(learnerText(DEMO_TASK_IDS.recovery), /[Ss]ketch/);
});

test('each setup is the one the prompt describes: h + v·t − (g/2)·t² = 0, up positive', () => {
  for (const t of DEMO_PACK.tasks) {
    const [, v] = /at (\d+) m\/s/.exec(t.prompt)!;
    const [, h] = /(\d+) m above/.exec(t.prompt)!;
    const [, g] = /g = (\d+) m\/s²/.exec(t.prompt)!;
    const model = `${h} + ${v}t - ${Number(g) / 2}t^2 = 0`;
    assert.equal(checkStep(model, TASK_EQUATIONS[t.id]).kind, 'equivalent', `${t.id}: ${model}`);
    for (const f of TASK_GIVENS[t.id].forms ?? []) assert.equal(checkStep(f, `y = ${model.replace(' = 0', '')}`).kind, 'equivalent', `${t.id} ${f}`);
    // the setup is worked out, not printed: the guard treats it as hidden
    assert.equal(TASK_GIVENS[t.id].stated, false);
    assert.ok(!squash(t.prompt).includes(squash(TASK_EQUATIONS[t.id].split('=')[0])), `${t.id} prints its setup`);
  }
});

test('expected answers check out: one positive root, the shared rejected root −1, accepted steps equivalent', () => {
  const answers: Record<string, string> = {
    [DEMO_TASK_IDS.recovery]: 't = 4 s', [DEMO_TASK_IDS.example]: 't = 2 s', [DEMO_TASK_IDS.independent]: 't = 3 s', [DEMO_TASK_IDS.review]: 't = 5 s',
  };
  for (const t of DEMO_PACK.tasks) {
    const eq = TASK_EQUATIONS[t.id];
    assert.equal(t.expected.finalAnswer, answers[t.id], t.id);
    assert.equal(checkStep(eq, plain(t.expected.finalAnswer)).kind, 'solution', `${t.id} final answer`);
    const [l, r] = normalize(eq).split('=');
    const p = parseExpr(`(${l}) - (${r})`);
    assert.ok(p.ok);
    const roots = realRoots(p.ast, 't').map((x) => Math.round(x * 1e6) / 1e6);
    assert.deepEqual(roots, [-1, Number(/\d+/.exec(t.expected.finalAnswer)![0])], `${t.id} roots`);
    assert.deepEqual(TASK_GIVENS[t.id].rejected, ['t = -1']);
    for (const s of t.expected.acceptedSteps) assert.equal(checkStep(eq, s).kind, 'equivalent', `${t.id} ${s}`);
  }
  // the built-in falls on the recovery task are not valid transitions from the setup
  const rec = TASK_EQUATIONS[DEMO_TASK_IDS.recovery];
  for (const wrong of ['20 + 15t + 5t^2 = 0', '15t - 5t^2 = 0', 't = 3', 't^2 - 3t + 4 = 0']) assert.equal(checkStep(rec, wrong).kind, 'inconsistent', wrong);
  // the sign-of-g fall has no real root at all (so no positive one)
  const sign = parseExpr('20 + 15t + 5t^2');
  assert.ok(sign.ok);
  assert.deepEqual(realRoots(sign.ast, 't'), []);
});

test('learner text never contains answer keys or the worked solution', () => {
  const keys = DEMO_PACK.tasks.flatMap((t) => [
    t.expected.finalAnswer,
    ...t.expected.acceptedSteps,
    TASK_EQUATIONS[t.id],
    t.expected.keyIdea,
    ...t.expected.rubric,
    ...(t.workedSolution ? [t.workedSolution, ...t.workedSolution.split('\n').filter(Boolean)] : []),
  ]);
  for (const t of DEMO_PACK.tasks) {
    const text = learnerText(t.id);
    assert.equal(text, t.prompt);
    for (const k of keys) assert.ok(!squash(text).includes(squash(k)), `${t.id} contains "${k}"`);
    const keyMath = new Set(DEMO_PACK.tasks.flatMap((x) => [x.expected.finalAnswer, plain(x.expected.finalAnswer), ...x.expected.acceptedSteps]).map(squash));
    for (const f of extractMath(text)) assert.ok(!keyMath.has(squash(plain(f))), `${t.id} formula "${f}"`);
  }
  assert.throws(() => learnerText('nope'));
});

// ---- the reply leak guard on the recovery task (T15: asking for the answer doesn't get it) --------------------
// Guard lines are built the way the workspace builds them (replyGuardLines): the check's lines plus the hidden setup.

const given = TASK_GIVENS[DEMO_TASK_IDS.recovery];
const guard = (lines: { id: string; reading: string; verdict: string }[] = [], stale = false) => replyGuardLines(lines, given, stale);
const noAnswer = (out: string) => !/t\s*=\s*4\b|\b4\s*(?:s\b|sec|seconds?)|4\\,\\mathrm\{s\}/.test(out);

const JUST_TELL_ME = [
  'Fine: t = 4 s.',
  'The ball hits the ground after 4 seconds.',
  'It lands at t = 4\\,\\mathrm{s}.',
  'Factor t^2 - 3t - 4 = 0 to get t = 4.',
  'Using the quadratic formula, t = (3 + 5)/2 = 4, so it lands at 4 s.',
  'It takes 4 s to land.',
  'The answer is $t = 4$ seconds.',
];

test('"just tell me the answer": a reply stating t = 4 s or 4 seconds is withheld, with no check yet', () => {
  for (const reply of JUST_TELL_ME) {
    const out = applyReplyLeakGuard(`I can't give you the answer, because the point is that you can do this one on your own. ${reply}`, guard(), 3);
    assert.ok(noAnswer(out), `${reply} -> ${out}`);
    // the refusal with its short reason survives
    assert.match(out, /can't give you the answer, because/, out);
  }
});

test('"just tell me": the answer is withheld next to each built-in fall, and the pointer survives', () => {
  const falls: Record<string, { id: string; reading: string; verdict: string }[]> = {
    sign: [{ id: 'L1', reading: '20 + 15t + 5t^2 = 0', verdict: 'incorrect' }],
    height: [{ id: 'L1', reading: '15t - 5t^2 = 0', verdict: 'incorrect' }, { id: 'L2', reading: String.raw`t = 3\,\mathrm{s}`, verdict: 'valid' }],
    keptRoot: [{ id: 'L1', reading: '20 + 15t - 5t^2 = 0', verdict: 'valid' }, { id: 'L2', reading: String.raw`t = 4\,\mathrm{s} \text{ or } t = -1\,\mathrm{s}`, verdict: 'partial' }],
    slip: [{ id: 'L1', reading: '20 + 15t - 5t^2 = 0', verdict: 'valid' }, { id: 'L2', reading: 't^2 - 3t + 4 = 0', verdict: 'incorrect' }],
  };
  const pointer: Record<string, string> = {
    sign: 'With up as positive, which way does gravity pull, and what sign does that give the t² term?',
    height: 'At t = 3 s the ball is back at the height it started from, not on the ground.',
    keptRoot: 'What does t = −1 mean for this throw?',
    slip: 'Compare the constant term in L2 with L1 after dividing by −5.',
  };
  for (const [name, lines] of Object.entries(falls)) {
    for (const stale of [false, true]) {
      for (const reply of JUST_TELL_ME) {
        const out = applyReplyLeakGuard(`${pointer[name]} ${reply}`, guard(lines, stale), 3);
        // keptRoot: the student already wrote t = 4 themselves, so saying it back is not a leak
        if (name !== 'keptRoot') assert.ok(noAnswer(out), `${name}${stale ? ' (stale)' : ''}: ${reply} -> ${out}`);
        assert.ok(out.includes(pointer[name]), `${name}${stale ? ' (stale)' : ''}: pointer lost -> ${out}`);
      }
    }
  }
});

test('the corrected setup is withheld below level 4; the student\'s own correct lines can be acknowledged', () => {
  const wrong = [{ id: 'L1', reading: '20 + 15t + 5t^2 = 0', verdict: 'incorrect' }];
  for (const fix of ['It should be 20 + 15t - 5t^2 = 0.', 'Write y = 20 + 15t - 5t^2.', 'You want t^2 - 3t - 4 = 0.', 'That gives (t - 4)(t + 1) = 0.']) {
    assert.equal(applyReplyLeakGuard(`Check the sign of the gravity term. ${fix}`, guard(wrong), 2), 'Check the sign of the gravity term.', fix);
  }
  // nothing written yet ("help me start"): the setup is not handed over either
  assert.equal(applyReplyLeakGuard('Start from the ground. Then y = 20 + 15t - 5t^2.', guard(), 2), 'Start from the ground.');
  // the student wrote these lines: quoting them back, units and all, is fine
  const right = [
    { id: 'L1', reading: '20 + 15t - 5t^2 = 0', verdict: 'valid' },
    { id: 'L2', reading: '(t - 4)(t + 1) = 0', verdict: 'valid' },
    { id: 'L3', reading: String.raw`t = 4\,\mathrm{s}`, verdict: 'valid' },
  ];
  for (const ack of ['Yes, 20 + 15t - 5t^2 = 0 is the right setup.', 'Your t = 4 s is right, and rejecting the negative root was the key step.', 'Your t = 4 is right.', 'Good: t^2 - 3t - 4 = 0 is the same equation as your L1.']) {
    assert.equal(applyReplyLeakGuard(ack, guard(right), 1), ack, ack);
  }
  // stale page: the student may have written the fix since the check; acknowledging it survives, the answer does not
  const fixAck = 'Yes, the line with 20 + 15t - 5t^2 = 0 is right now. What do you do next?';
  assert.equal(applyReplyLeakGuard(fixAck, guard(wrong, true), 1), fixAck);
  assert.ok(noAnswer(applyReplyLeakGuard('Right. So t = 4 s.', guard(wrong, true), 1)));
});

test('a fully scrubbed reply falls back to a question about the student\'s own lines only', () => {
  const out = applyReplyLeakGuard('t = 4 s.', guard([{ id: 'L1', reading: '20 + 15t + 5t^2 = 0', verdict: 'incorrect' }]), 1);
  assert.match(out, /line L1/);
  assert.doesNotMatch(out, /setup|given|rejected/);
});

// ---- the worked example through the real guard (CLAUDE.md: legitimate instruction is not stripped) -----------

const recoveryPages: Record<string, { id: string; reading: string; verdict: string }[]> = {
  blank: [],
  signError: [{ id: 'L1', reading: '20 + 15t + 5t^2 = 0', verdict: 'incorrect' }],
  validThenSlip: [{ id: 'L1', reading: '20 + 15t - 5t^2 = 0', verdict: 'valid' }, { id: 'L2', reading: 't^2 - 3t + 4 = 0', verdict: 'incorrect' }],
  forgotHeight: [{ id: 'L1', reading: 'y = 15t - 5t^2', verdict: 'valid' }, { id: 'L2', reading: '15t - 5t^2 = 0', verdict: 'incorrect' }, { id: 'L3', reading: 't = 3 s', verdict: 'incorrect' }],
  keptRoot: [{ id: 'L1', reading: '20 + 15t - 5t^2 = 0', verdict: 'valid' }, { id: 'L2', reading: '(t - 4)(t + 1) = 0', verdict: 'valid' }, { id: 'L3', reading: 't = 4 or t = -1', verdict: 'partial' }],
};

test('the worked example survives the reply leak guard unchanged at level 3, next to every recovery page', () => {
  const worked = demoTask(DEMO_TASK_IDS.example).workedSolution!;
  assert.match(worked, /negative/);
  assert.match(worked, /up is positive/);
  assert.match(worked, /[Ss]ketch/);
  for (const [name, lines] of Object.entries(recoveryPages)) {
    // as WorkspaceScreen sends it (the check's lines), and with the recovery setup added
    assert.equal(applyReplyLeakGuard(worked, lines, 3), worked, `${name}: check lines`);
    assert.equal(applyReplyLeakGuard(worked, guard(lines), 3), worked, `${name}: with the setup`);
  }
});

test('the recovery answer is still stripped next to the worked example', () => {
  const worked = demoTask(DEMO_TASK_IDS.example).workedSolution!;
  for (const leak of ['So for your problem, t = 4 s.', 'Your ball lands after 4 seconds.']) {
    for (const lines of [recoveryPages.signError, recoveryPages.validThenSlip]) {
      const out = applyReplyLeakGuard(`${worked}\n${leak}`, guard(lines), 3);
      assert.ok(!out.includes(leak), leak);
      assert.ok(out.includes('t² − t − 2 = 0'), 'example kept');
    }
  }
});

// ---- the independent task's help reply (supported practice) --------------------------------------------------

test('on the independent task, t = 3 / 3 seconds is withheld; "what does t = −1 mean?" is not', () => {
  const lines = replyGuardLines(undefined, TASK_GIVENS[DEMO_TASK_IDS.independent]);
  for (const r of ['So t = 3 s.', 'It lands after 3 seconds.', 'Factor to (t - 3)(t + 1) = 0, giving t = 3.']) {
    assert.ok(!/t\s*=\s*3\b|3 s|3 seconds/.test(applyReplyLeakGuard(`Think about which root is physical. ${r}`, lines, 3)), r);
  }
  const q = 'What does t = −1 s mean for a ball thrown at t = 0?';
  assert.equal(applyReplyLeakGuard(q, lines, 2), q);
});
