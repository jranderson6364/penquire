// Provider context for an independent attempt (T04). Built from scratch so the check cannot see earlier help.
import type { CheckInput, PageImage } from '../ai/types';
import { DEMO_PACK } from './demoPack.ts';
import type { DemoTask, Snapshot } from './types';

const POLICY_TEXT =
  'Original demo practice. Checking, general explanations and worked examples on different tasks are allowed through level 3.';

/**
 * No prior history, settled lines or lastCheck. `previous`, `settled`, `confirmed`, `groups` and `focusPart` are
 * left out entirely (not set to empty values). The answer key (`task.expected`) is never sent: `asksFor` is
 * the task's learner-facing list of what the prompt asks, and the assessment against the key happens locally (assess.ts).
 */
export function independentCheckInput(task: DemoTask, snap: Snapshot, page: PageImage): CheckInput {
  const asksFor = [...task.asksFor];
  return {
    course: 'Original demo practice',
    assignmentTitle: 'Independent attempt',
    problems: [{ label: '1', text: task.prompt, asksFor }],
    policy: POLICY_TEXT,
    helpLevel: DEMO_PACK.policy.maxLevel,
    image: page,
    lines: snap.lines.map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h })),
    pageNumber: 1,
  };
}
