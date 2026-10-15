/**
 * Speech in and out, on the device (docs/10 §4). Free, private and offline:
 *  - out: Apple's voices via expo-speech, preferring an Enhanced/Premium English voice if the student has one;
 *  - in: SFSpeechRecognizer via expo-speech-recognition, streaming partial text while they talk.
 * Both libraries exist only in native build 4+, so they are loaded lazily and every entry point degrades to "not
 * available" on an older binary instead of crashing.
 */
import { nativeApiVersion } from '../../modules/pencil-canvas';

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

let voiceId: string | undefined;
let voicePicked = false;

/** The best English voice installed: Enhanced/Premium beats Default; US English first. */
async function pickVoice(lib: SpeechLib) {
  if (voicePicked) return;
  voicePicked = true;
  try {
    const voices = await lib.getAvailableVoicesAsync();
    const en = voices.filter((v) => v.language?.startsWith('en'));
    const rank = (v: (typeof voices)[number]) => (String(v.quality) === 'Enhanced' ? 2 : 0) + (v.language === 'en-US' ? 1 : 0);
    voiceId = en.sort((a, b) => rank(b) - rank(a))[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
}

/** Speak sentences in order. Resolves when done or stopped. Calling it again stops what was being said. */
export async function speak(sentences: string[], opts: { onStart?: () => void; onSentence?: (i: number) => void } = {}): Promise<void> {
  const lib = speech();
  if (!lib || sentences.length === 0) return;
  await pickVoice(lib);
  await lib.stop();
  // Listening leaves the session in playAndRecord/"measurement", which plays speech very quietly. Switch to playback.
  try {
    recognition()?.ExpoSpeechRecognitionModule.setCategoryIOS({ category: 'playback', categoryOptions: ['duckOthers'], mode: 'spokenAudio' });
  } catch (e) {
    console.warn('could not switch the audio session to playback', e);
  }
  opts.onStart?.();
  for (let i = 0; i < sentences.length; i++) {
    const done = await new Promise<boolean>((resolve) => {
      lib.speak(sentences[i], {
        voice: voiceId,
        rate: 0.98,
        onStart: () => opts.onSentence?.(i),
        onDone: () => resolve(true),
        onStopped: () => resolve(false),
        onError: () => resolve(false),
      });
    });
    if (!done) return; // stopped (barge-in, the student started writing) or failed
  }
}

export function stopSpeaking() {
  void speech()?.stop();
}

// ---------------------------------------------------------------- listening

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
export async function listen(onPartial: (text: string) => void, vocabulary: string[] = []): Promise<Listening | null> {
  const lib = recognition();
  if (!lib) return null;
  const M = lib.ExpoSpeechRecognitionModule;
  const perm = await M.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Microphone or speech recognition is not allowed. Turn it on in Settings › Penquire.');

  let latest = '';
  let settle: ((t: string) => void) | null = null;
  const subs = [
    M.addListener('result', (e) => {
      latest = e.results[0]?.transcript ?? latest;
      onPartial(latest);
    }),
    M.addListener('end', () => settle?.(latest)),
    M.addListener('error', () => settle?.(latest)),
  ];
  const cleanup = () => subs.forEach((s) => s.remove());

  M.start({
    lang: 'en-US',
    interimResults: true,
    addsPunctuation: true,
    continuous: true,
    requiresOnDeviceRecognition: M.supportsOnDeviceRecognition(),
    contextualStrings: vocabulary.slice(0, 100),
    iosTaskHint: 'dictation',
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
