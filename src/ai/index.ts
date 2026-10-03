import { ENV } from '../config';
import { ClaudeProvider } from './claude';
import type { TutorProvider } from './types';

export type ProviderSettings = { provider: 'anthropic'; apiKey?: string; checkModel?: string; parseModel?: string };

/** Single place to swap providers. Add Gemini/OpenAI implementations of TutorProvider here. */
export function getProvider(settings?: Partial<ProviderSettings>): TutorProvider {
  return new ClaudeProvider({
    apiKey: settings?.apiKey || ENV.anthropicApiKey,
    checkModel: settings?.checkModel || ENV.checkModel,
    parseModel: settings?.parseModel || ENV.parseModel,
  });
}

export * from './types';
export { HELP_LEVELS } from './prompts';
