// Provider context for an independent attempt (T04). Stub until T04.
import type { CheckInput, PageImage } from '../ai/types';
import type { DemoTask, Snapshot } from './types';

/** no prior history, settled lines or lastCheck */
export function independentCheckInput(task: DemoTask, snap: Snapshot, page: PageImage): CheckInput {
  throw new Error('not implemented: independentCheckInput');
}
