import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { C, R, T } from '../theme';
import type { Anchor } from '../ui/toolbarDock';
import { Icon } from './Icon';
import { MenuDivider, MenuItem, MenuPopover } from './MenuPopover';

type Props = {
  title: string;
  pageIndex: number;
  pageCount: number;
  onBack: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onAddPage: () => void;
  /** false on an older binary: no tool spec, so the system palette is used (a note says so) and Fit is unavailable */
  modern: boolean;
  onFit: () => void;
  zoomPercent: number;
  /** the page is zoomed away from fit-to-width */
  zoomedAway: boolean;
  /** Export PDF of the whole assignment (share sheet) */
  onExport: () => void;
  exporting: boolean;
  questionOn: boolean;
  onToggleQuestion: () => void;
  checking: boolean;
  onCheck: () => void;
  /** the tutor panel; the dot counts lines that need attention */
  panelOpen: boolean;
  onTogglePanel: () => void;
  counts?: Partial<Record<'valid' | 'partial' | 'incorrect' | 'unreadable', number>>;
  stale: boolean;
  /** voice turn state (src/voice): the Check button shows it and a tap stops it */
  voice: 'idle' | 'listening' | 'thinking' | 'speaking';
  /** hold Check to talk; release to send */
  onTalkStart: () => void;
  onTalkEnd: () => void;
  onStopVoice: () => void;
  /** hands-free conversation on/off (the mic stays open; a pause ends your turn) */
  conversation: boolean;
  onToggleConversation: () => void;
  /** 'saved' on disk, 'dirty' waiting for the autosave, 'blocked' could not be saved */
  saveStatus: 'saved' | 'dirty' | 'blocked';
  onSaveTap: () => void;
  /** pivot flow: the ⓘ status popover next to the title (phase, feedback rule, help record) */
  info?: React.ReactNode;
  /** pivot flow: the Help menu (direct help moves) */
  help?: { items: { key: string; title: string }[]; disabled: boolean; onPick: (key: string) => void };
  /** extra rows at the end of the ⋯ menu; call `close` after acting */
  menuExtra?: (close: () => void) => React.ReactNode;
  insetTop: number;
  insetLeft: number;
  insetRight: number;
};

type Open = { which: 'info' | 'help' | 'more'; anchor: Anchor } | null;

/**
 * Slim top bar. Left: back, title and save state, page arrows. Right: Help (pivot), Check (hold to talk), hands-free
 * conversation, the tutor panel and ⋯ (Fit, Export PDF, the question). The drawing tools float on the page
 * (FloatingToolbar).
 */
