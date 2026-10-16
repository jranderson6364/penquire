/**
 * Hands-free conversation (docs/10 §4.2): when has the student finished a turn? Pure (tested).
 * A turn ends after a stretch of silence following some speech. A conversation ends by itself when nobody has said
 * anything for a while, so the microphone never stays open forever.
 */
export const END_OF_TURN_MS = 1300;
export const IDLE_END_MS = 30_000;

export type TurnState = { startedAt: number; lastChangeAt: number; text: string };

export function turnDecision(s: TurnState, now: number): 'wait' | 'send' | 'give_up' {
  if (s.text.trim().split(/\s+/).filter(Boolean).length >= 1 && now - s.lastChangeAt >= END_OF_TURN_MS) return 'send';
  if (!s.text.trim() && now - s.startedAt >= IDLE_END_MS) return 'give_up';
  return 'wait';
}
