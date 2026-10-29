import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ASSIGNMENT_ID, buildDemoAssignment, demoContent, ensureDemoIn, type DemoStore } from './seedData.ts';
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
  assert.match(c.prompt, /2\(3x − 4\) = 10/);
});

test('nothing from answer keys or other pack tasks reaches the seeded assignment', () => {
  const c = content();
  const text = JSON.stringify(buildDemoAssignment(c, 'p1', 1));
  const forbidden = ['6x − 8', '6x - 8', 'x = 3', 'x=3', '3(2z', '2y + 1', '5(2w', 'z = 4', 'y = 5', 'w = 4'];
  for (const t of DEMO_PACK.tasks) {
    if (t.id !== c.taskId) forbidden.push(t.prompt);
    forbidden.push(t.expected.finalAnswer, t.expected.keyIdea, ...t.expected.acceptedSteps);
    if (t.workedSolution) forbidden.push(t.workedSolution);
  }
  for (const f of forbidden.filter((x) => x && x.trim())) assert.ok(!text.includes(f), `seeded assignment contains "${f}"`);
});
