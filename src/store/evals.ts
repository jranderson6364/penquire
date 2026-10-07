import { Directory, File, Paths } from 'expo-file-system';

import { buildExport, emptyEvalStore, upsertFeedback, type CheckSnapshot, type EvalStore, type MarkFeedback } from './evalRecords';

/**
 * Accuracy feedback store, kept apart from db.json so it outlives deleted assignments.
 *  penquire/checks/<pageId>.png       image the model saw at the latest check of each page
 *  penquire/evals/feedback.json       check snapshots + ratings (EvalStore)
 *  penquire/evals/images/<checkId>.png  page images of rated checks
 *  penquire/evals/export-<ts>.json    files made by "Export", shared from Settings
 */
const root = new Directory(Paths.document, 'penquire');
const checkImagesDir = new Directory(root, 'checks');
const evalsDir = new Directory(root, 'evals');
const imagesDir = new Directory(evalsDir, 'images');
const strokesDir = new Directory(evalsDir, 'strokes');
const storeFile = new File(evalsDir, 'feedback.json');

let cache: EvalStore | null = null;
const listeners = new Set<() => void>();

const ensure = (d: Directory) => {
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
};

export function loadEvals(): EvalStore {
  if (cache) return cache;
  if (storeFile.exists) {
    try {
      cache = JSON.parse(storeFile.textSync()) as EvalStore;
      return cache;
    } catch (e) {
      console.warn('feedback.json unreadable, starting fresh', e);
    }
  }
  cache = emptyEvalStore();
  return cache;
}

export function subscribeEvals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keep the exact image sent to the model so later feedback is paired with what it saw, not a re-export. */
export function saveCheckImage(pageId: string, pngBase64: string) {
  ensure(checkImagesDir);
  const f = new File(checkImagesDir, `${pageId}.png`);
  if (!f.exists) f.create({ intermediates: true });
  f.write(pngBase64, { encoding: 'base64' });
}

/** Keep the ink (stroke points, native apiVersion >= 3) of the latest check, so a rated check can be replayed. */
export function saveCheckStrokes(pageId: string, strokes: unknown | null) {
  ensure(checkImagesDir);
  const f = new File(checkImagesDir, `${pageId}.strokes.json`);
  if (strokes == null) {
    if (f.exists) f.delete();
    return;
  }
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(strokes));
}

/**
 * Record a rating. The first rating of a check copies its page image into evals/images (and its ink into evals/strokes).
 * `snapshot.image` is ignored; it's filled in here from the saved check image, if one exists.
 */
export function recordFeedback(pageId: string, snapshot: Omit<CheckSnapshot, 'image'>, fb: MarkFeedback) {
  const store = loadEvals();
  let image: string | null = store.checks.find((c) => c.checkId === snapshot.checkId)?.image ?? null;
  if (!store.checks.some((c) => c.checkId === snapshot.checkId)) {
    const src = new File(checkImagesDir, `${pageId}.png`);
    if (src.exists) {
      ensure(imagesDir);
      const name = `${snapshot.checkId}.png`;
      const dest = new File(imagesDir, name);
      if (!dest.exists) src.copySync(dest);
      image = name;
    }
    const ink = new File(checkImagesDir, `${pageId}.strokes.json`);
    if (ink.exists) {
      ensure(strokesDir);
      const dest = new File(strokesDir, `${snapshot.checkId}.json`);
      if (!dest.exists) ink.copySync(dest);
    }
  }
  cache = upsertFeedback(store, { ...snapshot, image }, fb);
  ensure(evalsDir);
  if (!storeFile.exists) storeFile.create({ intermediates: true });
  storeFile.write(JSON.stringify(cache));
  listeners.forEach((l) => l());
}

/** Write a self-contained JSON export (images embedded) and return its file:// URI for the share sheet. */
export function writeExport(): string {
  const built = buildExport(loadEvals(), (name) => {
    const f = new File(imagesDir, name);
    return f.exists ? f.base64Sync() : null;
  });
  const data = {
    ...built,
    checks: built.checks.map((c) => {
      const f = new File(strokesDir, `${c.checkId}.json`);
      if (!f.exists) return c;
      try {
        return { ...c, strokes: JSON.parse(f.textSync()) as unknown };
      } catch {
        return c;
      }
    }),
  };
  ensure(evalsDir);
  const stamp = data.exportedAt.replace(/[:.]/g, '-');
  const f = new File(evalsDir, `export-${stamp}.json`);
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(data));
  return f.uri;
}
