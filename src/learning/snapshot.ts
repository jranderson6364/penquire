// Immutable page snapshots: a copy of the page's drawing file at a moment, never the live `pages/<id>.pk`.
import type { Line } from '../ink/lines';
import { newId, readPage, readSnapshotFile, snapshotFileExists, writeSnapshotFile } from '../store/db';
import { makeSnapshot, pickFreeId } from '../store/episodes';
import type { Snapshot } from './types';

/**
 * Copies the page's saved drawing into `snapshots/<snapshotId>.pk` (Snapshot.pageFile is that path, relative to the
 * store root). The caller must flush the live canvas to the page file first, or the copy is of the last save.
 * An empty page is copied as an empty file. Latest-check data is not touched.
 */
export function takeSnapshot(pageId: string, lines: Line[], strokeCount: number, now: number): Snapshot {
  const id = pickFreeId(() => newId('s_'), snapshotFileExists);
  writeSnapshotFile(id, readPage(pageId));
  return makeSnapshot(id, lines, strokeCount, now);
}

/** The snapshot's drawing data (base64 PKDrawing), for rendering or sending the submitted page. '' if missing. */
export function readSnapshot(s: Snapshot): string {
  return readSnapshotFile(s.id);
}
