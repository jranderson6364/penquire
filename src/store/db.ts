import { Directory, File, Paths } from 'expo-file-system';

import type { Assignment, DB, Settings } from './types';
import { appendRecord, makeRecord, type UsageRecord } from './usageRecords';
import type { Usage } from '../ai/types';

/**
 * Tiny local JSON store. Everything stays on the device for v0.
 *  penquire/db.json          assignments + settings
 *  penquire/pages/<id>.pk    PKDrawing data (base64)
 */
const root = new Directory(Paths.document, 'penquire');
const pagesDir = new Directory(root, 'pages');
const dbFile = new File(root, 'db.json');

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  checkModel: '',
  parseModel: '',
  paper: 'grid',
  allowFingerDrawing: false,
};

let cache: DB | null = null;
const listeners = new Set<() => void>();

function ensureDirs() {
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  if (!pagesDir.exists) pagesDir.create({ intermediates: true, idempotent: true });
}

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function load(): DB {
  if (cache) return cache;
  ensureDirs();
  if (dbFile.exists) {
    try {
      const parsed = JSON.parse(dbFile.textSync()) as DB;
      cache = { ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
      return cache;
    } catch (e) {
      console.warn('db.json unreadable, starting fresh', e);
    }
  }
  cache = { version: 1, assignments: [], settings: DEFAULT_SETTINGS };
  return cache;
}

function persist() {
  if (!cache) return;
  ensureDirs();
  if (!dbFile.exists) dbFile.create({ intermediates: true });
  dbFile.write(JSON.stringify(cache));
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAssignments(): Assignment[] {
  return [...load().assignments].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getAssignment(id: string): Assignment | undefined {
  return load().assignments.find((a) => a.id === id);
}

export function saveAssignment(a: Assignment) {
  const db = load();
  const next = { ...a, updatedAt: Date.now() };
  const idx = db.assignments.findIndex((x) => x.id === a.id);
  if (idx >= 0) db.assignments[idx] = next;
  else db.assignments.push(next);
  persist();
  return next;
}

export function updateAssignment(id: string, patch: (a: Assignment) => Assignment): Assignment | undefined {
  const a = getAssignment(id);
  if (!a) return undefined;
  return saveAssignment(patch(a));
}

export function deleteAssignment(id: string) {
  const db = load();
  const a = db.assignments.find((x) => x.id === id);
  a?.pageIds.forEach((pid) => {
    const f = new File(pagesDir, `${pid}.pk`);
    if (f.exists) f.delete();
  });
  db.assignments = db.assignments.filter((x) => x.id !== id);
  persist();
}

export function getSettings(): Settings {
  return load().settings;
}

export function saveSettings(patch: Partial<Settings>) {
  const db = load();
  db.settings = { ...db.settings, ...patch };
  persist();
}

export function readPage(pageId: string): string {
  ensureDirs();
  const f = new File(pagesDir, `${pageId}.pk`);
  return f.exists ? f.textSync() : '';
}

export function writePage(pageId: string, base64: string) {
  ensureDirs();
  const f = new File(pagesDir, `${pageId}.pk`);
  if (!f.exists) f.create({ intermediates: true });
  f.write(base64);
}

export function getUsage(): UsageRecord[] {
  return load().usage ?? [];
}

/** Metering is best-effort: a storage failure here must never fail the request that was just paid for. */
export function recordUsage(e: { kind: UsageRecord['kind']; model: string; usage: Usage }) {
  const db = load();
  db.usage = appendRecord(db.usage ?? [], makeRecord(e.kind, e.model, e.usage));
  persist();
}
