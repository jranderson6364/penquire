/**
 * Pure part of the demo seed (seed.ts wires it to db.ts). The store and pack are passed in so this loads under node
 * and does not depend on T02/T04 being merged.
 */
import type { Assignment } from '../store/types';
import type { PageBlock } from '../blocks';
import type { DemoPack, Episode, EpisodePolicy } from './types';

export const DEMO_ASSIGNMENT_ID = 'demo-algebra-distribution-v1';

// TODO(T04 merge): these fallbacks match docs/12 and tasks/T04 and are used only while DEMO_PACK is still the stub.
const FALLBACK_RECOVERY = {
  taskId: 'recovery',
  prompt: 'Solve 2(3x − 4) = 10. Show enough working to explain the distribution.',
};
const FALLBACK_PACK = { version: 'algebra-distribution-v1', skillId: 'algebra-distribution' };
const DEMO_POLICY: EpisodePolicy = { maxLevel: 3, allowExplain: true, allowExample: true };

export const DEMO_POLICY_TEXT =
  'Original demo practice (not course work). Checking your work, general explanations, and worked examples on a different task are allowed.';

const PART = '1';

export type DemoContent = { taskId: string; prompt: string; version: string; skillId: string; policy: EpisodePolicy };

/** The recovery task from the pack when it has one; otherwise the hardcoded fallback. Only the learner prompt, never the key. */
export function demoContent(pack: DemoPack, learnerText: (taskId: string) => string): DemoContent {
  const rec = pack.tasks.find((t) => t.role === 'recovery');
  if (!rec) return { ...FALLBACK_RECOVERY, ...FALLBACK_PACK, policy: DEMO_POLICY };
  return { taskId: rec.id, prompt: learnerText(rec.id), version: pack.version, skillId: pack.skillId, policy: pack.policy };
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
    problems: [{ label: PART, text: c.prompt, asksFor: ['value of x', 'working that shows the distribution'] }],
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

/**
 * TODO(T02 merge): replace with startEpisode(...) from session.ts. Built inline to match the Episode type.
 * rehearsal is false: the founder writes real work and the real provider checks it; 'rehearsal' means scripted responses.
 */
export function buildDemoEpisode(c: DemoContent, a: { id: string; attemptId: string; pageId: string; now: number }): Episode {
  return {
    id: a.id,
    assignmentId: DEMO_ASSIGNMENT_ID,
    part: PART,
    skillId: c.skillId,
    packVersion: c.version,
    policy: c.policy,
    phase: 'attempt',
    attempts: {
      [a.attemptId]: {
        id: a.attemptId, episodeId: a.id, kind: 'initial', taskId: c.taskId, pageId: a.pageId,
        startedAt: a.now, assistanceIds: [], allowedResources: [],
      },
    },
    initialAttemptId: a.attemptId,
    assistance: [],
    rehearsal: false,
    createdAt: a.now,
    updatedAt: a.now,
  };
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
  const ep = makeEpisode(c, { id: newId('e_'), attemptId: newId('t_'), pageId: a.pageIds[0], now });
  store.saveEpisode(ep);
  return { assignmentId: a.id, episodeId: ep.id };
}
