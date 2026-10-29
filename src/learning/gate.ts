/**
 * Request gate (T06): drops provider replies, streamed text and speech that belong to an older episode, attempt or
 * phase, so nothing from before a boundary can appear or be spoken after it.
 *
 * Usage (T07 Workspace, T08 Independent):
 *
 *   const gate = useRef(createGate()).current;          // one per screen; pure TS, no React needed
 *   gate.enter({ episodeId, attemptId, phase });         // on EVERY phase/attempt change, even to the same scope
 *
 *   const r = await gate.guard(ai.check(input));         // wrap every check/reply call
 *   if (!r.ok) return;                                   // stale: drop silently, show nothing
 *   use(r.value);
 *
 *   const s = gate.stamp();                              // at request start, for streams and speech
 *   const reply = await gate.guard(ai.reply(input, guardPartial(s, onPartial)), s);
 *   for (const sentence of sentences) {
 *     if (!gate.isCurrent(s)) break;                     // check before speaking each sentence
 *     ...
 *   }
 *
 * At the independent boundary call `gate.enter(...)` and then `stopAllVoice()` from `src/voice/engine.ts`.
 *
 * A stamp is only current for the gate that issued it, and only until the next `enter`. Scopes built by hand (not
 * from `stamp()`) are never current. A request that fails after a boundary resolves as stale too, so an old phase's
 * error is never shown in the new one; a failure while still current rejects with the request's own error.
 */
import type { RequestScope } from './types';

export type Gate = {
  /** new boundary; everything older is stale */
  enter(scope: RequestScope): void;
  /** scope at request start */
  stamp(): RequestScope;
  isCurrent(s: RequestScope): boolean;
  /** `s` defaults to a stamp taken now; pass one taken earlier if the request started before this call */
  guard<T>(p: Promise<T>, s?: RequestScope): Promise<{ ok: true; value: T } | { ok: false; stale: true }>;
};

/** stamp → the gate that issued it and the check that says whether it is still current (hidden generation) */
const issued = new WeakMap<RequestScope, { gate: Gate; current: () => boolean }>();

export function createGate(): Gate {
  let current: RequestScope = { episodeId: '', attemptId: '', phase: 'attempt' };
  let generation = 0;

  const isCurrent = (s: RequestScope) => {
    const i = issued.get(s);
    return !!i && i.gate === gate && i.current();
  };

  const stamp = (): RequestScope => {
    const gen = generation;
    const s: RequestScope = { ...current };
    issued.set(s, {
      gate,
      current: () =>
        gen === generation && s.episodeId === current.episodeId && s.attemptId === current.attemptId && s.phase === current.phase,
    });
    return s;
  };

  const gate: Gate = {
    enter(scope) {
      current = { episodeId: scope.episodeId, attemptId: scope.attemptId, phase: scope.phase };
      generation++;
    },
    stamp,
    isCurrent,
    async guard<T>(p: Promise<T>, s: RequestScope = stamp()) {
      try {
        const value = await p;
        return isCurrent(s) ? { ok: true as const, value } : { ok: false as const, stale: true as const };
      } catch (e) {
        if (!isCurrent(s)) return { ok: false as const, stale: true as const };
        throw e;
      }
    },
  };
  return gate;
}

/** Wrap a streaming `onPartial` (or any callback) so it does nothing once `s` is stale. */
export function guardPartial<A extends unknown[]>(s: RequestScope, cb: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    if (issued.get(s)?.current()) cb(...args);
  };
}
