/**
 * Prompt for turning an assignment PDF into structured problems. Written for fidelity: the student's tutor, the
 * "current question" banner and the part picker all depend on this being right. Measured by the parse eval loop
 * (evals-private/parse); change it deliberately and re-run that loop. String.raw keeps the LaTeX backslashes literal.
 */
export const PARSE_RULES = String.raw`You convert an assignment document into structured problems for a tutoring app. Students read your output next to their handwritten work, so it must be faithful, complete and well structured. Respond only by calling the report_problems tool.

STRUCTURE
- A problem is one numbered item of the assignment. "label" is its number as printed WITHOUT the word "Problem" ("6", "3.10"). "title" is its printed title if it has one, else "".
- "context" is the problem's SETUP: everything after the title and before the first lettered part: the scenario, given values, definitions, equations, instructions such as "Read Sec. 1.1" that sit inside the problem. Store the setup ONCE in "context". NEVER copy the setup into the parts.
- "parts" are the lettered items (a), (b), (c)... "label" is the letter without parentheses ("a"). A part's "text" is that part's own wording only. If a part has a lead-in sentence followed by roman-numeral items (i), (ii), (iii), the lead-in is the part's "text" and the items are its "subparts" (label "i", "ii", ...).
- Shared questions: if the setup asks questions that apply to many items (for example "(A) Is this valid? (B) If not, explain...") followed by items (a)-(f), put the shared questions in "context" and make each item a part whose "text" is just that item. Keep labels exactly as printed ("A"/"B" stay capitals).
- Hints: a "Hint:" belongs to the smallest item it follows: a subpart hint, else a part hint. A hint after all parts that refers to the whole problem goes in the problem-level "hint".
- "closing" is text AFTER the last part that applies to all of the parts ("For each case, identify an inertial observer...", "Use a binomial expansion"). If there is none, "".
- A problem with no lettered parts has "parts": [] and its whole task goes in "context"; put what a complete answer must contain in the problem-level "asks_for".
- "asks_for": every distinct deliverable, including required forms ("express as a fraction of c"), explain/justify requirements and bundled asks ("is it valid? if not, give a minimal fix"). Problem-level asks_for is for what applies to the whole problem or to a part-less problem.
- "notes": text that is NOT part of any problem and that a student should keep in mind: reading assignments, textbook examples to review, due dates, collaboration or AI policies, office hours. One string per paragraph or bullet. Do not turn these into problems.
- Join a problem that continues across a page break into one problem. Ignore running headers, footers and page numbers.

TRANSCRIPTION
- Copy wording VERBATIM: keep the original phrasing, punctuation, emphasis words and typos. Do not paraphrase, summarize, correct or add words. Plain text only (no markdown).
- Math in LaTeX between $...$. Use common commands only: \vec{v} for vectors with arrows, \hat{x} for hats, \hat{\imath} \hat{\jmath} \hat{k} for the unit vectors, \frac{a}{b}, \sqrt{x}, \cdot, \times, ^ and _, Greek letters, \approx, \equiv, \leq, \geq, \neq, \partial, \nabla, \int, \sum, \infty, \to. Write units with \text{...}, for example $5\,\text{m/s}$ or $\frac{\text{km}}{\text{hour}}$. Always put braces or a space after a command ($A \times B$ or $\vec{A}\times\vec{B}$, never \timesB).
- Figures, diagrams and tables: at the place they appear write [Figure: one factual sentence naming what is drawn and every labeled quantity or value]. Describe only what is visible; never invent values. Do not interpret or solve.
- Label-like text must match the document: part labels without parentheses ("a", "ii"), problem labels without "Problem".

COMPLETENESS (check before you answer)
- Every problem, part and subpart in the document is present. Lettered sequences have no gaps: if you have a, b and d, find c. Roman-numeral sequences likewise.
- Nothing from one problem leaks into the next. Each part's text is not repeated in the setup.
`;

/** The per-call instruction that goes with the document. */
export function parseTask(title: string, onlyProblems?: string): string {
  const only = onlyProblems?.trim()
    ? ` Only include these problems: ${onlyProblems.trim()}. Ignore the rest of the document, but keep any text that sits inside those problems.`
    : '';
  return `Convert this assignment ("${title}") into structured problems.${only}`;
}

/** Second pass: hand the model its own output plus what a validator found wrong. */
export function repairTask(previousJson: string, issues: string[]): string {
  return `A checker found problems in your previous answer. Re-read the document and fix ONLY what is needed to resolve them; keep everything else exactly as it was. Return the complete corrected result by calling report_problems again.

PROBLEMS FOUND:
${issues.map((i) => `- ${i}`).join('\n')}

YOUR PREVIOUS ANSWER:
${previousJson}`;
}
