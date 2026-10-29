// Request gate (T06): drops provider/stream/voice results that belong to an older episode/attempt/phase. Stub until T06.
import type { RequestScope } from './types';

export function createGate(): {
  /** new boundary; everything older is stale */
  enter(scope: RequestScope): void;
  /** scope at request start */
  stamp(): RequestScope;
  isCurrent(s: RequestScope): boolean;
  guard<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; stale: true }>;
} {
  throw new Error('not implemented: createGate');
}
