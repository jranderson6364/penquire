import type { HelpLevel, Obstacle } from '../ai/types.ts';

/**
 * Assistance-aware issue history. A fix made right after a strong hint is useful practice but weak evidence that the
 * student can do that step alone (Bastani et al. 2025), so every issue remembers the most help that was in force
 * while it was open, and how it ended. Pure logic; persisted as Assignment.issues.
 *
 * An issue is a flagged line, keyed like the hint ladder (part + transcribed reading) and scoped to its page.
 * "Resolved" means it is no longer flagged on a later check of the same page: the line was fixed, or rewritten so
 * that it reads differently. That is the honest name for what we can observe.
 */
export type IssueRecord = {
  page: string;
  part?: string;
  reading: string;
  obstacle?: Obstacle;
  firstSeen: number;
  lastSeen: number;
  /** checks in a row in which this issue was still flagged */
  checks: number;
  /** most help in force while it was open (default level or a ladder rung) */
  maxLevel: HelpLevel;
};

export type Issues = Record<string, IssueRecord>;

export type OpenIssue = { key: string; part?: string; reading: string; obstacle?: Obstacle; level: HelpLevel };

export type Resolved = { key: string; record: IssueRecord };

/** Help at or below this level counts as "on your own": marks and a pointer to where to look. */
export const UNAIDED_MAX: HelpLevel = 1;

const scoped = (page: string, key: string) => `${page}#${key}`;

/**
 * Fold one check of `page` into the history. Issues of this page that are no longer open are returned as resolved
 * (and removed); issues on other pages are untouched.
 */
export function recordCheck(prev: Issues, page: string, open: OpenIssue[], now: number): { issues: Issues; resolved: Resolved[] } {
  const next: Issues = {};
  const openKeys = new Set(open.map((o) => scoped(page, o.key)));
  const resolved: Resolved[] = [];
  for (const [k, rec] of Object.entries(prev)) {
    if (rec.page !== page || openKeys.has(k)) next[k] = rec;
    else resolved.push({ key: k, record: rec });
  }
  for (const o of open) {
    const k = scoped(page, o.key);
    const old = next[k];
    next[k] = old
      ? { ...old, lastSeen: now, checks: old.checks + 1, maxLevel: Math.max(old.maxLevel, o.level) as HelpLevel, obstacle: o.obstacle ?? old.obstacle }
      : { page, part: o.part, reading: o.reading, obstacle: o.obstacle, firstSeen: now, lastSeen: now, checks: 1, maxLevel: o.level };
  }
  return { issues: next, resolved };
}

/** Raise the help recorded for an open issue (e.g. after "More help"). */
export function noteHelp(prev: Issues, page: string, key: string, level: HelpLevel): Issues {
  const k = scoped(page, key);
  const rec = prev[k];
  if (!rec || rec.maxLevel >= level) return prev;
  return { ...prev, [k]: { ...rec, maxLevel: level } };
}

export function getIssue(issues: Issues | undefined, page: string, key: string): IssueRecord | undefined {
  return issues?.[scoped(page, key)];
}

/** Still flagged after at least one more check: same line, same reading. Time to change the kind of help. */
export function isRepeat(rec: IssueRecord | undefined): boolean {
  return !!rec && rec.checks >= 2;
}

export const resolvedUnaided = (level: HelpLevel | undefined) => (level ?? 0) <= UNAIDED_MAX;
