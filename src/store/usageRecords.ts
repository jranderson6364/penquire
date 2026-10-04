import { costUSD } from '../ai/pricing.ts';
import type { Usage } from '../ai/types';

/** One API call. Kept in db.json so the Settings screen can show this month's estimated spend. */
export type UsageRecord = {
  t: number;
  kind: 'check' | 'reply' | 'parse';
  model: string;
  usage: Usage;
  /** null when the model's price is unknown */
  costUSD: number | null;
};

const KEEP_MS = 400 * 24 * 3600 * 1000;

export function makeRecord(kind: UsageRecord['kind'], model: string, usage: Usage, t = Date.now()): UsageRecord {
  return { t, kind, model, usage, costUSD: costUSD(model, usage) };
}

/** Append and drop records older than ~13 months so db.json does not grow without bound. */
export function appendRecord(records: UsageRecord[], rec: UsageRecord): UsageRecord[] {
  return [...records.filter((r) => rec.t - r.t < KEEP_MS), rec];
}

/** Local calendar month of `now`. */
export function monthTotal(records: UsageRecord[], now = new Date()): { costUSD: number; calls: number; unpriced: number } {
  const y = now.getFullYear();
  const m = now.getMonth();
  let cost = 0;
  let calls = 0;
  let unpriced = 0;
  for (const r of records) {
    const d = new Date(r.t);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    calls++;
    if (r.costUSD === null) unpriced++;
    else cost += r.costUSD;
  }
  return { costUSD: cost, calls, unpriced };
}

/** Per-call cost: three decimals under 10 cents so a $0.017 check does not read as "<$0.01". */
export function formatCost(n: number): string {
  return n >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

/** Sum of the costs recorded on an assignment's events (checks, replies, parses). */
export function assignmentSpend(events: ReadonlyArray<{ costUSD?: number }>): number {
  return events.reduce((sum, e) => sum + (typeof e.costUSD === 'number' && Number.isFinite(e.costUSD) ? e.costUSD : 0), 0);
}

export function formatUSD(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}
