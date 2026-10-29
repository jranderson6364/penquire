// The demo learning pack (T04). Placeholder until T04 writes the real tasks.
import type { DemoPack } from './types';

/** tasks, worked example, independent item, review item, policy, version */
export const DEMO_PACK: DemoPack = {
  version: 'stub',
  skillId: 'stub',
  title: 'not implemented',
  policy: { maxLevel: 0, allowExplain: false, allowExample: false },
  tasks: [],
};

/** never includes answer keys */
export function learnerText(taskId: string): string {
  throw new Error('not implemented: learnerText');
}
