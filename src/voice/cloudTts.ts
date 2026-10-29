/**
 * Cloud neural speech (T13 Phase B): ElevenLabs Flash v2.5, one request per sentence, played with expo-audio.
 *
 * - Sentence-level streaming: the next sentence is fetched while the current one plays, and sentences can arrive one
 *   at a time (an async iterable) while the reply is still streaming.
 * - Any error, timeout or missing piece (no key, no expo-audio in the installed binary) falls back to the Apple voice
 *   for the rest of that reply, so the tutor never goes silent because the network did.
 * - stop() aborts in-flight requests and stops playback at once; nothing from a stopped reply plays later.
 * - The key is founder-only dev config (EXPO_PUBLIC_ELEVENLABS_API_KEY in app/.env). It is never put in a reason,
 *   error or log line. Not for distributed builds without a backend proxy.
 *
 * Not wired into engine.ts yet: speak() waits for T06 / T13 Phase A. The core takes its fetch, player and fallback
 * as arguments so it is testable without native modules; expoPlayer() is the real player.
 */

export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';
/** A premade ElevenLabs voice ("Rachel"); override with EXPO_PUBLIC_ELEVENLABS_VOICE_ID. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8EUISK';
/** One sentence of audio must arrive within this, or the reply falls back to the Apple voice. */
export const FETCH_TIMEOUT_MS = 3000;

/** Plays one sentence of audio. Resolves when it finishes or is stopped; rejects if it cannot play. */
export type TtsPlayer = {
  play(audio: Uint8Array): Promise<void>;
  stop(): void;
};

export type CloudTtsDeps = {
  apiKey: string | undefined;
  voiceId?: string;
  fetch: typeof fetch;
  /** null when the installed binary has no audio player (expo-audio arrived with apiVersion 7) */
  player: TtsPlayer | null;
  /** speak one sentence with the Apple voice; resolves when done */
  fallback: (sentence: string) => Promise<void>;
  /** stop the Apple voice (called by stop()) */
  stopFallback?: () => void;
  timeoutMs?: number;
  /** diagnostics; reasons are fixed strings and never contain the key */
  onFallback?: (reason: FallbackReason) => void;
};

export type FallbackReason = 'no_key' | 'no_player' | 'timeout' | 'http_error' | 'network' | 'empty_audio' | 'play_failed';

export type SpeakResult = { completed: boolean; fellBack: FallbackReason | null };

export type CloudTts = {
  /** Speak sentences in order. A new call stops the previous one. */
  speak(sentences: Iterable<string> | AsyncIterable<string>, opts?: { onStart?: () => void; onSentence?: (i: number) => void }): Promise<SpeakResult>;
  stop(): void;
};

class TtsFailure extends Error {
  readonly reason: FallbackReason;
  constructor(reason: FallbackReason) {
    super(reason);
    this.reason = reason;
  }
}

