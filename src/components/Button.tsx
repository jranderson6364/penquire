import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { C } from '../theme';

type Props = {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  small?: boolean;
};

export function Button({ title, onPress, kind = 'secondary', disabled, loading, style, small }: Props) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.incorrect : kind === 'ghost' ? 'transparent' : C.card;
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.small,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        kind === 'secondary' && styles.border,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.text, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: 42 },
  small: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 34 },
  border: { borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  text: { fontSize: 16, fontWeight: '600' },
});
