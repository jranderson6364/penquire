import * as React from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PencilCanvas, nativeApiVersion, nativeCanvasAvailable, nativeHasNewFunctions, type PencilCanvasHandle } from '../../modules/pencil-canvas';
import { getProvider } from '../ai';
import type { ChatTurn, CheckResult, LineVerdict, PageImage } from '../ai/types';
import { Button } from '../components/Button';
import { OutcomeCard } from '../components/OutcomeCard';
import { ENV } from '../config';
import { groupLines, type Line } from '../ink/lines';
import { assessSubmission } from '../learning/assess';
import { independentCheckInput } from '../learning/context';
import { DEMO_TASK_IDS, demoTask, learnerText } from '../learning/demoPack';
import { createGate } from '../learning/gate';
import {
  canSubmit, changedSinceSubmission, editInvalidates, helpReplyInput, independentAttemptId, independentView, linesToConfirm, liveMatchesSnapshot, resultVisible,
  withConfirmedReadings,
} from '../learning/independentFlow';
import {
  applyAssessment, beginIndependent, clampMove, exitIndependentForHelp, invalidateOnEdit, recordAssistance, scheduleReview, submitIndependent,
} from '../learning/session';
import { takeSnapshot } from '../learning/snapshot';
import type { Episode } from '../learning/types';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../page';
import { getEpisode, getSettings, newId, readPage, recordUsage, updateEpisode, writePage } from '../store/db';
import { isTransientViewError, mayAutosave, withViewRetry } from '../store/saveGuard';
import { normalizeToolState, selectTool, toNativeSpec, toggleEraser, type ToolKind, type ToolState } from '../tools';
import { C, LABEL, PALETTE, R, T } from '../theme';
import { stopAllVoice } from '../voice/engine';

/**
 * The fresh problem, attempted with no prior help on screen (T08). A separate screen IS the isolation: none of the
 * workspace's chat, marks, check state or voice is mounted here. Nothing calls the provider before Submit, except an
 * explicit, confirmed exit for help (which makes the attempt supported practice).
 */
type Props = { episodeId: string; onDone: () => void };

const COULDNT_ASSESS = "Couldn't assess right now. Your work is saved.";
const HELP_CONFIRM = "Getting help turns this into supported practice. That's fine. It just won't count as an independent attempt.";

const attemptOf = (ep: Episode | undefined) => (ep?.independentAttemptId ? ep.attempts[ep.independentAttemptId] : undefined);

const provider = () => {
  const s = getSettings();
  return getProvider({ apiKey: s.apiKey, checkModel: s.checkModel, parseModel: s.parseModel, onUsage: recordUsage });
};

