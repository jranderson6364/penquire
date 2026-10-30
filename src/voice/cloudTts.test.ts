import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudTts, ELEVENLABS_MODEL, type CloudTtsDeps, type TtsPlayer } from './cloudTts.ts';

const KEY = 'sk_test_secret_value_123';

type Call = { url: string; init: RequestInit };

/** fetch that answers each sentence after `delay` ms; `fail` decides per text what goes wrong */
function fakeFetch(opts: { delay?: number; fail?: (text: string) => 'http' | 'network' | 'hang' | 'empty' | null } = {}) {
  const calls: Call[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const text = JSON.parse(String(init.body)).text as string;
    const mode = opts.fail?.(text) ?? null;
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal as AbortSignal;
      const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
      if (mode === 'hang') return;
      setTimeout(() => {
        if (mode === 'network') return reject(new TypeError('Network request failed'));
        if (mode === 'http') return resolve(new Response('{"detail":"quota"}', { status: 401 }));
        resolve(new Response(mode === 'empty' ? new Uint8Array(0) : new TextEncoder().encode(`mp3:${text}`), { status: 200 }));
      }, opts.delay ?? 1);
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function fakePlayer(playMs = 5, opts: { failOn?: string } = {}) {
  const played: string[] = [];
  let stops = 0;
  let pending: (() => void) | null = null;
  const player: TtsPlayer = {
    play(audio) {
      const text = new TextDecoder().decode(audio).replace(/^mp3:/, '');
      if (text === opts.failOn) return Promise.reject(new Error('cannot play'));
      return new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          pending = null;
          played.push(text);
          resolve();
        }, playMs);
        pending = () => {
          clearTimeout(t);
          resolve();
        };
      });
    },
    stop() {
      stops++;
      pending?.();
      pending = null;
    },
  };
  return { player, played, stops: () => stops };
}

function deps(over: Partial<CloudTtsDeps> = {}) {
  const apple: string[] = [];
  const reasons: string[] = [];
  const d: CloudTtsDeps = {
    apiKey: KEY,
    fetch: fakeFetch().fn,
    player: fakePlayer().player,
    fallback: async (s) => {
      apple.push(s);
    },
    onFallback: (r) => reasons.push(r),
    timeoutMs: 50,
    ...over,
  };
  return { d, apple, reasons };
}

test('speaks every sentence with the cloud voice, in order, with Flash v2.5', async () => {
  const f = fakeFetch();
  const p = fakePlayer();
  const { d, apple } = deps({ fetch: f.fn, player: p.player });
  const seen: number[] = [];
  const r = await createCloudTts(d).speak(['First.', 'Second.', 'Third.'], { onSentence: (i) => seen.push(i) });
  assert.deepEqual(r, { completed: true, fellBack: null });
  assert.deepEqual(p.played, ['First.', 'Second.', 'Third.']);
  assert.deepEqual(apple, []);
  assert.deepEqual(seen, [0, 1, 2]);
  const body = JSON.parse(String(f.calls[1].init.body));
  assert.equal(body.model_id, ELEVENLABS_MODEL);
  assert.equal(body.previous_text, 'First.');
  assert.match(f.calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/[^/]+\/stream\?/);
  assert.equal((f.calls[0].init.headers as Record<string, string>)['xi-api-key'], KEY);
});

test('prefetches the next sentence while the current one plays', async () => {
  const f = fakeFetch({ delay: 1 });
  const p = fakePlayer(30);
  const { d } = deps({ fetch: f.fn, player: p.player });
  const tts = createCloudTts(d);
  const done = tts.speak(['One.', 'Two.']);
  await new Promise((r) => setTimeout(r, 15)); // first sentence is playing
  assert.equal(f.calls.length, 2);
  assert.deepEqual(p.played, []);
  await done;
});

test('accepts sentences that arrive one at a time while the reply streams', async () => {
  async function* stream() {
    yield 'Look at line two.';
    await new Promise((r) => setTimeout(r, 10));
    yield '';
    yield 'What happens to the minus sign?';
  }
  const p = fakePlayer(1);
  const { d } = deps({ player: p.player });
  await createCloudTts(d).speak(stream());
  assert.deepEqual(p.played, ['Look at line two.', 'What happens to the minus sign?']);
});

test('no key or no player: the Apple voice says everything, with a reason', async () => {
  const f = fakeFetch();
  for (const over of [{ apiKey: undefined }, { player: null }] as Partial<CloudTtsDeps>[]) {
    const { d, apple, reasons } = deps({ fetch: f.fn, ...over });
    const r = await createCloudTts(d).speak(['A.', 'B.']);
    assert.deepEqual(apple, ['A.', 'B.']);
    assert.equal(r.fellBack, over.apiKey === undefined && 'apiKey' in over ? 'no_key' : 'no_player');
    assert.equal(reasons.length, 1);
  }
  assert.equal(f.calls.length, 0);
});

