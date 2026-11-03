import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_UPLOAD_MS,
  SCRIBE_MODEL,
  SCRIBE_URL,
  scribeText,
  createCloudStt,
  createRecording,
  finalTranscript,
  recordingSuspect,
  scribeFields,
  sttLogLine,
  type CloudSttDeps,
  type SttOutcome,
} from './cloudStt.ts';

const KEY = 'sk_test_secret_value_123';
const FILE = 'file:///var/mobile/Library/Caches/recording_ABC.wav';

type Mode = 'ok' | 'http' | 'network' | 'hang' | 'empty' | 'blank' | 'badjson' | 'notext';

/** fetch that answers after `delay` ms in the given mode; records each call */
function fakeFetch(mode: Mode, text = 'subtract eight from both sides', delay = 1) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal as AbortSignal;
      const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
      if (mode === 'hang') return;
      setTimeout(() => {
        if (mode === 'network') return reject(new TypeError('Network request failed'));
        if (mode === 'http') return resolve(new Response('{"detail":{"status":"invalid_api_key"}}', { status: 401 }));
        if (mode === 'badjson') return resolve(new Response('not json', { status: 200 }));
        if (mode === 'notext') return resolve(new Response('{"words":[]}', { status: 200 }));
        if (mode === 'blank')
          return resolve(new Response(JSON.stringify({ text: ' (silence) ', words: [{ text: '(silence)', type: 'audio_event' }] }), { status: 200 }));
        resolve(new Response(JSON.stringify({ language_code: 'en', text: mode === 'empty' ? '' : text, words: [] }), { status: 200 }));
      }, delay);
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function stt(mode: Mode, extra: Partial<CloudSttDeps> = {}) {
  const f = fakeFetch(mode);
  const bodies: { uri: string; fields: Record<string, string> }[] = [];
  const s = createCloudStt({
    apiKey: KEY,
    fetch: f.fn,
    body: (uri, fields) => {
      bodies.push({ uri, fields });
      return 'multipart';
    },
    ...extra,
  });
  return { s, calls: f.calls, bodies };
}

const allText = (o: SttOutcome) => JSON.stringify(o) + sttLogLine(o);

test('Scribe request: POST to the speech-to-text endpoint, key in the xi-api-key header only, scribe_v2 and the file', async () => {
  const { s, calls, bodies } = stt('ok');
  const r = await s.transcribe(FILE, { timeoutMs: 3000 });
  assert.deepEqual(r.ok && r.text, 'subtract eight from both sides');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SCRIBE_URL);
  assert.ok(!calls[0].url.includes(KEY));
  assert.equal(calls[0].init.method, 'POST');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['xi-api-key'], KEY);
  assert.ok(!('Content-Type' in headers), 'fetch sets the multipart boundary itself');
  assert.equal(bodies[0].uri, FILE);
  assert.equal(bodies[0].fields.model_id, SCRIBE_MODEL);
  assert.equal(SCRIBE_MODEL, 'scribe_v2');
  assert.deepEqual(scribeFields(), { model_id: 'scribe_v2', language_code: 'en', tag_audio_events: 'false' });
});

test('falls back on an HTTP error, with the status and never the key', async () => {
  const { s } = stt('http');
  const r = await s.transcribe(FILE, { timeoutMs: 3000 });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'http_error');
  assert.equal(!r.ok && r.status, 401);
  assert.ok(sttLogLine(r).includes('stt fell back to Apple: http_error 401'));
  assert.ok(!allText(r).includes(KEY));
});

test('falls back on a network error', async () => {
  const r = await stt('network').s.transcribe(FILE, { timeoutMs: 3000 });
  assert.equal(!r.ok && r.reason, 'network');
  assert.ok(!allText(r).includes(KEY));
});

test('a hung request times out within the budget, as "timeout" not "network"', async () => {
  const t0 = Date.now();
  const r = await stt('hang').s.transcribe(FILE, { timeoutMs: 600 });
  const took = Date.now() - t0;
  assert.equal(!r.ok && r.reason, 'timeout');
  assert.ok(took >= 550 && took < 1500, `took ${took} ms`);
  assert.ok(!allText(r).includes(KEY));
});

