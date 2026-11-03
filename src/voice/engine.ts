/**
 * Speech in and out, on the device (docs/10 §4). Free, private and offline:
 *  - out: Apple's voices via expo-speech, preferring a Premium/Enhanced English voice (src/voice/session.ts), spoken
 *    sentence by sentence as the reply streams;
 *  - in: SFSpeechRecognizer via expo-speech-recognition, streaming partial text while they talk. With an ElevenLabs
 *    key, each turn's recorded audio is re-transcribed by Scribe for the final message (src/voice/cloudStt.ts); Apple's
 *    transcript is the fallback.
 * Both libraries exist only in native build 4+, so they are loaded lazily and every entry point degrades to "not
 * available" on an older binary instead of crashing.
 */
import { nativeApiVersion } from '../../modules/pencil-canvas';
import { cloudTtsConfig, createCloudTts, expoPlayer } from './cloudTts';
import { SCRIBE_MODEL, STT_BUDGET_MS, createCloudStt, createRecording, expoSttFiles, finalTranscript, nativeMultipart, recordingSuspect, sttLogLine, type CloudStt, type SttFiles } from './cloudStt';
import { contextualStrings, createRecognizerChoice } from './recognizer';
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
let picking: Promise<void> | null = null;
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
  picking = null;
  // choose now, while the student is still talking, so the first sentence doesn't wait for the voice list
  const lib = speech();
  if (lib) void pickVoice(lib);
}

/** one choice per voice session, shared by the prefetch in refreshVoice() and the first sentence */
function pickVoice(lib: SpeechLib): Promise<void> {
  if (!picking) picking = choose(lib);
  return picking;
}

