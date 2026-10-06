export type HelpLevel = 0 | 1 | 2 | 3 | 4;

export type Problem = {
  /** e.g. "3.10c" */
  label: string;
  /** Verbatim problem text, math in LaTeX */
  text: string;
  /** Everything a complete answer must contain, e.g. ["cosine of the angle (exact form)", "one-sentence justification"] */
  asksFor: string[];
};

export type Verdict = 'valid' | 'partial' | 'incorrect' | 'unreadable' | 'context';

/**
 * What kind of obstacle a non-valid line shows (a hypothesis about the work, never a label for the student).
 * It decides the kind of help, and is logged so recurring obstacle types can feed review later.
 */
export type Obstacle =
  | 'slip' // sound plan, local execution error
  | 'method' // inapplicable method or strategy
  | 'notation' // can't read or use the notation / missing vocabulary
  | 'prerequisite' // missing earlier skill (e.g. the algebra under the physics)
  | 'misconception' // coherent wrong idea
  | 'no_work' // correct result, reasoning not shown
  | 'incomplete' // a deliverable the part asks for is missing
  | 'alt_path' // valid approach different from the expected one
  | 'unclear'; // the work doesn't tell these apart

export const OBSTACLES: readonly Obstacle[] = ['slip', 'method', 'notation', 'prerequisite', 'misconception', 'no_work', 'incomplete', 'alt_path', 'unclear'];

/** Kinds of information a tutor response can give away, ordered by the lowest help level that allows them. */
export type RevealKind = 'location' | 'principle' | 'example' | 'subgoal' | 'step';
export const REVEAL_KINDS: readonly RevealKind[] = ['location', 'principle', 'example', 'subgoal', 'step'];
export type Revealed = { kind: RevealKind; what: string };

/** A chat reply started from a button: help me start a part, dispute a mark, or more help on one issue. */
export type ReplyIntent = 'start' | 'dispute' | 'more_help';

export type LineVerdict = {
  id: string; // "L4"
  part?: string; // "3.10c"
  reading: string; // how the model read the line (LaTeX/plain)
  verdict: Verdict;
  note: string; // one clause: why / what to look at (never the fix)
  /** fingerprint of the line's ink when it was checked (src/check/carry.ts); lets a later check skip unchanged lines */
  sig?: string;
  /** kind of obstacle (non-valid lines only; absent when the model gave none) */
  obstacle?: Obstacle;
  /** how sure the model was of `reading`, stated before grading (absent on older checks) */
  readConfidence?: 'high' | 'medium' | 'low';
  /** the characters of `reading` the model was unsure of */
  uncertain?: string;
  /** set when deterministic code (not the model) lowered this verdict: the algebra guard, or a low-confidence reading */
  guard?: 'algebra' | 'reading';
  /** the model's own verdict before a guard lowered it (for evals: model error vs guard error) */
  modelVerdict?: Verdict;
};

export type PartStatus = {
  label: string;
  status: 'complete' | 'in_progress' | 'missing_items' | 'not_started';
  missing: string[];
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type CheckResult = {
  lines: LineVerdict[];
  parts: PartStatus[];
  /** short markdown summary in the tutor's format */
  feedback: string;
  /** exactly one guiding question */
  question: string;
  fixedSinceLast: string[];
  /** formulas withheld from the text by the leak guard (for evals / transparency) */
  leaksBlocked?: { fragment: string; why: string }[];
  stillOpen: string[];
  /** what this check's feedback gave away, as reported by the model (for the disclosure and evals) */
  revealed?: Revealed[];
  /** reveal kinds above the help level used (src/tutor/revealed.ts); kept for evals and an honest disclosure */
  overLevel?: RevealKind[];
  model: string;
  usage?: Usage;
};

export type TutorContext = {
  course: string;
  assignmentTitle: string;
  problems: Problem[];
  /** structured problems (setup once); when they match `problems`, the tutor reads these instead (prompts.ts problemsText) */
  groups?: import('../problems/types').ProblemGroup[];
  /** Free text course AI policy, e.g. "AI only in Socratic mode: clarify concepts or check reasoning" */
  policy: string;
  helpLevel: HelpLevel;
  /** Optional student style preferences ("be brief", "more physical intuition") */
  style?: string;
};

export type PageImage = { base64: string; mediaType: 'image/png' | 'image/jpeg' };

export type LineRef = { id: string; x: number; y: number; w: number; h: number };

export type CheckInput = TutorContext & {
  image: PageImage;
  lines: LineRef[];
  pageNumber: number;
  focusPart?: string;
  previous?: { feedback: string; stillOpen: string[] };
  /** lines verified by an earlier check and unchanged since (src/check/carry.ts): context only, not to be graded */
  settled?: { id: string; part?: string; reading: string }[];
};

export type ChatTurn = { role: 'user' | 'assistant'; text: string; /** estimated cost of the call that produced this reply */ costUSD?: number };

export type ReplyInput = TutorContext & {
  history: ChatTurn[];
  message: string;
  /** attach the current page when the student asks about their work */
  image?: PageImage;
  lastCheck?: { feedback: string; stillOpen: string[] };
  /** the latest check's transcribed lines, so the leak guard can judge the reply against the student's work */
  lines?: { id: string; reading: string; verdict: string }[];
  /** set when the reply came from a button (Help me start, I think this is right, More help) */
  intent?: ReplyIntent;
  /** the part the student is working on, for intent 'start' */
  part?: string;
  /**
   * Line IDs drawn in the gutter of the attached page image. When present the tutor may point at them with marks
   * (highlight / circle / underline / note); without a labelled page image it cannot.
   */
  markLineIds?: string[];
};

/** A chat reply: the message, plus where on the page the tutor pointed (model output, sanitised, not yet placed). */
export type ReplyResult = { text: string; marks: import('../tutor/marks').RawMark[] };

export type ParseInput = {
  title: string;
  pdfBase64?: string;
  text?: string;
  /** e.g. "3.8, 3.10, 3.12" when the PDF is a whole textbook chapter */
  onlyProblems?: string;
};

export type ParseResult = {
  course?: string;
  /** flat per-part problems (labels like "6a"); derived from `groups` and used by the tutor, part picker and snapshots */
  problems: Problem[];
  /** structured problems: setup once, then parts, sub-parts, hints and closing text */
  groups?: import('../problems/types').ProblemGroup[];
  /** assignment-level text that is not a problem */
  notes?: string[];
  /** what the validator still found wrong after the repair pass, to show the student */
  issues?: import('../problems/types').ParseIssue[];
};

export interface TutorProvider {
  readonly id: string;
  parseAssignment(input: ParseInput): Promise<ParseResult>;
  check(input: CheckInput): Promise<CheckResult>;
  reply(input: ReplyInput): Promise<ReplyResult>;
}
