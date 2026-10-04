import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUSD, priceFor } from '../ai/pricing.ts';
import { appendRecord, formatUSD, makeRecord, monthTotal } from './usageRecords.ts';

const U = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite });

test('cost arithmetic for a Sonnet 5.5 check', () => {
  // 4000 uncached in + 1500 out + 3000 cache read: 4000*2 + 1500*10 + 3000*0.2 = 23600 / 1e6
  assert.ok(Math.abs(costUSD('claude-sonnet-5-5', U(4000, 1500, 3000))! - 0.0236) < 1e-9);
});

test('model ids with a date suffix match; longest prefix wins; unknown is null (never guessed)', () => {
  assert.equal(priceFor('claude-sonnet-5-5-20260901')?.input, 2);
  assert.equal(priceFor('claude-opus-5-5')?.input, 4);
  assert.equal(priceFor('claude-opus-5')?.input, 5);
  assert.equal(priceFor('gpt-5'), null);
  assert.equal(costUSD('mystery-model', U(1, 1)), null);
});

test('month totals only count the current local month, and report unpriced calls', () => {
  const now = new Date(2026, 9, 15, 12);
  const rec = (d: Date, model = 'claude-sonnet-5-5') => makeRecord('check', model, U(1_000_000, 0), d.getTime());
  const records = [rec(new Date(2026, 9, 1)), rec(new Date(2026, 9, 31, 23)), rec(new Date(2026, 8, 30, 23)), rec(new Date(2026, 9, 5), 'unknown-x')];
  const t = monthTotal(records, now);
  assert.equal(t.calls, 3);
  assert.equal(t.unpriced, 1);
  assert.ok(Math.abs(t.costUSD - 4) < 1e-9); // two priced calls at $2
});

test('old records are pruned on append', () => {
  const old = makeRecord('check', 'claude-sonnet-5-5', U(1, 1), 0);
  const fresh = makeRecord('reply', 'claude-sonnet-5-5', U(1, 1), 500 * 24 * 3600 * 1000);
  assert.deepEqual(appendRecord([old], fresh), [fresh]);
});

test('currency formatting', () => {
  assert.equal(formatUSD(0), '$0.00');
  assert.equal(formatUSD(0.004), '<$0.01');
  assert.equal(formatUSD(12.345), '$12.35');
});

test('per-call cost keeps three decimals under 10 cents; assignment spend sums event costs', async () => {
  const { formatCost, assignmentSpend } = await import('./usageRecords.ts');
  assert.equal(formatCost(0.0173), '$0.017');
  assert.equal(formatCost(0.1), '$0.10');
  assert.equal(formatCost(1.234), '$1.23');
  assert.ok(Math.abs(assignmentSpend([{ costUSD: 0.01 }, {}, { costUSD: 0.02 }, { costUSD: Number.NaN }]) - 0.03) < 1e-9);
});
