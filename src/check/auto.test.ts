import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCheckAllowed, recentAuto } from './auto.ts';

const HOUR = 3600_000;

test('a quiet check runs only when idle, with new ink, and under the hourly cap', () => {
  const now = 10 * HOUR;
  assert.equal(autoCheckAllowed({ times: [], now, busy: false, strokesSinceLastCheck: true }), true);
  assert.equal(autoCheckAllowed({ times: [], now, busy: true, strokesSinceLastCheck: true }), false);
  assert.equal(autoCheckAllowed({ times: [], now, busy: false, strokesSinceLastCheck: false }), false);
  const full = Array.from({ length: 20 }, (_, i) => now - i * 60_000);
  assert.equal(autoCheckAllowed({ times: full, now, busy: false, strokesSinceLastCheck: true }), false);
  // an hour later the cap has rolled off
  assert.equal(autoCheckAllowed({ times: full, now: now + HOUR, busy: false, strokesSinceLastCheck: true }), true);
});

test('only the last hour counts', () => {
  assert.deepEqual(recentAuto([1, HOUR + 5, 2 * HOUR], 2 * HOUR), [HOUR + 5, 2 * HOUR]);
});
