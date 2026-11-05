import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ASSIGNMENT_ID, RETIRED_DEMO_ASSIGNMENT_IDS, buildDemoAssignment, buildDemoEpisode, demoContent, ensureDemoIn, isDemoAssignmentId, type DemoStore } from './seedData.ts';
import { demoScopes } from '../store/episodes.ts';
import { independentView } from './independentFlow.ts';
import type { DB } from '../store/types';
import { DEMO_PACK, DEMO_TASK_IDS, learnerText } from './demoPack.ts';
import type { Episode } from './types';
import type { Assignment } from '../store/types';

const content = () => demoContent(DEMO_PACK, learnerText);

function memStore(): DemoStore & { assignments: Assignment[]; episodes: Episode[] } {
  const s = {
    assignments: [] as Assignment[],
    episodes: [] as Episode[],
    getAssignment: (id: string) => s.assignments.find((a) => a.id === id),
    saveAssignment: (a: Assignment) => { s.assignments = [...s.assignments.filter((x) => x.id !== a.id), a]; },
    getEpisodes: () => s.episodes,
    saveEpisode: (e: Episode) => { s.episodes = [...s.episodes.filter((x) => x.id !== e.id), e]; },
  };
  return s;
}
const counter = (start = 0) => { let n = start; return (p: string) => `${p}${++n}`; };

test('ensureDemo creates one assignment and one episode, and is idempotent', () => {
  const s = memStore();
  const ids = counter();
  const first = ensureDemoIn(s, content(), ids, 1000);
  const second = ensureDemoIn(s, content(), ids, 2000);
  assert.deepEqual(second, first);
  assert.equal(first.assignmentId, DEMO_ASSIGNMENT_ID);
  assert.equal(s.assignments.length, 1);
  assert.equal(s.episodes.length, 1);
  const ep = s.episodes[0];
  assert.equal(ep.assignmentId, DEMO_ASSIGNMENT_ID);
  assert.equal(ep.phase, 'attempt');
  assert.equal(ep.rehearsal, false);
  assert.equal(ep.attempts[ep.initialAttemptId!].pageId, s.assignments[0].pageIds[0]);
  assert.equal(ep.attempts[ep.initialAttemptId!].kind, 'initial');
  assert.equal(ep.attempts[ep.initialAttemptId!].taskId, DEMO_TASK_IDS.recovery);
  assert.equal(ep.packVersion, DEMO_PACK.version);
  assert.equal(ep.skillId, DEMO_PACK.skillId);
  assert.deepEqual(ep.policy, DEMO_PACK.policy);
});

test('ensureDemo resumes an existing demo episode and leaves other assignments alone', () => {
  const s = memStore();
  const other = { id: 'real', pageIds: ['rp'], title: 'Mine' } as never as Assignment;
  s.saveAssignment(other);
  const first = ensureDemoIn(s, content(), counter(), 1);
  s.saveEpisode({ ...s.episodes[0], phase: 'repair' });
  const again = ensureDemoIn(s, content(), counter(), 2);
  assert.equal(again.episodeId, first.episodeId);
  assert.equal(s.episodes[0].phase, 'repair');
  assert.equal(s.getAssignment('real'), other);
});

test('ensureDemo recreates the episode after the demo data was deleted (reset)', () => {
  const s = memStore();
  const first = ensureDemoIn(s, content(), counter(), 1);
  s.assignments = s.assignments.filter((a) => a.id !== DEMO_ASSIGNMENT_ID);
  s.episodes = [];
  const after = ensureDemoIn(s, content(), counter(10), 5);
  assert.notEqual(after.episodeId, first.episodeId);
  assert.equal(s.episodes.length, 1);
  assert.equal(s.assignments.length, 1);
});

test('the demo assignment has the demo policy, no autoCheck, and only the recovery prompt', () => {
  const c = content();
  const a = buildDemoAssignment(c, 'p1', 1);
  assert.equal(a.title, 'Original demo practice');
  assert.equal(a.policyMaxLevel, 3);
  assert.equal(a.helpLevel, 1);
  assert.match(a.policy, /checking/i);
  assert.match(a.policy, /explanations/i);
  assert.match(a.policy, /worked examples/i);
  assert.ok(!('autoCheck' in a));
  assert.equal(a.problems.length, 1);
  assert.equal(a.problems[0].text, c.prompt);
  assert.deepEqual(a.blocks?.p1.map((b) => b.lines), [[c.prompt]]);
  assert.match(c.prompt, /thrown straight up at 15 m\/s from the edge of a cliff 20 m above the ground/);
  assert.deepEqual(a.problems[0].asksFor, c.asksFor);
  assert.ok(!a.problems[0].asksFor.some((x) => /\bx\b|distribut/.test(x)), 'no algebra-pack wording');
});

