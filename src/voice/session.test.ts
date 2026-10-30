import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVoice, createSpeaker, needsBetterVoice, rankVoices, sentenceBackend, voiceTier, voiceTuning, withSpeechExposure, type VoiceInfo } from './session.ts';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A fake one-sentence voice: say() stays pending until the test finishes or stops it. */
function fakeVoice() {
  const spoken: string[] = [];
  let current: { text: string; resolve: (ok: boolean) => void } | null = null;
  let prepareGate: (() => void) | null = null;
  let holdPrepare = false;
  const v = {
    spoken,
    stops: 0,
    holdPrepare: () => (holdPrepare = true),
    releasePrepare: () => prepareGate?.(),
    current: () => current?.text,
    /** the sentence being said ends normally */
    finish: () => {
      const c = current;
      current = null;
      c?.resolve(true);
    },
    voice: {
      prepare: () => (holdPrepare ? new Promise<void>((r) => (prepareGate = r)) : Promise.resolve()),
      say: (text: string, onStart: () => void) =>
        new Promise<boolean>((resolve) => {
          spoken.push(text);
          onStart();
          current = { text, resolve };
        }),
      stop: () => {
        v.stops++;
        const c = current;
        current = null;
        c?.resolve(false);
      },
      pauseMs: 0,
      sleep: () => Promise.resolve(),
    },
  };
  return v;
}

test('sentences pushed while the reply streams are spoken in order', async () => {
  const f = fakeVoice();
  const sp = createSpeaker(() => backend);
  const backend = sentenceBackend(f.voice);
  let starts = 0;
  const u = sp.begin({ onStart: () => starts++ });
  u.push('First.');
  await tick();
  assert.equal(f.current(), 'First.');
  u.push('Second.');
  f.finish();
  await tick();
  await tick();
  assert.equal(f.current(), 'Second.');
  u.end();
  f.finish();
  await u.finished;
  assert.deepEqual(f.spoken, ['First.', 'Second.']);
  assert.equal(starts, 1);
  assert.equal(u.started(), true);
});

test('stop while the reply is still being fetched: nothing is ever spoken', async () => {
  const f = fakeVoice();
  const backend = sentenceBackend(f.voice);
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  sp.stopAll(); // Stop tapped while the provider call is in flight
  u.push('Late reply.');
  u.end();
  await u.finished;
  assert.deepEqual(f.spoken, []);
  assert.equal(u.live(), false);
  assert.equal(u.started(), false);
});

test('stop during speech ends it and drops queued sentences', async () => {
  const f = fakeVoice();
  const backend = sentenceBackend(f.voice);
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  u.push('One.');
  u.push('Two.');
  u.push('Three.');
  await tick();
  assert.equal(f.current(), 'One.');
  sp.stopAll();
  await u.finished;
  await tick();
  assert.deepEqual(f.spoken, ['One.']);
});

test('stop between sentences (during the pause) says nothing more', async () => {
  const f = fakeVoice();
  let wakePause: (() => void) | null = null;
  const backend = sentenceBackend({ ...f.voice, pauseMs: 200, sleep: () => new Promise<void>((r) => (wakePause = r)) });
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  u.push('One.');
  u.push('Two.');
  await tick();
  f.finish(); // "One." done; now waiting in the pause before "Two."
  await tick();
  await tick();
  assert.ok(wakePause, 'in the pause');
  sp.stopAll();
  wakePause!();
  await u.finished;
  assert.deepEqual(f.spoken, ['One.']);
});

test('stop while the voice is being prepared: the first sentence never starts', async () => {
  const f = fakeVoice();
  f.holdPrepare();
  const backend = sentenceBackend(f.voice);
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  u.push('One.');
  await tick();
  sp.stopAll();
  f.releasePrepare();
  await u.finished;
  assert.deepEqual(f.spoken, []);
});

test('interrupt (pen down, "your turn") between streamed sentences: later pushes are ignored', async () => {
  const f = fakeVoice();
  const backend = sentenceBackend(f.voice);
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  u.push('One.');
  await tick();
  f.finish();
  await tick();
  sp.interrupt();
  u.push('Two.'); // streamed in after the interrupt
  u.end();
  await u.finished;
  assert.deepEqual(f.spoken, ['One.']);
  // interrupt does not bump the stop epoch (listening that is starting is unaffected)
  assert.equal(sp.epoch(), 0);
});

test('a new utterance supersedes the old one: two replies never talk over each other', async () => {
  const f = fakeVoice();
  const backend = sentenceBackend(f.voice);
  const sp = createSpeaker(() => backend);
  const a = sp.begin();
  a.push('Old one.');
  a.push('Old two.');
  await tick();
  const b = sp.begin();
  b.push('New one.');
  b.end();
  await a.finished;
  await tick();
  f.finish();
  await b.finished;
  assert.deepEqual(f.spoken, ['Old one.', 'New one.']);
  assert.equal(a.live(), false);
});

