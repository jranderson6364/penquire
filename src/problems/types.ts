/**
 * Structured problems. A real problem is usually: a shared SETUP (context), then lettered PARTS (a-d) that
 * may have numbered SUBPARTS (i-iii) and hints, then sometimes CLOSING instructions that apply to all parts.
 * The shared context is stored once (not repeated in every part). The flat `Problem[]` the tutor and the part
 * picker use is derived from this by `flatten`, so labels stay stable ("6a", "1b.ii").
 */
export type Subpart = { label: string; text: string; hint?: string };

export type Part = {
  label: string;
  /** verbatim text of this part (its own lead-in, not the shared context), math in LaTeX */
  text: string;
  hint?: string;
  /** every distinct thing a complete answer to this part must contain */
  asksFor: string[];
  subparts: Subpart[];
};

export type ProblemGroup = {
  /** "6", "3.10" */
  label: string;
  title?: string;
  /** shared setup before the first part: scenario, given values, equations, figure placeholders. Stored once. */
  context: string;
  parts: Part[];
  /** text AFTER the parts that applies to all of them ("For each case (a and b), ...") */
  closing?: string;
  /** a hint that belongs to the whole problem */
  hint?: string;
  /** requirements of the whole problem (the main place for a problem that has no parts) */
  asksFor: string[];
};

export type ParsedAssignment = {
  course?: string;
  /** assignment-level text that is not a problem: reading instructions, logistics, policies */
  notes: string[];
  groups: ProblemGroup[];
};

export type IssueSeverity = 'error' | 'warn';

export type ParseIssue = {
  severity: IssueSeverity;
  code: 'duplicate-problem' | 'part-gap' | 'empty-text' | 'empty-problem' | 'part-repeats-context' | 'duplicate-part' | 'latex' | 'missing-problem' | 'order';
  /** problem label, and part label when relevant */
  problem?: string;
  part?: string;
  message: string;
};
