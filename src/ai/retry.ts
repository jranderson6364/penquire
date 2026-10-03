/**
 * Retry policy for the Messages API. Only failures that can succeed on a second try are retried:
 * network errors, timeouts of the connection itself, 408/409/429 and 5xx (including 529 overloaded).
 * Client errors (400/401/403/404/413) are never retried; they would fail the same way.
 * Pure + injectable (sleep, random) so the schedule is unit-tested without waiting.
 */
export class HttpError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`The request timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

/** "120" (seconds) or an HTTP date -> milliseconds, capped; undefined if absent or unparseable. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now(), capMs = 20_000): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  let ms: number;
  if (Number.isFinite(secs)) ms = secs * 1000;
  else {
    const at = Date.parse(header);
    if (Number.isNaN(at)) return undefined;
    ms = at - now;
  }
  return Math.max(0, Math.min(capMs, ms));
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  if (e instanceof TimeoutError) return false; // a slow request is not made faster by repeating it
  // fetch() rejects with a TypeError on network failure ("Network request failed" in React Native)
  return e instanceof TypeError;
}

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
};

/** Delay before retry number `attempt` (1-based): exponential with jitter, or the server's Retry-After. */
export function backoffMs(attempt: number, error: unknown, baseMs = 800, maxMs = 8000, random: () => number = Math.random): number {
  if (error instanceof HttpError && error.retryAfterMs !== undefined) return error.retryAfterMs;
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const delay = backoffMs(attempt + 1, e, opts.baseMs, opts.maxMs, opts.random);
      opts.onRetry?.(attempt + 1, delay, e);
      await sleep(delay);
    }
  }
}
