import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortParam, supportsEffort } from './models.ts';

test('haiku 4.5 gets no effort parameter, the others do', () => {
  assert.equal(supportsEffort('claude-haiku-4-5'), false);
  assert.equal(supportsEffort('claude-haiku-4-5-20251001'), false);
  assert.equal(supportsEffort('claude-sonnet-5-5'), true);
  assert.equal(supportsEffort('claude-opus-5-5'), true);
  assert.deepEqual(effortParam('claude-haiku-4-5', 'low'), {});
  assert.deepEqual(effortParam('claude-sonnet-5-5', 'low'), { output_config: { effort: 'low' } });
});
