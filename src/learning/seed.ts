// Demo assignment and episode seeding. The pure logic lives in seedData.ts.
import { deleteDemoData, getAssignment, getEpisodes, newId, saveAssignment, saveEpisode } from '../store/db';
import { DEMO_PACK, learnerText } from './demoPack';
import { DEMO_ASSIGNMENT_ID, demoContent, ensureDemoIn } from './seedData';

export { DEMO_ASSIGNMENT_ID };

/** Creates the demo assignment and its episode if missing; resumes the existing episode otherwise. Settings are not touched. */
export function ensureDemo(now: number): { assignmentId: string; episodeId: string } {
  return ensureDemoIn({ getAssignment, saveAssignment, getEpisodes, saveEpisode }, demoContent(DEMO_PACK, learnerText), newId, now);
}

/** Removes only demo data (this pack's and any retired pack's demo assignment), then seeds it again. */
export function resetDemo(now: number): ReturnType<typeof ensureDemo> {
  deleteDemoData();
  return ensureDemo(now);
}
