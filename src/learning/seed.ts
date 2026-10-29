// Demo assignment and episode seeding (T03). Placeholder id until T03.
export const DEMO_ASSIGNMENT_ID: string = 'demo-stub';

export function ensureDemo(now: number): { assignmentId: string; episodeId: string } {
  throw new Error('not implemented: ensureDemo');
}

export function resetDemo(now: number): ReturnType<typeof ensureDemo> {
  throw new Error('not implemented: resetDemo');
}
