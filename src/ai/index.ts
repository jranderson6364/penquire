import { ENV } from '../config';
import { ClaudeProvider } from './claude';
import { applyAlgebraGuard, applyLeakGuard, applyReplyLeakGuard } from '../verify/guard';
import type { TutorProvider } from './types';

export type ProviderSettings = { provider: 'anthropic'; apiKey?: string; checkModel?: string; parseModel?: string };

/** Single place to swap providers. Add Gemini/OpenAI implementations of TutorProvider here. */
export function getProvider(settings?: Partial<ProviderSettings>): TutorProvider {
  const inner = new ClaudeProvider({
    apiKey: settings?.apiKey || ENV.anthropicApiKey,
    checkModel: settings?.checkModel || ENV.checkModel,
    parseModel: settings?.parseModel || ENV.parseModel,
  });
  return guarded(inner);
}

/** Deterministic guards run on every provider's output: they may lower a verdict, never raise one. */
export function guarded(inner: TutorProvider): TutorProvider {
  return {
    id: inner.id,
    parseAssignment: (i) => inner.parseAssignment(i),
    reply: async (i) => {
      const text = await inner.reply(i);
      try {
        return applyReplyLeakGuard(text, i.lines ?? [], i.helpLevel);
      } catch (e) {
        console.warn('reply leak guard failed', e);
        return text;
      }
    },
    check: async (i) => {
      const r = await inner.check(i);
      // A guard bug must never lose a check the student already paid for: fall back to the model's own result.
      try {
        return applyLeakGuard({ ...r, lines: applyAlgebraGuard(r.lines) }, i.helpLevel);
      } catch (e) {
        console.warn('verification guards failed; returning the unguarded check', e);
        return r;
      }
    },
  };
}

export * from './types';
export { HELP_LEVELS } from './prompts';
