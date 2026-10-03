import type { Usage } from './types';

/**
 * USD per million tokens. One file on purpose: prices change, update them here only.
 * Source: Anthropic model pricing (checked 2026-09-25 via the claude-api reference). RE-VERIFY before relying on
 * the numbers; they are used for the Settings estimate, not billing. Cache-read prices were stated for Fable 5.1, Opus 5.5
 * and Sonnet 5.5; the other rows assume 0.1x input. Cache write assumes the 5-minute TTL (1.25x input).
 */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Response model ids may carry a date suffix; match the longest known prefix. */
export function priceFor(model: string): Price | null {
  const id = model.toLowerCase();
  const key = Object.keys(PRICES)
    .filter((k) => id === k || id.startsWith(k + '-'))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : null;
}

/** Estimated cost in USD, or null when the model's price is unknown (never guess). */
export function costUSD(model: string, u: Usage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6;
}
