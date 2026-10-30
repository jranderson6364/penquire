/**
 * The speaking side of a voice session, without native modules so it is tested in node (T13 Phase A):
 *  - one speaker with two counters: a stop epoch (stopAll(): nothing requested before it ever speaks, listening
 *    included) and an utterance id (a new utterance or an interrupt supersedes the old one, so two replies never talk
 *    over each other — the overlap race T06 noted);
 *  - an utterance is a stream of sentences pushed while the reply still arrives, played by a backend that checks
 *    live() after every await;
 *  - choosing the most natural installed voice.
 *
 * Backends: sentenceBackend() wraps a say-one-sentence voice (Apple's, via engine.ts). A cloud voice (T13B
 * cloudTts.ts) implements SpeechBackend directly: it already takes an async iterable of sentences and owns stop().
 */

// ---------------------------------------------------------------- speaker

export type PlayOptions = {
  /** false once this utterance was stopped or superseded: stop as soon as possible, start nothing new */
  live: () => boolean;
  /** the first sentence actually started playing */
  onStart?: () => void;
  onSentence?: (i: number) => void;
};

export type SpeechBackend = {
  /** Say the sentences as they arrive. Resolves when they are all said or playback stopped. */
  play(sentences: AsyncIterable<string>, o: PlayOptions): Promise<void>;
  /** Silence now. Must also end a play() waiting on the current sentence. */
  stop(): void;
};

export type Utterance = {
  /** queue a sentence (already leak-guarded and speakable); ignored once the utterance is no longer live */
  push(sentence: string): void;
  /** no more sentences are coming */
  end(): void;
  live(): boolean;
  /** true once the first sentence actually started playing (speech exposure) */
  started(): boolean;
  /** resolves when everything pushed was said, or the utterance was stopped */
  finished: Promise<void>;
};

type Queue = { iterable: AsyncIterable<string>; push(s: string): void; end(): void };

function queue(): Queue {
  const items: string[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const poke = () => {
    wake?.();
    wake = null;
  };
  return {
    push: (s) => {
      if (closed) return;
      items.push(s);
      poke();
    },
    end: () => {
      closed = true;
      poke();
    },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<string>> => {
          while (!items.length && !closed) await new Promise<void>((r) => (wake = r));
          return items.length ? { value: items.shift()!, done: false } : { value: undefined, done: true };
        },
        return: async (): Promise<IteratorResult<string>> => {
          closed = true;
          items.length = 0;
          return { value: undefined, done: true };
        },
      }),
    },
  };
}

export type Speaker = {
  /** Start an utterance. Interrupts whatever was being said. */
  begin(o?: { onStart?: () => void; onSentence?: (i: number) => void }): Utterance;
  /** End the current utterance ("your turn", a new turn). A conversation can go on. */
  interrupt(): void;
  /** End the current utterance only if it is already audible (pen down): a reply still loading keeps its speech. */
  interruptIfStarted(): void;
  /** Stop everything requested so far, including listening that is still starting (see epoch()). */
  stopAll(): void;
  /** bumped by stopAll() only */
  epoch(): number;
};

export function createSpeaker(backend: () => SpeechBackend): Speaker {
  let epoch = 0;
  let current = 0;
  let cancelActive: (() => void) | null = null;
  let activeStarted: () => boolean = () => false;

  const interrupt = () => {
    current++;
    cancelActive?.();
    cancelActive = null;
    try {
      backend().stop();
    } catch {}
  };

  const begin: Speaker['begin'] = (o = {}) => {
    interrupt();
    const id = current;
    const ep = epoch;
    const live = () => id === current && ep === epoch;
    const q = queue();
    let playing: Promise<void> | null = null;
    let started = false;
    let resolveFinished!: () => void;
    const finished = new Promise<void>((r) => (resolveFinished = r));
    const finish = () => resolveFinished();
    cancelActive = () => {
      q.end();
      if (!playing) finish();
    };
    activeStarted = () => started;
    return {
      live,
      started: () => started,
      finished,
      push: (s) => {
        const text = s.trim();
        if (!live() || !text) return;
        q.push(text);
        if (playing) return;
        playing = backend()
          .play(q.iterable, {
            live,
            onStart: () => {
              if (!live() || started) return;
              started = true;
              o.onStart?.();
            },
            onSentence: (i) => live() && o.onSentence?.(i),
          })
          .catch((e) => console.warn('speech failed', e))
          .then(finish);
      },
      end: () => {
        q.end();
        if (!playing) finish();
      },
    };
  };

  return {
    begin,
    interrupt,
    interruptIfStarted: () => {
      if (activeStarted()) interrupt();
    },
    stopAll: () => {
      epoch++;
      interrupt();
    },
    epoch: () => epoch,
  };
}

/** Short pause between sentences, so replies don't run together (tune on device). */
export const SENTENCE_PAUSE_MS = 220;

