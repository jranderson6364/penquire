import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { C, R, T } from '../theme';

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
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'ghost' ? C.primary : C.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.small,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'secondary' && styles.border,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.text, small && { fontSize: T.small }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: R.sm + 2, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  small: { paddingHorizontal: 12, paddingVertical: 6, minHeight: 36, borderRadius: R.sm },
  border: { borderWidth: 1, borderColor: C.line },
  text: { fontSize: T.body, fontWeight: '600', letterSpacing: -0.1 },
});
