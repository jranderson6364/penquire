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

export type LineVerdict = {
  id: string; // "L4"
  part?: string; // "3.10c"
  reading: string; // how the model read the line (LaTeX/plain)
  verdict: Verdict;
  note: string; // one clause: why / what to look at (never the fix)
  /** set when a deterministic guard (not the model) lowered this verdict */
  guard?: 'algebra';
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
  model: string;
  usage?: Usage;
};

export type TutorContext = {
  course: string;
  assignmentTitle: string;
  problems: Problem[];
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
};

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type ReplyInput = TutorContext & {
  history: ChatTurn[];
  message: string;
  /** attach the current page when the student asks about their work */
  image?: PageImage;
  lastCheck?: { feedback: string; stillOpen: string[] };
  /** the latest check's transcribed lines, so the leak guard can judge the reply against the student's work */
  lines?: { id: string; reading: string; verdict: string }[];
};

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
  reply(input: ReplyInput): Promise<string>;
}