export function IndependentScreen({ episodeId, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const settings = getSettings();
  const hasKey = !!(settings.apiKey || ENV.anthropicApiKey);
  const modern = nativeApiVersion >= 2 || nativeHasNewFunctions;
  const canvasRef = React.useRef<PencilCanvasHandle>(null);
  const gate = React.useRef(createGate()).current;

  const [ep, setEp] = React.useState<Episode | undefined>(() => getEpisode(episodeId));
  const epRef = React.useRef(ep);
  /** Persist a transition, then open a new request boundary for the resulting phase (older requests go stale). */
  const commit = React.useCallback(
    (f: (e: Episode) => Episode) => {
      const next = updateEpisode(episodeId, f);
      if (!next) return undefined;
      epRef.current = next;
      setEp(next);
      gate.enter({ episodeId: next.id, attemptId: next.independentAttemptId ?? '', phase: next.phase });
      return next;
    },
    [episodeId, gate]
  );

  // ---- entering ------------------------------------------------------------
  // Begin the attempt (or resume it), then the boundary: gate first, then silence any speech still running.
  React.useEffect(() => {
    const cur = getEpisode(episodeId);
    if (cur && independentView(cur) === 'begin') {
      const pageId = newId('p_');
      commit((e) =>
        independentView(e) === 'begin'
          ? beginIndependent(e, { attemptId: independentAttemptId(e.id), taskId: DEMO_TASK_IDS.independent, pageId, now: Date.now() })
          : e
      );
    } else {
      epRef.current = cur;
      setEp(cur);
      gate.enter({ episodeId, attemptId: cur?.independentAttemptId ?? '', phase: cur?.phase ?? 'independent' });
    }
    stopAllVoice();
    // leaving: nothing in flight may land on this screen or the episode afterwards (Retry recovers a lost check)
    return () => gate.enter({ episodeId: '', attemptId: '', phase: 'outcome' });
  }, [episodeId, commit, gate]);

  // an outcome restored without its review (the app stopped between the two writes) gets one now; idempotent
  React.useEffect(() => {
    if (ep?.phase === 'outcome' && !ep.reviewTaskId) commit((x) => scheduleReview(x, DEMO_TASK_IDS.review, Date.now()));
  }, [ep, commit]);

  const attempt = attemptOf(ep);
  const pageId = attempt?.pageId ?? '';
  const pageIdRef = React.useRef(pageId);
  pageIdRef.current = pageId;
  const view = ep ? independentView(ep) : 'unavailable';
  const supported = attempt?.kind === 'supported_practice';

  // ---- canvas: same paper, page coordinates and save guard as the workspace ---------------------------------
  const loadedPageRef = React.useRef('');
  const [loaded, setLoaded] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState<string | null>(null);
  const [loadNonce, setLoadNonce] = React.useState(0);
  const [strokeCount, setStrokeCount] = React.useState<number | null>(null);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** bumps on every stroke change, so an edit made while Submit was capturing is noticed */
  const editSeq = React.useRef(0);
  const [toolState, setToolState] = React.useState<ToolState>(() => normalizeToolState(getSettings().toolState));
  const prevTool = React.useRef<ToolKind>('pen');

  /** false when the page could NOT be saved (its stored drawing never loaded: saving could erase it) */
  const savePage = React.useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = pageIdRef.current;
    const c = canvasRef.current;
    if (!id || !c) return true;
    if (!mayAutosave({ loadedPageId: loadedPageRef.current, pageId: id, savedDrawing: readPage(id) })) return false;
    try {
      writePage(id, await c.getDrawing());
      return true;
    } catch (e) {
      if (isTransientViewError(e)) return true;
      throw e;
    }
  }, []);

  React.useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  React.useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    loadedPageRef.current = '';
    setLoaded(false);
    setLoadFailed(null);
    (async () => {
      const saved = readPage(pageId);
      await withViewRetry(
        async () => {
          const c = canvasRef.current;
          if (!c) throw new Error('canvas not mounted yet');
          await c.setDrawing(saved);
        },
        { isCancelled: () => cancelled }
      );
      if (cancelled) return;
      loadedPageRef.current = pageId;
      setLoaded(true);
      const strokes = await canvasRef.current?.getStrokes();
      if (!cancelled && strokes) setStrokeCount(strokes.length);
    })().catch((e) => {
      if (cancelled) return;
      console.warn('load independent page failed', e);
      setLoadFailed(isTransientViewError(e) ? 'The drawing canvas did not become ready.' : 'The saved drawing could not be read. It was left untouched.');
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, loadNonce]);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void savePage().catch((e) => console.warn('save failed', e));
    });
    return () => sub.remove();
  }, [savePage]);

  React.useEffect(() => {
    if (!modern || !pageId) return;
    let cancelled = false;
    withViewRetry(
      async () => {
        const c = canvasRef.current;
        if (!c) throw new Error('canvas not mounted yet');
        return c.setTool(toNativeSpec(toolState));
      },
      { isCancelled: () => cancelled }
    ).catch((e) => {
      if (!cancelled) console.warn('setTool failed', e);
    });
    return () => {
      cancelled = true;
    };
  }, [modern, toolState, pageId]);

  const onPencilDoubleTap = React.useCallback(() => {
    setToolState((s) => {
      const r = toggleEraser(s, prevTool.current);
      prevTool.current = r.previous;
      return r.state;
    });
  }, []);

  // ---- per-screen state (in memory; the episode holds everything that must survive a relaunch) ---------------
  const [busy, setBusy] = React.useState(false);
  const submitting = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [findings, setFindings] = React.useState<LineVerdict[] | undefined>(undefined);
  const [confirm, setConfirm] = React.useState<{ snapshotId: string; check: CheckResult; lines: LineVerdict[]; edits: Record<string, string> } | null>(null);
  /** page image of the submitted snapshot, reused by Retry; after a relaunch it is exported again from the canvas */
  const imageRef = React.useRef<{ snapshotId: string; image: PageImage } | null>(null);
  const [helpTurns, setHelpTurns] = React.useState<ChatTurn[]>([]);
  const [helpDraft, setHelpDraft] = React.useState('');
  const [helpBusy, setHelpBusy] = React.useState(false);
  const [helpError, setHelpError] = React.useState<string | null>(null);

  const onDrawingChanged = React.useCallback(
    (e: { strokeCount: number }) => {
      setStrokeCount(e.strokeCount);
      editSeq.current++;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void savePage().catch((err) => console.warn('autosave failed', err)), 800);
      // Work changed after submission: the old result no longer counts and is hidden until the next Submit.
      const cur = epRef.current;
      if (loadedPageRef.current && cur?.independentAttemptId && editInvalidates(cur.phase)) {
        const attemptId = cur.independentAttemptId;
        commit((x) => invalidateOnEdit(x, attemptId, Date.now()));
        setFindings(undefined);
        setConfirm(null);
        setError(null);
      }
    },
    [savePage, commit]
  );

  const exportPageImage = async (lines: Pick<Line, 'id' | 'x' | 'y' | 'w' | 'h'>[]): Promise<PageImage | null> => {
    const c = canvasRef.current;
    if (!c) return null;
    const boxes = lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    const img = (nativeApiVersion >= 3 ? await c.exportPage({ lines: boxes, maxDimension: 2000, format: 'png', cropBottom: true }) : null) ?? (await c.exportImage(boxes, 2000));
    return img ? { base64: img.base64, mediaType: 'image/png' } : null;
  };

  // ---- assessment of the submitted snapshot ---------------------------------
  /** Check the submitted snapshot and assess it. Never takes a new snapshot: Retry reuses attempt.snapshot. */
  const assess = async (confirmed?: { id: string; reading: string }[]) => {
    const cur = epRef.current;
    const at = attemptOf(cur);
    const snapshot = at?.snapshot;
    if (!cur || !at || !snapshot || cur.phase !== 'independent_submitted') return;
    const s = gate.stamp();
    const task = demoTask(DEMO_TASK_IDS.independent);
    let check: CheckResult;
    try {
      // After a relaunch there is no cached image: export the live page again only if it is provably the submitted ink.
      let image = imageRef.current?.snapshotId === snapshot.id ? imageRef.current.image : null;
      if (!image) {
        const strokes = (await canvasRef.current?.getStrokes()) ?? [];
        const live = { loaded: loadedPageRef.current === at.pageId, strokeCount: strokes.length };
        if (!liveMatchesSnapshot(snapshot, live)) throw new Error('live page does not match the submitted snapshot');
        image = await exportPageImage(snapshot.lines);
        if (!image) throw new Error('page image unavailable');
        imageRef.current = { snapshotId: snapshot.id, image };
      }
      if (!gate.isCurrent(s)) return;
      const input = { ...independentCheckInput(task, snapshot, image), ...(confirmed?.length ? { confirmed } : {}) };
      const r = await gate.guard(provider().check(input), s);
      if (!r.ok) return; // stale: the work changed or the screen was left; show nothing
      check = r.value;
    } catch (e) {
      console.warn('independent check failed', e);
      if (gate.isCurrent(s)) setError(COULDNT_ASSESS);
      return;
    }
    if (confirmed?.length) check = withConfirmedReadings(check, confirmed);
    else {
      const unsure = linesToConfirm(check);
      if (unsure.length > 0) {
        setConfirm({ snapshotId: snapshot.id, check, lines: unsure, edits: Object.fromEntries(unsure.map((l) => [l.id, l.reading])) });
        return;
      }
    }
    setFindings(check.lines);
    if (confirmed?.length) {
      const readings = confirmed.map((c) => `${c.id}: ${c.reading}`);
      commit((x) => {
        const a = attemptOf(x);
        return a?.snapshot?.id === snapshot.id ? { ...x, attempts: { ...x.attempts, [a.id]: { ...a, readings } } } : x;
      });
    }
    const now = Date.now();
    const next = commit((x) => applyAssessment(x, at.id, assessSubmission(task, check, snapshot.id, now, snapshot.lines.map((l) => l.id))));
    if (next?.phase === 'outcome') commit((x) => scheduleReview(x, DEMO_TASK_IDS.review, Date.now()));
  };

  const run = async (f: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await f();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      const cur = epRef.current;
      const at = attemptOf(cur);
      if (!cur || !at || cur.phase !== 'independent') return;
      if (!hasKey) {
        setError('Add your Anthropic API key in Settings to submit. Your work is saved.');
        return;
      }
      const seq = editSeq.current;
      try {
        // flush the live canvas to the page file first: the snapshot copies the saved file
        if (!(await savePage())) {
          setError('This page could not be saved, so it was not submitted. Retry loading it first.');
          return;
        }
        const c = canvasRef.current;
        if (!c) throw new Error('canvas not ready');
        const strokes = await c.getStrokes();
        if (strokes.length === 0) {
          setError('Write your working on the page first.');
          return;
        }
        const lines = groupLines(strokes);
        const image = await exportPageImage(lines);
        if (!image) throw new Error('page image unavailable');
        const now = Date.now();
        const snap = takeSnapshot(at.pageId, lines, strokes.length, now);
        imageRef.current = { snapshotId: snap.id, image };
        const next = commit((x) => submitIndependent(x, snap, [], now));
        if (next?.phase !== 'independent_submitted') return;
        // a stroke landed while capturing: the snapshot may miss it, so the submission doesn't count
        if (editSeq.current !== seq) {
          commit((x) => invalidateOnEdit(x, at.id, Date.now()));
          return;
        }
      } catch (e) {
        console.warn('submit failed', e);
        setError(epRef.current?.phase === 'independent_submitted' ? COULDNT_ASSESS : 'Could not submit right now. Your work is saved.');
        return;
      }
      await assess();
    });

  const retry = () => run(() => assess());

  const finishConfirm = (useEdits: boolean) => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (useEdits) {
      void run(() => assess(c.lines.map((l) => ({ id: l.id, reading: (c.edits[l.id] ?? '').trim() || l.reading }))));
    } else {
      // the student can't confirm: assess what was read, which is honestly "could not assess"
      void run(async () => {
        const cur = epRef.current;
        const at = attemptOf(cur);
        if (!cur || !at?.snapshot || cur.phase !== 'independent_submitted' || at.snapshot.id !== c.snapshotId) return;
        const snapId = at.snapshot.id;
        const task = demoTask(DEMO_TASK_IDS.independent);
        setFindings(c.check.lines);
        const next = commit((x) => applyAssessment(x, at.id, assessSubmission(task, c.check, snapId, Date.now(), at.snapshot!.lines.map((l) => l.id))));
        if (next?.phase === 'outcome') commit((x) => scheduleReview(x, DEMO_TASK_IDS.review, Date.now()));
      });
    }
  };

  // ---- leaving for help ----------------------------------------------------
  const askLeaveForHelp = () =>
    Alert.alert('Get help?', HELP_CONFIRM, [
      { text: 'Keep going alone', style: 'cancel' },
      { text: 'Get help', onPress: () => commit((x) => exitIndependentForHelp(x, Date.now())) },
    ]);

  const sendHelp = async () => {
    const message = helpDraft.trim();
    const cur = epRef.current;
    const at = attemptOf(cur);
    if (!message || !cur || !at || at.kind !== 'supported_practice' || helpBusy) return;
    if (!hasKey) {
      setHelpError('Add your Anthropic API key in Settings to ask for help.');
      return;
    }
    const clamp = clampMove('explain', cur.policy);
    if ('denied' in clamp) {
      setHelpError(clamp.denied);
      return;
    }
    setHelpBusy(true);
    setHelpError(null);
    const s = gate.stamp();
    try {
      let image: PageImage | undefined;
      try {
        const strokes = (await canvasRef.current?.getStrokes()) ?? [];
        image = strokes.length ? ((await exportPageImage(groupLines(strokes))) ?? undefined) : undefined;
      } catch {
        image = undefined; // the question still goes without the page
      }
      const task = demoTask(at.taskId);
      const r = await gate.guard(provider().reply(helpReplyInput(task, message, clamp.level, helpTurns, image)), s);
      if (!r.ok) return;
      const now = Date.now();
      commit((x) =>
        recordAssistance(x, { attemptId: at.id, move: 'explain', level: clamp.level, channels: ['text'], revealed: 'unknown', text: r.value.text, at: now }, newId('h_'))
      );
      setHelpTurns((t) => [...t, { role: 'user', text: message }, { role: 'assistant', text: r.value.text }]);
      setHelpDraft('');
    } catch (e) {
      console.warn('help reply failed', e);
      if (gate.isCurrent(s)) setHelpError("Couldn't reach the tutor right now. Try again.");
    } finally {
      setHelpBusy(false);
    }
  };

  const leave = async () => {
    let ok = false;
    try {
      ok = await savePage();
    } catch (e) {
      console.warn('save failed', e);
    }
    if (ok) return onDone();
    Alert.alert('This page is not saved', 'The drawing did not finish loading, so changes cannot be saved without risking what is stored.', [
      { text: 'Retry loading', onPress: () => setLoadNonce((n) => n + 1) },
      { text: 'Leave anyway', style: 'destructive', onPress: onDone },
      { text: 'Stay', style: 'cancel' },
    ]);
  };

  // ---- render --------------------------------------------------------------
  if (!nativeCanvasAvailable) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>This app build is missing the drawing module.</Text>
        <Button title="Back" onPress={onDone} />
      </View>
    );
  }
  if (!ep || view === 'unavailable') {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{ep ? 'The fresh problem opens after the recovery step.' : 'This practice episode was not found.'}</Text>
        <Button title="Back" onPress={onDone} />
      </View>
    );
  }
  if (view === 'begin' || !attempt) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const prompt = learnerText(attempt.taskId);
  const showResult = resultVisible(ep);
  const changed = changedSinceSubmission(ep);
  const submitOk = canSubmit({ phase: ep.phase, busy, strokeCount, loaded });
  const eraser = toolState.tool === 'eraser';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.header, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
        <Button title="‹ Home" kind="ghost" small onPress={() => void leave()} />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{supported ? 'Supported practice' : 'Independent attempt'}</Text>
          <Text style={styles.prompt}>{prompt}</Text>
        </View>
        {ep.rehearsal && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Rehearsal — scripted responses</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.page}>
          <PencilCanvas
            ref={canvasRef}
            style={StyleSheet.absoluteFill}
            paper={settings.paper}
            allowFingerDrawing={settings.allowFingerDrawing}
            showToolPicker={!modern}
            onDrawingChanged={onDrawingChanged}
            {...(modern ? { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, onPencilDoubleTap } : {})}
            {...(nativeApiVersion >= 5 ? { twoFingerScroll: settings.twoFingerScroll !== false } : {})}
            {...(nativeApiVersion >= 4 ? { surroundColor: PALETTE[scheme === 'dark' ? 'dark' : 'light'].surround } : {})}
          />
          {modern && (
            <View style={styles.tools}>
              <Button title="Pen" small kind={eraser ? 'secondary' : 'primary'} onPress={() => setToolState((s) => selectTool(s, 'pen'))} />
              <Button title="Eraser" small kind={eraser ? 'primary' : 'secondary'} onPress={() => setToolState((s) => selectTool(s, 'eraser'))} />
              <Button title="Undo" small onPress={() => void canvasRef.current?.undo()} />
              <Button title="Redo" small onPress={() => void canvasRef.current?.redo()} />
            </View>
          )}
          {loadFailed && (
            <View style={styles.loadBanner}>
              <Text style={styles.loadBannerText}>{loadFailed} Nothing has been overwritten.</Text>
              <Button title="Retry" small onPress={() => setLoadNonce((n) => n + 1)} />
            </View>
          )}
        </View>

        <ScrollView style={[styles.side, { paddingRight: insets.right }]} contentContainerStyle={styles.sideContent} keyboardShouldPersistTaps="handled">
          {!showResult && !supported && <Text style={styles.status}>Tutor is off until you submit</Text>}
          {supported && !showResult && <Text style={styles.status}>Help is on. This attempt counts as supported practice.</Text>}
          {changed && <Text style={styles.warn}>Changed since submission. Submit again.</Text>}

          {ep.phase === 'independent' && (
            <Button title={busy ? 'Submitting…' : 'Submit'} kind="primary" loading={busy} disabled={!submitOk} onPress={() => void submit()} />
          )}

          {ep.phase === 'independent_submitted' && !confirm && (
            <View style={styles.block}>
              <Text style={styles.status}>{busy ? 'Checking your submitted work…' : 'Submitted. Not assessed yet.'}</Text>
              {busy && <ActivityIndicator />}
              {!busy && <Button title="Retry" kind="primary" onPress={() => void retry()} />}
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {ep.phase === 'independent_submitted' && !busy && error === COULDNT_ASSESS && <Button title="Retry" small onPress={() => void retry()} />}
            </View>
          )}

          {confirm && ep.phase === 'independent_submitted' && (
            <View style={styles.block}>
              <Text style={LABEL}>Check how we read these lines</Text>
              <Text style={styles.small}>Correct the text if it doesn't match what you wrote. This is only about the reading, not whether it is right.</Text>
              {confirm.lines.map((l) => (
                <View key={l.id} style={{ gap: 4 }}>
                  <Text style={styles.small}>{l.id}</Text>
                  <TextInput
                    style={styles.input}
                    value={confirm.edits[l.id] ?? ''}
                    onChangeText={(t) => setConfirm((c) => (c ? { ...c, edits: { ...c.edits, [l.id]: t } } : c))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
              <Button title="That's what I wrote" kind="primary" onPress={() => finishConfirm(true)} />
              <Button title="Skip (can't be assessed)" kind="ghost" onPress={() => finishConfirm(false)} />
            </View>
          )}

          {showResult && (
            <>
              <OutcomeCard ep={ep} findings={findings} />
              <Button title="Done" kind="primary" onPress={() => void leave()} />
            </>
          )}

          {ep.phase === 'independent' && !supported && <Button title="Get help" kind="ghost" onPress={askLeaveForHelp} />}

          {supported && ep.phase === 'independent' && (
            <View style={styles.block}>
              <Text style={LABEL}>Ask about this problem</Text>
              {helpTurns.map((t, i) => (
                <Text key={i} style={t.role === 'user' ? styles.userTurn : styles.tutorTurn}>
                  {t.text}
                </Text>
              ))}
              <TextInput style={[styles.input, { minHeight: 60 }]} value={helpDraft} onChangeText={setHelpDraft} placeholder="What are you stuck on?" placeholderTextColor={C.faint} multiline />
              {helpError && <Text style={styles.errorText}>{helpError}</Text>}
              <Button title="Ask" loading={helpBusy} disabled={!helpDraft.trim()} onPress={() => void sendHelp()} />
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surround },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg, padding: 24 },
  centerText: { color: C.ink, fontSize: T.lead, textAlign: 'center', maxWidth: 520 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  kicker: LABEL,
  prompt: { fontSize: T.lead, color: C.ink, fontWeight: '600' },
  badge: { backgroundColor: C.partialSoft, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: C.partial, fontWeight: '700', fontSize: T.small },
  body: { flex: 1, flexDirection: 'row' },
  page: { flex: 1, overflow: 'hidden' },
  tools: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', gap: 8 },
  loadBanner: { position: 'absolute', top: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.incorrectSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  loadBannerText: { color: C.incorrect, fontWeight: '700', fontSize: 13 },
  side: { width: 360, flexGrow: 0, backgroundColor: C.bg, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  sideContent: { padding: 16, gap: 12 },
  block: { gap: 8 },
  status: { fontSize: T.body, color: C.sub },
  warn: { fontSize: T.body, color: C.partial, fontWeight: '700' },
  small: { fontSize: T.small, color: C.sub },
  errorBox: { backgroundColor: C.incorrectSoft, borderRadius: R.sm, padding: 10, gap: 8 },
  errorText: { color: C.incorrect, fontWeight: '600', fontSize: T.body },
  input: { borderWidth: StyleSheet.hairlineWidth, borderColor: C.lineStrong, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: T.body, color: C.ink, backgroundColor: C.card },
  userTurn: { alignSelf: 'flex-end', backgroundColor: C.primarySoft, color: C.ink, borderRadius: R.sm, padding: 8, fontSize: T.body },
  tutorTurn: { color: C.ink, fontSize: T.body, lineHeight: 21 },
});