export function TopBar(p: Props) {
  const { width } = useWindowDimensions();
  const narrow = width < 700;
  const atFirst = p.pageIndex === 0;
  const atLast = p.pageIndex >= p.pageCount - 1;
  const [open, setOpen] = React.useState<Open>(null);
  const refs = React.useRef<Partial<Record<'info' | 'help' | 'more', View | null>>>({});
  const show = (which: 'info' | 'help' | 'more') => refs.current[which]?.measureInWindow((x, y, w, h) => setOpen({ which, anchor: { x, y, w, h } }));
  const close = () => setOpen(null);

  const left = (
    <View style={[styles.group, !narrow && styles.leftGroup]}>
      <Pressable onPress={p.onBack} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back to assignments">
        <Icon name="chevron-left" size={22} color={C.primary} />
      </Pressable>
      <Pressable onPress={p.onSaveTap} accessibilityLabel={`${p.title}. ${p.saveStatus === 'saved' ? 'Saved' : p.saveStatus === 'dirty' ? 'Saving' : 'Not saved. Tap to retry'}`} style={styles.titleBox}>
        <Text style={styles.title} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={[styles.save, p.saveStatus === 'blocked' && styles.saveBad]} numberOfLines={1}>
          {p.saveStatus === 'saved' ? 'Saved' : p.saveStatus === 'dirty' ? 'Saving…' : 'Not saved · tap to retry'}
        </Text>
      </Pressable>
      {!!p.info && (
        <Pressable
          ref={(r) => {
            refs.current.info = r;
          }}
          onPress={() => show('info')}
          hitSlop={6}
          style={styles.infoBtn}
          accessibilityRole="button"
          accessibilityLabel="Practice status and help used"
        >
          <Icon name="info" size={18} color={C.sub} />
        </Pressable>
      )}
      <View style={styles.pager}>
        <Pressable onPress={p.onPrevPage} disabled={atFirst} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Previous page">
          <Icon name="chevron-left" size={16} color={atFirst ? C.lineStrong : C.sub} />
        </Pressable>
        <Text style={styles.pagerText}>
          {p.pageIndex + 1}/{p.pageCount}
        </Text>
        <Pressable onPress={p.onNextPage} disabled={atLast} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Next page">
          <Icon name="chevron-right" size={16} color={atLast ? C.lineStrong : C.sub} />
        </Pressable>
        <Pressable onPress={p.onAddPage} hitSlop={6} style={styles.pagerBtn} accessibilityLabel="Add page">
          <Icon name="plus" size={16} color={C.sub} />
        </Pressable>
      </View>
      {!p.modern && <Text style={styles.oldBuild}>Old app build: install the latest for zoom and the new tools</Text>}
    </View>
  );

  const attention = !!p.counts && (['incorrect', 'partial', 'unreadable'] as const).some((v) => p.counts?.[v]);
  const right = (
    <View style={styles.group}>
      {p.help && (
        <Pressable
          ref={(r) => {
            refs.current.help = r;
          }}
          onPress={() => show('help')}
          disabled={p.help.disabled}
          style={[styles.helpBtn, p.help.disabled && { opacity: 0.45 }]}
          accessibilityRole="button"
          accessibilityLabel="Help"
          accessibilityHint="Find the issue, explain the idea, show another example or help you start"
        >
          <Icon name="help" size={17} color={C.primary} />
          <Text style={styles.helpText}>Help</Text>
          <Icon name="chevron-down" size={12} color={C.primary} />
        </Pressable>
      )}
      <TutorButton {...p} />
      <Pressable onPress={p.onToggleConversation} style={[styles.iconBtn, p.conversation && styles.convoOn]} accessibilityRole="switch" accessibilityState={{ checked: p.conversation }} accessibilityLabel={p.conversation ? 'End the spoken conversation' : 'Talk with the tutor hands-free'}>
        <Icon name="mic" size={19} color={p.conversation ? C.onPrimary : C.ink} />
      </Pressable>
      <Pressable onPress={p.onTogglePanel} style={[styles.iconBtn, p.panelOpen && styles.on]} accessibilityRole="button" accessibilityLabel={p.panelOpen ? 'Hide the tutor chat' : 'Show the tutor chat'} accessibilityState={{ selected: p.panelOpen }}>
        <Icon name="sidebar" size={20} color={p.panelOpen ? C.primary : C.ink} />
        {attention && (
          <View style={[styles.countDot, p.stale && { opacity: 0.45 }]}>
            <Text style={styles.countDotText}>{(p.counts?.incorrect ?? 0) + (p.counts?.partial ?? 0) + (p.counts?.unreadable ?? 0)}</Text>
          </View>
        )}
      </Pressable>
      <Pressable
        ref={(r) => {
          refs.current.more = r;
        }}
        onPress={() => show('more')}
        style={styles.iconBtn}
        accessibilityRole="button"
        accessibilityLabel="More: fit, export, question"
      >
        <Icon name="more" size={20} color={C.ink} />
      </Pressable>
    </View>
  );

  const pad = { paddingTop: p.insetTop + 4, paddingLeft: Math.max(8, p.insetLeft), paddingRight: Math.max(8, p.insetRight) };
  return (
    <View style={[styles.bar, pad]}>
      {narrow ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          {left}
          {right}
        </ScrollView>
      ) : (
        <View style={styles.row}>
          {left}
          {right}
        </View>
      )}

      {open?.which === 'info' && p.info && (
        <MenuPopover anchor={open.anchor} onClose={close} width={300} label="Practice status">
          {p.info}
        </MenuPopover>
      )}
      {open?.which === 'help' && p.help && (
        <MenuPopover anchor={open.anchor} onClose={close} label="Help">
          {p.help.items.map((it) => (
            <MenuItem
              key={it.key}
              title={it.title}
              disabled={p.help!.disabled}
              onPress={() => {
                close();
                p.help!.onPick(it.key);
              }}
            />
          ))}
        </MenuPopover>
      )}
      {open?.which === 'more' && (
        <MenuPopover anchor={open.anchor} onClose={close} label="More">
          {p.modern && (
            <MenuItem
              title="Fit page to width"
              detail={`Zoom ${p.zoomPercent}%`}
              disabled={!p.zoomedAway}
              onPress={() => {
                close();
                p.onFit();
              }}
            />
          )}
          <MenuItem
            title="Export PDF"
            icon="share"
            disabled={p.exporting}
            onPress={() => {
              close();
              // the share sheet can't present while this menu's modal is still fading out
              setTimeout(p.onExport, 350);
            }}
          />
          <MenuItem
            title={p.questionOn ? 'Hide the question' : 'Show the question'}
            icon="question"
            selected={p.questionOn}
            onPress={() => {
              close();
              p.onToggleQuestion();
            }}
          />
          {p.menuExtra && (
            <>
              <MenuDivider />
              {p.menuExtra(close)}
            </>
          )}
        </MenuPopover>
      )}
    </View>
  );
}

