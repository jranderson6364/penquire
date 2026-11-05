import * as React from 'react';
import { Alert, AppState, Pressable, Share, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PencilCanvas, exportPDF, nativeApiVersion, nativeCanvasAvailable, nativeHasNewFunctions, nativeModuleInfo, type ExportedImage, type PencilCanvasHandle, type StrokeBox, type StrokePoints, type ViewportEvent } from '../../modules/pencil-canvas';
import { getProvider } from '../ai';
import type { HelpLevel, LineVerdict, ReplyIntent, TutorContext } from '../ai/types';
import { Button } from '../components/Button';
import { HelpLevelPicker } from '../components/HelpLevelPicker';
import { QuestionBanner, QuestionPill } from '../components/QuestionBanner';
import { TopBar } from '../components/TopBar';
import { ENV } from '../config';
import { FloatingCard } from '../components/FloatingCard';
import { MarkPopover, MarkPopoverCard, MarksOverlay, POPOVER_H, POPOVER_W } from '../components/MarksOverlay';
import { BlocksLayer } from '../components/BlocksLayer';
import { ClearMarksButton, TutorMarksLayer } from '../components/TutorMarksLayer';
import { PageLayer, followViewport, useLiveViewport } from '../components/PageLayer';
import { BLOCK_MARGIN_X, BLOCK_WIDTH, clampBlock, estimateHeight, nextBlockY, partContent, setupContent, type PageBlock } from '../blocks';
import { SidePanel, type Tab } from '../components/SidePanel';
import { mergeParts, mergeVerdicts, planCarry, signatures } from '../check/carry';
import { guardMerged } from '../check/finalize';
import { checkOutOfDate } from '../check/stale';
import { AUTO_IDLE_MS, autoCheckAllowed, recentAuto } from '../check/auto';
import { confirmReading, confirmedFor } from '../check/confirmed';
import { groupLines, type Line } from '../ink/lines';
import { IDENTITY_VIEWPORT, PAGE_HEIGHT, PAGE_WIDTH, boxToLayer, parseViewport, sameViewport, visibleInLayer, type Viewport } from '../page';
import { eraserRing, normalizeToolState, toNativeSpec, toggleEraser, type ToolKind, type ToolState } from '../tools';
import { fetch as expoFetch } from 'expo/fetch';
import { buildPdfRequest } from '../export/pdf';
import { beginSpeech, listen, refreshVoice, stopAllVoice, stopSpeaking, stopSpeakingIfTalking, voiceAvailable, type Listening } from '../voice/engine';
import { pointedLine, speakable, unspoken } from '../voice/text';
import { createVoiceActivity, listenState, turnDecision, type TurnState } from '../voice/turns';
import { withSpeechExposure, type SpokenReply } from '../voice/session';
import { done as hapticDone, tick } from '../ui/haptics';
import { getAssignment, getEpisode, getEpisodes, getSettings, newId, readPage, recordUsage, saveSettings, subscribe, updateAssignment, updateEpisode, writePage } from '../store/db';
import { loadEvals, recordFeedback, saveCheckImage, saveCheckStrokes, subscribeEvals } from '../store/evals';
import { feedbackFor, type MarkFeedback } from '../store/evalRecords';
import { applyParse } from '../store/parseApply';
import { isTransientViewError, mayAutosave, withViewRetry } from '../store/saveGuard';
import { readSource } from '../store/sources';
import { findPart } from '../problems/flatten';
import { chunkLine } from '../tutor/chunks';
import { marksAfterCheck, marksAfterReply, marksOnCurrentInk } from '../tutor/marks';
import { escalate, issueKey, legacyIssueKey, pruneLadder, renameLadderKeys, rungFor } from '../tutor/ladder';
import { getIssue, isRepeat, noteHelp, recordCheck, renameIssueKeys } from '../tutor/issues';
import { HELP_LEVELS } from '../ai/prompts';
import { DeniedNotice, PracticeStatus, RepairCard } from '../components/LearningBar';
import { FloatingToolbar, useToolbarDock } from '../components/FloatingToolbar';
import { MenuItem, MenuSection } from '../components/MenuPopover';
import { pageSlots, pickNotice, type NoticeKind } from '../ui/toolbarDock';
import { clampMove, markRepairVerified, recordAssistance, recordFall, repairEvidence } from '../learning/session';
import { MOVE_TITLE, fallbackMove, flagFrom, givenFor, levelMove, needsInitialSnap, pivotPolicy, repairedAfter, replacementValid, replyGuardLines, withSnapshot, workAttemptId, workTaskId, CHECKING_LINE, doneVerdict, isDoneQuestion, type CheckOutcome, type Flag } from '../learning/workspaceFlow';
import { createGate, guardPartial } from '../learning/gate';
import { DEMO_ASSIGNMENT_ID, ensureDemo } from '../learning/seed';
import { takeSnapshot } from '../learning/snapshot';
import { DEMO_PACK, DEMO_TASK_IDS, demoTask, learnerText } from '../learning/demoPack';
import type { Channel, Episode, HelpMove, Snapshot } from '../learning/types';
import { applyReplyLeakGuard } from '../verify/guard';
import { costUSD } from '../ai/pricing';
import type { Assignment } from '../store/types';
import { C, PALETTE, R } from '../theme';

const HELP_MOVES: HelpMove[] = ['pointer', 'explain', 'example', 'start'];

type Props = {
  assignmentId: string;
  onBack: () => void;
  /** pivot flow: open the independent attempt for this episode (route owned by App.tsx / T08) */
  onStartIndependent?: (episodeId: string) => void;
};

// ---- pivot flow (demo episode) helpers: small and pure --------------------------------------

/** The newest episode on this assignment, if any. */
const episodeFor = (assignmentId: string): Episode | undefined =>
  getEpisodes()
    .filter((e) => e.assignmentId === assignmentId && !e.followUpOf)
    .sort((x, y) => y.updatedAt - x.updatedAt)[0];

const tutorContext = (a: Assignment): TutorContext => ({
  course: a.course,
  assignmentTitle: a.title,
  problems: a.problems,
  groups: a.groups,
  policy: a.policy,
  helpLevel: Math.min(a.helpLevel, a.policyMaxLevel) as HelpLevel,
  style: a.style,
});

/** Build 6+: the page overlays are children of the native canvas, which moves them with the ink in the same frame. */
const NATIVE_OVERLAY = nativeApiVersion >= 6;
/**
 * Build 6+: the overlay is laid out ONCE at this fixed scale (page * OVERLAY_K) and native scales it by zoom / OVERLAY_K,
 * so zooming never re-lays it out: marks, notes and question text stay put on the page like ink (Jason, October 29,
 * 2026: re-layout at each settled zoom shifted text and marks). 2 keeps text crisp up to about 2x zoom.
 */
const OVERLAY_K = 2;
/**
 * Build 10+: host the overlay and the paper INSIDE PencilKit's zoomed page, so UIKit moves them with the ink in every
 * pinch, scroll and bounce (no syncing at all). Native falls back to the synced layers if it can't find the page view.
 * Kill switches: set false here (JS only, no rebuild) if either misbehaves on a device.
 */
const OVERLAY_IN_PAGE = true;
/** off until [penquire:canvas] on the device shows PencilKit's ink is in subviews of its page (else paper could hide it) */
const PAPER_IN_PAGE = false;

/** `spend.total` accumulates the estimated cost of every API call made through the returned provider (retries included). */
const providerFromSettings = (spend?: { total: number }) => {
  const s = getSettings();
  return getProvider({
    apiKey: s.apiKey,
    checkModel: s.checkModel,
    parseModel: s.parseModel,
    onUsage: (e) => {
      recordUsage(e);
      const c = costUSD(e.model, e.usage);
      if (spend && c !== null) spend.total += c;
      // dev log only (not shown in the app): lets "what did that session cost?" be answered from the Metro logs
      console.log(`[penquire:cost] ${e.kind} ${e.model} ${c === null ? 'unpriced' : `$${c.toFixed(4)}`} in=${e.usage.inputTokens} cached=${e.usage.cacheReadTokens} out=${e.usage.outputTokens}`);
    },
    // streamed chat replies (whole, guarded sentences as they arrive)
    streamFetch: expoFetch as unknown as NonNullable<Parameters<typeof getProvider>[0]>['streamFetch'],
  });
};

