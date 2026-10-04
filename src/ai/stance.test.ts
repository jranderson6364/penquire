import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUTOR_RULES } from './prompts.ts';

// A cheap guard: the "verify, don't audit" stance was measured (evals-private/check) to take needless questions on
// fully-correct pages from 6/6 to 0/8 without losing a single caught mistake. Edits to the rules must not drop it silently.
test('the tutor rules keep the verify-not-audit stance', () => {
  assert.match(TUTOR_RULES, /VERIFY, DON'T AUDIT/);
  assert.match(TUTOR_RULES, /Mental arithmetic, routine algebra/);
  assert.match(TUTOR_RULES, /leave the question empty/);
  assert.match(TUTOR_RULES, /Do not turn a correct page into a quiz/);
});

test('the stance still demands shown work when the problem asks for it', () => {
  assert.match(TUTOR_RULES, /the problem itself asks for it \("show", "derive", "justify"/);
});
