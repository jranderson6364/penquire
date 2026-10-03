import type { ChatTurn, CheckResult, HelpLevel, Problem } from '../ai/types';
import type { Line } from '../ink/lines';
import type { Ladder } from '../tutor/ladder';
import type { ParseIssue, ProblemGroup } from '../problems/types';
import type { UsageRecord } from './usageRecords';

export type StoredCheck = {
  /** stable id for accuracy feedback (missing on checks saved before it existed) */
  id?: string;
  at: number;
  result: CheckResult;
  /** line boxes as they were at check time (marks are positioned from these) */
  lines: Line[];
  strokeCount: number;
  /** 'page-v2': line boxes are in fixed-page space (apiVersion >= 2). Absent: the old view-sized canvas space. */
  space?: 'page-v2';
};

export type LogEvent = {
  t: number;
  type: 'parse' | 'check' | 'reply' | 'level_change';
  page?: number;
  level?: HelpLevel;
  detail?: string;
};

export type Assignment = {
  id: string;
  title: string;
  course: string;
  policy: string;
  /** maximum help level the course policy allows */
  policyMaxLevel: HelpLevel;
  helpLevel: HelpLevel;
  style: string;
  /** flat per-part problems (labels like "6a") used by the tutor, part picker and snapshots */
  problems: Problem[];
  /** structured problems (setup once, parts, sub-parts, hints, closing); absent on assignments parsed before this existed */
  groups?: ProblemGroup[];
  /** assignment-level text that is not a problem (reading, logistics, policies) */
  notes?: string[];
  /** what the validator still flagged after the repair pass */
  parseIssues?: ParseIssue[];
  /** page range of the source PDF that was parsed, e.g. "80-82" (large PDFs are sliced) */
  sourcePages?: string;
  /** the "only these problems" filter used when parsing, e.g. "3.8, 3.10, 3.12" */
  sourceOnly?: string;
  /** flat label of the question the student is working on ("6b"); persists between sessions */
  activePart?: string;
  pageIds: string[];
  chat: ChatTurn[];
  /** latest check per page id */
  checks: Record<string, StoredCheck>;
  /** hint-ladder rung per open issue (see src/tutor/ladder.ts); absent on older assignments */
  ladder?: Ladder;
  /** append-only hint/session log (integrity disclosure) */
  events: LogEvent[];
  createdAt: number;
  updatedAt: number;
};

export type Settings = {
  apiKey: string;
  checkModel: string;
  parseModel: string;
  paper: 'grid' | 'lined' | 'blank';
  allowFingerDrawing: boolean;
  /** persisted pen/eraser toolbar state (see src/tools.ts); validated on load */
  toolState?: unknown;
  /** show the current-question banner under the top bar */
  showQuestion?: boolean;
};

export type DB = {
  version: 1;
  assignments: Assignment[];
  settings: Settings;
  /** one entry per billed API call (see Settings > Usage) */
  usage?: UsageRecord[];
};
