// The one reviewed original demo pack (docs/12-demo-spec.md "One original reviewed pack"). Invented content,
// not a course assignment. `expected` and `workedSolution` are answer keys: only `learnerText` reaches the learner.
import type { DemoPack, DemoTask } from './types';

export const DEMO_TASK_IDS = {
  recovery: 'alg-dist-recovery',
  example: 'alg-dist-example',
  independent: 'alg-dist-independent',
  review: 'alg-dist-review',
} as const;

/**
 * The equation each task starts from, for deterministic step checks (src/learning/assess.ts). It is already in
 * the learner-facing prompt, so it is not an answer key.
 */
export const TASK_EQUATIONS: Record<string, string> = {
  [DEMO_TASK_IDS.recovery]: '2(3x - 4) = 10',
  [DEMO_TASK_IDS.example]: '3(2z - 1) = 21',
  [DEMO_TASK_IDS.independent]: '3(2y + 1) = 33',
  [DEMO_TASK_IDS.review]: '5(2w - 3) = 25',
};

const tasks: DemoTask[] = [
  {
    id: DEMO_TASK_IDS.recovery,
    role: 'recovery',
    prompt: 'Solve 2(3x − 4) = 10. Show enough working to explain the distribution.',
    asksForExplanation: false,
    expected: {
      finalAnswer: 'x = 3',
      acceptedSteps: ['6x - 8 = 10'],
      keyIdea: 'Both terms inside the parentheses are multiplied by 2.',
      rubric: [
        'The distribution step multiplies both 3x and -4 by 2.',
        'Each later step does the same thing to both sides of the equation.',
        'The final value of x is stated.',
      ],
    },
  },
  {
    id: DEMO_TASK_IDS.example,
    role: 'example',
    prompt: 'Worked example: solve 3(2z − 1) = 21.',
    asksForExplanation: false,
    expected: {
      finalAnswer: 'z = 4',
      acceptedSteps: ['6z - 3 = 21'],
      keyIdea: 'Multiplying a sum or difference multiplies every term inside the parentheses.',
      rubric: [
        'The distribution step multiplies both 2z and -1 by 3.',
        'Each later step does the same thing to both sides of the equation.',
      ],
    },
    workedSolution: [
      'Start with 3(2z − 1) = 21.',
      'The 3 multiplies everything inside the parentheses, so it multiplies 2z and it also multiplies −1: 3(2z − 1) = 6z − 3.',
      'That gives 6z − 3 = 21.',
      'Add 3 to both sides. Doing the same thing to both sides keeps them equal: 6z = 24.',
      'Divide both sides by 6: z = 4.',
      'Check by putting it back in: 3(2·4 − 1) = 3·7 = 21, which matches.',
    ].join('\n'),
  },
  {
    id: DEMO_TASK_IDS.independent,
    role: 'independent',
    prompt: 'A length is modeled by 3(2y + 1). Its measured value is 33. Find y and explain how multiplication applies to the parentheses.',
    asksForExplanation: true,
    expected: {
      finalAnswer: 'y = 5',
      // either distribute first, or divide both sides by 3 first
      acceptedSteps: ['6y + 3 = 33', '2y + 1 = 11'],
      keyIdea: 'The 3 multiplies both 2y and 1, or both sides can be divided by 3 first.',
      rubric: [
        'Either the distribution step multiplies both 2y and 1 by 3, or both sides are divided by 3 first.',
        'Each later step does the same thing to both sides of the equation.',
        'The final value of y is stated.',
        'The explanation says the multiplication applies to every term inside the parentheses.',
      ],
    },
  },
  {
    id: DEMO_TASK_IDS.review,
    role: 'review',
    prompt: 'Solve 5(2w − 3) = 25 and explain or demonstrate the distribution.',
    asksForExplanation: true,
    expected: {
      finalAnswer: 'w = 4',
      acceptedSteps: ['10w - 15 = 25'],
      keyIdea: 'The 5 multiplies both 2w and -3.',
      rubric: [
        'The distribution step multiplies both 2w and -3 by 5.',
        'Each later step does the same thing to both sides of the equation.',
        'The final value of w is stated.',
      ],
    },
  },
];

/** tasks, worked example, independent item, review item, policy, version */
export const DEMO_PACK: DemoPack = {
  version: 'algebra-distribution-v1',
  skillId: 'algebra.linear.distribution',
  title: 'Original demo practice: distributing multiplication',
  policy: { maxLevel: 3, allowExplain: true, allowExample: true },
  tasks,
};

export function demoTask(taskId: string): DemoTask {
  const t = DEMO_PACK.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`unknown demo task: ${taskId}`);
  return t;
}

/** never includes answer keys */
export function learnerText(taskId: string): string {
  return demoTask(taskId).prompt;
}
