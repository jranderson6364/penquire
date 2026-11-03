/**
 * Cloud dictation for the final transcript (T14 B): ElevenLabs Scribe v2 (batch speech-to-text).
 *
 * Apple's live recognizer still shows what it hears while the student talks. With `recordingOptions.persist` it also
 * writes the session's audio to a WAV file (expo-speech-recognition 57.1.1: the `audioend` event carries the uri,
 * after the native side has closed the file). When the turn ends, that file is uploaded to Scribe and its transcript
 * becomes the turn's message.
 *
 * - Apple's transcript is the fallback on any error, missing file, empty result, or when the turn's time budget
 *   (STT_BUDGET_MS from the moment the turn ends) runs out. Scribe never delays a turn past that.
 * - One recognition session is one turn: listen() is started per turn in both push-to-talk and hands-free mode, so
 *   the mapping is one session = one file. A session that reports more than one file is treated as ambiguous and
 *   falls back (createRecording()).
 * - The key is founder-only dev config (EXPO_PUBLIC_ELEVENLABS_API_KEY, read by cloudTtsConfig()). It goes in the
 *   `xi-api-key` header only. Reasons are fixed strings and never contain it.
 *
 * Pure: fetch, the multipart body, clock and timers are injected, so this is testable without native modules.
 * expoSttFiles() is the real file layer (lazy expo-file-system).
 *
 * API checked November 3, 2026 at https://elevenlabs.io/docs/api-reference/speech-to-text/convert :
 * POST https://api.elevenlabs.io/v1/speech-to-text, multipart/form-data, fields `model_id` (required), `file`,
 * `language_code`, `tag_audio_events`, ...; response JSON with top-level `text`.
 */

export const SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
export const SCRIBE_MODEL = 'scribe_v2';
/** From the moment a turn ends (finish()) to the turn's message, Scribe or not. */
export const STT_BUDGET_MS = 4000;
/** Less time than this left for the upload: don't start it, use Apple's transcript. */
export const MIN_UPLOAD_MS = 500;
/**
 * Scribe `keyterms` (biasing) is off: the multipart encoding of the list is not confirmed in the docs, a rejected
 * term (labels with brackets etc.) would fail every turn, and it costs extra. Apple gets the vocabulary instead.
 */
export const SEND_KEYTERMS = false;

/** The form fields sent with the audio file (besides `file`). */
export function scribeFields(): Record<string, string> {
  return { model_id: SCRIBE_MODEL, language_code: 'en', tag_audio_events: 'false' };
}

export type SttFallbackReason =
  | 'no_key'
  | 'no_file'
  | 'multiple_files'
  | 'no_time'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'bad_response'
  | 'empty_text'
  | 'cancelled';

export type SttOutcome = { ok: true; text: string; ms: number } | { ok: false; reason: SttFallbackReason; status?: number; ms: number };

export type CloudSttDeps = {
  apiKey: string | undefined;
  fetch: typeof fetch;
  /**
   * The multipart body: the audio file at `uri` plus `fields`. The real one is React Native's FormData with a
   * `{ uri, name, type }` file part; don't set Content-Type, fetch adds the boundary.
   */
  body: (uri: string, fields: Record<string, string>) => BodyInit;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
};

