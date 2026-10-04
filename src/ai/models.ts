/** Per-model API capabilities that the request builder must respect (a wrong parameter is an HTTP 400). */

/** Haiku 4.5 rejects `output_config.effort` ("This model does not support the effort parameter"). */
export const supportsEffort = (model: string): boolean => !/^claude-haiku-4-5(?:-|$)/i.test(model.trim());

/** `{ output_config: { effort } }` for models that accept it, `{}` otherwise. */
export const effortParam = (model: string, effort: string): { output_config?: { effort: string } } => (supportsEffort(model) ? { output_config: { effort } } : {});
