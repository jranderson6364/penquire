import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyLines, demoScope, makeSnapshot, normalizeDb, pickFreeId, upsertEpisode } from './episodes.ts';

const settings = { apiKey: '', checkModel: '', parseModel: '', paper: 'grid', allowFingerDrawing: false } as never;
const asg = (id: string, pageIds: string[]) => ({ id, pageIds, title: id }) as never;
const ep = (id: string, assignmentId: string, attempts: Record<string, unknown> = {}) =>
  ({ id, assignmentId, attempts, createdAt: 1, updatedAt: 1 }) as never;

test('an old db.json without episodes loads with an empty list and is otherwise unchanged', () => {
  const old = JSON.parse(JSON.stringify({ version: 1, assignments: [asg('a1', ['p1'])], settings, usage: [] }));
  const db = normalizeDb(old);
  assert.deepEqual(db.episodes, []);
  assert.deepEqual(db.assignments, old.assignments);
  assert.equal(db.version, 1);
  assert.deepEqual(normalizeDb({ ...old, episodes: [ep('e1', 'a1')] }).episodes?.map((e) => e.id), ['e1']);
});

test('upsertEpisode replaces by id and keeps the episode as given', () => {
  const list = upsertEpisode(upsertEpisode([], ep('e1', 'a')), ep('e2', 'a'));
  const next = upsertEpisode(list, { ...(ep('e1', 'b') as object), updatedAt: 42 } as never);
  assert.deepEqual(next.map((e) => [e.id, e.assignmentId, e.updatedAt]), [['e1', 'b', 42], ['e2', 'a', 1]]);
  assert.equal(list[0].assignmentId, 'a'); // not mutated
});

test('reset scope removes only the demo assignment, its episodes, pages and snapshots', () => {
  const snap = makeSnapshot('s_1', [], 0, 5);
  const db = {
    version: 1, settings, usage: [{ x: 1 }],
    assignments: [asg('demo', ['dp1']), asg('real', ['rp1', 'shared'])],
    episodes: [
      ep('de', 'demo', { t1: { pageId: 'dp1', snapshot: snap }, t2: { pageId: 'dp-indep' }, t3: { pageId: 'shared' } }),
      ep('re', 'real', { t9: { pageId: 'rp1', snapshot: makeSnapshot('s_real', [], 0, 5) } }),
    ],
  } as never;
  const { next, pageIds, snapshotIds } = demoScope(db, 'demo');
  assert.deepEqual(next.assignments.map((a) => a.id), ['real']);
  assert.deepEqual(next.episodes?.map((e) => e.id), ['re']);
  assert.deepEqual(pageIds.sort(), ['dp-indep', 'dp1']);
  assert.deepEqual(snapshotIds, ['s_1']);
  assert.equal(next.settings, (db as { settings: unknown }).settings);
  assert.deepEqual(next.usage, [{ x: 1 }]);
});

test('reset scope with no demo data changes nothing', () => {
  const db = { version: 1, settings, assignments: [asg('real', ['rp1'])] } as never;
  const { next, pageIds, snapshotIds } = demoScope(db, 'demo');
  assert.deepEqual(next.assignments.map((a) => a.id), ['real']);
  assert.deepEqual([pageIds, snapshotIds], [[], []]);
});

test('snapshot ids skip taken ones, so an earlier snapshot is never overwritten', () => {
  const taken = new Set(['s_a', 's_b']);
  const ids = ['s_a', 's_b', 's_c'];
  assert.equal(pickFreeId(() => ids.shift()!, (id) => taken.has(id)), 's_c');
  assert.throws(() => pickFreeId(() => 's_a', (id) => taken.has(id)));
});

test('a snapshot file is named by its id and its lines are a deep copy', () => {
  const lines = [{ id: 'L1', x: 0, y: 0, w: 10, h: 5, strokes: [0, 1] }];
  const a = makeSnapshot('s_1', lines, 2, 7);
  const b = makeSnapshot('s_2', lines, 2, 8);
  assert.notEqual(a.pageFile, b.pageFile);
  assert.equal(a.pageFile, 'snapshots/s_1.pk');
  assert.ok(!a.pageFile.startsWith('pages/'));
  lines[0].strokes.push(2);
  lines[0].x = 99;
  assert.deepEqual(a.lines[0].strokes, [0, 1]);
  assert.equal(a.lines[0].x, 0);
  assert.deepEqual(copyLines([]), []);
});
