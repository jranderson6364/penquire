/**
 * Pure part of the demo seed (seed.ts wires it to db.ts). The store and pack are passed in so this loads under node.
 */
import type { Assignment } from '../store/types';
import type { PageBlock } from '../blocks';
import { startEpisode } from './session.ts';
import type { DemoPack, Episode, EpisodePolicy } from './types';

/** One assignment id per pack version: a new pack is a new demo, never the old episode under a new prompt. */
export const DEMO_ASSIGNMENT_ID = 'demo-projectile-cliff-v1';
/**
 * Demo assignments of earlier pack versions. Kept in the DB (historical work is not discarded silently), hidden from
 * Home's library, and removed by Reset demo along with the current one.
 */
export const RETIRED_DEMO_ASSIGNMENT_IDS: readonly string[] = ['demo-algebra-distribution-v1'];
export const isDemoAssignmentId = (id: string) => id === DEMO_ASSIGNMENT_ID || RETIRED_DEMO_ASSIGNMENT_IDS.includes(id);

export const DEMO_POLICY_TEXT =
  'Original demo practice (not course work). Checking your work, general explanations, and worked examples on a different task are allowed.';

const PART = '1';

export type DemoContent = { taskId: string; prompt: string; asksFor: string[]; version: string; skillId: string; policy: EpisodePolicy };

/** The pack's recovery task. Only the learner prompt, never the key. */
export function demoContent(pack: DemoPack, learnerText: (taskId: string) => string): DemoContent {
  const rec = pack.tasks.find((t) => t.role === 'recovery');
  if (!rec) throw new Error(`demo pack ${pack.version} has no recovery task`);
  return { taskId: rec.id, prompt: learnerText(rec.id), asksFor: [...rec.asksFor], version: pack.version, skillId: pack.skillId, policy: pack.policy };
}

export function buildDemoAssignment(c: DemoContent, pageId: string, now: number): Assignment {
  const block: PageBlock = { id: `${DEMO_ASSIGNMENT_ID}-b1`, kind: 'part', label: PART, heading: `Problem ${PART}`, lines: [c.prompt], x: 48, y: 48, w: 720 };
  return {
    id: DEMO_ASSIGNMENT_ID,
    title: 'Original demo practice',
    course: 'Demo',
    policy: DEMO_POLICY_TEXT,
    policyMaxLevel: 3,
    helpLevel: 1,
    style: '',
    problems: [{ label: PART, text: c.prompt, asksFor: c.asksFor }],
    activePart: PART,
    pageIds: [pageId],
    blocks: { [pageId]: [block] },
    chat: [],
    checks: {},
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** rehearsal is false: the founder writes real work and the real provider checks it; 'rehearsal' means scripted responses. */
export function buildDemoEpisode(c: DemoContent, a: { id: string; pageId: string; now: number }): Episode {
  return startEpisode({
    id: a.id, assignmentId: DEMO_ASSIGNMENT_ID, part: PART, skillId: c.skillId, packVersion: c.version, policy: c.policy,
    taskId: c.taskId, pageId: a.pageId, rehearsal: false, now: a.now,
  });
}

export type DemoStore = {
  getAssignment(id: string): Assignment | undefined;
  saveAssignment(a: Assignment): unknown;
  getEpisodes(): Episode[];
  saveEpisode(ep: Episode): void;
};

/** Creates the demo assignment and episode if missing; resumes the newest existing demo episode otherwise. */
export function ensureDemoIn(
  store: DemoStore,
  c: DemoContent,
  newId: (prefix: string) => string,
  now: number,
  makeEpisode: typeof buildDemoEpisode = buildDemoEpisode,
): { assignmentId: string; episodeId: string } {
  let a = store.getAssignment(DEMO_ASSIGNMENT_ID);
  if (!a) {
    a = buildDemoAssignment(c, newId('p_'), now);
    store.saveAssignment(a);
  }
  const existing = store.getEpisodes().filter((e) => e.assignmentId === DEMO_ASSIGNMENT_ID).sort((x, y) => y.createdAt - x.createdAt)[0];
  if (existing) return { assignmentId: a.id, episodeId: existing.id };
  const ep = makeEpisode(c, { id: newId('e_'), pageId: a.pageIds[0], now });
  store.saveEpisode(ep);
  return { assignmentId: a.id, episodeId: ep.id };
}
