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
};

export type ParseInput = {
  title: string;
  pdfBase64?: string;
  text?: string;
  /** e.g. "3.8, 3.10, 3.12" when the PDF is a whole textbook chapter */
  onlyProblems?: string;
};

export type ParseResult = { course?: string; problems: Problem[] };

export interface TutorProvider {
  readonly id: string;
  parseAssignment(input: ParseInput): Promise<ParseResult>;
  check(input: CheckInput): Promise<CheckResult>;
  reply(input: ReplyInput): Promise<string>;
}
