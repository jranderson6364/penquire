import { getAssignments, getEpisodes } from './store/db';

/**
 * DEV ONLY (T11 diagnosis, temporary): print the most recently used assignment's saved chat, checks, tutor marks,
 * events and episodes to Metro once per launch, so the founder's device run can be read on the PC. Settings (the
 * key) are never printed. Remove before any external build.
 */
export function dumpRecentSession() {
  if (!__DEV__) return;
  try {
    const a = getAssignments()[0];
    if (!a) return console.log('[penquire:dump] no assignments');
    const checks = Object.fromEntries(
      Object.entries(a.checks).map(([pid, c]) => [pid, { at: new Date(c.at).toISOString(), result: c.result }]),
    );
    const out = {
      assignment: { id: a.id, title: a.title, activePart: a.activePart, updatedAt: new Date(a.updatedAt).toISOString() },
      chat: a.chat,
      checks,
      tutorMarks: a.tutorMarks,
      issues: a.issues,
      events: a.events.map((e) => ({ ...e, t: new Date(e.t).toISOString() })),
      episodes: getEpisodes().filter((e) => e.assignmentId === a.id),
    };
    const s = JSON.stringify(out);
    const n = Math.ceil(s.length / 3000);
    console.log(`[penquire:dump] begin ${s.length} chars in ${n} parts`);
    for (let i = 0; i < n; i++) console.log(`[penquire:dump] ${i + 1}/${n} ${s.slice(i * 3000, (i + 1) * 3000)}`);
    console.log('[penquire:dump] end');
  } catch (e) {
    console.warn('[penquire:dump] failed', e);
  }
}
