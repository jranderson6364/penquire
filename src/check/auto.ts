/**
 * Check as you write (docs/10 §3.1): after the Pencil rests for a moment, run a quiet check of what is new. Carry-over
 * (src/check/carry.ts) means only new or changed lines are graded, so a quiet check is cheap, but it still costs money,
 * so it is opt-in and capped per rolling hour. Pure (tested).
 */
export const AUTO_IDLE_MS = 4000;
export const AUTO_CAP_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;

/** Keep only the auto-checks of the last hour. */
export function recentAuto(times: number[], now: number): number[] {
  return times.filter((t) => now - t < HOUR);
}

/** May a quiet check run now? Not while something else is happening, and never over the hourly cap. */
export function autoCheckAllowed(o: { times: number[]; now: number; busy: boolean; strokesSinceLastCheck: boolean; cap?: number }): boolean {
  if (o.busy || !o.strokesSinceLastCheck) return false;
  return recentAuto(o.times, o.now).length < (o.cap ?? AUTO_CAP_PER_HOUR);
}
