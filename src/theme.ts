/**
 * Design tokens (docs/08-design-direction.md). Cool, technical, GoodNotes-clean: white surfaces on a pale
 * blue-gray canvas, hairlines instead of shadows, one blue that always means "the tutor/primary action", and
 * verdict colors that are only ever used for verdicts (always paired with a symbol, never color alone).
 * Components import these; nothing outside this file should contain a raw color.
 */
export const C = {
  bg: '#F3F4F7',
  card: '#FFFFFF',
  ink: '#0F1419',
  sub: '#4B5563',
  faint: '#8791A0',
  line: '#E2E5EB',
  lineStrong: '#CDD2DB',
  primary: '#2F6BEB',
  primarySoft: '#E8EFFD',
  valid: '#17855C',
  validSoft: '#E2F4EB',
  partial: '#A86A00',
  partialSoft: '#FDF1D6',
  incorrect: '#CC2F4E',
  incorrectSoft: '#FCE6EA',
  unknown: '#667085',
  unknownSoft: '#EDEFF3',
};

/** Font sizes (pt). Reading text 15, UI labels 13, captions 12. */
export const T = { caption: 12, small: 13, body: 15, lead: 17, title: 22, display: 30 } as const;

/** Families: the system sans (SF) for everything; Menlo for numbers, ids and the log. */
export const F = { mono: 'Menlo' } as const;

export const R = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Small-caps style section label ("FEEDBACK", "2A"). */
export const LABEL = { fontSize: T.caption, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: C.faint } as const;

export const VERDICT_STYLE = {
  valid: { symbol: '✓', color: C.valid, bg: C.validSoft, label: 'valid' },
  partial: { symbol: '~', color: C.partial, bg: C.partialSoft, label: 'partially valid' },
  incorrect: { symbol: '✗', color: C.incorrect, bg: C.incorrectSoft, label: 'incorrect' },
  unreadable: { symbol: '?', color: C.unknown, bg: C.unknownSoft, label: "couldn't read" },
} as const;
