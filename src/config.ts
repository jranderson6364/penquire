/**
 * Dev-only configuration. EXPO_PUBLIC_* values are inlined into the JS bundle at build/serve time,
 * so the key is on-device. Fine for a personal prototype; replace with a backend proxy before testers.
 */
export const ENV = {
  anthropicApiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '',
  checkModel: process.env.EXPO_PUBLIC_CHECK_MODEL || 'claude-sonnet-5-5',
  parseModel: process.env.EXPO_PUBLIC_PARSE_MODEL || 'claude-sonnet-5-5',
};
