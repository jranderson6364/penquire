/**
 * Hands-free conversation (docs/10 §4.2): when has the student finished a turn? Pure (tested).
 *
 * A fixed silence timer always trades cut-offs against dead air (T01: 1.3 s after one word cut Jason off). So the
 * wait is measured from the last sign of speech (live mic level, or else a changed partial transcript) and depends on
 * how the words end: longer mid-clause ("so I distributed the two and"), on a number or operator, or when only a
 * few words were said; shorter after a clear question. The student can always send now by tapping. A conversation
 * ends by itself when nobody has said anything for a while, so the microphone never stays open forever.
 */
export const END_OF_TURN_MS = 2200;
/** mid-clause, a number or operator at the end, or fewer than SHORT_TURN_WORDS words */
export const HOLD_END_MS = 3500;
/** the student asked a question ("is that right?") */
export const QUESTION_END_MS = 1200;
export const SHORT_TURN_WORDS = 4;
export const IDLE_END_MS = 30_000;

export type TurnState = {
  startedAt: number;
  /** when the partial transcript last changed */
  lastChangeAt: number;
  /** when the mic level was last above the voice threshold (absent on a recognizer that sends no levels) */
  lastVoiceAt?: number;
  text: string;
  /** the student tapped "send now" */
  sendNow?: boolean;
};

/** words that leave a sentence unfinished when it stops on them */
const OPEN_ENDINGS = new Set(
  'and so because but or then the a an of to is are was equals equal plus minus times over divided by into with which that if when my i we it its it\'s this than from for as at on in squared'.split(' ')
);
const NUMBER_WORDS = new Set('zero one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand point negative half'.split(' '));

/** How long a pause after these words should be before the turn is sent. */
export function endDelay(text: string): number {
  const t = text.trim();
  if (/\?\s*$/.test(t)) return QUESTION_END_MS;
  // the recognizer adds punctuation at pauses ("so I distributed the two and."): judge the words, not the period
  const bare = t.replace(/[\s.,;:!…]+$/, '');
  const words = bare.split(/\s+/).filter(Boolean);
  const last = (words[words.length - 1] ?? '').toLowerCase();
  if (words.length < SHORT_TURN_WORDS) return HOLD_END_MS;
  if (OPEN_ENDINGS.has(last) || NUMBER_WORDS.has(last) || /[\d+\-−=×*/^(]$/.test(bare)) return HOLD_END_MS;
  return END_OF_TURN_MS;
}

const lastSign = (s: TurnState) => Math.max(s.lastChangeAt, s.lastVoiceAt ?? 0);

export function turnDecision(s: TurnState, now: number): 'wait' | 'send' | 'give_up' {
  const said = !!s.text.trim();
  if (said && s.sendNow) return 'send';
  if (said && now - lastSign(s) >= endDelay(s.text)) return 'send';
  if (!said && now - Math.max(s.startedAt, s.lastVoiceAt ?? 0) >= IDLE_END_MS) return 'give_up';
  return 'wait';
}

/** For the live status: is the student talking right now, or pausing (the tutor is waiting for them)? */
export function listenState(s: TurnState, now: number): 'listening' | 'waiting' {
  return now - lastSign(s) < 700 ? 'listening' : 'waiting';
}

/**
 * Voice activity from the recognizer's mic level (expo-speech-recognition `volumechange`, about -2 to 10; below 0 is
 * inaudible). The threshold follows the room's noise floor: a slowly rising minimum. Tune VOICE_* on the iPad.
 */
export const VOICE_MIN_LEVEL = 1;
export const VOICE_MARGIN = 2.5;

export function createVoiceActivity() {
  let floor: number | undefined;
  return {
    /** feed one level reading; true when it sounds like someone is talking */
    sample(level: number): boolean {
      if (!Number.isFinite(level)) return false;
      floor = floor === undefined || level < floor ? level : floor + (level - floor) * 0.02;
      return level >= Math.max(VOICE_MIN_LEVEL, floor + VOICE_MARGIN);
    },
  };
}
