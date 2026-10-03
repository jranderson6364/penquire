import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRepeat, noteHelp, recordCheck, getIssue, type OpenIssue } from './issues.ts';
import { ALLOWED_REVEALS, overLevel } from './revealed.ts';
import { sanitizeCheck, sanitizeLines, sanitizeRevealed } from '../ai/sanitize.ts';
import { HELP_LEVELS, intentBlock } from '../ai/prompts.ts';
import { disclosureSummary, issueOutcomes } from '../log.ts';
import type { Assignment } from '../store/types.ts';
import type { HelpLevel } from '../ai/types.ts';

const issue = (key: string, level: HelpLevel = 1): OpenIssue => ({ key, reading: key, level, obstacle: 'slip' });

test('an issue that disappears on a later check of the same page is resolved with the most help it had', () => {
  let { issues, resolved } = recordCheck({}, 'p1', [issue('a', 1), issue('b', 1)], 1);
  assert.equal(resolved.length, 0);
  issues = noteHelp(issues, 'p1', 'b', 3); // "More help" on b
  ({ issues, resolved } = recordCheck(issues, 'p1', [issue('a', 1)], 2));
  assert.deepEqual(resolved.map((r) => [r.record.reading, r.record.maxLevel]), [['b', 3]]);
  assert.equal(isRepeat(getIssue(issues, 'p1', 'a')), true, 'a was flagged on two checks in a row');
});

test('checking one page never resolves issues on another page', () => {
  const first = recordCheck({}, 'p1', [issue('a')], 1);
  const second = recordCheck(first.issues, 'p2', [], 2);
  assert.equal(second.resolved.length, 0);
  assert.ok(getIssue(second.issues, 'p1', 'a'));
});

test('noteHelp only raises, never lowers, and ignores unknown issues', () => {
  const { issues } = recordCheck({}, 'p1', [issue('a', 3)], 1);
  assert.equal(noteHelp(issues, 'p1', 'a', 2), issues);
  assert.equal(noteHelp(issues, 'p1', 'zzz', 4), issues);
});

test('reveal kinds above the level are reported; the level table matches the prompt text', () => {
  assert.deepEqual(overLevel([{ kind: 'location', what: 'L4' }, { kind: 'principle', what: 'energy' }], 1), ['principle']);
  assert.deepEqual(overLevel([{ kind: 'step', what: 'x' }, { kind: 'example', what: 'y' }], 2), ['example', 'step']);
  assert.deepEqual(overLevel([{ kind: 'step', what: 'x' }], 4), []);
  for (const l of [0, 1, 2, 3, 4] as HelpLevel[]) {
    const line = HELP_LEVELS[l].rule.match(/Allowed in "revealed": ([a-z, ]+)\./)?.[1];
    assert.deepEqual(line?.split(', '), [...ALLOWED_REVEALS[l]], `level ${l}`);
  }
});

test('help levels never loosen: levels 0-3 forbid steps of the student problem', () => {
  for (const l of [0, 1, 2, 3] as HelpLevel[]) assert.ok(!ALLOWED_REVEALS[l].includes('step') && !ALLOWED_REVEALS[l].includes('subgoal'));
  assert.match(HELP_LEVELS[2].rule, /Do not apply it to their problem/);
});

test('obstacle is kept only when known and only on lines that need work', () => {
  const out = sanitizeLines([
    { id: 'L1', reading: 'a', verdict: 'incorrect', note: '', obstacle: 'Slip' },
    { id: 'L2', reading: 'b', verdict: 'valid', note: '', obstacle: 'slip' },
    { id: 'L3', reading: 'c', verdict: 'partial', note: '', obstacle: 'laziness' },
  ]);
  assert.deepEqual(out.map((l) => l.obstacle), ['slip', undefined, undefined]);
});

test('an unknown reveal kind counts as the most revealing, so a malformed report cannot hide a reveal', () => {
  assert.deepEqual(sanitizeRevealed([{ kind: 'hint', what: 'x' }, 'the answer', null, {}]), [
    { kind: 'step', what: 'x' },
    { kind: 'step', what: 'the answer' },
  ]);
  assert.deepEqual(sanitizeCheck({}, 'm').revealed, []);
});

test('intent blocks: start never requires an attempt; dispute re-checks from scratch', () => {
  assert.match(intentBlock('start', '3b'), /PART 3b/);
  assert.match(intentBlock('start'), /Don't ask them to show an attempt/);
  assert.match(intentBlock('dispute'), /from scratch/);
  assert.equal(intentBlock(undefined), '');
});

const assignment = (events: Assignment['events'], issues: Assignment['issues'] = {}): Assignment => ({
  id: 'a',
  title: 'PS 1',
  course: 'Phys 1',
  policy: '',
  policyMaxLevel: 4,
  helpLevel: 1,
  style: '',
  problems: [],
  pageIds: [],
  chat: [],
  checks: {},
  events,
  issues,
  createdAt: 0,
  updatedAt: 0,
});

test('disclosure separates issues resolved on your own from ones resolved with help', () => {
  const a = assignment(
    [
      { t: 1, type: 'check', level: 1 },
      { t: 2, type: 'reply', level: 3, detail: 'hint ladder' },
      { t: 3, type: 'resolved', level: 1 },
      { t: 3, type: 'resolved', level: 3 },
    ],
    { 'p#x': { page: 'p', reading: 'x', firstSeen: 1, lastSeen: 3, checks: 1, maxLevel: 1 } }
  );
  const o = issueOutcomes(a);
  assert.deepEqual([o.unaided, o.helped, o.open], [1, 1, 1]);
  const s = disclosureSummary(a);
  assert.match(s, /Of 3 issues the tutor flagged, 1 was resolved on my own/);
  assert.match(s, /1 after more help \(1 with Show a similar example\)/);
  assert.match(s, /similar problems; it gave no steps of my problem/, 'describes the highest level actually used');
});

test('disclosure is honest about reveals above the level', () => {
  const s = disclosureSummary(assignment([{ t: 1, type: 'check', level: 1, overLevel: ['principle'] }]));
  assert.match(s, /reported revealing more than the selected level allows/);
  assert.doesNotMatch(disclosureSummary(assignment([{ t: 1, type: 'check', level: 1 }])), /more than the selected level/);
});
