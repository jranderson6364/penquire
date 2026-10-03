import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, TimeoutError, backoffMs, isRetryable, parseRetryAfter, withRetry } from './retry.ts';

const noSleep = async () => {};

test('which failures are retried', () => {
  for (const s of [408, 409, 429, 500, 502, 503, 529]) assert.equal(isRetryable(new HttpError(s, 'x')), true, String(s));
  for (const s of [400, 401, 403, 404, 413, 422]) assert.equal(isRetryable(new HttpError(s, 'x')), false, String(s));
  assert.equal(isRetryable(new TypeError('Network request failed')), true);
  assert.equal(isRetryable(new TimeoutError(1000)), false);
  assert.equal(isRetryable(new Error('boom')), false);
});

test('succeeds after transient failures, then returns the value', async () => {
  let calls = 0;
  const delays: number[] = [];
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new HttpError(529, 'overloaded');
      return 'ok';
    },
    { sleep: noSleep, random: () => 0.5, onRetry: (_a, d) => delays.push(d) }
  );
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [600, 1200]); // 800*0.75, 1600*0.75
});

test('gives up after the retry budget and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new HttpError(503, 'down'); }, { sleep: noSleep }),
    (e: unknown) => e instanceof HttpError && e.status === 503
  );
  assert.equal(calls, 3); // 1 try + 2 retries
});

test('client errors fail immediately, once', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(400, 'bad'); }, { sleep: noSleep }));
  assert.equal(calls, 1);
});

test('Retry-After wins over the exponential schedule, and is capped', () => {
  assert.equal(backoffMs(1, new HttpError(429, 'x', 3000)), 3000);
  assert.equal(parseRetryAfter('120'), 20000);
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(parseRetryAfter(new Date(1_000).toUTCString(), 4_000), 0); // already past
});

test('backoff grows, is jittered within [50%,100%], and is capped', () => {
  assert.equal(backoffMs(1, null, 800, 8000, () => 1), 800);
  assert.equal(backoffMs(2, null, 800, 8000, () => 1), 1600);
  assert.equal(backoffMs(10, null, 800, 8000, () => 1), 8000);
  assert.equal(backoffMs(3, null, 800, 8000, () => 0), 1600);
});