/**
 * The one entry to the tutor (docs/10 §2). Tap = Check. Hold = talk (release to send; the answer is spoken).
 * While the tutor listens, thinks or speaks, the button says so, and a tap stops it.
 */
function TutorButton(p: Props) {
  const talking = React.useRef(false);
  const busy = p.voice !== 'idle';
  const label = p.voice === 'listening' ? 'Listening' : p.voice === 'thinking' ? 'Thinking…' : p.voice === 'speaking' ? 'Speaking' : p.checking ? 'Checking…' : 'Check';
  return (
    <Pressable
      onPress={() => (busy ? p.onStopVoice() : p.onCheck())}
      onLongPress={() => {
        if (busy || p.checking) return;
        talking.current = true;
        p.onTalkStart();
      }}
      onPressOut={() => {
        if (!talking.current) return;
        talking.current = false;
        p.onTalkEnd();
      }}
      delayLongPress={320}
      disabled={p.checking && !busy}
      style={({ pressed }) => [styles.check, p.voice === 'listening' && styles.checkListening, (pressed || p.checking) && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={busy ? `${label}. Tap to stop.` : 'Check my work. Hold to ask out loud.'}
    >
      {p.checking && !busy ? (
        <ActivityIndicator size="small" color={C.onPrimary} />
      ) : (
        <Icon name={p.voice === 'listening' ? 'mic' : p.voice === 'speaking' ? 'speaker' : 'sparkles'} size={16} color={C.onPrimary} />
      )}
      <Text style={styles.checkText}>{label}</Text>
      {/* the page changed since the last check: a quiet dot, not a banner */}
      {p.stale && !busy && !p.checking && <View style={styles.staleDot} accessibilityLabel="Page changed since the last check" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leftGroup: { flex: 1, minWidth: 0 },
  titleBox: { flexShrink: 1, maxWidth: 300, paddingHorizontal: 2 },
  title: { fontSize: T.body, fontWeight: '600', color: C.ink, letterSpacing: -0.2 },
  save: { fontSize: 11, color: C.faint, marginTop: 1 },
  saveBad: { color: C.incorrect, fontWeight: '700' },
  infoBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  oldBuild: { fontSize: T.caption, color: C.partial, fontWeight: '700', flexShrink: 1, marginLeft: 8 },
  pager: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: R.pill, paddingHorizontal: 4, height: 32, marginLeft: 6 },
  pagerBtn: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
  pagerText: { fontSize: T.small, color: C.sub, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'center' },
  iconBtn: { width: 42, height: 42, borderRadius: R.md - 1, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: C.primarySoft },
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: R.pill, backgroundColor: C.primarySoft, marginRight: 2 },
  helpText: { fontSize: T.body, fontWeight: '600', color: C.primary },
  check: { minWidth: 104, height: 36, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  checkListening: { backgroundColor: C.incorrect },
  convoOn: { backgroundColor: C.incorrect },
  countDot: { position: 'absolute', top: 4, right: 3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: C.incorrect, alignItems: 'center', justifyContent: 'center' },
  countDotText: { color: C.onPrimary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  checkText: { color: C.onPrimary, fontSize: T.body, fontWeight: '600', letterSpacing: -0.2 },
  staleDot: { position: 'absolute', top: 3, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: C.partialSoft, borderWidth: 1.5, borderColor: C.onPrimary },
});
