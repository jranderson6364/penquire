import * as React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

/** Line icons drawn by scripts/make_icons.py (white on transparent); tinted at render time so one file serves every color. */
const SOURCES = {
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
} as const;

export type IconName = keyof typeof SOURCES;

export function Icon({ name, size = 22, color, style }: { name: IconName; size?: number; color: string; style?: StyleProp<ImageStyle> }) {
  return <Image source={SOURCES[name]} style={[{ width: size, height: size, tintColor: color }, style]} accessible={false} />;
}
