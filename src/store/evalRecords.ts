import type { HelpLevel, LineRef, LineVerdict, Problem, Verdict } from '../ai/types';

/**
 * Accuracy feedback ("was this mark right?") for building an eval set.
 * Pure logic only (no expo imports) so it runs under `node --test`.
 */

/** up = mark and note were right · down = verdict OK but the note was unhelpful · wrong = verdict wrong · misread = `reading` wrong */
export type Rating = 'up' | 'down' | 'wrong' | 'misread';

/** Everything needed to replay one check later, independent of the assignment (which may be deleted). */
export type CheckSnapshot = {
  checkId: string;
  checkedAt: number;
  assignmentId: string;
  course: string;
  assignmentTitle: string;
  policy: string;
  helpLevel: HelpLevel;
  problems: Problem[];
  page: number;
  model: string;
  lines: LineRef[];
  verdicts: LineVerdict[];
  /** file name under evals/images/, or null if the page image wasn't saved (checks from before this feature) */
  image: string | null;
};

export type MarkFeedback = {
  checkId: string;
  lineId: string;
  at: number;
  rating: Rating;
  /** what the verdict should have been (rating = 'wrong') */
  correctVerdict?: Verdict;
  /** what the line actually says (rating = 'misread') */
  correctReading?: string;
  comment?: string;
};

export type EvalStore = { version: 1; checks: CheckSnapshot[]; feedback: MarkFeedback[] };

export const emptyEvalStore = (): EvalStore => ({ version: 1, checks: [], feedback: [] });

/** One rating per mark: a later rating of the same (check, line) replaces the earlier one. */
export function upsertFeedback(store: EvalStore, snapshot: CheckSnapshot, fb: MarkFeedback): EvalStore {
  const checks = store.checks.some((c) => c.checkId === snapshot.checkId) ? store.checks : [...store.checks, snapshot];
  const feedback = [...store.feedback.filter((f) => !(f.checkId === fb.checkId && f.lineId === fb.lineId)), fb];
  return { ...store, checks, feedback };
}

export function feedbackFor(store: EvalStore, checkId: string, lineId: string): MarkFeedback | undefined {
  return store.feedback.find((f) => f.checkId === checkId && f.lineId === lineId);
}

export function feedbackStats(store: EvalStore): { ratings: number; checks: number; wrong: number } {
  return {
    ratings: store.feedback.length,
    checks: new Set(store.feedback.map((f) => f.checkId)).size,
    wrong: store.feedback.filter((f) => f.rating === 'wrong' || f.rating === 'misread').length,
  };
}

export type EvalExport = {
  format: 'penquire-evals';
  version: 1;
  exportedAt: string;
  checks: (CheckSnapshot & {
    imageBase64: string | null;
    feedback: MarkFeedback[];
    /** the ink at check time (native apiVersion >= 3): makes the case replayable through line grouping and reading */
    strokes?: unknown;
  })[];
};

/** Self-contained export: each rated check with its page image (PNG base64) and its ratings. */
export function buildExport(store: EvalStore, readImage: (name: string) => string | null, now = Date.now()): EvalExport {
  const rated = new Set(store.feedback.map((f) => f.checkId));
  return {
    format: 'penquire-evals',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    checks: store.checks
      .filter((c) => rated.has(c.checkId))
      .map((c) => ({
        ...c,
        imageBase64: c.image ? readImage(c.image) : null,
        feedback: store.feedback.filter((f) => f.checkId === c.checkId),
      })),
  };
}