export type CloudStt = {
  /**
   * Transcribe one file within `timeoutMs`. Never throws; `signal` aborts (reason 'cancelled').
   * Any failure is a fallback reason, so the caller uses Apple's transcript.
   */
  transcribe(uri: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<SttOutcome>;
};

export function createCloudStt(deps: CloudSttDeps): CloudStt {
  const now = deps.now ?? Date.now;
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));

  async function transcribe(uri: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<SttOutcome> {
    const t0 = now();
    const fail = (reason: SttFallbackReason, status?: number): SttOutcome => ({ ok: false, reason, status, ms: now() - t0 });
    if (!deps.apiKey) return fail('no_key');
    if (!uri) return fail('no_file');
    if (opts.signal?.aborted) return fail('cancelled');
    if (opts.timeoutMs < MIN_UPLOAD_MS) return fail('no_time');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setT(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const why = (): SttFallbackReason => (timedOut ? 'timeout' : opts.signal?.aborted ? 'cancelled' : 'network');
    try {
      let res: Response;
      try {
        res = await deps.fetch(SCRIBE_URL, {
          method: 'POST',
          headers: { 'xi-api-key': deps.apiKey, Accept: 'application/json' },
          body: deps.body(uri, scribeFields()),
          signal: controller.signal,
        });
      } catch {
        return fail(why());
      }
      if (!res.ok) return fail('http_error', res.status);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return fail(timedOut || opts.signal?.aborted ? why() : 'bad_response');
      }
      const text = json && typeof json === 'object' && typeof (json as { text?: unknown }).text === 'string' ? (json as { text: string }).text : null;
      if (text === null) return fail('bad_response');
      const clean = cleanTranscript(text);
      if (!clean) return fail('empty_text');
      return { ok: true, text: clean, ms: now() - t0 };
    } finally {
      clearT(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  return { transcribe };
}

/** Scribe can tag non-speech ("(laughs)", "[music]") even with tag_audio_events off; keep only the words. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which file belongs to this turn. Fed the session's `audiostart` / `audioend` uris. One session = one turn = one
 * file; the file is usable only after `audioend` (the native side closes it before sending that event).
 */
export function createRecording() {
  const all = new Set<string>();
  let starts = 0;
  let ended: string | null = null;
  return {
    audioStart(uri: string | null | undefined) {
      starts++;
      if (uri) all.add(uri);
    },
    audioEnd(uri: string | null | undefined) {
      if (uri) {
        all.add(uri);
        ended = uri;
      }
    },
    /** true once any audio capture began (a later error is then not the recording format's fault) */
    started: () => starts > 0,
    /** the turn's file, or why there isn't a usable one */
    file(): { uri: string } | { reason: 'no_file' | 'multiple_files' } {
      // two captures in one session: which audio is this turn's is ambiguous (the uris of one capture are identical)
      if (starts > 1) return { reason: 'multiple_files' };
      return ended ? { uri: ended } : { reason: 'no_file' };
    },
    /** every file this session wrote, for deleting */
    uris: () => [...all],
  };
}

/**
 * Should recording be turned off for the rest of the run? A session that persisted audio and failed before any audio
 * capture started or anything was heard may have been broken by the recording format; the live transcript matters
 * more than Scribe. Server-recognizer failures (network) and an abort are not the recording's fault.
 */
export function recordingSuspect(o: { persisted: boolean; error: string | undefined; audioStarted: boolean; heard: boolean }): boolean {
  if (!o.persisted || o.audioStarted || o.heard) return false;
  return !['aborted', 'network', 'service-not-allowed', 'no-speech', 'not-allowed', 'interrupted'].includes(o.error ?? '');
}

/**
 * The turn's message: Scribe's transcript, or Apple's when Scribe could not deliver. `remainingMs` is what is left of
 * STT_BUDGET_MS after waiting for the recognizer to end.
 */
export async function finalTranscript(
  stt: CloudStt | null,
  o: { apple: string; file: { uri: string } | { reason: 'no_file' | 'multiple_files' }; remainingMs: number; signal?: AbortSignal }
): Promise<{ text: string; source: 'scribe' | 'apple'; outcome: SttOutcome }> {
  const apple = o.apple.trim();
  if (!stt) return { text: apple, source: 'apple', outcome: { ok: false, reason: 'no_key', ms: 0 } };
  if (!('uri' in o.file)) return { text: apple, source: 'apple', outcome: { ok: false, reason: o.file.reason, ms: 0 } };
  const outcome = await stt.transcribe(o.file.uri, { timeoutMs: o.remainingMs, signal: o.signal });
  return outcome.ok ? { text: outcome.text, source: 'scribe', outcome } : { text: apple, source: 'apple', outcome };
}

/** The one log line per turn. Fixed strings plus numbers: never the key, never the transcript. */
export function sttLogLine(outcome: SttOutcome, extra = ''): string {
  if (outcome.ok) return `[penquire:voice] stt scribe ${Math.round(outcome.ms)} ms${extra}`;
  const why = outcome.status ? `${outcome.reason} ${outcome.status}` : outcome.reason;
  return `[penquire:voice] stt fell back to Apple: ${why}${outcome.ms ? ` after ${Math.round(outcome.ms)} ms` : ''}${extra}`;
}

export type SttFiles = {
  /** size in bytes, or null if unknown */
  size(uri: string): number | null;
  /** delete if it exists; never throws */
  remove(uri: string): void;
};

/** expo-file-system's File (57.0.7: `new File(uri)`, `.exists`, `.size`, `.delete()`); null if it isn't in the binary. */
export function expoSttFiles(apiVersion: number): SttFiles | null {
  if (apiVersion < 7) return null;
  let fs: typeof import('expo-file-system');
  try {
    fs = require('expo-file-system') as typeof import('expo-file-system');
  } catch {
    return null;
  }
  return {
    size(uri) {
      try {
        const f = new fs.File(uri);
        return f.exists ? f.size : null;
      } catch {
        return null;
      }
    },
    remove(uri) {
      try {
        const f = new fs.File(uri);
        if (f.exists) f.delete();
      } catch {}
    },
  };
}

/** React Native's multipart body: a file part by uri (RN reads the file natively), plus the text fields. */
export function nativeMultipart(uri: string, fields: Record<string, string>): BodyInit {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const name = uri.split('/').pop() || 'turn.wav';
  form.append('file', { uri, name, type: 'audio/wav' } as unknown as Blob);
  return form;
}