test('nothing from answer keys or other pack tasks reaches the seeded assignment', () => {
  const c = content();
  const text = JSON.stringify(buildDemoAssignment(c, 'p1', 1));
  const forbidden = ['t = 4', 't=4', '4 s', '15t', '5t^2', 't^2', '(t - 4)', 't = -1', 't = 2', 't = 3', 't = 5', 'balcony', 'bridge', 'rooftop'];
  for (const t of DEMO_PACK.tasks) {
    if (t.id !== c.taskId) forbidden.push(t.prompt);
    forbidden.push(t.expected.finalAnswer, t.expected.keyIdea, ...t.expected.acceptedSteps);
    if (t.workedSolution) forbidden.push(t.workedSolution);
  }
  for (const f of forbidden.filter((x) => x && x.trim())) assert.ok(!text.includes(f), `seeded assignment contains "${f}"`);
});

// ---- a pack version change (T15: algebra-distribution-v1 -> projectile-cliff-v1) -----------------------------

test('a new pack is a new demo id; the retired demo is hidden, never resumed as the new task', () => {
  assert.equal(DEMO_ASSIGNMENT_ID, 'demo-projectile-cliff-v1');
  assert.deepEqual(RETIRED_DEMO_ASSIGNMENT_IDS, ['demo-algebra-distribution-v1']);
  assert.ok(isDemoAssignmentId(DEMO_ASSIGNMENT_ID) && isDemoAssignmentId('demo-algebra-distribution-v1') && !isDemoAssignmentId('real'));
  const s = memStore();
  // an iPad that ran the old demo: its assignment and an episode at the repair stage
  const oldA = { id: 'demo-algebra-distribution-v1', pageIds: ['p-old'], title: 'Original demo practice', problems: [{ label: '1', text: 'Solve 2(3x − 4) = 10.', asksFor: [] }] } as never as Assignment;
  s.saveAssignment(oldA);
  const base = buildDemoEpisode(content(), { id: 'e-old', pageId: 'p-old', now: 5 });
  const legacy: Episode = { ...base, assignmentId: oldA.id, packVersion: 'algebra-distribution-v1', phase: 'repair' };
  s.saveEpisode(legacy);
  const started = ensureDemoIn(s, content(), counter(), 10);
  assert.equal(started.assignmentId, DEMO_ASSIGNMENT_ID);
  assert.notEqual(started.episodeId, 'e-old');
  const ep = s.episodes.find((e) => e.id === started.episodeId)!;
  assert.equal(ep.packVersion, DEMO_PACK.version);
  assert.equal(ep.attempts[ep.initialAttemptId!].taskId, DEMO_TASK_IDS.recovery);
  assert.match(s.getAssignment(DEMO_ASSIGNMENT_ID)!.problems[0].text, /cliff/);
  // the old data is kept (not silently discarded) but can't open this pack's fresh problem
  assert.equal(s.getAssignment(oldA.id), oldA);
  assert.equal(independentView(legacy), 'unavailable');
});

test('Reset demo removes the current and the retired demo, and nothing else', () => {
  const ep = (id: string, assignmentId: string, pageId: string) => ({ id, assignmentId, attempts: { a: { pageId, snapshot: { id: `s-${id}` } } } }) as never as Episode;
  const db = {
    assignments: [
      { id: DEMO_ASSIGNMENT_ID, pageIds: ['p-new'] },
      { id: 'demo-algebra-distribution-v1', pageIds: ['p-old'] },
      { id: 'real', pageIds: ['p-real'] },
    ],
    episodes: [ep('e-new', DEMO_ASSIGNMENT_ID, 'p-new-fresh'), ep('e-old', 'demo-algebra-distribution-v1', 'p-old'), ep('e-real', 'real', 'p-real')],
  } as never as DB;
  const { next, pageIds, snapshotIds } = demoScopes(db, [DEMO_ASSIGNMENT_ID, ...RETIRED_DEMO_ASSIGNMENT_IDS]);
  assert.deepEqual(next.assignments.map((a) => a.id), ['real']);
  assert.deepEqual((next.episodes ?? []).map((e) => e.id), ['e-real']);
  assert.deepEqual(pageIds.sort(), ['p-new', 'p-new-fresh', 'p-old']);
  assert.deepEqual(snapshotIds.sort(), ['s-e-new', 's-e-old']);
});
