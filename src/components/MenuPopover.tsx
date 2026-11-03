import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { C, LABEL, R, SHADOW, T } from '../theme';
import { popoverPosition, type Anchor } from '../ui/toolbarDock';
import { Icon, type IconName } from './Icon';

type Props = {
  /** the button it opens from, in window coordinates (measureInWindow) */
  anchor: Anchor;
  onClose: () => void;
  width?: number;
  /** read by VoiceOver when the menu opens */
  label: string;
  children: React.ReactNode;
};

/** A small menu card under a top-bar button (Help, ⋯, ⓘ). Tap outside to close. */
export function MenuPopover({ anchor, onClose, width = 280, label, children }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [h, setH] = React.useState(0);
  const pos = popoverPosition(anchor, 'below', { w: width, h: h || 200 }, { w: winW, h: winH }, 6);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down']}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" />
      <View
        style={[styles.card, { left: pos.left, top: pos.top, width, opacity: h ? 1 : 0 }]}
        onLayout={(e) => {
          const nh = Math.round(e.nativeEvent.layout.height);
          if (Math.abs(nh - h) > 1) setH(nh);
        }}
        accessibilityViewIsModal
        accessibilityLabel={label}
      >
        {children}
      </View>
    </Modal>
  );
}

export function MenuItem({ title, detail, icon, onPress, disabled, selected, locked }: { title: string; detail?: string; icon?: IconName; onPress: () => void; disabled?: boolean; selected?: boolean; locked?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || locked}
      style={({ pressed }) => [styles.item, selected && styles.itemOn, pressed && styles.itemPressed, (disabled || locked) && { opacity: 0.4 }]}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: !!(disabled || locked), selected: !!selected }}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
    >
      {icon && <Icon name={icon} size={18} color={selected ? C.primary : C.sub} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, selected && { color: C.primary }]}>{title}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {selected && <Icon name="check" size={16} color={C.primary} />}
    </Pressable>
  );
}

export function MenuSection({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

export const MenuDivider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: C.card, borderRadius: R.md + 2, padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: C.lineStrong, ...SHADOW },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.sm },
  itemOn: { backgroundColor: C.primarySoft },
  itemPressed: { backgroundColor: C.bg },
  title: { fontSize: T.body, color: C.ink, fontWeight: '500' },
  detail: { fontSize: T.caption, color: C.sub, marginTop: 1 },
  section: { ...LABEL, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginVertical: 4, marginHorizontal: 6 },
});