export type SentenceVoice = {
  /** before the first sentence: pick the voice, stop old speech, switch the audio session to playback */
  prepare: () => Promise<void>;
  /** say one sentence; resolves true when done, false when stopped or failed; calls onStart when audio starts */
  say: (text: string, onStart: () => void) => Promise<boolean>;
  stop: () => void;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** A backend over a voice that speaks one sentence at a time (Apple's AVSpeechSynthesizer via expo-speech). */
export function sentenceBackend(v: SentenceVoice): SpeechBackend {
  const sleep = v.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pause = v.pauseMs ?? SENTENCE_PAUSE_MS;
  // whatever the play loop is waiting on (a sentence, a pause); stop() ends it even if the voice never reports
  let pending: ((ok: boolean) => void) | null = null;
  const wait = <T>(p: Promise<T>, onStop: T) =>
    new Promise<T>((resolve) => {
      let end: ((ok: boolean) => void) | null = null;
      pending = end = () => resolve(onStop);
      p.then(resolve, () => resolve(onStop)).finally(() => {
        if (pending === end) pending = null;
      });
    });

  return {
    stop: () => {
      pending?.(false);
      pending = null;
      try {
        v.stop();
      } catch {}
    },
    play: async (sentences, o) => {
      let i = 0;
      for await (const s of sentences) {
        if (!o.live()) return;
        if (i === 0) await v.prepare();
        else await wait(sleep(pause), undefined);
        if (!o.live()) return;
        const n = i;
        const ok = await wait(
          v.say(s, () => {
            if (n === 0) o.onStart?.();
            o.onSentence?.(n);
          }),
          false
        );
        if (!ok || !o.live()) return;
        i++;
      }
    },
  };
}

// ---------------------------------------------------------------- choosing a voice

export type VoiceInfo = { identifier: string; name: string; language: string; quality?: string };

/**
 * 3 premium, 2 enhanced, 1 compact/default, 0 novelty or Eloquence voices (never chosen automatically).
 * expo-speech reports Premium voices as "Default" (SpeechModule.swift only knows .enhanced), so the identifier is the
 * reliable signal: com.apple.voice.premium.en-US.Ava, com.apple.voice.enhanced.en-US.Zoe, com.apple.voice.compact…
 */
export function voiceTier(v: VoiceInfo): 0 | 1 | 2 | 3 {
  const id = v.identifier.toLowerCase();
  if (/eloquence|speech\.synthesis\.voice|novelty/.test(id)) return 0;
  if (id.includes('premium') || /\(premium\)/i.test(v.name)) return 3;
  if (id.includes('enhanced') || String(v.quality) === 'Enhanced' || /\(enhanced\)/i.test(v.name)) return 2;
  return 1;
}

/** Natural-sounding US voices, best first (to confirm by ear on the iPad). */
export const PREFERRED_VOICES = ['Ava', 'Zoe', 'Evan', 'Nathan', 'Noelle', 'Joelle', 'Tom', 'Allison', 'Susan', 'Samantha'];

const baseName = (v: VoiceInfo) => v.name.replace(/\s*\((premium|enhanced|compact)\)\s*/i, '').trim();

/** English voices worth offering, best first: tier, then en-US, then the preferred list, then name. */
export function rankVoices(voices: VoiceInfo[]): VoiceInfo[] {
  const pref = (v: VoiceInfo) => {
    const i = PREFERRED_VOICES.indexOf(baseName(v));
    return i < 0 ? PREFERRED_VOICES.length : i;
  };
  return voices
    .filter((v) => v.language?.toLowerCase().startsWith('en') && voiceTier(v) > 0)
    .sort((a, b) => voiceTier(b) - voiceTier(a) || Number(b.language === 'en-US') - Number(a.language === 'en-US') || pref(a) - pref(b) || a.name.localeCompare(b.name));
}

/** The student's pick if it is still installed (downloads can be deleted), otherwise the best installed voice. */
export function chooseVoice(voices: VoiceInfo[], preferredId?: string): VoiceInfo | undefined {
  return (preferredId ? voices.find((v) => v.identifier === preferredId) : undefined) ?? rankVoices(voices)[0];
}

/** expo-speech rate (1 = normal) and pitch per voice tier; compact voices sound better a little slower. Tune on device. */
export function voiceTuning(v: VoiceInfo | undefined): { rate: number; pitch: number } {
  const t = v ? voiceTier(v) : 1;
  return t === 3 ? { rate: 1.0, pitch: 1.0 } : t === 2 ? { rate: 0.97, pitch: 1.0 } : { rate: 0.92, pitch: 1.0 };
}

export function voiceLabel(v: VoiceInfo): string {
  const tier = ['Novelty', 'Compact', 'Enhanced', 'Premium'][voiceTier(v)];
  return `${baseName(v)} · ${tier} · ${v.language}`;
}

/** Shown when nothing better than a compact voice is installed. */
export const VOICE_DOWNLOAD_HINT =
  'For a natural voice, download a Premium US English voice: iPad Settings › Accessibility › Spoken Content › Voices › English (or Live Speech › Voices). Then reopen this screen.';

export const needsBetterVoice = (voices: VoiceInfo[]) => (rankVoices(voices)[0] ? voiceTier(rankVoices(voices)[0]) < 2 : true);

// ---------------------------------------------------------------- speech exposure

/** What a voice turn hands the reply request: stream sentences to speech, and report exposure only once spoken. */
export type SpokenReply = {
  /** guarded reply text so far (whole sentences only) */
  onPartial: (text: string) => void;
  /** speech actually started */
  started: () => boolean;
  /** the reply was recorded as assistance before speech started: add 'speech' when it does */
  recorded: (episodeId: string, assistanceId: string) => void;
};

/** Add the speech channel to delivered help once speech really started (T07 recorded it when only requested). */
export function withSpeechExposure<E extends { assistance: Array<{ id: string; channels: string[] }>; updatedAt: number }>(ep: E, assistanceId: string, now: number): E {
  let changed = false;
  const assistance = ep.assistance.map((h) => {
    if (h.id !== assistanceId || h.channels.includes('speech')) return h;
    changed = true;
    return { ...h, channels: [...h.channels, 'speech'] };
  });
  return changed ? { ...ep, assistance, updatedAt: Math.max(ep.updatedAt, now) } : ep;
}
