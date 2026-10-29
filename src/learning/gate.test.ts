import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate, guardPartial } from './gate.ts';
import type { RequestScope } from './types.ts';

const A: RequestScope = { episodeId: 'ep1', attemptId: 'a1', phase: 'repair' };
const B: RequestScope = { episodeId: 'ep1', attemptId: 'a2', phase: 'independent' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

test('a resolve before the boundary is ok', async () => {
  const g = createGate();
  g.enter(A);
  const d = deferred<string>();
  const r = g.guard(d.promise);
  d.resolve('reply');
  assert.deepEqual(await r, { ok: true, value: 'reply' });
});

test('a late resolve after enter is stale', async () => {
  const g = createGate();
  g.enter(A);
  const d = deferred<string>();
  const r = g.guard(d.promise);
  g.enter(B);
  d.resolve('old reply');
  assert.deepEqual(await r, { ok: false, stale: true });
});

test('a rejection while current passes through with its own error', async () => {
  const g = createGate();
  g.enter(A);
  const err = new Error('network');
  await assert.rejects(g.guard(Promise.reject(err)), (e) => e === err);
});

test('a rejection after the boundary resolves stale instead of surfacing an old error', async () => {
  const g = createGate();
  g.enter(A);
  const d = deferred<string>();
  const r = g.guard(d.promise);
  g.enter(B);
  d.reject(new Error('old failure'));
  assert.deepEqual(await r, { ok: false, stale: true });
});

test('a partial callback after a boundary is dropped', () => {
  const g = createGate();
  g.enter(A);
  const got: string[] = [];
  const onPartial = guardPartial(g.stamp(), (t: string) => got.push(t));
  onPartial('Look at');
  onPartial('Look at line 2');
  g.enter(B);
  onPartial('Look at line 2, the sign');
  assert.deepEqual(got, ['Look at', 'Look at line 2']);
});

test('repeated enter with an identical scope still invalidates older stamps', async () => {
  const g = createGate();
  g.enter(A);
  const s = g.stamp();
  const d = deferred<number>();
  const r = g.guard(d.promise, s);
  g.enter({ ...A });
  assert.equal(g.isCurrent(s), false);
  assert.equal(g.isCurrent(g.stamp()), true);
  d.resolve(1);
  assert.deepEqual(await r, { ok: false, stale: true });
});

test('interleaved requests: only those started in the current scope get through', async () => {
  const g = createGate();
  g.enter(A);
  const first = deferred<string>();
  const r1 = g.guard(first.promise);
  g.enter(B);
  const second = deferred<string>();
  const r2 = g.guard(second.promise);
  second.resolve('new');
  first.resolve('old');
  assert.deepEqual(await r2, { ok: true, value: 'new' });
  assert.deepEqual(await r1, { ok: false, stale: true });
});

test('stamp copies the scope and a hand-built scope is never current', () => {
  const g = createGate();
  g.enter(A);
  const s = g.stamp();
  assert.deepEqual(s, A);
  assert.notEqual(s, A);
  assert.equal(g.isCurrent(s), true);
  assert.equal(g.isCurrent({ ...A }), false);
  assert.equal(g.isCurrent(A), false);
});

test('mutating the scope passed to enter does not move the boundary', () => {
  const g = createGate();
  const scope = { ...A };
  g.enter(scope);
  const s = g.stamp();
  scope.phase = 'independent';
  assert.equal(g.isCurrent(s), true);
});

test('stamps from one gate are not current on another', () => {
  const g1 = createGate();
  const g2 = createGate();
  g1.enter(A);
  g2.enter(A);
  assert.equal(g2.isCurrent(g1.stamp()), false);
});