test('an utterance ended with nothing to say finishes at once', async () => {
  const f = fakeVoice();
  const sp = createSpeaker(() => sentenceBackend(f.voice));
  const u = sp.begin();
  u.push('   ');
  u.end();
  await u.finished;
  assert.deepEqual(f.spoken, []);
});

test('a sentence the voice never finishes is still ended by stop (expo-speech may not report onStopped)', async () => {
  const f = fakeVoice();
  const backend = sentenceBackend({ ...f.voice, stop: () => {} }); // stop() reports nothing back
  const sp = createSpeaker(() => backend);
  const u = sp.begin();
  u.push('Hangs.');
  await tick();
  sp.stopAll();
  await u.finished; // would hang without the backend's own pending resolver
  assert.deepEqual(f.spoken, ['Hangs.']);
});

// ---------------------------------------------------------------- voices

const V = (identifier: string, name: string, language = 'en-US', quality = 'Default'): VoiceInfo => ({ identifier, name, language, quality });

test('premium voices are found by identifier, though expo-speech reports them as Default', () => {
  assert.equal(voiceTier(V('com.apple.voice.premium.en-US.Ava', 'Ava')), 3);
  assert.equal(voiceTier(V('com.apple.voice.enhanced.en-US.Evan', 'Evan')), 2);
  assert.equal(voiceTier(V('x', 'Evan', 'en-US', 'Enhanced')), 2);
  assert.equal(voiceTier(V('com.apple.voice.compact.en-US.Samantha', 'Samantha')), 1);
  assert.equal(voiceTier(V('com.apple.eloquence.en-US.Rocko', 'Rocko')), 0);
  assert.equal(voiceTier(V('com.apple.speech.synthesis.voice.Bahh', 'Bahh')), 0);
});

test('ranking: premium > enhanced > compact, en-US first, preferred names, English only, no novelty', () => {
  const voices = [
    V('com.apple.voice.compact.en-US.Samantha', 'Samantha'),
    V('com.apple.voice.enhanced.en-GB.Serena', 'Serena', 'en-GB'),
    V('com.apple.voice.enhanced.en-US.Evan', 'Evan'),
    V('com.apple.voice.premium.en-US.Zoe', 'Zoe'),
    V('com.apple.voice.premium.en-US.Ava', 'Ava'),
    V('com.apple.voice.premium.fr-FR.Audrey', 'Audrey', 'fr-FR'),
    V('com.apple.eloquence.en-US.Rocko', 'Rocko'),
  ];
  assert.deepEqual(
    rankVoices(voices).map((v) => v.name),
    ['Ava', 'Zoe', 'Evan', 'Serena', 'Samantha']
  );
  assert.equal(chooseVoice(voices)?.name, 'Ava');
  assert.equal(needsBetterVoice(voices), false);
  assert.equal(needsBetterVoice([V('com.apple.voice.compact.en-US.Samantha', 'Samantha')]), true);
});

test('the saved pick wins while installed; a deleted download falls back to the best voice', () => {
  const voices = [V('com.apple.voice.premium.en-US.Ava', 'Ava'), V('com.apple.voice.enhanced.en-US.Evan', 'Evan')];
  assert.equal(chooseVoice(voices, 'com.apple.voice.enhanced.en-US.Evan')?.name, 'Evan');
  assert.equal(chooseVoice(voices, 'com.apple.voice.premium.en-US.Zoe')?.name, 'Ava');
  assert.equal(chooseVoice([], 'anything'), undefined);
});

test('compact voices are slowed a little; premium voices speak at normal rate', () => {
  assert.equal(voiceTuning(V('com.apple.voice.premium.en-US.Ava', 'Ava')).rate, 1);
  assert.ok(voiceTuning(V('com.apple.voice.compact.en-US.Samantha', 'Samantha')).rate < 1);
  assert.ok(voiceTuning(undefined).rate < 1);
});

// ---------------------------------------------------------------- exposure

test('speech exposure is added to the recorded help only once, and only to that help', () => {
  const ep = {
    updatedAt: 10,
    assistance: [
      { id: 'h1', channels: ['text'] },
      { id: 'h2', channels: ['text', 'marks'] },
    ],
  };
  const a = withSpeechExposure(ep, 'h2', 20);
  assert.deepEqual(a.assistance[1].channels, ['text', 'marks', 'speech']);
  assert.deepEqual(a.assistance[0].channels, ['text']);
  assert.equal(a.updatedAt, 20);
  assert.equal(withSpeechExposure(a, 'h2', 30), a);
  assert.equal(withSpeechExposure(ep, 'missing', 30), ep);
});
