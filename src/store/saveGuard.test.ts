import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientViewError, mayAutosave, withViewRetry } from './saveGuard.ts';

const noSleep = async () => {};

test('which errors are transient view races', () => {
  assert.equal(isTransientViewError(new Error("ViewNotFound<UIView>: Unable to find the 'PencilCanvasView' view with tag '164'")), true);
  assert.equal(isTransientViewError(new Error('canvas not mounted yet')), true);
  assert.equal(isTransientViewError('Unable to find the PencilCanvasView view'), true);
  assert.equal(isTransientViewError(new Error('The saved drawing could not be decoded')), false);
  assert.equal(isTransientViewError(new TypeError('undefined is not a function')), false);
});

test('autosave rule: loaded page yes, new page yes, unloaded page with stored work NO', () => {
  assert.equal(mayAutosave({ loadedPageId: 'p1', pageId: 'p1', savedDrawing: 'AAAA' }), true);
  assert.equal(mayAutosave({ loadedPageId: '', pageId: 'p1', savedDrawing: '' }), true); // brand new page, nothing to destroy
  assert.equal(mayAutosave({ loadedPageId: '', pageId: 'p1', savedDrawing: 'AAAA' }), false); // would erase real work
  assert.equal(mayAutosave({ loadedPageId: 'p0', pageId: 'p1', savedDrawing: 'AAAA' }), false); // loaded a different page
  assert.equal(mayAutosave({ loadedPageId: 'p1', pageId: '', savedDrawing: '' }), false);
});

test('retries through a transient race and returns the value', async () => {
  let calls = 0;
  const out = await withViewRetry(
    async () => {
      calls++;
      if (calls < 4) throw new Error("ViewNotFound: Unable to find the 'PencilCanvasView' view");
      return 'loaded';
    },
    { sleep: noSleep }
  );
  assert.equal(out, 'loaded');
  assert.equal(calls, 4);
});

test('a real failure is thrown immediately, once', async () => {
  let calls = 0;
  await assert.rejects(withViewRetry(async () => { calls++; throw new Error('The saved drawing could not be decoded'); }, { sleep: noSleep }), /decoded/);
  assert.equal(calls, 1);
});

test('gives up after the retry budget with the last transient error', async () => {
  let calls = 0;
  await assert.rejects(withViewRetry(async () => { calls++; throw new Error('ViewNotFound x'); }, { tries: 5, sleep: noSleep }), /ViewNotFound/);
  assert.equal(calls, 5);
});

test('stops retrying when cancelled (screen closed or page switched)', async () => {
  let calls = 0;
  let cancelled = false;
  await assert.rejects(
    withViewRetry(async () => { calls++; cancelled = true; throw new Error('ViewNotFound x'); }, { sleep: noSleep, isCancelled: () => cancelled }),
    /cancelled/
  );
  assert.equal(calls, 1);
});
