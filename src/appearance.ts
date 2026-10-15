import { Appearance } from 'react-native';

/**
 * Light / dark / follow the system. Colors are DynamicColorIOS pairs (src/theme.ts), so switching is just telling
 * iOS which trait to use: no re-render, no restart. 'system' needs a binary built with userInterfaceStyle
 * "automatic" (native build 4+); on an older binary the system choice resolves to light.
 */
export type AppearanceMode = 'system' | 'light' | 'dark';

export function applyAppearance(mode: AppearanceMode | undefined) {
  try {
    Appearance.setColorScheme(mode === 'light' || mode === 'dark' ? mode : 'unspecified');
  } catch (e) {
    console.warn('appearance could not be applied', e);
  }
}