export function createCloudTts(deps: CloudTtsDeps): CloudTts {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const voiceId = deps.voiceId || DEFAULT_VOICE_ID;
  let generation = 0;
  const inFlight = new Set<AbortController>();

  const abortAll = () => {
    for (const c of inFlight) c.abort();
    inFlight.clear();
  };

  async function fetchAudio(text: string, previousText: string | undefined): Promise<Uint8Array> {
    const controller = new AbortController();
    inFlight.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let res: Response;
      try {
        res = await deps.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': deps.apiKey ?? '', 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            ...(previousText ? { previous_text: previousText } : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        throw new TtsFailure(timedOut ? 'timeout' : 'network');
      }
      if (!res.ok) throw new TtsFailure('http_error');
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        throw new TtsFailure(timedOut ? 'timeout' : 'network');
      }
      if (bytes.length === 0) throw new TtsFailure('empty_audio');
      return bytes;
    } finally {
      clearTimeout(timer);
      inFlight.delete(controller);
    }
  }

  function stop() {
    generation++;
    abortAll();
    try {
      deps.player?.stop();
    } catch {}
    try {
      deps.stopFallback?.();
    } catch {}
  }

  async function speak(
    sentences: Iterable<string> | AsyncIterable<string>,
    opts: { onStart?: () => void; onSentence?: (i: number) => void } = {}
  ): Promise<SpeakResult> {
    stop();
    const gen = generation;
    const live = () => gen === generation;

    let fellBack: FallbackReason | null = !deps.apiKey ? 'no_key' : !deps.player ? 'no_player' : null;
    if (fellBack) deps.onFallback?.(fellBack);
    const fallBack = (reason: FallbackReason) => {
      if (fellBack) return;
      fellBack = reason;
      abortAll(); // the prefetched sentence will be said by the Apple voice instead
      deps.onFallback?.(reason);
    };

    const iterator: Iterator<string> | AsyncIterator<string> =
      Symbol.asyncIterator in sentences ? (sentences as AsyncIterable<string>)[Symbol.asyncIterator]() : (sentences as Iterable<string>)[Symbol.iterator]();
    let previous: string | undefined;
    type Item = { text: string; audio?: Promise<Uint8Array> };
    const pull = async (): Promise<Item | null> => {
      const r = await iterator.next();
      if (r.done || !live()) return null;
      const text = String(r.value).trim();
      if (!text) return pull();
      const item: Item = { text };
      if (!fellBack) {
        item.audio = fetchAudio(text, previous);
        item.audio.catch(() => {}); // handled when it is played; never an unhandled rejection
      }
      previous = text;
      return item;
    };

    let started = false;
    let i = 0;
    let current = await pull();
    while (current && live()) {
      const next = pull(); // prefetch: the next request runs while this sentence plays
      next.catch(() => {});
      if (!started) {
        started = true;
        opts.onStart?.();
      }
      let spoken = false;
      if (!fellBack && current.audio) {
        try {
          const audio = await current.audio;
          if (!live()) break;
          try {
            await deps.player!.play(audio);
          } catch {
            throw new TtsFailure('play_failed');
          }
          spoken = true;
        } catch (e) {
          if (!live()) break;
          fallBack(e instanceof TtsFailure ? e.reason : 'network');
        }
      }
      if (!spoken) {
        if (!live()) break;
        await deps.fallback(current.text);
      }
      if (!live()) break;
      opts.onSentence?.(i++);
      try {
        current = await next;
      } catch {
        current = null;
      }
    }
    return { completed: live(), fellBack };
  }

  return { speak, stop };
}

/** The key and voice from founder-only dev config. Static access, so Metro inlines EXPO_PUBLIC_ values. */
export function cloudTtsConfig(): { apiKey: string | undefined; voiceId: string | undefined } {
  return {
    apiKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || undefined,
    voiceId: process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || undefined,
  };
}

/**
 * The real player: each sentence's mp3 goes to a small rotating cache file and plays through expo-audio. Returns null
 * on a binary without expo-audio (apiVersion < 7), so callers fall back instead of crashing. Loaded lazily for the same
 * reason. The audio session category is the caller's job (engine.ts switches to playback after listening).
 */
export function expoPlayer(apiVersion: number): TtsPlayer | null {
  if (apiVersion < 7) return null;
  let audio: typeof import('expo-audio');
  let fs: typeof import('expo-file-system');
  try {
    audio = require('expo-audio') as typeof import('expo-audio');
    fs = require('expo-file-system') as typeof import('expo-file-system');
  } catch (e) {
    console.warn('cloud speech unavailable: no audio player in this build', e);
    return null;
  }
  let slot = 0;
  let active: { player: ReturnType<typeof audio.createAudioPlayer>; finish: () => void } | null = null;

  const stop = () => {
    const a = active;
    active = null;
    if (!a) return;
    try {
      a.player.pause();
      a.player.remove();
    } catch {}
    a.finish();
  };

  const play = (bytes: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      stop();
      let file: InstanceType<typeof fs.File>;
      try {
        // rotate between a few files so the next sentence never overwrites the one playing
        file = new fs.File(fs.Paths.cache, `penquire-tts-${slot++ % 3}.mp3`);
        if (!file.exists) file.create({ intermediates: true });
        file.write(bytes);
      } catch {
        reject(new Error('could not write audio'));
        return;
      }
      let player: ReturnType<typeof audio.createAudioPlayer>;
      try {
        player = audio.createAudioPlayer({ uri: file.uri });
      } catch {
        reject(new Error('could not create player'));
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        sub.remove();
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        sub.remove();
        if (active?.player === player) active = null;
        try {
          player.remove();
        } catch {}
        reject(new Error('audio did not start'));
      };
      // if it has not started within 3 s it is not going to: say it with the Apple voice instead
      let begun = false;
      const startTimer = setTimeout(() => {
        if (!begun) fail();
      }, 3000);
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.playing) begun = true;
        if (s.didJustFinish) {
          if (active?.player === player) active = null;
          try {
            player.remove();
          } catch {}
          finish();
        }
      });
      active = { player, finish };
      player.play();
    });

  return { play, stop };
}
