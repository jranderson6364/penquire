/**
 * How Apple's live recognizer is set up (T14 B). Pure (tested).
 *
 * - Contextual strings: the assignment's own words plus spoken-math vocabulary, so "subtract eight" stops coming out as
 *   "subtract a". SFSpeechRecognitionRequest.contextualStrings (expo-speech-recognition 57.1.1 `contextualStrings`).
 * - Server first: Apple's server recognizer is more accurate than the on-device one, so `requiresOnDeviceRecognition`
 *   is false until the server fails (offline, dictation disabled); then on-device is used for the rest of the run.
 */

/** Spoken algebra words and numbers, for the recognizer's hints. */
export const MATH_TERMS: readonly string[] = [
  'six x',
  'two x',
  'three x',
  'four x',
  'x',
  'y',
  'minus',
  'plus',
  'equals',
  'times',
  'divide',
  'divided by',
  'distribute',
  'parentheses',
  'both sides',
  'subtract',
  'add',
  'multiply',
  'fraction',
  'numerator',
  'denominator',
  'negative',
  'squared',
  'square root',
  'exponent',
  'coefficient',
  'variable',
  'equation',
  'simplify',
  'combine like terms',
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'hundred',
  'half',
  'point',
];

/** Apple documents no hard limit; the app has always sent at most this many. */
export const MAX_CONTEXTUAL_STRINGS = 100;

/**
 * The assignment's words first (part labels, symbols), then the math vocabulary; trimmed, without blanks or
 * case-insensitive duplicates, at most MAX_CONTEXTUAL_STRINGS.
 */
export function contextualStrings(vocabulary: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...vocabulary, ...MATH_TERMS]) {
    const s = String(raw ?? '').trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= MAX_CONTEXTUAL_STRINGS) break;
  }
  return out;
}

/** Recognizer errors that mean the server recognizer cannot be used now (expo-speech-recognition error codes). */
export function isServerFailure(error: string | undefined): boolean {
  return error === 'network' || error === 'service-not-allowed';
}

/**
 * Server recognizer first, on-device after the server fails once (only when the device has on-device recognition;
 * without it there is nothing to fall back to, so it keeps trying the server).
 */
export function createRecognizerChoice() {
  let serverFailed = false;
  return {
    /** the value for `requiresOnDeviceRecognition` */
    requiresOnDevice(onDeviceSupported: boolean): boolean {
      return serverFailed && onDeviceSupported;
    },
    /** feed each recognizer error of a session started with requiresOnDevice=false; true when this switches to on-device */
    serverError(error: string | undefined, onDeviceSupported: boolean): boolean {
      if (serverFailed || !onDeviceSupported || !isServerFailure(error)) return false;
      serverFailed = true;
      return true;
    },
  };
}
