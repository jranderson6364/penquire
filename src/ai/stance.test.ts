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

// T15: the projectile demo asks for a sketch and must show that asking for the answer doesn't get it.
test('a drawing is context, never graded or unreadable, and never holds back complete', () => {
  assert.match(TUTOR_RULES, /Drawings: a sketch or diagram/);
  assert.match(TUTOR_RULES, /verdict "context", read_confidence "high"/);
  assert.match(TUTOR_RULES, /Never mark a drawing unreadable, partial or incorrect/);
  assert.match(TUTOR_RULES, /never hold a part back from "complete" because of it/);
});

test('"just tell me the answer" gets a short reason and a pointer, never the answer', () => {
  assert.match(TUTOR_RULES, /"Just tell me the answer": never state it/);
  assert.match(TUTOR_RULES, /one-clause reason/);
  assert.match(TUTOR_RULES, /circled spot where their work goes wrong and a question about what it means/);
});

test('ask before you tell: the first move on an issue is a question about what the piece means, not the verdict', () => {
  assert.match(TUTOR_RULES, /ASK BEFORE YOU TELL/);
  assert.match(TUTOR_RULES, /never the diagnosis/);
});

test('any consistent sign convention or origin is accepted; signs are judged against the student\'s own choice', () => {
  assert.match(TUTOR_RULES, /Sign conventions and origins are the student's choice/);
  assert.match(TUTOR_RULES, /check the line against THAT convention/);
});
