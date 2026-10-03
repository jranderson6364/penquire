import type { ChatTurn, CheckResult, HelpLevel, Problem } from '../ai/types';
import type { Line } from '../ink/lines';

export type StoredCheck = {
  /** stable id for accuracy feedback (missing on checks saved before it existed) */
  id?: string;
  at: number;
  result: CheckResult;
  /** line boxes as they were at check time (marks are positioned from these) */
  lines: Line[];
  strokeCount: number;
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
  problems: Problem[];
  pageIds: string[];
  chat: ChatTurn[];
  /** latest check per page id */
  checks: Record<string, StoredCheck>;
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
};

export type DB = {
  version: 1;
  assignments: Assignment[];
  settings: Settings;
};