test('empty, silence-only and malformed results fall back', async () => {
  assert.equal((await stt('empty').s.transcribe(FILE, { timeoutMs: 3000 }) as { reason?: string }).reason, 'empty_text');
  assert.equal((await stt('blank').s.transcribe(FILE, { timeoutMs: 3000 }) as { reason?: string }).reason, 'empty_text');
  assert.equal((await stt('badjson').s.transcribe(FILE, { timeoutMs: 3000 }) as { reason?: string }).reason, 'bad_response');
  assert.equal((await stt('notext').s.transcribe(FILE, { timeoutMs: 3000 }) as { reason?: string }).reason, 'bad_response');
});

test('no key, no file or too little time left: no request at all', async () => {
  const noKey = stt('ok', { apiKey: undefined });
  assert.equal((await noKey.s.transcribe(FILE, { timeoutMs: 3000 }) as { reason?: string }).reason, 'no_key');
  const t = stt('ok');
  assert.equal((await t.s.transcribe('', { timeoutMs: 3000 }) as { reason?: string }).reason, 'no_file');
  assert.equal((await t.s.transcribe(FILE, { timeoutMs: MIN_UPLOAD_MS - 1 }) as { reason?: string }).reason, 'no_time');
  assert.equal(noKey.calls.length + t.calls.length, 0);
});

test('Stop during the upload aborts it: "cancelled"', async () => {
  const { s } = stt('hang');
  const c = new AbortController();
  const p = s.transcribe(FILE, { timeoutMs: 3000, signal: c.signal });
  setTimeout(() => c.abort(), 20);
  const r = await p;
  assert.equal(!r.ok && r.reason, 'cancelled');
});

test('the key never appears in any fallback reason or log line', async () => {
  for (const mode of ['http', 'network', 'empty', 'badjson', 'notext'] as Mode[]) {
    const r = await stt(mode).s.transcribe(FILE, { timeoutMs: 3000 });
    assert.ok(!allText(r).includes(KEY), mode);
    assert.ok(!allText(r).includes('sk_'), mode);
  }
});

test("finalTranscript uses Scribe's text, and Apple's on any failure", async () => {
  const ok = await finalTranscript(stt('ok').s, { apple: 'subtract a from both sides', file: { uri: FILE }, remainingMs: 3000 });
  assert.equal(ok.source, 'scribe');
  assert.equal(ok.text, 'subtract eight from both sides');
  for (const mode of ['http', 'network', 'empty'] as Mode[]) {
    const r = await finalTranscript(stt(mode).s, { apple: ' subtract a from both sides ', file: { uri: FILE }, remainingMs: 3000 });
    assert.equal(r.source, 'apple', mode);
    assert.equal(r.text, 'subtract a from both sides', mode);
  }
  const noFile = await finalTranscript(stt('ok').s, { apple: 'so madam', file: { reason: 'no_file' }, remainingMs: 3000 });
  assert.deepEqual([noFile.source, noFile.text, !noFile.outcome.ok && noFile.outcome.reason], ['apple', 'so madam', 'no_file']);
  const noStt = await finalTranscript(null, { apple: 'x', file: { uri: FILE }, remainingMs: 3000 });
  assert.equal(noStt.source, 'apple');
});

test('Scribe still answers when Apple heard nothing', async () => {
  const r = await finalTranscript(stt('ok').s, { apple: '', file: { uri: FILE }, remainingMs: 3000 });
  assert.equal(r.text, 'subtract eight from both sides');
});

test('a slow Scribe never delays the turn past the remaining budget', async () => {
  const t0 = Date.now();
  const r = await finalTranscript(stt('hang').s, { apple: 'six x equals', file: { uri: FILE }, remainingMs: 700 });
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual([r.source, r.text, !r.outcome.ok && r.outcome.reason], ['apple', 'six x equals', 'timeout']);
});

