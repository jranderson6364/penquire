import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuModel } from './menu.ts';
import { flatten } from './flatten.ts';
import type { ProblemGroup } from './types.ts';

const g = (label: string, parts: string[], title = ''): ProblemGroup => ({
  label,
  title,
  context: `Setup for problem ${label} with $x^2$ in it.`,
  parts: parts.map((p) => ({ label: p, text: `Part ${p}.`, asksFor: [], subparts: [] })),
  asksFor: [],
});

test('one row per problem, parts as chips, labels the app keys on', () => {
  const groups = [g('1', ['a', 'b', 'c'], 'Ramp'), g('2', [])];
  const rows = menuModel(groups, flatten(groups));
  assert.deepEqual(
    rows.map((r) => [r.label, r.title, r.items.map((i) => `${i.short}:${i.flat}`)]),
    [
      ['1', 'Ramp', ['a:1a', 'b:1b', 'c:1c']],
      ['2', 'Setup for problem 2 with … in it.', ['2:2']],
    ]
  );
});

test('only parts the tutor knows are offered (an "only these problems" filter)', () => {
  const groups = [g('1', ['a', 'b']), g('2', ['a'])];
  const rows = menuModel(groups, flatten(groups).filter((p) => p.label !== '1b' && !p.label.startsWith('2')));
  assert.deepEqual(rows.map((r) => r.items.map((i) => i.flat)), [['1a']]);
});

test('without groups, each flat problem is a row', () => {
  const rows = menuModel(undefined, [{ label: '3.10', text: 'A long problem statement '.repeat(10), asksFor: [] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].items[0].flat, '3.10');
  assert.ok(rows[0].title.length <= 64);
});
