/**
 * Speech in and out, on the device (docs/10 §4). Free, private and offline:
 *  - out: Apple's voices via expo-speech, preferring a Premium/Enhanced English voice (src/voice/session.ts), spoken
 *    sentence by sentence as the reply streams;
 *  - in: SFSpeechRecognizer via expo-speech-recognition, streaming partial text while they talk.
 * Both libraries exist only in native build 4+, so they are loaded lazily and every entry point degrades to "not
 * available" on an older binary instead of crashing.
 */
import { nativeApiVersion } from '../../modules/pencil-canvas';
import { chooseVoice, createSpeaker, rankVoices, sentenceBackend, voiceTier, voiceTuning, type SpeechBackend, type Utterance, type VoiceInfo } from './session';

export type { Utterance, VoiceInfo } from './session';

type SpeechLib = typeof import('expo-speech');
type RecognitionLib = typeof import('expo-speech-recognition');

let speechLib: SpeechLib | null | undefined;
let recLib: RecognitionLib | null | undefined;

function speech(): SpeechLib | null {
  if (speechLib === undefined) {
    speechLib = null;
    if (nativeApiVersion >= 4) {
      try {
        speechLib = require('expo-speech') as SpeechLib;
      } catch (e) {
        console.warn('speech output unavailable', e);
      }
    }
  }
  return speechLib;
}

function recognition(): RecognitionLib | null {
  if (recLib === undefined) {
    recLib = null;
    if (nativeApiVersion >= 4) {
      try {
        recLib = require('expo-speech-recognition') as RecognitionLib;
      } catch (e) {
        console.warn('speech input unavailable', e);
      }
    }
  }
  return recLib;
}

export const voiceAvailable = () => nativeApiVersion >= 4 && !!speech() && !!recognition();

// ---------------------------------------------------------------- speaking

let voice: VoiceInfo | undefined;
let voicePicked = false;
let preferredVoiceId: string | undefined;
let loggedVoice: string | undefined;

/** English voices installed on this iPad, best first (Settings' voice picker). */
export async function englishVoices(): Promise<VoiceInfo[]> {
  const lib = speech();
  if (!lib) return [];
  try {
    return rankVoices(await lib.getAvailableVoicesAsync());
  } catch {
    return [];
  }
}

/**
 * Choose the voice again at the start of a voice session: the student's pick from Settings if it is still installed
 * (downloaded voices can be deleted), otherwise the best installed one (src/voice/session.ts).
 */
export function refreshVoice(preferredId?: string) {
  preferredVoiceId = preferredId;
  voicePicked = false;
}

async function pickVoice(lib: SpeechLib) {
  if (voicePicked) return;
  voicePicked = true;
  try {
    const all = await lib.getAvailableVoicesAsync();
    voice = chooseVoice(all, preferredVoiceId);
    if (voice?.identifier !== loggedVoice) {
      loggedVoice = voice?.identifier;
      const t = voiceTuning(voice);
      console.warn(
        `[penquire:voice] using ${voice ? `${voice.identifier} (${voice.name}, ${voice.quality}, tier ${voiceTier(voice)})` : 'the system default'} rate=${t.rate}; English voices: ${rankVoices(all)
          .map((v) => v.identifier)
          .join(', ') || 'none'}`
      );
    }
  } catch {
    voice = undefined;
  }
}

function playbackSession() {
  // Listening leaves the session in playAndRecord/"measurement", which plays speech very quietly. Switch to playback.
  try {
    recognition()?.ExpoSpeechRecognitionModule.setCategoryIOS({ category: 'playback', categoryOptions: ['duckOthers'], mode: 'spokenAudio' });
  } catch (e) {
    console.warn('could not switch the audio session to playback', e);
  }
}

/** Apple's voice, one sentence at a time. */
const apple = sentenceBackend({
  prepare: async () => {
    const lib = speech();
    if (!lib) return;
    await pickVoice(lib);
    await lib.stop();
    playbackSession();
  },
  say: (text, onStart) =>
    new Promise<boolean>((resolve) => {
      const lib = speech();
      if (!lib) return resolve(false);
      const t = voiceTuning(voice);
      lib.speak(text, {
        voice: voice?.identifier,
        rate: t.rate,
        pitch: t.pitch,
        onStart,
        onDone: () => resolve(true),
        onStopped: () => resolve(false),
        onError: () => resolve(false),
      });
    }),
  stop: () => void speech()?.stop(),
});

/**
 * The voice that speaks. Cloud TTS (T13B src/voice/cloudTts.ts) plugs in HERE, as another SpeechBackend; the
 * generation and stop handling in the speaker then cover it too. See tasks/handoff/T13A.md for the exact code.
 */
const backend = (): SpeechBackend => apple;

