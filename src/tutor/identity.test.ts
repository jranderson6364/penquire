import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalate, issueKey, legacyIssueKey, pruneLadder, renameLadderKeys, rungFor } from './ladder.ts';
import { recordCheck, renameIssueKeys } from './issues.ts';

test('the same ink read two different ways is the same issue', () => {
  assert.equal(issueKey('1a', '2x = 10', 'sigA'), issueKey('1a', '2x = 1O', 'sigA'));
  assert.notEqual(issueKey('1a', '2x = 10', 'sigA'), issueKey('1a', '2x = 10', 'sigB'));
});

test('without a signature the key falls back to the reading', () => {
  assert.equal(issueKey('1a', '2x = 10'), legacyIssueKey('1a', '2x=10'));
});

test('a re-read of unchanged ink keeps the rung and logs no resolution', () => {
  const k1 = issueKey('1a', '2x = 10', 'sigA');
  const esc = escalate({}, k1, 1, 3);
  const round1 = recordCheck({}, 'p1', [{ key: k1, part: '1a', reading: '2x = 10', level: esc.level }], 1);
  // Next check: the model now reads the same strokes as "2x = 1O".
  const k2 = issueKey('1a', '2x = 1O', 'sigA');
  const ladder = pruneLadder(esc.ladder, [k2]);
  assert.equal(rungFor(ladder, k2, 1, 3), 2);
  const round2 = recordCheck(round1.issues, 'p1', [{ key: k2, part: '1a', reading: '2x = 1O', level: 2 }], 2);
  assert.equal(round2.resolved.length, 0);
});

test('stored reading-keyed rungs and records migrate to the ink key without a false resolution', () => {
  const old = legacyIssueKey('1a', '2x = 10');
  const ink = issueKey('1a', '2x = 10', 'sigA');
  const ladder = renameLadderKeys({ [old]: 2, other: 1 }, [[old, ink]]);
  assert.deepEqual(ladder, { other: 1, [ink]: 2 });
  const before = recordCheck({}, 'p1', [{ key: old, part: '1a', reading: '2x = 10', level: 2 }], 1).issues;
  const migrated = renameIssueKeys(before, 'p1', [[old, ink]]);
  const after = recordCheck(migrated, 'p1', [{ key: ink, part: '1a', reading: '2x = 10', level: 2 }], 2);
  assert.equal(after.resolved.length, 0);
  assert.equal(Object.values(after.issues)[0].checks, 2);
});

test('a rung already on the new key wins over a migrated one', () => {
  assert.deepEqual(renameLadderKeys({ a: 1, b: 3 }, [['a', 'b']]), { b: 3 });
});

test('an issue on unchanged ink that is no longer flagged is withdrawn by the tutor, not resolved by the student', async () => {
  const { recordCheck } = await import('./issues.ts');
  const r1 = recordCheck({}, 'p1', [{ key: 'k1', part: '1a', reading: '2x=10', level: 1, sig: 'sigA' }, { key: 'k2', part: '1a', reading: 'y=3', level: 1, sig: 'sigB' }], 1);
  // next check: sigA is still on the page but no longer flagged (re-check conceded); sigB's ink was rewritten
  const r2 = recordCheck(r1.issues, 'p1', [], 2, new Set(['sigA', 'sigC']));
  assert.deepEqual(r2.withdrawn.map((w) => w.key), ['p1#k1']);
  assert.deepEqual(r2.resolved.map((w) => w.key), ['p1#k2']);
  assert.deepEqual(r2.issues, {});
});

test('disclosure counts withdrawn flags apart from issues the student resolved', async () => {
  const { disclosureSummary, issueOutcomes } = await import('../log.ts');
  const a = {
    title: 'PS1', course: '', events: [
      { t: 1, type: 'check', level: 1 },
      { t: 2, type: 'resolved', level: 1 },
      { t: 2, type: 'withdrawn', level: 1 },
    ], issues: {},
  } as never;
  assert.equal(issueOutcomes(a).unaided, 1);
  assert.equal(issueOutcomes(a).withdrawn, 1);
  const s = disclosureSummary(a);
  assert.match(s, /Of 1 issue the tutor flagged, 1 was resolved on my own/);
  assert.match(s, /withdrew 1 flag on work I had not changed/);
});
