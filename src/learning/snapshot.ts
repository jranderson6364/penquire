// Immutable page snapshots (T03). Stub until T03.
import type { Line } from '../ink/lines';
import type { Snapshot } from './types';

export function takeSnapshot(pageId: string, lines: Line[], strokeCount: number, now: number): Snapshot {
  throw new Error('not implemented: takeSnapshot');
}
