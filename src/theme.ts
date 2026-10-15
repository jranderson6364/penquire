import { DynamicColorIOS, Platform, type ColorValue } from 'react-native';

/**
 * Design tokens (docs/08, docs/10). Quiet and exact, in the spirit of Codex/Apple: neutral grays (no blue cast),
 * hairlines instead of shadows, one blue that always means "the tutor/primary action", and verdict colors that are
 * only ever used for verdicts (always paired with a symbol, never color alone).
 *
 * Light and dark: every token is a DynamicColorIOS pair, resolved by iOS per trait. Styles stay static
 * (StyleSheet.create at module load) and still switch instantly with the system or the in-app setting
 * (Appearance.setColorScheme, see src/appearance.ts). The PAGE stays white paper in both modes: PencilKit ink and the
 * tutor's marks are drawn for paper.
 *
 * Components import these; nothing outside this file should contain a raw UI color.
 */
const pair = (light: string, dark: string): ColorValue => (Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : light);

export const PALETTE = {
  light: {
    bg: '#F6F6F7',
    card: '#FFFFFF',
    raised: '#FFFFFF',
    ink: '#0D0D0F',
    sub: '#5C5C66',
    faint: '#8E8E98',
    line: '#E7E7EA',
    lineStrong: '#D4D4D9',
    primary: '#2563EB',
    primarySoft: '#EAF0FE',
    onPrimary: '#FFFFFF',
    valid: '#15803D',
    validSoft: '#E5F4EA',
    partial: '#A16207',
    partialSoft: '#FBF1DC',
    incorrect: '#C8283F',
    incorrectSoft: '#FCE7EA',
    unknown: '#62646E',
    unknownSoft: '#EEEEF1',
    scrim: 'rgba(0,0,0,0.28)',
    surround: '#ECECEF',
  },
  dark: {
    bg: '#0E0E10',
    card: '#17171A',
    raised: '#1E1E22',
    ink: '#EDEDEF',
    sub: '#A3A3AD',
    faint: '#73737D',
    line: '#28282D',
    lineStrong: '#3A3A41',
    primary: '#6B97FF',
    primarySoft: '#1A2643',
    onPrimary: '#FFFFFF',
    valid: '#3CCB85',
    validSoft: '#0F2A1D',
    partial: '#E7AC45',
    partialSoft: '#2D2311',
    incorrect: '#FF6B84',
    incorrectSoft: '#34151C',
    unknown: '#A0A3AD',
    unknownSoft: '#232428',
    scrim: 'rgba(0,0,0,0.5)',
    surround: '#070708',
  },
} as const;

type Token = keyof typeof PALETTE.light;
export const C = Object.fromEntries((Object.keys(PALETTE.light) as Token[]).map((k) => [k, pair(PALETTE.light[k], PALETTE.dark[k])])) as Record<Token, ColorValue>;

/**
 * Colors for things drawn ON the paper (question blocks, verdict circles, block handles). The page is white in both
 * modes, so these never follow dark mode: dynamic tokens there would put near-white text on white paper.
 */
export const PAPER = {
  ink: PALETTE.light.ink,
  sub: PALETTE.light.sub,
  primary: PALETTE.light.primary,
  wash: 'rgba(243,244,247,0.55)',
  handle: 'rgba(255,255,255,0.92)',
  figure: PALETTE.light.unknownSoft,
} as const;

export const PAPER_VERDICT = {
  valid: { symbol: '✓', color: PALETTE.light.valid, bg: PALETTE.light.validSoft, label: 'valid' },
  partial: { symbol: '~', color: PALETTE.light.partial, bg: PALETTE.light.partialSoft, label: 'partially valid' },
  incorrect: { symbol: '✗', color: PALETTE.light.incorrect, bg: PALETTE.light.incorrectSoft, label: 'incorrect' },
  unreadable: { symbol: '?', color: PALETTE.light.unknown, bg: PALETTE.light.unknownSoft, label: "couldn't read" },
} as const;

/**
 * Text drawn ON the page, in PAGE units (it scales with the paper, like ink): placed questions and the tutor's notes
 * use these and nothing else, so everything on the page reads at one consistent size at any zoom.
 */
export const PAGE_TYPE = { body: 15, label: 12.5, note: 16, leading: 1.45 } as const;

/** Font sizes (pt). Reading text 15, UI labels 13, captions 12. */
export const T = { caption: 12, small: 13, body: 15, lead: 17, title: 22, display: 30 } as const;

/** Families: the system sans (SF) for everything; Menlo for numbers, ids and the log. */
export const F = { mono: 'Menlo' } as const;

export const R = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** One soft elevation, only for things that float (popovers, sheets). */
export const SHADOW = { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } } as const;

/** Motion: short ease-out for state changes; a little longer for things that travel. */
export const MOTION = { fast: 160, base: 220, slow: 320 } as const;

/** Small-caps style section label ("FEEDBACK", "2A"). */
export const LABEL = { fontSize: T.caption, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: C.faint } as const;

export const VERDICT_STYLE = {
  valid: { symbol: '✓', color: C.valid, bg: C.validSoft, label: 'valid' },
  partial: { symbol: '~', color: C.partial, bg: C.partialSoft, label: 'partially valid' },
  incorrect: { symbol: '✗', color: C.incorrect, bg: C.incorrectSoft, label: 'incorrect' },
  unreadable: { symbol: '?', color: C.unknown, bg: C.unknownSoft, label: "couldn't read" },
} as const;
