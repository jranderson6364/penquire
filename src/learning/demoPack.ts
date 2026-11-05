// The one reviewed original demo pack (docs/12-demo-spec.md "One original reviewed pack"). Invented content,
// not a course assignment. `expected`, `workedSolution` and TASK_GIVENS are answer keys or guard input: only
// `learnerText` reaches the learner.
//
// Vertical projectile motion with g = 10 m/s², so every quadratic factors cleanly. Every task has the extraneous
// root t = −1 s (each height is the launch speed plus 5): rejecting it is part of the skill.
import type { DemoPack, DemoTask } from './types';

export const DEMO_TASK_IDS = {
  recovery: 'proj-cliff-recovery',
  example: 'proj-cliff-example',
  independent: 'proj-cliff-independent',
  review: 'proj-cliff-review',
  /** "Test me further" after a pass: the same idea with a twist (thrown downward, so the starting velocity is negative) */
  twist: 'proj-cliff-twist',
  /** "Try another one" after anything but a pass: another problem of the same kind */
  again: 'proj-cliff-again',
} as const;

/**
 * What the deterministic checks know about where a task starts (src/learning/assess.ts, workspaceFlow.ts).
 *
 * `equation` is the model setup, "height above the ground = 0" with up positive. It is worked out from the numbers in
 * the prompt but is NOT printed there (`stated: false`): setting it up is where the student can fall (the sign of g,
 * the starting height), so the guards treat it as hidden, and a tutor restating it is a leak. `forms` are other ways
 * of writing the same setup. `rejected` are roots of the equation that are not the answer; the tutor may name them
 * when talking about rejecting them, and stating one as the answer fails the assessment.
 */
export type TaskGiven = { equation: string; stated: boolean; forms?: string[]; rejected?: string[] };

export const TASK_GIVENS: Record<string, TaskGiven> = {
  [DEMO_TASK_IDS.recovery]: { equation: '20 + 15t - 5t^2 = 0', stated: false, forms: ['y = 20 + 15t - 5t^2'], rejected: ['t = -1'] },
  [DEMO_TASK_IDS.example]: { equation: '10 + 5t - 5t^2 = 0', stated: false, forms: ['y = 10 + 5t - 5t^2'], rejected: ['t = -1'] },
  [DEMO_TASK_IDS.independent]: { equation: '15 + 10t - 5t^2 = 0', stated: false, forms: ['y = 15 + 10t - 5t^2'], rejected: ['t = -1'] },
  [DEMO_TASK_IDS.review]: { equation: '25 + 20t - 5t^2 = 0', stated: false, forms: ['y = 25 + 20t - 5t^2'], rejected: ['t = -1'] },
  [DEMO_TASK_IDS.twist]: { equation: '30 - 5t - 5t^2 = 0', stated: false, forms: ['y = 30 - 5t - 5t^2'], rejected: ['t = -3'] },
  [DEMO_TASK_IDS.again]: { equation: '30 + 5t - 5t^2 = 0', stated: false, forms: ['y = 30 + 5t - 5t^2'], rejected: ['t = -2'] },
};

/** Each task's model equation, for step checks. */
export const TASK_EQUATIONS: Record<string, string> = Object.fromEntries(Object.entries(TASK_GIVENS).map(([id, g]) => [id, g.equation]));

