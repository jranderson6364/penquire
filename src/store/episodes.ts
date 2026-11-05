/**
 * Pure helpers behind the episode store in db.ts (which imports expo-file-system and cannot load under node).
 * Everything here works on plain objects so it can be tested.
 */
import type { DB } from './types';
import type { Episode, Snapshot } from '../learning/types';
import type { Line } from '../ink/lines';

/** Older db.json files have no `episodes`; treat that as an empty list. Nothing else changes. */
export function normalizeDb(parsed: DB): DB {
  return { ...parsed, episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [] };
}

/** Replace the episode with the same id, or append it. The episode is stored as given (its updatedAt is the caller's). */
export function upsertEpisode(list: Episode[], ep: Episode): Episode[] {
  const idx = list.findIndex((x) => x.id === ep.id);
  if (idx < 0) return [...list, ep];
  const next = [...list];
  next[idx] = ep;
  return next;
}

/** Published path of a snapshot file, relative to the store root. It is named by the snapshot id, so it is never reused. */
export const snapshotFileName = (id: string) => `snapshots/${id}.pk`;

/** Try generated ids until one is free, so a snapshot can never overwrite an earlier one. */
export function pickFreeId(gen: () => string, exists: (id: string) => boolean, tries = 8): string {
  for (let i = 0; i < tries; i++) {
    const id = gen();
    if (!exists(id)) return id;
  }
  throw new Error('could not pick a free snapshot id');
}

/** Deep copy of line boxes (including stroke index arrays) so later edits of the live lines cannot change a snapshot. */
export const copyLines = (lines: Line[]): Line[] => lines.map((l) => ({ ...l, strokes: [...l.strokes] }));

export function makeSnapshot(id: string, lines: Line[], strokeCount: number, now: number): Snapshot {
  return { id, pageFile: snapshotFileName(id), strokeCount, lines: copyLines(lines), at: now };
}

/** Snapshots referenced by an episode's attempts. */
export function episodeSnapshots(ep: Episode): Snapshot[] {
  return Object.values(ep.attempts).flatMap((a) => (a.snapshot ? [a.snapshot] : []));
}

/**
 * What resetting one assignment's demo data removes: the assignment, the episodes for it, their pages (the
 * assignment's pageIds plus any attempt page, e.g. a separate independent page) and their snapshot files.
 * Settings, usage and every other assignment/episode are returned unchanged.
 */
export function demoScope(db: DB, assignmentId: string): { next: DB; pageIds: string[]; snapshotIds: string[] } {
  const a = db.assignments.find((x) => x.id === assignmentId);
  const eps = (db.episodes ?? []).filter((e) => e.assignmentId === assignmentId);
  const pageIds = new Set(a?.pageIds ?? []);
  eps.forEach((e) => Object.values(e.attempts).forEach((at) => pageIds.add(at.pageId)));
  // A page still used by a surviving assignment is never deleted.
  db.assignments.forEach((x) => x.id !== assignmentId && x.pageIds.forEach((p) => pageIds.delete(p)));
  const snapshotIds = eps.flatMap((e) => episodeSnapshots(e).map((s) => s.id));
  const next: DB = {
    ...db,
    assignments: db.assignments.filter((x) => x.id !== assignmentId),
    episodes: (db.episodes ?? []).filter((e) => e.assignmentId !== assignmentId),
  };
  return { next, pageIds: [...pageIds], snapshotIds };
}

/** demoScope for several assignments in turn (the current demo and retired pack versions), merged. */
export function demoScopes(db: DB, assignmentIds: readonly string[]): { next: DB; pageIds: string[]; snapshotIds: string[] } {
  let next = db;
  const pageIds: string[] = [];
  const snapshotIds: string[] = [];
  for (const id of assignmentIds) {
    const s = demoScope(next, id);
    next = s.next;
    pageIds.push(...s.pageIds);
    snapshotIds.push(...s.snapshotIds);
  }
  return { next, pageIds: [...new Set(pageIds)], snapshotIds: [...new Set(snapshotIds)] };
}
