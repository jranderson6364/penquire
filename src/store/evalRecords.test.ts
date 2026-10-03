import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, emptyEvalStore, feedbackFor, feedbackStats, upsertFeedback, type CheckSnapshot } from './evalRecords.ts';

const snap = (checkId: string, image: string | null = `${checkId}.png`): CheckSnapshot => ({
  checkId,
  checkedAt: 1,
  assignmentId: 'a1',
  course: 'PHYSICS 61',
  assignmentTitle: 'PS3',
  policy: 'Socratic only',
  helpLevel: 1,
  problems: [],
  page: 1,
  model: 'm',
  lines: [{ id: 'L1', x: 0, y: 0, w: 10, h: 10 }],
  verdicts: [{ id: 'L1', reading: 'x=1', verdict: 'valid', note: 'ok' }],
  image,
});

test('upsert adds the snapshot once and replaces a rating for the same mark', () => {
  let s = emptyEvalStore();
  s = upsertFeedback(s, snap('c1'), { checkId: 'c1', lineId: 'L1', at: 1, rating: 'up' });
  s = upsertFeedback(s, snap('c1'), { checkId: 'c1', lineId: 'L1', at: 2, rating: 'wrong', correctVerdict: 'incorrect' });
  s = upsertFeedback(s, snap('c1'), { checkId: 'c1', lineId: 'L2', at: 3, rating: 'down' });
  assert.equal(s.checks.length, 1);
  assert.equal(s.feedback.length, 2);
  assert.equal(feedbackFor(s, 'c1', 'L1')?.correctVerdict, 'incorrect');
  assert.deepEqual(feedbackStats(s), { ratings: 2, checks: 1, wrong: 1 });
});

test('upsert does not mutate the input store', () => {
  const s0 = emptyEvalStore();
  upsertFeedback(s0, snap('c1'), { checkId: 'c1', lineId: 'L1', at: 1, rating: 'up' });
  assert.equal(s0.checks.length, 0);
  assert.equal(s0.feedback.length, 0);
});

test('export includes only rated checks, with images and their ratings', () => {
  let s = emptyEvalStore();
  s = upsertFeedback(s, snap('c1'), { checkId: 'c1', lineId: 'L1', at: 1, rating: 'misread', correctReading: 'x=2' });
  s = upsertFeedback(s, snap('c2', null), { checkId: 'c2', lineId: 'L1', at: 2, rating: 'up' });
  s = { ...s, checks: [...s.checks, snap('c3')] }; // snapshot with no ratings
  const out = buildExport(s, (name) => (name === 'c1.png' ? 'BASE64' : null), 0);
  assert.equal(out.format, 'penquire-evals');
  assert.equal(out.exportedAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(out.checks.map((c) => c.checkId), ['c1', 'c2']);
  assert.equal(out.checks[0].imageBase64, 'BASE64');
  assert.equal(out.checks[1].imageBase64, null);
  assert.equal(out.checks[0].feedback[0].correctReading, 'x=2');
});