test('turn/file mapping: one capture gives the file from audioend', () => {
  const rec = createRecording();
  assert.deepEqual(rec.file(), { reason: 'no_file' });
  rec.audioStart(FILE);
  assert.ok(rec.started());
  assert.deepEqual(rec.file(), { reason: 'no_file' }, 'not usable before audioend');
  rec.audioEnd(FILE);
  assert.deepEqual(rec.file(), { uri: FILE });
  assert.deepEqual(rec.uris(), [FILE]);
});

test('turn/file mapping: no persisted file (uri null) means no file', () => {
  const rec = createRecording();
  rec.audioStart(null);
  rec.audioEnd(null);
  assert.deepEqual(rec.file(), { reason: 'no_file' });
  assert.deepEqual(rec.uris(), []);
});

test('turn/file mapping: two captures in one session are ambiguous; every file is kept for deletion', () => {
  const rec = createRecording();
  rec.audioStart('file:///a.wav');
  rec.audioEnd('file:///a.wav');
  rec.audioStart('file:///b.wav');
  rec.audioEnd('file:///b.wav');
  assert.deepEqual(rec.file(), { reason: 'multiple_files' });
  assert.deepEqual(rec.uris().sort(), ['file:///a.wav', 'file:///b.wav']);
});

test('an aborted session (audiostart, no audioend) still knows its file for deletion', () => {
  const rec = createRecording();
  rec.audioStart(FILE);
  assert.deepEqual(rec.uris(), [FILE]);
  assert.deepEqual(rec.file(), { reason: 'no_file' });
});

test('recording is suspected only for a persisting session that failed before capturing or hearing anything', () => {
  const base = { persisted: true, error: 'audio-capture', audioStarted: false, heard: false };
  assert.equal(recordingSuspect(base), true);
  assert.equal(recordingSuspect({ ...base, persisted: false }), false);
  assert.equal(recordingSuspect({ ...base, audioStarted: true }), false);
  assert.equal(recordingSuspect({ ...base, heard: true }), false);
  for (const error of ['aborted', 'network', 'no-speech', 'not-allowed', 'interrupted', 'service-not-allowed'])
    assert.equal(recordingSuspect({ ...base, error }), false, error);
});

test('log lines: one per turn, in the documented form', () => {
  assert.equal(sttLogLine({ ok: true, text: 'secret words', ms: 812.4 }), '[penquire:voice] stt scribe 812 ms');
  assert.ok(!sttLogLine({ ok: true, text: 'secret words', ms: 1 }).includes('secret'), 'no transcript in the log');
  assert.equal(sttLogLine({ ok: false, reason: 'timeout', ms: 2400 }), '[penquire:voice] stt fell back to Apple: timeout after 2400 ms');
  assert.equal(sttLogLine({ ok: false, reason: 'no_file', ms: 0 }, ' (0 KB audio)'), '[penquire:voice] stt fell back to Apple: no_file (0 KB audio)');
});

test('math in the transcript is kept exactly; only audio_event entries are dropped', () => {
  assert.equal(scribeText({ text: 'so 2(x + 3) = 12 [and] done', words: [] }), 'so 2(x + 3) = 12 [and] done');
  assert.equal(scribeText({ text: '2(x + 3)' }), '2(x + 3)');
  const words = [
    { text: '(laughter)', type: 'audio_event' },
    { text: ' ', type: 'spacing' },
    { text: 'six', type: 'word' },
    { text: ' ', type: 'spacing' },
    { text: 'x', type: 'word' },
  ];
  assert.equal(scribeText({ text: '(laughter) six x', words }), 'six x');
  assert.equal(scribeText({ words: [] }), null);
  assert.equal(scribeText(null), null);
});

test('log lines name each failure cause separately', () => {
  assert.equal(sttLogLine({ ok: false, reason: 'no_recording', ms: 0 }), '[penquire:voice] stt fell back to Apple: no_recording');
  assert.equal(sttLogLine({ ok: false, reason: 'no_end', ms: 2500 }), '[penquire:voice] stt fell back to Apple: no_end after 2500 ms');
});
