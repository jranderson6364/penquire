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
    reply: async (i) => applyReplyLeakGuard(await inner.reply(i), i.lines ?? [], i.helpLevel),
    check: async (i) => {
      const r = await inner.check(i);
      return applyLeakGuard({ ...r, lines: applyAlgebraGuard(r.lines) }, i.helpLevel);
    },
  };
}

export * from './types';
export { HELP_LEVELS } from './prompts';