for (const [mode, reason] of [
  ['http', 'http_error'],
  ['network', 'network'],
  ['hang', 'timeout'],
  ['empty', 'empty_audio'],
] as const) {
  test(`${mode} on the second sentence: the rest of the reply falls back to the Apple voice (${reason})`, async () => {
    const f = fakeFetch({ fail: (t) => (t === 'Two.' ? mode : null) });
    const p = fakePlayer(1);
    const { d, apple, reasons } = deps({ fetch: f.fn, player: p.player });
    const r = await createCloudTts(d).speak(['One.', 'Two.', 'Three.']);
    assert.deepEqual(p.played, ['One.']);
    assert.deepEqual(apple, ['Two.', 'Three.']);
    assert.equal(r.fellBack, reason);
    assert.deepEqual(reasons, [reason]);
    assert.equal(r.completed, true);
  });
}

test('a sentence the player cannot play is said by the Apple voice', async () => {
  const p = fakePlayer(1, { failOn: 'One.' });
  const { d, apple } = deps({ player: p.player });
  const r = await createCloudTts(d).speak(['One.', 'Two.']);
  assert.deepEqual(apple, ['One.', 'Two.']);
  assert.equal(r.fellBack, 'play_failed');
});

test('stop during the fetch: nothing plays, the request is aborted', async () => {
  const f = fakeFetch({ fail: () => 'hang' });
  const p = fakePlayer();
  let fallbackStops = 0;
  const { d, apple } = deps({ fetch: f.fn, player: p.player, timeoutMs: 5000, stopFallback: () => fallbackStops++ });
  const tts = createCloudTts(d);
  const done = tts.speak(['One.', 'Two.']);
  await new Promise((r) => setTimeout(r, 5));
  tts.stop();
  const r = await done;
  assert.equal(r.completed, false);
  assert.deepEqual(p.played, []);
  assert.deepEqual(apple, []);
  assert.ok((f.calls[0].init.signal as AbortSignal).aborted);
  assert.ok(fallbackStops >= 1);
});

test('stop while a sentence plays: playback stops and later sentences never play', async () => {
  const p = fakePlayer(40);
  const { d, apple } = deps({ player: p.player });
  const tts = createCloudTts(d);
  const done = tts.speak(['One.', 'Two.', 'Three.']);
  await new Promise((r) => setTimeout(r, 15));
  tts.stop();
  const r = await done;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(r.completed, false);
  assert.deepEqual(p.played, []);
  assert.deepEqual(apple, []);
  assert.ok(p.stops() >= 2);
});

test('stop between streamed sentences: a late sentence is never fetched or spoken', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  async function* stream() {
    yield 'One.';
    await gate;
    yield 'Late.';
  }
  const f = fakeFetch();
  const p = fakePlayer(1);
  const { d, apple } = deps({ fetch: f.fn, player: p.player });
  const tts = createCloudTts(d);
  const done = tts.speak(stream());
  await new Promise((r) => setTimeout(r, 20));
  tts.stop();
  release();
  await done;
  assert.deepEqual(p.played, ['One.']);
  assert.deepEqual(apple, []);
  assert.equal(f.calls.length, 1);
});

test('a new speak() stops the previous reply', async () => {
  const p = fakePlayer(20);
  const { d } = deps({ player: p.player });
  const tts = createCloudTts(d);
  const first = tts.speak(['Old one.', 'Old two.']);
  await new Promise((r) => setTimeout(r, 5));
  const second = tts.speak(['New.']);
  assert.equal((await first).completed, false);
  assert.equal((await second).completed, true);
  assert.deepEqual(p.played, ['New.']);
});

test('the key never appears in a fallback reason, even when the server echoes it', async () => {
  const echo = ((_url: string, init: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ detail: `bad key ${(init.headers as Record<string, string>)['xi-api-key']}` }), { status: 401 }))) as unknown as typeof fetch;
  const logged: string[] = [];
  const origWarn = console.warn;
  const origLog = console.log;
  const origErr = console.error;
  console.warn = console.log = console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    const statuses: (number | undefined)[] = [];
    const { d, reasons } = deps({ fetch: echo, onFallback: (r, st) => (reasons.push(r), statuses.push(st)) });
    const r = await createCloudTts(d).speak(['One.']);
    const out = JSON.stringify({ r, reasons, logged });
    assert.ok(!out.includes(KEY));
    assert.equal(r.fellBack, 'http_error');
    assert.deepEqual(statuses, [401]);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    console.error = origErr;
  }
});
