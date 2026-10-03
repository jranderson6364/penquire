/**
 * Saving a page must never lose work, and must never overwrite a drawing that was not shown.
 *
 * The native canvas can be unreachable for a moment after the screen opens ("ViewNotFound": React Native has created
 * the view but the module has not registered it yet). Loading must retry through that, not give up, and a page whose
 * load never completed must not silently swallow every later save.
 */

/** The native view is not (yet / any more) reachable: worth retrying, not a real failure. */
export function isTransientViewError(e: unknown): boolean {
  return /ViewNotFound|Unable to find the .* view|canvas not mounted/i.test(String((e as { message?: string })?.message ?? e));
}

/**
 * May the current canvas contents overwrite the stored drawing?
 *  - yes once this page's stored drawing was loaded into the canvas;
 *  - yes when nothing is stored (a new page): there is nothing to destroy;
 *  - no otherwise: the canvas may be blank only because the load failed, and saving it would erase real work.
 */
export function mayAutosave(s: { loadedPageId: string; pageId: string; savedDrawing: string }): boolean {
  if (!s.pageId) return false;
  if (s.loadedPageId === s.pageId) return true;
  return s.savedDrawing === '';
}

export type RetryOptions = {
  tries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
};

/** Run `fn`, retrying only while the failure is a transient native-view error. Any other error is thrown at once. */
export async function withViewRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = opts.tries ?? 30;
  const delay = opts.delayMs ?? 150;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (opts.isCancelled?.()) throw new Error('cancelled');
    try {
      return await fn();
    } catch (e) {
      if (!isTransientViewError(e)) throw e;
      last = e;
      await sleep(delay);
    }
  }
  throw last ?? new Error('canvas not ready');
}