async function choose(lib: SpeechLib) {
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

/** Apple's voice for one sentence: cloud TTS falls back to it on any error or timeout. */
const appleSay = (s: string) =>
  new Promise<void>((resolve) => {
    const lib = speech();
    if (!lib) return resolve();
    const t = voiceTuning(voice);
    lib.speak(s, { voice: voice?.identifier, rate: t.rate, pitch: t.pitch, onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
  });

let cloudTts: ReturnType<typeof createCloudTts> | null = null;
let loggedFallback = '';
/** ElevenLabs Flash v2.5 (src/voice/cloudTts.ts), created on first use; null without a key or below build 7. */
function cloud() {
  if (cloudTts) return cloudTts;
  const config = cloudTtsConfig();
  if (!config.apiKey || nativeApiVersion < 7) return null;
  const player = expoPlayer(nativeApiVersion);
  if (!player) return null;
  console.warn('[penquire:voice] cloud voice: ElevenLabs Flash v2.5 (falls back to the Apple voice on any error)');
  cloudTts = createCloudTts({
    ...config,
    fetch,
    player,
    fallback: appleSay,
    stopFallback: () => void speech()?.stop(),
    // reasons are fixed strings and never contain the key
    onFallback: (reason, status) => {
      const why = status ? `${reason} ${status}` : reason;
      if (why !== loggedFallback) console.warn(`[penquire:voice] cloud voice fell back to Apple: ${why}`);
      loggedFallback = why;
    },
  });
  return cloudTts;
}

const cloudBackend: SpeechBackend = {
  play: async (sentences, o) => {
    const lib = speech();
    if (lib) await pickVoice(lib); // the Apple fallback voice
    playbackSession();
    if (!o.live()) return;
    await cloud()!.speak(sentences, { onStart: o.onStart, onSentence: o.onSentence });
  },
  stop: () => cloudTts?.stop(),
};

/**
 * The voice that speaks: ElevenLabs when the key is configured and the build has an audio player (7+), else Apple's.
 * The speaker's generation and stop handling cover both: stopAllVoice() -> backend().stop() -> cloud.stop() aborts
 * fetches and stops playback.
 */
const backend = (): SpeechBackend => (cloud() ? cloudBackend : apple);

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

/** The student started writing: stop the tutor if it is talking, but keep a reply that is still on its way. */
export function stopSpeakingIfTalking() {
  speaker.interruptIfStarted();
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
  activeStt?.(); // a turn being transcribed by Scribe: drop it (finish() resolves "")
  activeStt = null;
  try {
    recognition()?.ExpoSpeechRecognitionModule.abort();
  } catch (e) {
    console.warn('could not abort listening', e);
  }
}

// ---------------------------------------------------------------- listening

/** removes the current listen()'s event listeners, so a stopAllVoice() leaves no callback behind */
let activeListen: (() => void) | null = null;

/** Apple's server recognizer first (more accurate), on-device after it fails once (src/voice/recognizer.ts). */
const recognizerChoice = createRecognizerChoice();
let loggedRecognizer = '';

export type Listening = {
  /** stop listening; resolves with the final transcript ("" if nothing was heard) */
  finish: () => Promise<string>;
  /** throw away what was heard */
  cancel: () => void;
};

/**
 * Start listening (push-to-talk). Partial text streams to onPartial while the student talks. Hints the recognizer
 * with the assignment's own vocabulary (part labels, symbols) so "three point ten c" and "theta" come out right, plus
 * spoken-math words ("subtract eight", "six x"; src/voice/recognizer.ts).
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

  let onDeviceSupported = false;
  try {
    onDeviceSupported = M.supportsOnDeviceRecognition();
  } catch {}
  const onDevice = recognizerChoice.requiresOnDevice(onDeviceSupported);
  const mode = onDevice ? 'on-device' : 'Apple server';
  if (mode !== loggedRecognizer) {
    loggedRecognizer = mode;
    console.warn(`[penquire:voice] recognizer: ${mode}${onDevice ? '' : onDeviceSupported ? ' (on-device is the fallback)' : ' (no on-device recognizer)'}`);
  }

  // Scribe needs this session's audio: persist it when there is a key and the build can record (src/voice/cloudStt.ts)
  const stt = scribe();
  let canRecord = false;
  try {
    canRecord = M.supportsRecording();
  } catch {}
  const persist = !!stt && canRecord && !recordingOff;
  flushRecordings(); // files of earlier sessions that were aborted or timed out; none is still uploading
  const rec = createRecording();
  /** finish() took over the files (it deletes them after the upload); otherwise cleanup() queues them for deletion */
  let handedOff = false;

  let latest = '';
  let settle: ((t: string) => void) | null = null;
  const subs = [
    M.addListener('result', (e) => {
      latest = e.results[0]?.transcript ?? latest;
      onPartial(latest);
    }),
    ...(onVolume ? [M.addListener('volumechange', (e) => onVolume(e.value))] : []),
    M.addListener('audiostart', (e) => rec.audioStart(e.uri)),
    M.addListener('audioend', (e) => rec.audioEnd(e.uri)),
    M.addListener('end', () => {
      if (settle) return settle(latest);
      cleanup(); // ended by itself: drop this session's listeners so a later session's events don't reach them
      onEnded?.();
    }),
    M.addListener('error', (e) => {
      if (!onDevice && recognizerChoice.serverError(e.error, onDeviceSupported))
        console.warn(`[penquire:voice] recognizer: Apple server failed (${e.error}); on-device from now on`);
      if (!recordingOff && recordingSuspect({ persisted: persist, error: e.error, audioStarted: rec.started(), heard: !!latest })) {
        recordingOff = true;
        console.warn(`[penquire:voice] stt: recording disabled for this run (${e.error}); Apple's transcript only`);
      }
      if (settle) return settle(latest);
      cleanup();
      onEnded?.();
    }),
  ];
  const cleanup = () => {
    subs.forEach((s) => s.remove());
    if (activeListen === cleanup) activeListen = null;
    if (!handedOff) staleRecordings.push(...rec.uris());
  };
  activeListen = cleanup;

  M.start({
    lang: 'en-US',
    interimResults: true,
    addsPunctuation: true,
    continuous: true,
    requiresOnDeviceRecognition: onDevice,
    contextualStrings: contextualStrings(vocabulary),
    iosTaskHint: 'dictation',
    ...(onVolume ? { volumeChangeEventOptions: { enabled: true, intervalMillis: 100 } } : {}),
    // 16 kHz 16-bit mono WAV: about 32 KB per second, small enough to upload quickly
    ...(persist ? { recordingOptions: { persist: true, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' as const } } : {}),
  });

  return {
    finish: () =>
      new Promise<string>((resolve) => {
        const endedAt = Date.now(); // the turn's STT_BUDGET_MS starts now
        // never hang if 'end' doesn't come. The recording is closed only when the recognizer ends, and Apple's server
        // recognizer takes longer to end than on-device, so wait longer for it when Scribe needs that file.
        let endTimedOut = false;
        const timer = setTimeout(() => {
          endTimedOut = true;
          settle?.(latest);
        }, persist ? END_WAIT_SCRIBE_MS : END_WAIT_MS);
        settle = (t) => {
          clearTimeout(timer);
          settle = null;
          handedOff = true;
          cleanup();
          if (!persist) {
            if (stt) console.warn(sttLogLine({ ok: false, reason: 'no_recording', ms: 0 }));
            return resolve(t.trim());
          }
          const waited = Date.now() - endedAt;
          void scribeTurn(stt, rec, t, STT_BUDGET_MS - waited, endTimedOut ? waited : null).then(resolve);
        };
        M.stop();
      }),
    cancel: () => {
      cleanup();
      M.abort();
    },
  };
}

// ---------------------------------------------------------------- cloud dictation (Scribe)

let cloudSttInst: CloudStt | null | undefined;
/** ElevenLabs Scribe (src/voice/cloudStt.ts), created on first use; null without a key. */
function scribe(): CloudStt | null {
  if (cloudSttInst !== undefined) return cloudSttInst;
  const { apiKey } = cloudTtsConfig();
  cloudSttInst = apiKey ? createCloudStt({ apiKey, fetch, body: nativeMultipart }) : null;
  console.warn(
    cloudSttInst
      ? `[penquire:voice] stt: ElevenLabs ${SCRIBE_MODEL} for the final transcript (Apple's live transcript is the fallback)`
      : "[penquire:voice] stt: Apple's transcript only (no ElevenLabs key)"
  );
  return cloudSttInst;
}

let sttFilesInst: SttFiles | null | undefined;
const sttFiles = () => (sttFilesInst === undefined ? (sttFilesInst = expoSttFiles(nativeApiVersion)) : sttFilesInst);

/** Turned on by a session that failed before capturing any audio while recording: persist no more this run. */
let recordingOff = false;
/** recordings nobody is uploading any more (aborted, ended by themselves, timed out), deleted at the next listen() */
const staleRecordings: string[] = [];
function flushRecordings() {
  const files = sttFiles();
  for (const uri of staleRecordings.splice(0)) files?.remove(uri);
}

/** how long finish() waits for the recognizer to end: without Scribe, and when Scribe needs the closed recording */
const END_WAIT_MS = 1500;
const END_WAIT_SCRIBE_MS = 2500;

/** aborts the Scribe upload of the turn being finished (stopAllVoice) */
let activeStt: (() => void) | null = null;

/**
 * The turn's message: Scribe's transcript of the recording, or Apple's on any failure. Resolves "" when Stop was
 * pressed during the upload, so a stopped turn is not sent. One log line per turn.
 */
async function scribeTurn(
  stt: CloudStt | null,
  rec: ReturnType<typeof createRecording>,
  apple: string,
  remainingMs: number,
  /** the recognizer did not end within the wait (ms waited): the recording was never closed */
  noEndAfter: number | null
): Promise<string> {
  const controller = new AbortController();
  let stopped = false;
  const stop = () => {
    stopped = true;
    controller.abort();
  };
  activeStt = stop;
  const files = sttFiles();
  if (noEndAfter !== null) {
    activeStt = null;
    staleRecordings.push(...rec.uris());
    console.warn(sttLogLine({ ok: false, reason: 'no_end', ms: noEndAfter }));
    return apple.trim();
  }
  const file = rec.file();
  const bytes = 'uri' in file ? files?.size(file.uri) ?? null : null;
  const r = await finalTranscript(stt, { apple, file, remainingMs, signal: controller.signal });
  if (activeStt === stop) activeStt = null;
  const uris = rec.uris();
  // an aborted upload may still be reading its file: delete it at the next listen() instead of now
  if (!r.outcome.ok && (r.outcome.reason === 'timeout' || r.outcome.reason === 'cancelled')) staleRecordings.push(...uris);
  else for (const uri of uris) files?.remove(uri);
  console.warn(sttLogLine(r.outcome, bytes !== null ? ` (${Math.round(bytes / 1024)} KB audio)` : ''));
  return stopped ? '' : r.text;
}