const tasks: DemoTask[] = [
  {
    id: DEMO_TASK_IDS.recovery,
    role: 'recovery',
    prompt:
      'A ball is thrown straight up at 15 m/s from the edge of a cliff 20 m above the ground. Taking g = 10 m/s², how long until it hits the ground? Sketch the situation and show your working.',
    asksFor: ['the time until the ball hits the ground', 'working that gets there'],
    asksForExplanation: false,
    expected: {
      finalAnswer: 't = 4 s',
      acceptedSteps: ['20 + 15t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 20 m up, with gravity pulling down) set equal to zero',
      keyIdea:
        'Measure height from the ground with up positive: the ball starts at +20 m with +15 m/s and gravity gives −5t². It lands when the height is 0, and only the root after the throw counts.',
      rubric: [
        'Height is measured from one origin with a consistent sign convention, and the 20 m starting height is included (15t − 5t² = 0 gives the time back at the cliff edge, not the ground).',
        'Gravity acts downward: with up positive the t² term is −5t², not +5t².',
        'The quadratic is solved correctly, by factoring or by the quadratic formula.',
        'The negative root is rejected because it is a time before the throw; the answer is t = 4 s.',
        'A sketch of the situation is supporting context, not graded work.',
      ],
    },
  },
  {
    id: DEMO_TASK_IDS.example,
    role: 'example',
    prompt: 'Worked example: a rock is thrown straight up at 5 m/s from a bridge 10 m above the water. Taking g = 10 m/s², how long until it hits the water?',
    asksFor: ['the time until the rock hits the water', 'working that gets there'],
    asksForExplanation: false,
    expected: {
      finalAnswer: 't = 2 s',
      acceptedSteps: ['10 + 5t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 10 m up, with gravity pulling down) set equal to zero',
      keyIdea: 'Height above the water with up positive: +10 m start, +5 m/s, −5t² from gravity; keep only the root after the throw.',
      rubric: ['The 10 m starting height is included.', 'With up positive the t² term is −5t².', 'The negative root is rejected.'],
    },
    // Written so the reply leak guard keeps it whole next to the recovery work (demoPack.test.ts): the other root is
    // described in words, never as an equation, because every task in the pack shares it.
    workedSolution: [
      'Sketch: the bridge 10 m above the water, the rock leaving it with an arrow up labelled 5 m/s, an arrow down labelled g, and a height axis with 0 at the water and up as positive.',
      'Sign convention: up is positive. So the rock starts at +10 m, its starting velocity is +5 m/s, and its acceleration is −10 m/s², because gravity pulls down.',
      'Height above the water after t seconds: y = 10 + 5t − 5t² (the −5t² is ½ × (−10) × t²).',
      'It hits the water when its height is zero, so solve 10 + 5t − 5t² = 0.',
      'Divide both sides by −5 to get t² − t − 2 = 0.',
      'Factor: (t − 2)(t + 1) = 0. One root is 2 and the other is negative.',
      'A negative time is before the rock was thrown, so it does not describe this throw. Reject it.',
      'The rock hits the water 2 seconds after it is thrown.',
      'Check: 10 + 5·2 − 5·4 = 10 + 10 − 20 = 0, so the height really is zero then.',
    ].join('\n'),
  },
  {
    id: DEMO_TASK_IDS.independent,
    role: 'independent',
    prompt:
      'A ball is thrown straight up at 10 m/s from a balcony 15 m above the ground. Taking g = 10 m/s², how long until it hits the ground? Show your working, and write one sentence saying which solution of your equation answers the question, and why.',
    asksFor: ['the time until the ball hits the ground', 'working that gets there', 'one sentence saying which solution answers the question, and why'],
    asksForExplanation: true,
    expected: {
      finalAnswer: 't = 3 s',
      acceptedSteps: ['15 + 10t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 15 m up, with gravity pulling down) set equal to zero',
      keyIdea: 'Height above the ground with up positive: +15 m, +10 m/s, −5t²; t² − 2t − 3 = 0 gives 3 or −1, and −1 is before the throw.',
      rubric: [
        'The 15 m starting height is included and, with up positive, the t² term is −5t².',
        'The quadratic is solved correctly, by factoring or by the quadratic formula.',
        'The final answer is t = 3 s and the negative root is not given as an answer.',
        'The sentence says the negative solution is rejected because it is a time before the ball was thrown (or otherwise correctly justifies the choice of root).',
        'A sketch, if drawn, is supporting context, not graded work.',
      ],
    },
  },
  {
    id: DEMO_TASK_IDS.review,
    role: 'review',
    prompt:
      'A ball is thrown straight up at 20 m/s from a rooftop 25 m above the ground. Taking g = 10 m/s², how long until it hits the ground? Show your working and say which solution you keep, and why.',
    asksFor: ['the time until the ball hits the ground', 'working that gets there', 'which solution is kept, and why'],
    asksForExplanation: true,
    expected: {
      finalAnswer: 't = 5 s',
      acceptedSteps: ['25 + 20t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 25 m up, with gravity pulling down) set equal to zero',
      keyIdea: 'Height above the ground with up positive: +25 m, +20 m/s, −5t²; t² − 4t − 5 = 0 gives 5 or −1, and −1 is before the throw.',
      rubric: [
        'The 25 m starting height is included and, with up positive, the t² term is −5t².',
        'The quadratic is solved correctly.',
        'The final answer is t = 5 s and the negative root is rejected with a reason.',
      ],
    },
  },
];

/**
 * Follow-up independent problems, opened only from an outcome card ("Test me further" / "Try another one"). Kept out of
 * DEMO_PACK.tasks: their rejected root is not the pack's shared −1, and the twist is thrown downward.
 */
export const FOLLOW_UP_TASKS: DemoTask[] = [
  {
    id: DEMO_TASK_IDS.twist,
    role: 'follow_up',
    prompt:
      'A stone is thrown straight down at 5 m/s from the top of a cliff 30 m above the ground. Taking g = 10 m/s², how long until it hits the ground? Show your working and say which solution you keep, and why.',
    asksFor: ['the time until the stone hits the ground', 'working that gets there', 'which solution is kept, and why'],
    asksForExplanation: true,
    expected: {
      finalAnswer: 't = 2 s',
      acceptedSteps: ['30 - 5t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 30 m up, moving down at the start, with gravity pulling down) set equal to zero',
      keyIdea: 'Height above the ground with up positive: +30 m, −5 m/s because it is thrown down, −5t²; t² + t − 6 = 0 gives 2 or −3, and −3 is before the throw.',
      rubric: [
        'The 30 m starting height is included and, with up positive, the starting velocity is −5 m/s (thrown down) and the t² term is −5t².',
        'The quadratic is solved correctly, by factoring or by the quadratic formula.',
        'The final answer is t = 2 s and the negative root is rejected with a reason.',
        'A sketch, if drawn, is supporting context, not graded work.',
      ],
    },
  },
  {
    id: DEMO_TASK_IDS.again,
    role: 'follow_up',
    prompt:
      'A ball is thrown straight up at 5 m/s from a tower 30 m above the ground. Taking g = 10 m/s², how long until it hits the ground? Show your working and say which solution you keep, and why.',
    asksFor: ['the time until the ball hits the ground', 'working that gets there', 'which solution is kept, and why'],
    asksForExplanation: true,
    expected: {
      finalAnswer: 't = 3 s',
      acceptedSteps: ['30 + 5t - 5t^2 = 0'],
      keyStep: 'the height equation (starting 30 m up, with gravity pulling down) set equal to zero',
      keyIdea: 'Height above the ground with up positive: +30 m, +5 m/s, −5t²; t² − t − 6 = 0 gives 3 or −2, and −2 is before the throw.',
      rubric: [
        'The 30 m starting height is included and, with up positive, the t² term is −5t².',
        'The quadratic is solved correctly, by factoring or by the quadratic formula.',
        'The final answer is t = 3 s and the negative root is rejected with a reason.',
        'A sketch, if drawn, is supporting context, not graded work.',
      ],
    },
  },
];

/** tasks, worked example, independent item, review item, policy, version */
export const DEMO_PACK: DemoPack = {
  version: 'projectile-cliff-v1',
  skillId: 'physics.kinematics.projectile_vertical',
  title: 'Original demo practice: a ball thrown off a cliff',
  policy: { maxLevel: 3, allowExplain: true, allowExample: true },
  tasks,
};

export function demoTask(taskId: string): DemoTask {
  const t = DEMO_PACK.tasks.find((x) => x.id === taskId) ?? FOLLOW_UP_TASKS.find((x) => x.id === taskId);
  if (!t) throw new Error(`unknown demo task: ${taskId}`);
  return t;
}

/** never includes answer keys */
export function learnerText(taskId: string): string {
  return demoTask(taskId).prompt;
}
