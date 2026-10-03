import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyParse } from './parseApply.ts';
import type { Assignment } from './types';
import type { ParseResult } from '../ai/types';

const base = (): Assignment => ({
  id: 'a1',
  title: 'T',
  course: '',
  policy: '',
  policyMaxLevel: 2,
  helpLevel: 1,
  style: '',
  problems: [{ label: 'old', text: 'old', asksFor: [] }],
  pageIds: ['p1'],
  chat: [],
  checks: {},
  events: [],
  ladder: { 'stale|key': 3 },
  createdAt: 1,
  updatedAt: 1,
});

const parsed: ParseResult = {
  course: 'PHYS',
  problems: [],
  notes: ['read chapter 2'],
  issues: [{ severity: 'warn', code: 'latex', problem: '1', message: 'm' }],
  groups: [
    { label: '1', context: 'setup', parts: [{ label: 'a', text: 'A?', asksFor: [], subparts: [] }, { label: 'b', text: 'B?', asksFor: [], subparts: [] }], asksFor: [] },
    { label: '2', context: 'just a task', parts: [], asksFor: ['value'] },
  ],
};

test('a structured parse sets groups, flat problems, notes, issues, course, and clears stale ladder entries', () => {
  const a = applyParse(base(), parsed, { pages: '80-82' });
  assert.deepEqual(a.problems.map((p) => p.label), ['1a', '1b', '2']);
  assert.equal(a.groups?.length, 2);
  assert.deepEqual(a.notes, ['read chapter 2']);
  assert.equal(a.parseIssues?.length, 1);
  assert.equal(a.course, 'PHYS');
  assert.equal(a.sourcePages, '80-82');
  assert.deepEqual(a.ladder, {});
  assert.match(a.events[a.events.length - 1].detail ?? '', /2 problems, 3 parts \(pages 80-82\)/);
});

test('an existing course name is kept; a flat-only result still works', () => {
  const flatOnly: ParseResult = { problems: [{ label: '3a', text: 't', asksFor: [] }] };
  const a = applyParse({ ...base(), course: 'MINE' }, flatOnly);
  assert.equal(a.course, 'MINE');
  assert.equal(a.groups, undefined);
  assert.deepEqual(a.problems.map((p) => p.label), ['3a']);
});

test('re-parse without a page range keeps the remembered range', () => {
  const a = applyParse({ ...base(), sourcePages: '10-12' }, parsed);
  assert.equal(a.sourcePages, '10-12');
});
