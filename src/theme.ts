export const C = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  ink: '#16181D',
  sub: '#5B6270',
  faint: '#9AA1AD',
  line: '#E3E6EB',
  primary: '#3B5BDB',
  primarySoft: '#E7ECFF',
  valid: '#2B8A3E',
  validSoft: '#E6F4EA',
  partial: '#C77C02',
  partialSoft: '#FFF4DB',
  incorrect: '#D6336C',
  incorrectSoft: '#FFE3EC',
  unknown: '#6C757D',
  unknownSoft: '#EEF0F2',
};

export const VERDICT_STYLE = {
  valid: { symbol: '✓', color: C.valid, bg: C.validSoft, label: 'valid' },
  partial: { symbol: '~', color: C.partial, bg: C.partialSoft, label: 'partially valid' },
  incorrect: { symbol: '✗', color: C.incorrect, bg: C.incorrectSoft, label: 'incorrect' },
  unreadable: { symbol: '?', color: C.unknown, bg: C.unknownSoft, label: "couldn't read" },
} as const;
