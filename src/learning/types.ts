import type { HelpLevel, RevealKind } from '../ai/types';
import type { Line } from '../ink/lines';

export type Phase = 'attempt' | 'repair' | 'repair_verified' | 'independent' | 'independent_submitted' | 'outcome';
export type AttemptKind = 'initial' | 'repair' | 'independent' | 'supported_practice';
export type HelpMove = 'check' | 'pointer' | 'explain' | 'example' | 'step' | 'start' | 'dispute';
export type Channel = 'marks' | 'text' | 'speech';

/** Help that was actually delivered (not just selected). Unknown exposure stays 'unknown'. */
export type Assistance = {
  id: string; episodeId: string; attemptId: string;
  move: HelpMove; level: HelpLevel; channels: Channel[];
  revealed: RevealKind[] | 'unknown';
  /** bounded copy of delivered text (<= 2000 chars) */
  text?: string;
  at: number;
};

/** Immutable copy of a page at a moment; never points at the "latest" files. */
export type Snapshot = { id: string; pageFile: string; strokeCount: number; lines: Line[]; at: number };

export type AssessmentResult = 'pass' | 'needs_practice' | 'unassessable';
export type Assessment = {
  result: AssessmentResult;
  reasons: string[];
  /** 'rehearsal' outcomes are never learner evidence */
  source: 'provider+rubric' | 'rehearsal';
  packVersion: string;
  snapshotId: string;
  at: number;
};

export type Attempt = {
  id: string; episodeId: string; kind: AttemptKind;
  taskId: string; pageId: string;
  startedAt: number; submittedAt?: number;
  snapshot?: Snapshot;
  assistanceIds: string[];
  allowedResources: string[];
  /** student-confirmed readings of the submitted lines */
  readings?: string[];
  assessment?: Assessment;
  /** set when work changed after assessment; the assessment no longer counts */
  invalidatedAt?: number;
};

export type OutcomeLabel = 'repair_verified' | 'passed_independent' | 'needs_practice' | 'could_not_assess' | 'supported_practice';

export type EpisodePolicy = { maxLevel: HelpLevel; allowExplain: boolean; allowExample: boolean };

export type Episode = {
  id: string; assignmentId: string; part?: string;
  skillId: string; packVersion: string;
  policy: EpisodePolicy;
  phase: Phase;
  attempts: Record<string, Attempt>;
  initialAttemptId?: string; repairAttemptId?: string; independentAttemptId?: string;
  assistance: Assistance[];
  repairVerifiedAt?: number;
  outcome?: { label: OutcomeLabel; at: number };
  reviewDueAt?: number; reviewTaskId?: string;
  /** stays undefined until a real delayed attempt happens (not in demo scope) */
  delayedOutcome?: Assessment;
  /** fixture/rehearsal episodes are labeled everywhere and excluded from evidence */
  rehearsal: boolean;
  createdAt: number; updatedAt: number;
};

export type RequestScope = { episodeId: string; attemptId: string; phase: Phase };

export type DemoTaskRole = 'recovery' | 'example' | 'independent' | 'review';
export type DemoTask = {
  id: string; role: DemoTaskRole;
  /** learner-facing statement only */
  prompt: string;
  /** what a complete answer must include, worded from the prompt (learner-facing, not a key) */
  asksFor: string[];
  asksForExplanation: boolean;
  /**
   * answer key: never shown or sent as learner context before that task's submission. `acceptedSteps` are equations
   * any equivalent of which shows the key step; `keyStep` names that step in a post-submission reason.
   */
  expected: { finalAnswer: string; acceptedSteps: string[]; keyStep: string; keyIdea: string; rubric: string[] };
  /** worked solution text, only for role 'example' */
  workedSolution?: string;
};
export type DemoPack = { version: string; skillId: string; title: string; policy: EpisodePolicy; tasks: DemoTask[] };