export function WorkspaceScreen({ assignmentId, onBack, onStartIndependent }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const { width: winW } = useWindowDimensions();
  const settings = getSettings();
  const canvasRef = React.useRef<PencilCanvasHandle>(null);

  const [a, setA] = React.useState<Assignment | undefined>(() => getAssignment(assignmentId));
  // pivot flow: the demo assignment (or any assignment with an episode) runs attempt → direct help → repair
  const [ep, setEp] = React.useState<Episode | undefined>(() => episodeFor(assignmentId));
  React.useEffect(
    () =>
      subscribe(() => {
        setA(getAssignment(assignmentId));
        setEp(episodeFor(assignmentId));
      }),
    [assignmentId]
  );
  const pivot = assignmentId === DEMO_ASSIGNMENT_ID || !!ep;
  const pivotRef = React.useRef(pivot);
  pivotRef.current = pivot;
  const epRef = React.useRef(ep);
  epRef.current = ep;
  React.useEffect(() => {
    if (assignmentId === DEMO_ASSIGNMENT_ID && !ep) ensureDemo(Date.now());
  }, [assignmentId, ep]);
  // drops replies, streamed text and speech from before a boundary (episode load, "Try a fresh problem", leaving)
  const gate = React.useRef(createGate()).current;
  const epId = ep?.id;
  React.useEffect(() => {
    const e = epRef.current;
    if (e) gate.enter({ episodeId: e.id, attemptId: workAttemptId(e), phase: e.phase });
  }, [epId, gate]);
  const [denied, setDenied] = React.useState<{ reason: string; alt?: HelpMove } | undefined>(undefined);
  /** the line the last requested check flagged; kept until a check verifies its repair */
  const flagRef = React.useRef<Flag | null>(null);

  const [pageIndex, setPageIndex] = React.useState(0);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [strokeCount, setStrokeCount] = React.useState<number | null>(null);
  /**
   * Signatures of the lines on the page now, refreshed shortly after the ink changes. A check's mark whose line is no
   * longer on the page (edited, rewritten, erased) is hidden at once instead of waiting for the next check
   * (device run, November 4, 2026: two fixed lines kept their ✗ marks).
   */
  const [liveSigs, setLiveSigs] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (strokeCount === null) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const strokes = await canvasRef.current?.getStrokes();
        if (cancelled || !strokes) return;
        setLiveSigs(new Set(signatures(groupLines(strokes), strokes).values()));
      } catch {
        // keep the last known set; marks fall back to showing as before
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [strokeCount]);
  const [checking, setChecking] = React.useState(false);
  const autoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRun = React.useRef<() => void>(() => undefined);
  const autoTimes = React.useRef<number[]>([]);
  React.useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, []);
  // Normal outcomes ("nothing new", "add a key", a failed check) are a quiet line on the page, not a system alert.
  const [notice, setNotice] = React.useState<{ text: string; tone: 'info' | 'warn' | 'error'; id: number } | null>(null);
  const say = React.useCallback((text: string, tone: 'info' | 'warn' | 'error' = 'info') => setNotice({ text, tone, id: Date.now() }), []);
  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), notice.tone === 'error' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const [sending, setSending] = React.useState(false);
  // the tutor's reply as it streams in: whole sentences that already passed the leak guard (src/ai/index.ts)
  const [streamText, setStreamText] = React.useState('');
  const [reparsing, setReparsing] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('feedback');
  const [draft, setDraft] = React.useState('');
  const [showMarks, setShowMarks] = React.useState(true);
  /** the mark whose details are open; its card is in screen space (same size at any zoom, draggable) */
  const [openMark, setOpenMark] = React.useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const activePart = a?.activePart;
  const setActivePart = React.useCallback(
    (label: string | undefined) => {
      updateAssignment(assignmentId, (x) => ({ ...x, activePart: label }));
    },
    [assignmentId]
  );
  const [showQuestion, setShowQuestion] = React.useState<boolean>(() => getSettings().showQuestion ?? true);
  // the floating toolbar's edge (saved in Settings); the page's notices and cards keep clear of it
  const [dock, setDock] = useToolbarDock();
  const toggleQuestion = () =>
    setShowQuestion((v) => {
      saveSettings({ showQuestion: !v });
      return !v;
    });
  const hasKey = !!(settings.apiKey || ENV.anthropicApiKey);
  /** apiVersion >= 2: fixed page, zoom/pan, native tool spec. An older binary keeps the previous behavior. */
  // The version constant is the normal signal; if it is missing, ask the canvas directly whether it has the new
  // functions (an older binary has no getViewport). Either way the new features switch on as soon as they exist.
  const [probedModern, setProbedModern] = React.useState(false);
  const modern = nativeApiVersion >= 2 || nativeHasNewFunctions || probedModern;
  React.useEffect(() => console.warn(`[penquire] native canvas apiVersion=${nativeApiVersion} module=${JSON.stringify(nativeModuleInfo)}`), []);
  // build 10+: how the canvas is hosted on this device (page-hosted overlay/paper or the synced fallback), once
  React.useEffect(() => {
    if (nativeApiVersion < 10) return;
    const t = setTimeout(() => {
      canvasRef.current
        ?.debugInfo()
        .then((j) => j && console.warn(`[penquire:canvas] ${j}`))
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  const [viewport, setViewport] = React.useState<Viewport>(IDENTITY_VIEWPORT);
  const [toolState, setToolState] = React.useState<ToolState>(() => normalizeToolState(getSettings().toolState));
  const toolIsPixelEraser = toolState.tool === 'eraser' && toolState.eraserMode === 'pixel';
  // Pages where the pixel eraser was used since their last check (it can shrink a stroke without changing its box).
  const pixelErased = React.useRef(new Set<string>());
  const prevToolRef = React.useRef<ToolKind>('pen');
  const [evals, setEvals] = React.useState(loadEvals);
  React.useEffect(() => subscribeEvals(() => setEvals({ ...loadEvals() })), []);

  // Tools: the toolbar is JS; the native canvas only receives a small generic spec.
  // The eraser keeps its size on screen: its page width follows the settled zoom.
  const eraserZoom = toolState.tool === 'eraser' ? viewport.scale : 1;
  React.useEffect(() => {
    if (!modern) return;
    const c = canvasRef.current;
    if (!c) return;
    // Right after the page opens the native view may not be registered yet (ViewNotFound): the saved tool was then
    // never applied, so the toolbar showed the eraser while the Pencil drew with the pen. Retry until it lands.
    let cancelled = false;
    const spec = toNativeSpec(toolState, eraserZoom);
    const ruler = toolState.ruler;
    const send = async (tries: number) => {
      try {
        await c.setTool(spec);
        // only when it changed: toggling the ruler can make PencilKit adjust the view
        if (rulerSent.current !== ruler) {
          await c.setRulerActive(ruler);
          rulerSent.current = ruler;
        }
      } catch (e) {
        if (cancelled) return;
        if (tries <= 0) return console.warn('setTool failed', e);
        setTimeout(() => !cancelled && void send(tries - 1), 150);
      }
    };
    void send(20);
    toolChangedAt.current = Date.now();
    saveSettings({ toolState });
    return () => {
      cancelled = true;
    };
  }, [modern, toolState]);
  // only on a zoom change (tool changes are sent above, without saving settings or the jump diagnostic)
  React.useEffect(() => {
    if (!modern || toolState.tool !== 'eraser') return;
    canvasRef.current?.setTool(toNativeSpec(toolState, eraserZoom)).catch((e) => console.warn('setTool failed', e));
  }, [eraserZoom]);
  const rulerSent = React.useRef<boolean | null>(null);
  // dev diagnostic for "the page jumps when I change tools": log any viewport move right after a tool change
  const toolChangedAt = React.useRef(0);

  React.useEffect(() => {
    if (nativeApiVersion >= 2 || nativeHasNewFunctions || probedModern) return;
    let cancelled = false;
    (async () => {
      try {
        const vp = await withViewRetry(
          async () => {
            const c = canvasRef.current;
            if (!c) throw new Error('canvas not mounted yet');
            return c.getViewport();
          },
          { isCancelled: () => cancelled, tries: 20 }
        );
        console.warn(`[penquire] probe getViewport -> ${vp ? 'answered (new native build)' : 'no such function (old native build)'}`);
        if (vp && !cancelled) setProbedModern(true);
      } catch (e) {
        if (!cancelled) console.warn('[penquire] probe failed', String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [probedModern]);

  // Every event moves the overlay layer (no render). Only a SETTLED viewport is React state: overlays re-lay out once
  // at the new zoom when the gesture ends, never per frame.
  const live = useLiveViewport();
  const settledRef = React.useRef<Viewport>(IDENTITY_VIEWPORT);
  const onViewportChanged = React.useCallback(
    (e: ViewportEvent) => {
      const next = parseViewport(e, settledRef.current);
      if (Date.now() - toolChangedAt.current < 600 && Math.abs(next.ty - settledRef.current.ty) > 0.5) {
        console.log(`[penquire:jump] viewport moved ${(next.ty - settledRef.current.ty).toFixed(1)} pt right after a tool change (view ${next.viewWidth}x${next.viewHeight})`);
      }
      followViewport(live, next, settledRef.current.scale);
      if (next.interacting) return;
      setViewport((prev) => {
        const v = sameViewport(prev, next) ? prev : next;
        settledRef.current = v;
        return v;
      });
    },
    [live]
  );

  // Apple Pencil double-tap: flip to the eraser and back
  const onPencilDoubleTap = React.useCallback(() => {
    setToolState((s) => {
      const r = toggleEraser(s, prevToolRef.current);
      prevToolRef.current = r.previous;
      return r.state;
    });
  }, []);

  const pageId = a?.pageIds[pageIndex] ?? '';
  const pageIdRef = React.useRef(pageId);
  React.useEffect(() => {
    if (toolIsPixelEraser && pageId) pixelErased.current.add(pageId);
  }, [toolIsPixelEraser, pageId]);
  pageIdRef.current = pageId;
  // pivot flow: after a relaunch (or a new demo page) the flag comes back from the page's latest check
  React.useEffect(() => {
    const c = pivotRef.current ? getAssignment(assignmentId)?.checks[pageId] : undefined;
    flagRef.current = c ? flagFrom(c.lines, c.result.lines) : null;
  }, [assignmentId, pageId, epId]);
  /** page whose saved drawing is currently loaded; never autosave a page that failed to load */
  const loadedPageRef = React.useRef('');
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- persistence -------------------------------------------------------
  // Never lose work: 'saved' = on disk, 'dirty' = changes waiting for the autosave, 'blocked' = this page's stored
  // drawing never loaded into the canvas, so saving could overwrite it with a blank page (see src/store/saveGuard.ts).
  const [saveState, setSaveState] = React.useState<'saved' | 'dirty' | 'blocked'>('saved');
  const [loadFailed, setLoadFailed] = React.useState<string | null>(null);
  const [loadNonce, setLoadNonce] = React.useState(0);

  /** Returns false when the page could NOT be saved (the caller must not silently leave). */
  const savePage = React.useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = pageIdRef.current;
    const c = canvasRef.current;
    if (!id || !c) return true; // nothing on screen to save
    // the page was removed under us (resetDemo deletes the demo page): never write it back
    if (!getAssignment(assignmentId)?.pageIds.includes(id)) return true;
    if (!mayAutosave({ loadedPageId: loadedPageRef.current, pageId: id, savedDrawing: readPage(id) })) {
      setSaveState('blocked');
      return false;
    }
    try {
      writePage(id, await c.getDrawing());
      setSaveState('saved');
      return true;
    } catch (e) {
      // the native view is gone (screen closed or reloaded) by the time a timer fires: nothing left to save from
      if (isTransientViewError(e)) return true;
      throw e;
    }
  }, [assignmentId]);

  // A pending autosave must not fire against a view that no longer exists.
  React.useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  // Load the drawing whenever the page changes (and on first mount). The native canvas may not be reachable for a moment,
  // so retry through that instead of giving up; only a real failure (e.g. an undecodable file) stops it.
  React.useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    loadedPageRef.current = '';
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
      setSaveState('saved');
      const strokes = await canvasRef.current?.getStrokes();
      if (!cancelled && strokes) setStrokeCount(strokes.length);
    })().catch((e) => {
      if (cancelled) return;
      console.warn('load page failed', e);
      setLoadFailed(isTransientViewError(e) ? 'The drawing canvas did not become ready.' : 'The saved drawing could not be read. It was left untouched.');
      setSaveState('blocked');
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, loadNonce]);

  // Save when the app goes to the background (unmount is too late: the native view is gone).
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void savePage();
    });
    return () => sub.remove();
  }, [savePage]);

  const onDrawingChanged = React.useCallback(
    (e: { strokeCount: number }) => {
      setStrokeCount(e.strokeCount);
      // writing means the student is thinking: the tutor stops talking (barge-in by pen); a reply still loading is kept
      stopSpeakingIfTalking();
      // check as you write: a quiet check once the Pencil has rested (opt-in, capped; src/check/auto.ts)
      if (autoTimer.current) clearTimeout(autoTimer.current);
      // pivot flow: no ambient checks, whatever the setting says (feedback only when asked)
      if (getSettings().autoCheck && !pivotRef.current) autoTimer.current = setTimeout(() => autoRun.current(), AUTO_IDLE_MS);
      setSaveState((s) => (s === 'blocked' ? s : 'dirty'));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void savePage().catch((err) => console.warn('autosave failed', err)), 800);
    },
    [savePage]
  );

  /** Leave only when the page is safely on disk; otherwise tell the student instead of dropping their work. */
  const saveOrWarn = React.useCallback(async (): Promise<boolean> => {
    let ok = false;
    try {
      ok = await savePage();
    } catch (e) {
      console.warn('save failed', e);
    }
    if (!ok) {
      Alert.alert(
        'This page is not saved',
        'The drawing did not finish loading, so changes on this page cannot be saved without risking what is already stored. Retry loading it, or stay here.',
        [{ text: 'Retry loading', onPress: () => setLoadNonce((n) => n + 1) }, { text: 'Stay', style: 'cancel' }]
      );
    }
    return ok;
  }, [savePage]);

  // ---- capture -----------------------------------------------------------
  const capture = async (): Promise<{ lines: Line[]; image: ExportedImage | null; strokes: number; strokeList: StrokeBox[]; points: StrokePoints[] | null }> => {
    const c = canvasRef.current;
    if (!c) throw new Error('Canvas not ready');
    const strokes = await c.getStrokes();
    const lines = groupLines(strokes);
    const boxes = lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    // apiVersion >= 3: crop the blank page below the ink (fewer image tokens; same coordinates). PNG on purpose:
    // lossy compression hurts handwriting legibility, and image tokens depend on pixels, not bytes.
    const image = (nativeApiVersion >= 3 ? await c.exportPage({ lines: boxes, maxDimension: 2000, format: 'png', cropBottom: true }) : null) ?? (await c.exportImage(boxes, 2000));
    // the ink itself, so a rated check can be replayed through line grouping and reading later (null on older builds)
    const points = nativeApiVersion >= 3 ? await c.getStrokePoints().catch(() => null) : null;
    return { lines, image, strokes: strokes.length, strokeList: strokes, points };
  };

  if (!nativeCanvasAvailable) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>This app build is missing the drawing module</Text>
        <Text style={{ maxWidth: 520, textAlign: 'center', color: C.sub, fontSize: 16, lineHeight: 22 }}>
          The installed copy of Penquire was built before the PencilKit canvas was included. Delete Penquire from this iPad, then install the latest development build from expo.dev (Builds, newest, Install). JS changes alone cannot fix this.
        </Text>
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  if (!a) {
    return (
      <View style={styles.center}>
        <Text style={{ color: C.ink }}>Assignment not found.</Text>
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  const check = a.checks[pageId];
  const stale = !!check && strokeCount !== null && strokeCount !== check.strokeCount;
  const checkId = check ? (check.id ?? `${pageId}-${check.at}`) : '';
  // Marks are positioned from line boxes saved at check time. Boxes saved before the fixed-page canvas are in the
  // old view-sized space and cannot be mapped onto the page, so they are not drawn (run Check again).
  const marksUsable = !!check && (!modern || check.space === 'page-v2');
  const oldCheck = !!check && modern && check.space !== 'page-v2';
  // Build 6+: margin marks are laid out in page units and scaled with the page (see the overlay below)
  const markK = NATIVE_OVERLAY ? 1 : viewport.scale;
  // a line the student has since changed or erased loses its mark (its signature is gone from the page). Plain
  // computation, not a hook: this runs after the early returns above.
  const markVerdicts = check ? check.result.lines.filter((v) => !(stale && liveSigs && v.sig && !liveSigs.has(v.sig))) : [];
  const markLines = check && marksUsable ?(modern ? check.lines.map((l) => ({ ...l, ...boxToLayer(l, markK) })) : check.lines) : [];

  // ---- question blocks on the page ---------------------------------------
  const pageBlocks: PageBlock[] = (a?.blocks && a.blocks[pageId]) || [];
  const placeBlock = async (kind: 'part' | 'setup') => {
    if (!a || !activePart) return;
    const content = kind === 'part' ? partContent(a.groups, a.problems, activePart) : setupContent(a.groups, activePart);
    if (!content) {
      Alert.alert('Nothing to place', kind === 'setup' ? 'This problem has no shared setup.' : 'This question has no text to place.');
      return;
    }
    const label = kind === 'part' ? activePart : (a.groups && findPart(a.groups, activePart)?.group.label) || activePart;
    const existing = pageBlocks.find((b) => b.kind === kind && b.label === label);
    if (existing) {
      // already here: placing it again picks a stamped block back up so it can be moved
      if (existing.locked) {
        setBlockLocked(existing.id, false);
        say('Drag it into place, then tap ✓ to stamp it.');
      } else {
        say('It is already on this page: drag it by ⠿, then tap ✓ to stamp it.');
      }
      return;
    }
    let inkBottom = 0;
    try {
      const strokes = (await canvasRef.current?.getStrokes()) ?? [];
      for (const st of strokes) inkBottom = Math.max(inkBottom, st.y + st.h);
    } catch {
      // placing below the other blocks is still fine
    }
    const h = estimateHeight(content);
    const block: PageBlock = {
      id: newId('b_'),
      kind,
      label,
      heading: content.heading,
      lines: content.lines,
      x: BLOCK_MARGIN_X,
      y: nextBlockY(inkBottom, pageBlocks, PAGE_HEIGHT, h),
      w: BLOCK_WIDTH,
      h,
    };
    updateAssignment(a.id, (x) => ({ ...x, blocks: { ...(x.blocks ?? {}), [pageId]: [...((x.blocks ?? {})[pageId] ?? []), block] } }));
  };
  // an underline or circle on a line the student has since changed points at old ink: hidden (device run, November 4)
  const tutorMarks = marksOnCurrentInk((a?.tutorMarks && a.tutorMarks[pageId]) || [], liveSigs);
  const [focusTurn, setFocusTurn] = React.useState<number | undefined>(undefined);
  const [focusTag, setFocusTag] = React.useState<number | undefined>(undefined);
  const marksByTurn = React.useMemo(() => tutorMarks.reduce<Record<number, number[]>>((m, t) => ((m[t.turn] = [...(m[t.turn] ?? []), t.tag]), m), {}), [tutorMarks]);
  /**
   * Chat -> page: a colored phrase (or "Show on page") brings its marks into view and has the tutor draw them again.
   * Stays emphasised until tapped again or another phrase is tapped; says so when those marks are no longer on the page.
   */
  const showTurnMarks = (turn: number, tag?: number) => {
    if (focusTurn === turn && focusTag === tag) {
      setFocusTurn(undefined);
      setFocusTag(undefined);
      return;
    }
    const ms = tutorMarks.filter((m) => m.turn === turn && (tag === undefined || m.tag === tag));
    if (ms.length === 0) {
      say('Those marks were cleared from the page. Ask again to see them.');
      return;
    }
    tick();
    setFocusTurn(turn);
    setFocusTag(tag);
    if (narrow) setPanelOpen(false);
    const x0 = Math.min(...ms.map((m) => m.box.x));
    const y0 = Math.min(...ms.map((m) => m.box.y));
    const x1 = Math.max(...ms.map((m) => m.box.x + m.box.w));
    const y1 = Math.max(...ms.map((m) => m.box.y + m.box.h));
    void canvasRef.current?.scrollToPageRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }).catch(() => undefined);
  };
  const dismissMark = React.useCallback(
    (id: string) => {
      updateAssignment(assignmentId, (x) => ({ ...x, tutorMarks: { ...(x.tutorMarks ?? {}), [pageId]: ((x.tutorMarks ?? {})[pageId] ?? []).filter((m) => m.id !== id) } }));
    },
    [assignmentId, pageId]
  );
  const clearMarks = React.useCallback(() => {
    updateAssignment(assignmentId, (x) => ({ ...x, tutorMarks: { ...(x.tutorMarks ?? {}), [pageId]: [] } }));
  }, [assignmentId, pageId]);
  const moveBlock = React.useCallback(
    (id: string, bx: number, by: number) => {
      updateAssignment(assignmentId, (x) => {
        const list = ((x.blocks ?? {})[pageId] ?? []).map((b) => (b.id === id ? { ...b, ...clampBlock({ x: bx, y: by, w: b.w }, PAGE_WIDTH, PAGE_HEIGHT) } : b));
        return { ...x, blocks: { ...(x.blocks ?? {}), [pageId]: list } };
      });
    },
    [assignmentId, pageId]
  );
  const setBlockLocked = React.useCallback(
    (id: string, locked: boolean) => {
      updateAssignment(assignmentId, (x) => ({ ...x, blocks: { ...(x.blocks ?? {}), [pageId]: ((x.blocks ?? {})[pageId] ?? []).map((b) => (b.id === id ? { ...b, locked } : b)) } }));
    },
    [assignmentId, pageId]
  );
  const removeBlock = React.useCallback(
    (id: string) => {
      updateAssignment(assignmentId, (x) => ({ ...x, blocks: { ...(x.blocks ?? {}), [pageId]: ((x.blocks ?? {})[pageId] ?? []).filter((b) => b.id !== id) } }));
    },
    [assignmentId, pageId]
  );

  // ---- actions -----------------------------------------------------------
  // check as you write: refreshed every render so the timer always runs the current runCheck
  autoRun.current = () => {
    if (pivotRef.current) return;
    const now = Date.now();
    const busy = checking || sending || voice !== 'idle' || !hasKey;
    const fresh = strokeCount !== null && strokeCount !== (a.checks[pageId]?.strokeCount ?? -1);
    if (!autoCheckAllowed({ times: autoTimes.current, now, busy, strokesSinceLastCheck: fresh })) return;
    autoTimes.current = [...recentAuto(autoTimes.current, now), now];
    void runCheck(true);
  };

  /** quiet: a check-as-you-write check. Marks appear on the page; no panel, no notices; the panel button's dot says if something needs a look. */
  const runCheck = async (quiet = false, pivotMove?: { move: HelpMove; level: HelpLevel }): Promise<CheckOutcome> => {
    if (!hasKey) {
      say('Add your Anthropic API key in Settings to check your work.', 'warn');
      return { kind: 'error' };
    }
    setChecking(true);
    try {
      await savePage();
      const { lines, image, strokes, strokeList, points } = await capture();
      if (strokes === 0 || !image) {
        if (!quiet) say('Nothing to check yet. Write something on this page first.');
        return { kind: 'empty' };
      }
      const e0 = pivotMove ? epRef.current : undefined;
      const level = pivotMove?.level ?? tutorContext(a).helpLevel;
      const prev = a.checks[pageId];
      // Only grade what is new or changed: lines verified earlier and untouched since stay as they were (src/check/carry.ts).
      // The pixel eraser can shrink a stroke without changing its box, so after using it nothing is carried.
      const sigs = signatures(lines, strokeList);
      const current = lines.map((l) => ({ id: l.id, sig: sigs.get(l.id) ?? '' }));
      const plan = planCarry(current, prev && prev.space === 'page-v2' ? prev.result.lines : undefined, pixelErased.current.has(pageId) || (toolState.tool === 'eraser' && toolState.eraserMode === 'pixel'));
      if (prev && plan.toGrade.length === 0 && plan.dirtyParts.size === 0) {
        if (pivotMove?.move === 'pointer') {
          // the page is graded already: the pointer comes as a reply about the flagged line
          setTab('chat');
          setPanelOpen(true);
          const f = prev.result.lines.find((l) => l.verdict === 'incorrect' || l.verdict === 'partial');
          await send(`Point me to the issue${f ? ` on ${f.id}` : ''} without giving the answer.`, true, pivotMove.level, undefined, undefined, undefined, 'pointer');
          return { kind: 'unchanged', result: prev.result };
        }
        setShowMarks(true);
        setTab('feedback');
        if (!quiet) {
          setPanelOpen(true);
          say('Nothing new since your last check.');
        }
        return { kind: 'unchanged', result: prev.result };
      }
      const settled = [...plan.settled.entries()].map(([id, l]) => ({ id, part: l.part, reading: l.reading }));
      // Readings the student confirmed for ink that hasn't changed (src/check/confirmed.ts).
      const conf = confirmedFor(a.confirmedReadings?.[pageId], current);
      // pivot flow: the first help keeps a copy of the attempt as it was before any help is shown (page saved above)
      const initialSnap = e0 && needsInitialSnap(e0) ? takeSnapshot(pageId, lines, strokes, Date.now()) : undefined;
      const spend = { total: 0 };
      const stamp = gate.stamp();
      const checked = await gate.guard(
        providerFromSettings(spend).check({
        ...tutorContext(a),
        helpLevel: level,
        image: { base64: image.base64, mediaType: 'image/png' },
        lines: lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        pageNumber: pageIndex + 1,
        focusPart: activePart && a.problems.some((p) => p.label === activePart) ? activePart : undefined,
        previous: prev ? { feedback: prev.result.feedback, stillOpen: prev.result.stillOpen } : undefined,
        settled: settled.length ? settled : undefined,
        confirmed: conf.input.length ? conf.input : undefined,
        }),
        stamp
      );
      if (!checked.ok) return { kind: 'dropped' }; // a boundary passed while checking: show nothing
      const fresh = checked.value;
      const mergedLines = mergeVerdicts(current, plan, fresh.lines);
      // Re-run the guards on the whole merged page: the provider's guards only saw the freshly graded lines (src/check/finalize.ts).
      // a demo task's setup goes in too, so feedback stating the answer next to a wrong setup is withheld (src/learning/workspaceFlow.ts)
      const result = guardMerged({ ...fresh, lines: mergedLines, parts: mergeParts(fresh.parts, prev?.result.parts, plan, mergedLines) }, level, replyGuardLines(undefined, e0 ? givenFor(e0) : undefined));
      if (!toolIsPixelEraser) pixelErased.current.delete(pageId);
      try {
        saveCheckImage(pageId, image.base64);
        saveCheckStrokes(pageId, points);
      } catch (e) {
        console.warn('saving check image failed', e);
      }
      const counts = result.lines.reduce<Record<string, number>>((m, l) => ((m[l.verdict] = (m[l.verdict] ?? 0) + 1), m), {});
      const flagged = result.lines.filter((l) => l.verdict !== 'valid' && l.verdict !== 'context');
      const openKeys = flagged.map((l) => issueKey(l.part, l.reading, l.sig));
      // Issues used to be keyed by the reading; carry their rungs and history over to the ink-based key.
      const renames = flagged.map((l): [string, string] => [legacyIssueKey(l.part, l.reading), issueKey(l.part, l.reading, l.sig)]);
      updateAssignment(a.id, (x) => {
        const now = Date.now();
        const base = tutorContext(x).helpLevel;
        const ladder = renameLadderKeys(x.ladder ?? {}, renames);
        // Most help in force for each open issue: the default level, or a rung raised by "More help".
        const open = flagged.map((l) => {
          const key = issueKey(l.part, l.reading, l.sig);
          return { key, part: l.part, reading: l.reading, obstacle: l.obstacle, sig: l.sig, level: rungFor(ladder, key, base, x.policyMaxLevel) };
        });
        const present = new Set(current.map((c) => c.sig).filter(Boolean));
        const { issues, resolved, withdrawn } = recordCheck(renameIssueKeys(x.issues ?? {}, pageId, renames), pageId, open, now, present);
        return {
          ...x,
          ladder: pruneLadder(ladder, openKeys),
          issues,
          confirmedReadings: { ...(x.confirmedReadings ?? {}), [pageId]: conf.kept },
          checks: { ...x.checks, [pageId]: { id: newId('c_'), at: now, result, lines, strokeCount: strokes, costUSD: spend.total, space: modern ? 'page-v2' : undefined } },
          // the new check is the page's verdict now: reply marks drawn on older ink go
          tutorMarks: { ...(x.tutorMarks ?? {}), [pageId]: marksAfterCheck() },
          events: [
            ...x.events,
            ...resolved.map((r) => ({
              t: now,
              type: 'resolved' as const,
              page: pageIndex + 1,
              level: r.record.maxLevel,
              detail: [r.record.part, r.record.obstacle].filter(Boolean).join(' · ') || undefined,
            })),
            // the tutor stopped flagging unchanged ink: its own reversal, not the student's fix
            ...withdrawn.map((r) => ({ t: now, type: 'withdrawn' as const, page: pageIndex + 1, level: r.record.maxLevel, detail: r.record.part || undefined })),
            {
              t: now,
              type: 'check',
              page: pageIndex + 1,
              level: base,
              detail: `✓${counts.valid ?? 0} ~${counts.partial ?? 0} ✗${counts.incorrect ?? 0} ?${counts.unreadable ?? 0}`,
              costUSD: spend.total,
              revealed: result.revealed?.length ? [...new Set(result.revealed.map((r) => r.kind))] : undefined,
              overLevel: result.overLevel,
            },
          ],
        };
      });
      let assistanceId: string | undefined;
      if (e0 && pivotMove) {
        // record the check as delivered help; a requested check is also where a repair is verified (never by erasing)
        const now = Date.now();
        const flag = flagRef.current;
        const ev = flag && (e0.phase === 'attempt' || e0.phase === 'repair') ? repairEvidence({ flaggedSig: flag.sig, before: flag.before, after: lines, nowValid: replacementValid(flag, lines, result.lines) }) : undefined;
        const repairSnap = ev?.verified ? takeSnapshot(pageId, lines, strokes, now) : undefined;
        const revealed = result.revealed ? [...new Set(result.revealed.map((r) => r.kind))] : ('unknown' as const);
        assistanceId = newId('h_');
        const hid = assistanceId;
        const next = updateEpisode(e0.id, (e) => {
          // the first flags on the initial attempt, kept so the outcome can name the fall after the fresh problem
          let n = recordFall(e, result.lines.filter((v) => v.verdict === 'incorrect' || v.verdict === 'partial').map((v) => v.reading), now);
          n = withSnapshot(n, n.initialAttemptId ?? '', initialSnap);
          n = recordAssistance(n, { attemptId: workAttemptId(n), move: pivotMove.move, level, channels: ['marks', 'text'], revealed, text: result.feedback, at: now }, hid);
          if (ev?.verified) n = withSnapshot(markRepairVerified(n, now), n.repairAttemptId ?? '', repairSnap);
          return n;
        });
        if (ev?.verified && next?.phase === 'repair_verified') {
          flagRef.current = null;
          say(`${repairedAfter(next.assistance)}.`);
        } else {
          flagRef.current = flagFrom(lines, result.lines) ?? flag;
        }
      }
      setShowMarks(true);
      if (!quiet) {
        hapticDone();
        setTab('feedback');
        setPanelOpen(true);
      }
      return { kind: 'checked', result, assistanceId };
    } catch (e) {
      if (!quiet) say(`Check didn't finish: ${String(e instanceof Error ? e.message : e)}. Tap Check to try again.`, 'error');
      return { kind: 'error' };
    } finally {
      setChecking(false);
    }
  };

  /** One tutor turn. Returns the guarded reply text (for voice), or undefined if it failed. */
  const send = async (
    message: string,
    attachPage: boolean,
    levelOverride?: HelpLevel,
    intent?: ReplyIntent,
    evidence?: string,
    spoken?: boolean,
    /** pivot flow: the help move this reply delivers (recorded as assistance) */
    move?: HelpMove,
    /** pivot flow: an initial-attempt snapshot the caller already took */
    presnap?: Snapshot,
    /** voice: speak guarded sentences as they stream, and record speech exposure only once speech really started */
    speech?: SpokenReply
  ): Promise<string | undefined> => {
    // pivot flow: a typed "is this right?" / "am I done?" runs the real check (buttons and voice come with an intent, a move or speech)
    if (!intent && !move && !spoken && !speech) {
      const d = await doneTurn(message, () => setDraft(''));
      if (d) return d.verdict;
    }
    const e0 = pivotRef.current ? epRef.current : undefined;
    const stamp = gate.stamp();
    setSending(true);
    setDraft('');
    try {
      // The store at call time, not this render's copy: a hands-free turn can run on a closure from many turns ago,
      // which sent every reply of T11 run 1 with no history and the first check (uncached input stayed flat at ~1760 tokens).
      const ax = getAssignment(assignmentId) ?? a;
      const check = ax.checks[pageId];
      const cap = attachPage ? await capture() : null;
      const image = cap?.image ?? null;
      const level = levelOverride ?? tutorContext(ax).helpLevel;
      let initialSnap = presnap;
      if (e0 && !initialSnap && needsInitialSnap(e0)) {
        // flush the canvas first: the snapshot copies the saved page file
        await savePage();
        const c = cap ?? (await capture());
        initialSnap = takeSnapshot(pageId, c.lines, c.strokes, Date.now());
      }
      const strokeBox = new Map((cap?.strokeList ?? []).map((st) => [st.i, st]));
      const chunksByLine = Object.fromEntries((cap?.lines ?? []).map((l) => [l.id, chunkLine(l.strokes.map((i) => strokeBox.get(i)).filter((b): b is NonNullable<typeof b> => !!b))]));
      // Has the ink changed since the latest check? Then the reply is told the check is history (src/check/stale.ts).
      const checkStale = cap
        ? checkOutOfDate(
            check && { strokeCount: check.strokeCount, sigs: check.result.lines.map((l) => l.sig) },
            { strokes: cap.strokes, sigs: [...signatures(cap.lines, cap.strokeList).values()] },
            pixelErased.current.has(pageId) || toolIsPixelEraser
          )
        : stale;
      const spend = { total: 0 };
      const replied = await gate.guard(
        providerFromSettings(spend).reply({
        ...tutorContext(ax),
        helpLevel: level,
        // the guard keeps judging against the check's lines even when they are out of date (no lines: no guard)
        lines: replyGuardLines(check?.result.lines, e0 ? givenFor(e0) : undefined, checkStale),
        history: ax.chat,
        message,
        image: image ? { base64: image.base64, mediaType: 'image/png' } : undefined,
        lastCheck: check ? { feedback: check.result.feedback, stillOpen: check.result.stillOpen } : undefined,
        checkStale,
        intent,
        evidence,
        // "is this right?" means the line the Pencil last wrote on (src/voice/text.ts)
        pointingAt: cap && (spoken || /\b(this|here|that|these|those)\b/i.test(message)) ? pointedLine(cap.lines, cap.strokeList) : undefined,
        spoken,
        onPartial: guardPartial(stamp, (t: string) => {
          setStreamText(t);
          speech?.onPartial(t);
        }),
        part: activePart,
        markLineIds: cap && image ? cap.lines.map((l) => l.id) : undefined,
        }),
        stamp
      );
      if (!replied.ok) return undefined; // a boundary passed while waiting: show and speak nothing
      const reply = replied.value;
      const type = intent === 'start' ? 'start' : intent === 'dispute' ? 'dispute' : 'reply';
      updateAssignment(a.id, (x) => ({
        ...x,
        chat: [...x.chat, { role: 'user', text: message }, { role: 'assistant', text: reply.text, costUSD: spend.total }],
        // this reply's marks replace the earlier ones (none drawn: none left), on this capture's lines only
        tutorMarks: {
          ...(x.tutorMarks ?? {}),
          [pageId]: (() => {
            const sigs = cap ? signatures(cap.lines, cap.strokeList) : undefined;
            return marksAfterReply(reply.marks, cap ? { lines: cap.lines, chunksByLine } : null, x.chat.length + 1, () => newId('t_')).map((m) =>
              sigs?.get(m.lineId) ? { ...m, sig: sigs.get(m.lineId) } : m
            );
          })(),
        },
        events: [
          ...x.events,
          { t: Date.now(), type, page: pageIndex + 1, level, detail: intent === 'more_help' ? 'hint ladder' : type === 'start' ? activePart : spoken ? 'voice' : undefined, costUSD: spend.total },
        ],
      }));
      if (e0) {
        // speech counts as delivered only once it actually started; if it starts later, the voice turn adds it
        const saidAloud = spoken && (speech ? speech.started() : true);
        const channels: Channel[] = ['text', ...(reply.marks.length ? (['marks'] as const) : []), ...(saidAloud ? (['speech'] as const) : [])];
        const hid = newId('h_');
        updateEpisode(e0.id, (e) => {
          const n = withSnapshot(e, e.initialAttemptId ?? '', initialSnap);
          return recordAssistance(n, { attemptId: workAttemptId(n), move: move ?? levelMove(level), level, channels, revealed: 'unknown', text: reply.text, at: Date.now() }, hid);
        });
        if (spoken && !saidAloud) speech?.recorded(e0.id, hid);
      }
      return reply.text;
    } catch (e) {
      setDraft(message);
      say(`Message didn't send: ${String(e instanceof Error ? e.message : e)}`, 'error');
      return undefined;
    } finally {
      setSending(false);
      setStreamText('');
    }
  };

  // ---- voice: hold Check (or squeeze the Pencil) to talk; the answer is spoken (docs/10 §4) ----------------
  const [voice, setVoice] = React.useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [heard, setHeard] = React.useState('');
  /** hands-free: the student said something and is pausing, so the tutor is waiting for them (src/voice/turns.ts) */
  const [pausing, setPausing] = React.useState(false);
  const listening = React.useRef<Listening | null>(null);
  const starting = React.useRef(false);
  const releasedEarly = React.useRef(false);
  /** bumped by Stop and by ending a conversation: a reply still on its way is then not spoken */
  const voiceGen = React.useRef(0);
  const vocabulary = React.useMemo(() => [...a.problems.map((p) => p.label), 'theta', 'omega', 'vector', 'derivative', 'integral', 'line', 'part'], [a.problems]);

  const startTalk = async () => {
    if (!voiceAvailable()) {
      say('Voice needs the newest app build. Install it from the Expo build page.', 'warn');
      return;
    }
    if (listening.current || starting.current) return;
    stopSpeaking();
    refreshVoice(getSettings().voiceId);
    setHeard('');
    setVoice('listening');
    starting.current = true;
    releasedEarly.current = false;
    try {
      listening.current = await listen(setHeard, vocabulary);
      if (!listening.current) setVoice('idle');
    } catch (e) {
      setVoice('idle');
      say(String(e instanceof Error ? e.message : e), 'warn');
    } finally {
      starting.current = false;
    }
    // The button (or Pencil squeeze) was released while the permission prompt was up: finish now, don't leave the mic on.
    if (releasedEarly.current && listening.current) void endTalk();
  };

  const endTalk = async () => {
    if (starting.current) {
      releasedEarly.current = true;
      return;
    }
    const l = listening.current;
    if (!l) return;
    listening.current = null;
    const text = await l.finish();
    setHeard('');
    if (!text) {
      setVoice('idle');
      say("I didn't catch that. Hold the button and ask again.");
      return;
    }
    await voiceTurn(text);
    setVoice((v) => (v === 'speaking' || v === 'thinking' ? 'idle' : v));
  };

  /**
   * One spoken turn: send what was heard (with the page), then say the guarded reply. Shared by push-to-talk and
   * hands-free. The utterance exists before the fetch, so a Stop while the reply loads kills it (src/voice/session.ts).
   * Sentences are spoken as the stream releases them, each one already through the leak guard (src/ai/index.ts); the
   * final, fully guarded reply supplies only what was not said yet. Nothing unguarded is ever spoken.
   */
  const voiceTurn = async (text: string) => {
    const stamp = gate.stamp();
    const gen = voiceGen.current;
    const said: string[] = [];
    let exposure: { episodeId: string; id: string } | null = null;
    const sentAt = Date.now();
    const u = beginSpeech({
      onStart: () => {
        console.warn(`[penquire:voice] first audio ${Date.now() - sentAt} ms after the turn was sent`);
        setVoice('speaking');
        const x = exposure;
        exposure = null;
        if (x) updateEpisode(x.episodeId, (e) => withSpeechExposure(e, x.id, Date.now()));
      },
    });
    const live = () => u.live() && gate.isCurrent(stamp) && gen === voiceGen.current;
    const sayNew = (t: string, final: boolean) => {
      if (!live()) return;
      for (const s of unspoken(said, t, final)) {
        said.push(s);
        u.push(speakable(s));
      }
    };
    setVoice('thinking');
    setTab('chat');
    // pivot flow: "am I done?" is answered by the real check, with a line now and a verdict when it lands
    const d = await doneTurn(text, () => {
      if (live()) u.push(CHECKING_LINE);
    });
    if (d) {
      if (d.verdict && live()) {
        u.push(speakable(d.verdict));
        const e1 = epRef.current;
        if (d.outcome.kind === 'checked' && d.outcome.assistanceId && e1) {
          // the spoken verdict is part of the check's delivered help: add speech once it really started
          const x = { episodeId: e1.id, id: d.outcome.assistanceId };
          if (u.started()) updateEpisode(x.episodeId, (e) => withSpeechExposure(e, x.id, Date.now()));
          else exposure = x;
        }
      }
      u.end();
      await u.finished;
      return;
    }
    const reply = await send(text, true, undefined, undefined, undefined, true, undefined, undefined, {
      onPartial: (t) => sayNew(t, false),
      started: u.started,
      recorded: (episodeId, id) => {
        exposure = { episodeId, id };
      },
    });
    if (reply) sayNew(reply, true);
    u.end();
    await u.finished;
  };
  /** the latest render's voiceTurn (and through it send, runMove and the current check): the hands-free loop below keeps running on the closure that started it */
  const voiceTurnRef = React.useRef(voiceTurn);
  voiceTurnRef.current = voiceTurn;

  // ---- hands-free conversation: the mic stays open; a pause ends your turn; the tutor answers aloud; repeat ----
  const [conversation, setConversation] = React.useState(false);
  const convo = React.useRef(false);
  const convoTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  /** the turn being heard now; "Send now" marks it */
  const turnRef = React.useRef<TurnState | null>(null);

  const listenForTurn = async () => {
    if (!convo.current) return;
    const turn: TurnState = { startedAt: Date.now(), lastChangeAt: Date.now(), text: '' };
    turnRef.current = turn;
    const activity = createVoiceActivity();
    setHeard('');
    setPausing(false);
    setVoice('listening');
    let l: Listening | null = null;
    try {
      l = await listen(
        (t) => {
          if (t !== turn.text) {
            turn.text = t;
            turn.lastChangeAt = Date.now();
          }
          setHeard(t);
        },
        vocabulary,
        // the recognizer stopped by itself: start a fresh one rather than going silent
        () => {
          if (convoTimer.current) clearInterval(convoTimer.current);
          listening.current = null;
          setTimeout(() => void listenForTurn(), 300);
        },
        // the turn stays open while the student is audibly talking, even before the transcript catches up
        (level) => {
          if (activity.sample(level)) turn.lastVoiceAt = Date.now();
        }
      );
    } catch (e) {
      endConversation(String(e instanceof Error ? e.message : e));
      return;
    }
    if (!l || !convo.current) {
      l?.cancel();
      return;
    }
    listening.current = l;
    if (convoTimer.current) clearInterval(convoTimer.current);
    convoTimer.current = setInterval(() => {
      const now = Date.now();
      setPausing(!!turn.text.trim() && listenState(turn, now) === 'waiting');
      const d = turnDecision(turn, now);
      if (d === 'wait') return;
      if (convoTimer.current) clearInterval(convoTimer.current);
      convoTimer.current = null;
      turnRef.current = null;
      const cur = listening.current;
      listening.current = null;
      if (d === 'give_up') {
        cur?.cancel();
        endConversation('Conversation ended: no one spoke for a while.');
        return;
      }
      void (async () => {
        const text = (await cur?.finish()) || turn.text;
        setHeard('');
        setPausing(false);
        if (!convo.current) return;
        await voiceTurnRef.current(text);
        if (convo.current) void listenForTurn();
      })();
    }, 200);
  };

  /** Hands-free: the student is done talking; don't wait for the pause. */
  const sendNow = () => {
    if (turnRef.current) turnRef.current.sendNow = true;
  };

  /** Hands-free: cut the tutor off and go back to listening; the conversation goes on (Stop ends it). */
  const yourTurn = () => stopSpeaking();

  const startConversation = () => {
    if (!voiceAvailable()) {
      say('Voice needs the newest app build. Install it from the Expo build page.', 'warn');
      return;
    }
    stopSpeaking();
    refreshVoice(getSettings().voiceId);
    convo.current = true;
    setConversation(true);
    void listenForTurn();
  };

  const endConversation = (message?: string) => {
    voiceGen.current++;
    convo.current = false;
    setConversation(false);
    if (convoTimer.current) clearInterval(convoTimer.current);
    convoTimer.current = null;
    turnRef.current = null;
    listening.current?.cancel();
    listening.current = null;
    stopSpeaking();
    setHeard('');
    setPausing(false);
    setVoice('idle');
    if (message) say(message);
  };
  // Leaving the screen: end the loop and every sound; in the pivot flow also drop replies still on their way.
  React.useEffect(
    () => () => {
      endConversation();
      stopAllVoice();
      if (pivotRef.current) gate.enter({ episodeId: '', attemptId: '', phase: 'attempt' });
    },
    []
  );

  /** Stop means stop: it ends a hands-free conversation too (T01: the loop used to keep going after a stop). */
  const stopVoice = () => {
    voiceGen.current++;
    if (convo.current) {
      endConversation();
      stopAllVoice();
      return;
    }
    listening.current?.cancel();
    listening.current = null;
    stopAllVoice();
    setHeard('');
    setVoice('idle');
  };

  const reparse = async () => {
    const pdf = readSource(a.id);
    if (!pdf) {
      Alert.alert('No PDF saved', 'Create a new assignment with the PDF attached.');
      return;
    }
    setReparsing(true);
    try {
      const parsed = await providerFromSettings().parseAssignment({ title: a.title, pdfBase64: pdf, onlyProblems: a.sourceOnly });
      updateAssignment(a.id, (x) => applyParse(x, parsed));
      setActivePart(undefined);
    } catch (e) {
      Alert.alert('Parsing failed', String(e instanceof Error ? e.message : e));
    } finally {
      setReparsing(false);
    }
  };

  /** The final PDF: every page's ink and placed questions (no tutor marks), then the share sheet. */
  const [exporting, setExporting] = React.useState(false);
  const exportAssignment = async () => {
    if (nativeApiVersion < 4) {
      say('PDF export needs the newest app build. Install it from the Expo build page.', 'warn');
      return;
    }
    setExporting(true);
    try {
      if (!(await savePage())) {
        say("This page couldn't be saved, so it can't be exported yet. Tap the title to retry.", 'error');
        return;
      }
      const url = await exportPDF(buildPdfRequest(getAssignment(assignmentId) ?? a, readPage));
      if (url) await Share.share({ url, title: a.title });
    } catch (e) {
      say(`Export didn't finish: ${String(e instanceof Error ? e.message : e)}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const goToPage = async (index: number) => {
    if (index < 0 || index >= a.pageIds.length || index === pageIndex) return;
    if (!(await saveOrWarn())) return;
    setPageIndex(index);
  };

  const addPage = async () => {
    if (!(await saveOrWarn())) return;
    const updated = updateAssignment(a.id, (x) => ({ ...x, pageIds: [...x.pageIds, newId('p_')] }));
    if (updated) setPageIndex(updated.pageIds.length - 1);
  };

  const askAbout = (v: LineVerdict) => {
    setDraft(`About ${v.id}${v.reading ? ` ("${v.reading}")` : ''}: `);
    setTab('chat');
    setPanelOpen(true);
  };

  const moreHelp = async (v: LineVerdict) => {
    // pivot flow: no ladder climbing; "More help" asks for the explanation directly
    if (pivot) return runMove('explain');
    const base = tutorContext(a).helpLevel;
    const key = issueKey(v.part, v.reading, v.sig);
    const esc = escalate(a.ladder ?? {}, key, base, a.policyMaxLevel);
    if (esc.atCeiling) {
      say(`${HELP_LEVELS[a.policyMaxLevel].name} is the most help this course's AI policy allows. Ask in the chat to talk it through.`, 'warn');
      return;
    }
    updateAssignment(a.id, (x) => ({ ...x, ladder: esc.ladder, issues: noteHelp(x.issues ?? {}, pageId, key, esc.level) }));
    setTab('chat');
    setPanelOpen(true);
    await send(`I'm still stuck on ${v.id} ("${v.reading}"). Give me the next level of help.`, true, esc.level, 'more_help');
  };

  /** "I think this is right": recorded as accuracy feedback and re-checked by the tutor against the actual page. */
  const dispute = async (v: LineVerdict) => {
    rateMark({ lineId: v.id, rating: 'wrong', comment: 'student disputed the mark' });
    setTab('chat');
    setPanelOpen(true);
    // what the deterministic guard found, so the tutor doesn't simply back down (src/ai/prompts.ts intentBlock)
    const evidence = v.guard === 'algebra' ? /(Algebra|Units) check:.*$/.exec(v.note)?.[0] : undefined;
    await send(`I think the mark on ${v.id} ("${v.reading}") is wrong. Can you re-check it?`, true, undefined, 'dispute', evidence, undefined, 'dispute');
  };

  /** "Help me start": no attempt needed; a policy-capped first move for the active part. */
  const helpStart = async () => {
    if (pivot) return runMove('start');
    setTab('chat');
    setPanelOpen(true);
    await send(`I don't know how to start${activePart ? ` ${activePart}` : ' this problem'}.`, true, undefined, 'start');
  };

  // ---- pivot flow: direct help moves, the reviewed example, and the hand-off --------------------
  /** Every move goes through the episode policy (never wider than the assignment's); a denied move offers the next one down. */
  const runMove = async (m: HelpMove) => {
    if (!ep) return;
    setDenied(undefined);
    const policy = pivotPolicy(ep, a);
    const c = clampMove(m, policy);
    if ('denied' in c) {
      setDenied({ reason: c.denied, alt: fallbackMove(m, policy) });
      return;
    }
    const flagged = check?.result.lines.find((l) => l.verdict === 'incorrect' || l.verdict === 'partial');
    const on = flagged ? ` on ${flagged.id}` : '';
    if (m === 'check' || m === 'pointer') return runCheck(false, { move: m, level: c.level });
    if (m === 'example') return showExample(c.level);
    setTab('chat');
    setPanelOpen(true);
    if (m === 'start') await send(`I don't know how to start${activePart ? ` ${activePart}` : ' this problem'}.`, true, c.level, 'start', undefined, undefined, 'start');
    else if (m === 'explain') await send(`Explain the idea I need${on}. Teach the idea; don't solve my problem for me.`, true, c.level, undefined, undefined, undefined, 'explain');
    else if (m === 'step') await send(`Show me one step${on}.`, true, c.level, undefined, undefined, undefined, 'step');
  };

  /**
   * pivot flow: a turn asking whether the work is right or done ("am I done?", "is this right?", spoken or typed;
   * src/learning/workspaceFlow.ts isDoneQuestion) runs the real check through the Check button's path, so repair
   * verification, "Repaired after …" and Try a fresh problem follow from it. The question and a short verdict from
   * that check go into the chat. null: not such a turn (the tutor answers it as usual), including on a blank page.
   * `verdict` is undefined when a boundary dropped the check: say nothing.
   */
  const doneTurn = async (message: string, onChecking: () => void): Promise<{ verdict: string | undefined; outcome: CheckOutcome } | null> => {
    if (!pivotRef.current || !epRef.current || !isDoneQuestion(message)) return null;
    const strokes = await canvasRef.current?.getStrokes().catch(() => []);
    if (!strokes?.length) return null;
    const stamp = gate.stamp();
    onChecking();
    const outcome = await runMove('check');
    if (!outcome) return null; // the policy refused a check: the tutor answers instead
    // a verified repair now shows the Try a fresh problem card: name it, so "done" has a next step
    const verified = getEpisode(epRef.current.id)?.phase === 'repair_verified';
    const verdict = gate.isCurrent(stamp) ? doneVerdict(outcome, verified, workTaskId(epRef.current)) : undefined;
    if (verdict) updateAssignment(assignmentId, (x) => ({ ...x, chat: [...x.chat, { role: 'user', text: message }, { role: 'assistant', text: verdict }] }));
    return { verdict, outcome };
  };

  /** The pack's worked example (a different task), rendered directly but still through the reply leak guard. */
  const showExample = async (level: HelpLevel) => {
    const e0 = epRef.current;
    if (!e0) return;
    // the reviewed pack example: a different task from the recovery one
    const task = e0.packVersion === DEMO_PACK.version ? demoTask(DEMO_TASK_IDS.example) : undefined;
    if (!task?.workedSolution) {
      setDenied({ reason: 'There is no reviewed example for this assignment.', alt: fallbackMove('example', pivotPolicy(e0, a)) });
      return;
    }
    const stamp = gate.stamp();
    setSending(true);
    try {
      let initialSnap: Snapshot | undefined;
      if (needsInitialSnap(e0)) {
        await savePage();
        const cap = await capture();
        initialSnap = takeSnapshot(pageId, cap.lines, cap.strokes, Date.now());
      }
      if (!gate.isCurrent(stamp)) return;
      const guardLines = check?.result.lines.map((l) => ({ id: l.id, reading: l.reading, verdict: l.verdict })) ?? [];
      const text = `${learnerText(task.id)}\n\n${applyReplyLeakGuard(task.workedSolution, guardLines, level)}`;
      const now = Date.now();
      updateAssignment(a.id, (x) => ({
        ...x,
        chat: [...x.chat, { role: 'user', text: 'Show me another example.' }, { role: 'assistant', text }],
        events: [...x.events, { t: now, type: 'reply', page: pageIndex + 1, level, detail: 'worked example' }],
      }));
      updateEpisode(e0.id, (e) => {
        const n = withSnapshot(e, e.initialAttemptId ?? '', initialSnap);
        return recordAssistance(n, { attemptId: workAttemptId(n), move: 'example', level, channels: ['text'], revealed: ['example'], text, at: now }, newId('h_'));
      });
      setTab('chat');
      setPanelOpen(true);
    } catch (e) {
      say(`The example didn't open: ${String(e instanceof Error ? e.message : e)}`, 'error');
    } finally {
      setSending(false);
    }
  };

  /** "Try a fresh problem": save, silence everything, close the tutor, drop late replies, then leave for the independent attempt. */
  const startFresh = async () => {
    const e0 = epRef.current;
    if (!e0) return;
    if (!(await saveOrWarn())) return;
    endConversation();
    stopAllVoice();
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPanelOpen(false);
    setDenied(undefined);
    gate.enter({ episodeId: e0.id, attemptId: workAttemptId(e0), phase: 'independent' });
    if (onStartIndependent) onStartIndependent(e0.id);
    else onBack();
  };

  /** "Yes, that's what I wrote" / a corrected reading: the next check grades this ink as the student says it reads. */
  const confirmLine = (v: LineVerdict, reading: string) => {
    if (!v.sig) return;
    updateAssignment(a.id, (x) => ({
      ...x,
      confirmedReadings: { ...(x.confirmedReadings ?? {}), [pageId]: confirmReading(x.confirmedReadings?.[pageId], v.sig, reading) },
    }));
    say('Got it. Check again and the tutor will grade it as you wrote it.');
  };

  const repeats = (v: LineVerdict) => isRepeat(getIssue(a.issues, pageId, issueKey(v.part, v.reading, v.sig)));

  const rungName = (v: LineVerdict) => HELP_LEVELS[rungFor(a.ladder ?? {}, issueKey(v.part, v.reading, v.sig), tutorContext(a).helpLevel, a.policyMaxLevel)].name;

  const rateMark = (fb: Omit<MarkFeedback, 'checkId' | 'at'>) => {
    if (!check) return;
    try {
      recordFeedback(
        pageId,
        {
          checkId,
          checkedAt: check.at,
          assignmentId: a.id,
          course: a.course,
          assignmentTitle: a.title,
          policy: a.policy,
          helpLevel: tutorContext(a).helpLevel,
          problems: a.problems,
          page: pageIndex + 1,
          model: check.result.model,
          lines: check.lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
          verdicts: check.result.lines,
        },
        { ...fb, checkId, at: Date.now() }
      );
    } catch (e) {
      Alert.alert('Could not save feedback', String(e instanceof Error ? e.message : e));
    }
  };

  const setLevel = (l: HelpLevel) =>
    updateAssignment(a.id, (x) => ({ ...x, helpLevel: l, events: [...x.events, { t: Date.now(), type: 'level_change', level: l }] }));

  // Sidebar: docked beside the canvas when the window is wide enough, so the canvas area (and with it the page's
  // centre and fit) shrinks to the space that is left. In a very narrow window (Split View) it overlays instead.
  const narrow = winW < 600;
  const drawerWidth = narrow ? Math.round(winW * 0.94) : Math.min(520, Math.max(340, Math.round(winW * 0.4)));
  const working = !!ep && (ep.phase === 'attempt' || ep.phase === 'repair' || ep.phase === 'repair_verified');
  // page chrome stays clear of the floating toolbar: one notice slot at the top, the repair card on the free edge
  const slots = pageSlots(dock.edge);
  const docked = panelOpen && !narrow;
  const counts = check?.result.lines.reduce<Record<string, number>>((m, l) => ((m[l.verdict] = (m[l.verdict] ?? 0) + 1), m), {});

  const panel = (
        <SidePanel
          assignment={a}
          check={check}
          stale={stale}
          tab={tab}
          onTab={setTab}
          draft={draft}
          onDraft={setDraft}
          onSend={send}
          onHelpStart={helpStart}
          sending={sending}
          streamText={streamText}
          onReparse={reparse}
          reparsing={reparsing}
          activePart={activePart}
          onSelectPart={setActivePart}
          marksByTurn={marksByTurn}
          onShowMarks={showTurnMarks}
          compact={pivot}
          header={
            pivot ? undefined : (
            <View style={styles.sideHeader}>
              <HelpLevelPicker value={tutorContext(a).helpLevel} max={a.policyMaxLevel} onChange={setLevel} />
              <Button small title={showMarks ? 'Hide marks' : 'Show marks'} onPress={() => setShowMarks((v) => !v)} />
            </View>
            )
          }
          onClose={() => setPanelOpen(false)}
          onInputBlur={() => canvasRef.current?.focus()}
        />
  );

  // every overlay on the page, in layer units (page * layerK). Build 6+: hosted natively at the fixed OVERLAY_K, so it
  // never re-lays out on zoom; older builds: page * settled zoom, moved by PageLayer.
  const layerK = NATIVE_OVERLAY ? OVERLAY_K : viewport.scale;
  const markVisible = NATIVE_OVERLAY
    ? { x: -viewport.tx / viewport.scale, y: -viewport.ty / viewport.scale, w: viewport.viewWidth / viewport.scale, h: viewport.viewHeight / viewport.scale }
    : visibleInLayer(viewport);
  const marks = check && marksUsable && showMarks && (
          <MarksOverlay
            width={PAGE_WIDTH * markK}
            height={PAGE_HEIGHT * markK}
            visible={markVisible}
            lines={markLines}
            verdicts={markVerdicts}
            parts={check.result.parts}
            stale={stale}
            onAsk={askAbout}
            onMoreHelp={moreHelp}
            onDispute={dispute}
            repeats={repeats}
            rungName={rungName}
            feedbackFor={(lineId) => feedbackFor(evals, checkId, lineId)}
            onRate={rateMark}
            onConfirmReading={confirmLine}
            onInputBlur={() => canvasRef.current?.focus()}
            {...(modern
              ? {
                  popoverOutside: true,
                  open: openMark?.id ?? null,
                  onOpenChange: (id: string | null) => setOpenMark(id ? { id, at: popoverSpot(id) } : null),
                }
              : {})}
          />
  );
  /** where a mark's card first opens, in screen points: beside its line if it fits, else below it */
  function popoverSpot(id: string) {
    const line = check?.lines.find((l) => l.id === id);
    if (!line) return { x: size.w - POPOVER_W - 16, y: 80 };
    const s = viewport.scale;
    const left = line.x * s + viewport.tx;
    const right = (line.x + line.w) * s + viewport.tx;
    const top = line.y * s + viewport.ty;
    const bottom = (line.y + line.h) * s + viewport.ty;
    if (right + 16 + POPOVER_W <= size.w) return { x: right + 16, y: top - 8 };
    if (left - 16 - POPOVER_W >= 0) return { x: left - 16 - POPOVER_W, y: top - 8 };
    return { x: left, y: bottom + 12 > size.h - POPOVER_H ? top - POPOVER_H - 12 : bottom + 12 };
  }
  const openVerdict = openMark && check && marksUsable && showMarks ? check.result.lines.find((v) => v.id === openMark.id) : undefined;
  const overlay = (
    <>
          {modern && pageBlocks.length > 0 && <BlocksLayer blocks={pageBlocks} k={layerK} zoom={viewport.scale} onMove={moveBlock} onRemove={removeBlock} onStamp={(id) => setBlockLocked(id, true)} />}
          {modern && tutorMarks.length > 0 && <TutorMarksLayer marks={tutorMarks} k={layerK} focusTurn={focusTurn} focusTag={focusTag} onDismiss={dismissMark} />}
          {marks &&
            (NATIVE_OVERLAY ? (
              // page units, scaled up to the layer: the marks' sizes are page points, so they grow and shrink with the ink
              <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, transformOrigin: 'left top', transform: [{ scale: OVERLAY_K }] }}>
                {marks}
              </View>
            ) : (
              marks
            ))}
    </>
  );

  return (
    <View style={styles.root}>
      <TopBar
        title={a.title}
        pageIndex={pageIndex}
        pageCount={a.pageIds.length}
        onBack={async () => {
          if (await saveOrWarn()) onBack();
        }}
        saveStatus={saveState}
        onSaveTap={() => (saveState === 'blocked' ? setLoadNonce((n) => n + 1) : void saveOrWarn())}
        onPrevPage={() => goToPage(pageIndex - 1)}
        onNextPage={() => goToPage(pageIndex + 1)}
        onAddPage={addPage}
        modern={modern}
        onFit={() => canvasRef.current?.fitToWidth()}
        zoomPercent={Math.round(viewport.scale * 100)}
        zoomedAway={Math.abs(viewport.scale - viewport.viewWidth / PAGE_WIDTH) > 0.03 * (viewport.viewWidth / PAGE_WIDTH)}
        onExport={() => void exportAssignment()}
        exporting={exporting}
        questionOn={showQuestion}
        onToggleQuestion={toggleQuestion}
        checking={checking}
        onCheck={() => void (pivot ? runMove('check') : runCheck())}
        voice={voice}
        onTalkStart={() => void startTalk()}
        onTalkEnd={() => void endTalk()}
        onStopVoice={stopVoice}
        conversation={conversation}
        onToggleConversation={() => (conversation ? endConversation() : startConversation())}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((o) => !o)}
        counts={counts}
        stale={stale}
        info={pivot && ep ? <PracticeStatus phase={ep.phase} assistance={ep.assistance} /> : undefined}
        help={
          pivot && ep && working
            ? { items: HELP_MOVES.map((m) => ({ key: m, title: MOVE_TITLE[m] })), disabled: checking || sending, onPick: (k) => void runMove(k as HelpMove) }
            : undefined
        }
        menuExtra={
          pivot
            ? (close) => (
                <>
                  <MenuItem
                    title={showMarks ? 'Hide marks' : 'Show marks'}
                    onPress={() => {
                      close();
                      setShowMarks((v) => !v);
                    }}
                  />
                  <MenuSection title="Help level for typed and spoken questions" />
                  {([0, 1, 2, 3, 4] as HelpLevel[]).map((l) => (
                    <MenuItem
                      key={l}
                      title={`${l}. ${HELP_LEVELS[l].name}`}
                      detail={l > a.policyMaxLevel ? 'Not allowed by this policy' : undefined}
                      locked={l > a.policyMaxLevel}
                      selected={tutorContext(a).helpLevel === l}
                      onPress={() => {
                        close();
                        setLevel(l);
                      }}
                    />
                  ))}
                </>
              )
            : undefined
        }
        insetTop={insets.top}
        insetLeft={insets.left}
        insetRight={insets.right}
      />
      {showQuestion && (
        <QuestionBanner
          assignment={a}
          activePart={activePart}
          onChange={setActivePart}
          onPlacePart={() => void placeBlock('part')}
          onPlaceSetup={() => void placeBlock('setup')}
          onRetract={toggleQuestion}
          insetLeft={insets.left}
          insetRight={insets.right}
        />
      )}

      <View style={styles.body}>
      <View style={styles.page} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <PencilCanvas
          ref={canvasRef}
          style={StyleSheet.absoluteFill}
          paper={settings.paper}
          allowFingerDrawing={settings.allowFingerDrawing}
          showToolPicker={!modern}
          onDrawingChanged={onDrawingChanged}
          {...(modern ? { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, onViewportChanged, onPencilDoubleTap } : {})}
          {...(nativeApiVersion >= 5 ? { twoFingerScroll: settings.twoFingerScroll !== false } : {})}
          {...(nativeApiVersion >= 8 ? { eraserCursor: eraserRing(toolState) } : {})}
          {...(nativeApiVersion >= 10 ? { overlayInPage: OVERLAY_IN_PAGE, paperInPage: PAPER_IN_PAGE } : {})}
          {...(nativeApiVersion >= 4 ? { surroundColor: PALETTE[scheme === 'dark' ? 'dark' : 'light'].surround, onPencilSqueeze: (ph: 'began' | 'ended' | 'cancelled') => (ph === 'began' ? void startTalk() : ph === 'ended' ? void endTalk() : stopVoice()) } : {})}
          {...(NATIVE_OVERLAY ? { overlayScale: OVERLAY_K } : {})}
        >
          {/* Build 6+: the overlay layer lives INSIDE the native canvas view, which moves and scales it with the ink in
              the same frame (no JS round trip). Laid out once at page * OVERLAY_K; overlayScale never changes, so a
              zoom neither re-lays it out nor races a prop update. */}
          {NATIVE_OVERLAY && size.w > 0 && (
            <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: PAGE_WIDTH * OVERLAY_K, height: PAGE_HEIGHT * OVERLAY_K }}>
              {overlay}
            </View>
          )}
        </PencilCanvas>
        {/* Older builds: the same layer above the canvas, moved by a JS-driven transform (src/components/PageLayer.tsx). */}
        {!NATIVE_OVERLAY && size.w > 0 && (
          <PageLayer live={live} settled={viewport}>
            {overlay}
          </PageLayer>
        )}
        {modern && tutorMarks.length > 0 && <ClearMarksButton onClear={clearMarks} top={dock.edge === 'top' ? slots.top : undefined} />}
        {openMark && openVerdict && size.w > 0 && (
          <FloatingCard key={openMark.id} initial={openMark.at} bounds={size} width={POPOVER_W} height={POPOVER_H}>
            <MarkPopoverCard>
              <MarkPopover
                v={openVerdict}
                onClose={() => setOpenMark(null)}
                onAsk={askAbout}
                onMoreHelp={moreHelp}
                onDispute={dispute}
                repeats={repeats}
                feedbackFor={(lineId) => feedbackFor(evals, checkId, lineId)}
                onRate={rateMark}
                onConfirmReading={confirmLine}
                onInputBlur={() => canvasRef.current?.focus()}
              />
            </MarkPopoverCard>
          </FloatingCard>
        )}
        {!showQuestion && <QuestionPill label={activePart} onPress={toggleQuestion} insetLeft={insets.left} top={dock.edge === 'top' ? slots.top : undefined} />}
        {size.w > 0 && (
          <FloatingToolbar
            tool={toolState}
            onToolChange={setToolState}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
            modern={modern}
            dock={dock}
            onDock={setDock}
            bounds={size}
            insets={{ top: 0, left: insets.left, bottom: insets.bottom, right: docked ? 0 : insets.right }}
          />
        )}
        {/* ONE notice at a time (src/ui/toolbarDock.ts pickNotice): a failed load, the voice state, a denied move, a
            transient notice, no key, then the quiet stale hint */}
        {(() => {
          const top = pickNotice<{ kind: NoticeKind; node: React.ReactNode }>([
            !!loadFailed && {
              kind: 'load',
              node: (
                <Pressable onPress={() => setLoadNonce((n) => n + 1)} style={styles.loadBanner} accessibilityRole="button">
                  <Text style={styles.loadBannerText}>{loadFailed} Tap to retry. Nothing has been overwritten.</Text>
                </Pressable>
              ),
            },
            (voice !== 'idle' || conversation) && {
              kind: 'voice',
              node: (
                <View style={[styles.notice, styles.listening, voice !== 'listening' && { borderColor: C.line }]} accessibilityLiveRegion="polite">
                  <Text style={[styles.listeningDot, voice !== 'listening' && { color: C.sub }]}>●</Text>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.voiceState}>
                      {voice === 'thinking' ? 'Thinking…' : voice === 'speaking' ? 'Speaking…' : pausing ? "I'm waiting for you…" : 'Listening…'}
                    </Text>
                    {voice === 'listening' && !!heard && (
                      <Text style={styles.noticeText} numberOfLines={2}>
                        {heard}
                      </Text>
                    )}
                    {notice && notice.tone !== 'info' && (
                      <Text style={[styles.noticeText, { color: notice.tone === 'error' ? C.incorrect : C.partial }]} numberOfLines={2}>
                        {notice.text}
                      </Text>
                    )}
                  </View>
                  {conversation && voice === 'listening' && !!heard && <Button title="Send now" kind="primary" small onPress={sendNow} />}
                  {conversation && voice === 'speaking' && <Button title="Your turn" small onPress={yourTurn} />}
                  <Button title={conversation ? 'End' : 'Stop'} small onPress={stopVoice} />
                </View>
              ),
            },
            pivot && !!denied && {
              kind: 'denied',
              node: <DeniedNotice reason={denied.reason} alt={denied.alt} busy={checking || sending} onMove={(m) => void runMove(m)} onDismiss={() => setDenied(undefined)} />,
            },
            !!notice && {
              kind: 'notice',
              node: (
                <Pressable onPress={() => setNotice(null)} style={[styles.notice, notice.tone !== 'info' && { backgroundColor: notice.tone === 'error' ? C.incorrectSoft : C.partialSoft }]} accessibilityRole="alert" accessibilityLabel={notice.text}>
                  <Text style={[styles.noticeText, notice.tone !== 'info' && { color: notice.tone === 'error' ? C.incorrect : C.partial }]}>{notice.text}</Text>
                </Pressable>
              ),
            },
            !hasKey && {
              kind: 'key',
              node: (
                <View pointerEvents="none" style={styles.keyBanner}>
                  <Text style={styles.keyBannerText}>No API key: add one in Settings to check your work</Text>
                </View>
              ),
            },
            (oldCheck || stale) && showMarks && {
              kind: 'stale',
              node: (
                <View pointerEvents="none" style={styles.staleTag}>
                  <Text style={styles.staleText}>{oldCheck ? 'Marks from an older version · Check again' : 'Page changed since the check'}</Text>
                </View>
              ),
            },
          ]);
          const card = pivot && ep && ep.phase === 'repair_verified' ? <RepairCard key={ep.id} repairedText={repairedAfter(ep.assistance)} onFresh={() => void startFresh()} /> : null;
          return (
            <>
              {(top || (card && slots.card === 'top')) && (
                <View pointerEvents="box-none" style={[styles.stack, { top: slots.top }]}>
                  {top?.node}
                  {slots.card === 'top' && card}
                </View>
              )}
              {card && slots.card === 'bottom' && (
                <View pointerEvents="box-none" style={[styles.stack, { bottom: 12 + insets.bottom }]}>
                  {card}
                </View>
              )}
            </>
          );
        })()}
        {panelOpen && narrow && (
          <View style={[styles.drawer, { width: drawerWidth, paddingBottom: insets.bottom, paddingRight: insets.right }]}>
            {panel}
          </View>
        )}
      </View>
      {panelOpen && !narrow && (
        <View style={[styles.dock, { width: drawerWidth + insets.right, paddingBottom: insets.bottom, paddingRight: insets.right }]}>{panel}</View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surround },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, flexWrap: 'wrap', backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  body: { flex: 1, flexDirection: 'row' },
  page: { flex: 1, overflow: 'hidden' },
  dock: { backgroundColor: C.bg, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  drawer: {
    position: 'absolute',
    // above the floating toolbar (30) and the notice stack (20)
    zIndex: 50,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.bg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: -4, height: 0 },
  },
  stack: { position: 'absolute', left: 12, right: 12, alignItems: 'center', gap: 8, zIndex: 20 },
  loadBanner: { maxWidth: '90%', backgroundColor: C.incorrectSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, zIndex: 5 },
  loadBannerText: { color: C.incorrect, fontWeight: '700', fontSize: 13 },
  keyBanner: { backgroundColor: C.incorrectSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  keyBannerText: { color: C.incorrect, fontWeight: '700', fontSize: 12 },
  // quiet on purpose: a hint, not a warning
  staleTag: { backgroundColor: C.card, opacity: 0.9, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  staleText: { color: C.sub, fontWeight: '500', fontSize: 12 },
  notice: {
    maxWidth: 520,
    backgroundColor: C.card,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  noticeText: { fontSize: 14, color: C.ink, textAlign: 'center' },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 8, borderColor: C.incorrect },
  listeningDot: { color: C.incorrect, fontSize: 12 },
  voiceState: { fontSize: 13, fontWeight: '700', color: C.sub },
});
