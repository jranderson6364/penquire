/** Per-model API capabilities that the request builder must respect (a wrong parameter is an HTTP 400). */

/** Haiku 4.5 rejects `output_config.effort` ("This model does not support the effort parameter"). */
export const supportsEffort = (model: string): boolean => !/^claude-haiku-4-5(?:-|$)/i.test(model.trim());

/** `{ output_config: { effort } }` for models that accept it, `{}` otherwise. */
export const effortParam = (model: string, effort: string): { output_config?: { effort: string } } => (supportsEffort(model) ? { output_config: { effort } } : {});

/**
 * Reasoning effort for a chat reply with the page attached. Thinking counts as output, and in T11 run 1 the slowest
 * spoken replies (3.4–5.2 s to first audio) were the ones with the most output tokens. Spoken replies are 1–2
 * sentences, and "is it right / am I done" no longer rides on them (it runs the real check, at the check's effort;
 * src/learning/workspaceFlow.ts isDoneQuestion), so they use 'low'. Typed replies keep 'medium': at 'low' a typed
 * reply once told a student with a correct answer that it was wrong. Checks are unaffected (CHECK_EFFORT in claude.ts).
 */
export const replyEffort = (spoken: boolean): 'low' | 'medium' => (spoken ? 'low' : 'medium');