/** One speaker for the app: a new utterance interrupts the old one; stopAllVoice() stops everything. */
const speaker = createSpeaker(backend);

/**
 * Start speaking a reply that may still be streaming: push guarded, speakable sentences as they arrive, then end().
 * Interrupts what was being said. Create it before fetching the reply, so a stop during the fetch also kills it.
 */
export function beginSpeech(opts: { onStart?: () => void; onSentence?: (i: number) => void } = {}): Utterance {
  if (!speech()) {
    const done = Promise.resolve();
    return { push: () => {}, end: () => {}, live: () => false, started: () => false, finished: done };
  }
  return speaker.begin(opts);
}

/** Speak sentences in order. Resolves when done or stopped. Calling it again stops what was being said. */
export async function speak(sentences: string[], opts: { onStart?: () => void; onSentence?: (i: number) => void } = {}): Promise<void> {
  const u = beginSpeech(opts);
  sentences.forEach((s) => u.push(s));
  u.end();
  await u.finished;
}

/** Hear a voice from Settings (the student's pick, or automatic). */
export async function previewVoice(identifier?: string) {
  refreshVoice(identifier);
  await speak(['Hi! Show me what you tried, and we can look at it together.', 'Two times the quantity three x minus four equals ten.']);
}

/**
 * Stop the reply being said now, and anything still queued for it (pen down, "your turn"). A conversation goes on;
 * use stopAllVoice() to stop everything.
 */
export function stopSpeaking() {
  speaker.interrupt();
}

/**
 * Stop everything (Stop button, independent boundary, leaving the screen): current speech, the sentences queued
 * after it, speech still waiting to start, and listening. Safe to call when nothing is running. Callers must also drop
 * replies still being fetched (see src/learning/gate.ts) and end any conversation loop themselves.
 */
export function stopAllVoice() {
  speaker.stopAll();
  activeListen?.();
  activeListen = null;
  try {
    recognition()?.ExpoSpeechRecognitionModule.abort();
  } catch (e) {
    console.warn('could not abort listening', e);
  }
}

// ---------------------------------------------------------------- listening

/** removes the current listen()'s event listeners, so a stopAllVoice() leaves no callback behind */
let activeListen: (() => void) | null = null;

export type Listening = {
  /** stop listening; resolves with the final transcript ("" if nothing was heard) */
  finish: () => Promise<string>;
  /** throw away what was heard */
  cancel: () => void;
};

/**
 * Start listening (push-to-talk). Partial text streams to onPartial while the student talks. Hints the recognizer
 * with the assignment's own vocabulary (part labels, symbols) so "three point ten c" and "theta" come out right.
 */
export async function listen(
  onPartial: (text: string) => void,
  vocabulary: string[] = [],
  /** the recognizer stopped by itself (error, interruption) while nobody was finishing it */
  onEnded?: () => void,
  /** live mic level (about -2 to 10, below 0 inaudible), for voice activity in hands-free turns */
  onVolume?: (level: number) => void
): Promise<Listening | null> {
  const lib = recognition();
  if (!lib) return null;
  const M = lib.ExpoSpeechRecognitionModule;
  const epoch = speaker.epoch();
  const perm = await M.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Microphone or speech recognition is not allowed. Turn it on in Settings › Penquire.');
  if (epoch !== speaker.epoch()) return null; // stopAllVoice() while asking for permission: do not start

  let latest = '';
  let settle: ((t: string) => void) | null = null;
  const subs = [
    M.addListener('result', (e) => {
      latest = e.results[0]?.transcript ?? latest;
      onPartial(latest);
    }),
    ...(onVolume ? [M.addListener('volumechange', (e) => onVolume(e.value))] : []),
    M.addListener('end', () => (settle ? settle(latest) : onEnded?.())),
    M.addListener('error', () => (settle ? settle(latest) : onEnded?.())),
  ];
  const cleanup = () => {
    subs.forEach((s) => s.remove());
    if (activeListen === cleanup) activeListen = null;
  };
  activeListen = cleanup;

  M.start({
    lang: 'en-US',
    interimResults: true,
    addsPunctuation: true,
    continuous: true,
    requiresOnDeviceRecognition: M.supportsOnDeviceRecognition(),
    contextualStrings: vocabulary.slice(0, 100),
    iosTaskHint: 'dictation',
    ...(onVolume ? { volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } } : {}),
  });

  return {
    finish: () =>
      new Promise<string>((resolve) => {
        const timer = setTimeout(() => settle?.(latest), 1500); // never hang if 'end' doesn't come
        settle = (t) => {
          clearTimeout(timer);
          settle = null;
          cleanup();
          resolve(t.trim());
        };
        M.stop();
      }),
    cancel: () => {
      cleanup();
      M.abort();
    },
  };
}
