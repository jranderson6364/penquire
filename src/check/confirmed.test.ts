import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmReading, confirmedFor } from './confirmed.ts';
import { applyReadingGuard } from '../verify/guard.ts';

test('a confirmed reading follows the ink, under the current line id', () => {
  const map = confirmReading(undefined, 'sigA', ' 2x = 10 ');
  const { input, kept } = confirmedFor(map, [
    { id: 'L1', sig: 'sigZ' },
    { id: 'L2', sig: 'sigA' },
  ]);
  assert.deepEqual(input, [{ id: 'L2', reading: '2x = 10' }]);
  assert.deepEqual(kept, { sigA: '2x = 10' });
});

test('rewritten ink drops its confirmation', () => {
  const map = confirmReading(undefined, 'sigA', 'x = 2');
  assert.deepEqual(confirmedFor(map, [{ id: 'L1', sig: 'sigB' }]), { input: [], kept: {} });
});

test('no signature or empty reading confirms nothing; readings are capped', () => {
  assert.deepEqual(confirmReading({}, undefined, 'x'), {});
  assert.deepEqual(confirmReading({}, 's', '   '), {});
  assert.equal(confirmReading({}, 's', 'x'.repeat(500)).s.length, 200);
});

test('the reading guard does not re-ask a line the student confirmed', () => {
  const line = { id: 'L2', reading: '2x=10', verdict: 'incorrect' as const, note: '', readConfidence: 'low' as const };
  assert.equal(applyReadingGuard([line], new Set(['L2']))[0].verdict, 'incorrect');
  assert.equal(applyReadingGuard([line])[0].verdict, 'unreadable');
});
