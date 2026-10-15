import * as React from 'react';
import { Image, Text, type ColorValue, type ImageStyle, type StyleProp } from 'react-native';

import { nativeApiVersion } from '../../modules/pencil-canvas';

/**
 * Icons. Native build 4+ draws Apple's SF Symbols (one family, one weight, crisp at any size, matching the system).
 * Older binaries have no symbol view, so they fall back to the PNG line icons from scripts/make_icons.py (white on
 * transparent, tinted at render time). Names are ours; each maps to one SF Symbol.
 */
const SF = {
  pen: 'pencil.tip',
  fountain: 'pencil.and.scribble',
  pencil: 'pencil',
  highlighter: 'highlighter',
  eraser: 'eraser',
  lasso: 'lasso',
  ruler: 'ruler',
  undo: 'arrow.uturn.backward',
  redo: 'arrow.uturn.forward',
  question: 'doc.text',
  'chevron-left': 'chevron.left',
  'chevron-right': 'chevron.right',
  'chevron-down': 'chevron.down',
  'chevron-up': 'chevron.up',
  plus: 'plus',
  close: 'xmark',
  check: 'checkmark',
  image: 'photo',
  pin: 'pin',
  share: 'square.and.arrow.up',
  more: 'ellipsis',
  mic: 'mic.fill',
  speaker: 'speaker.wave.2.fill',
  sparkles: 'sparkles',
  stop: 'stop.fill',
} as const;

const PNG: Partial<Record<keyof typeof SF, number>> = {
  pen: require('../../assets/icons/pen.png'),
  fountain: require('../../assets/icons/fountain.png'),
  pencil: require('../../assets/icons/pencil.png'),
  highlighter: require('../../assets/icons/highlighter.png'),
  eraser: require('../../assets/icons/eraser.png'),
  lasso: require('../../assets/icons/lasso.png'),
  ruler: require('../../assets/icons/ruler.png'),
  undo: require('../../assets/icons/undo.png'),
  redo: require('../../assets/icons/redo.png'),
  question: require('../../assets/icons/question.png'),
  'chevron-left': require('../../assets/icons/chevron-left.png'),
  'chevron-right': require('../../assets/icons/chevron-right.png'),
  'chevron-down': require('../../assets/icons/chevron-down.png'),
  'chevron-up': require('../../assets/icons/chevron-up.png'),
  plus: require('../../assets/icons/plus.png'),
  close: require('../../assets/icons/close.png'),
  check: require('../../assets/icons/check.png'),
  image: require('../../assets/icons/image.png'),
  pin: require('../../assets/icons/pin.png'),
};

/** text stand-ins for icons that never had a PNG (only on pre-build-4 binaries) */
const GLYPH: Partial<Record<keyof typeof SF, string>> = { share: '↑', more: '⋯', mic: '●', speaker: '♪', sparkles: '✦', stop: '■' };

export type IconName = keyof typeof SF;

type SymbolViewType = React.ComponentType<{ name: string; size?: number; tintColor?: ColorValue; weight?: string; type?: string; style?: StyleProp<ImageStyle> }>;

/** expo-symbols is only in binaries from build 4; requiring it on an older one would fail, so load it lazily. */
let SymbolView: SymbolViewType | null | undefined;
function symbolView(): SymbolViewType | null {
  if (SymbolView !== undefined) return SymbolView;
  SymbolView = null;
  if (nativeApiVersion >= 4) {
    try {
      SymbolView = (require('expo-symbols') as { SymbolView: SymbolViewType }).SymbolView;
    } catch (e) {
      console.warn('SF Symbols unavailable; using PNG icons', e);
    }
  }
  return SymbolView;
}

export function Icon({ name, size = 22, color, style, weight = 'medium' }: { name: IconName; size?: number; color: ColorValue; style?: StyleProp<ImageStyle>; weight?: 'regular' | 'medium' | 'semibold' }) {
  const Sym = symbolView();
  if (Sym) return <Sym name={SF[name]} size={size} tintColor={color} weight={weight} type="monochrome" style={[{ width: size, height: size }, style]} />;
  const png = PNG[name];
  if (png) return <Image source={png} style={[{ width: size, height: size, tintColor: color }, style]} accessible={false} />;
  return (
    <Text style={{ fontSize: size * 0.8, lineHeight: size, width: size, textAlign: 'center', color }} accessible={false}>
      {GLYPH[name] ?? '•'}
    </Text>
  );
}
