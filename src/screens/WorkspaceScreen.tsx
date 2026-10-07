import * as React from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PencilCanvas, nativeApiVersion, nativeCanvasAvailable, nativeHasNewFunctions, nativeModuleInfo, type ExportedImage, type PencilCanvasHandle, type StrokeBox, type ViewportEvent } from '../../modules/pencil-canvas';
import { getProvider } from '../ai';
import type { HelpLevel, LineVerdict, ReplyIntent, TutorContext } from '../ai/types';
import { Button } from '../components/Button';
import { AiFab } from '../components/AiFab';
import { HelpLevelPicker } from '../components/HelpLevelPicker';
import { QuestionBanner, QuestionPill } from '../components/QuestionBanner';
import { TopBar } from '../components/TopBar';
import { ENV } from '../config';
import { MarksOverlay } from '../components/MarksOverlay';
import { BlocksLayer } from '../components/BlocksLayer';
import { TutorMarksLayer } from '../components/TutorMarksLayer';
import { BLOCK_MARGIN_X, BLOCK_WIDTH, clampBlock, estimateHeight, nextBlockY, partContent, setupContent, type PageBlock } from '../blocks';
import { SidePanel, type Tab } from '../components/SidePanel';
import { mergeParts, mergeVerdicts, planCarry, signatures } from '../check/carry';
import { guardMerged } from '../check/finalize';
import { confirmReading, confirmedFor } from '../check/confirmed';
import { groupLines, type Line } from '../ink/lines';
import { IDENTITY_VIEWPORT, PAGE_HEIGHT, PAGE_WIDTH, boxToScreen, parseViewport, sameViewport, type Viewport } from '../page';
import { normalizeToolState, toNativeSpec, toggleEraser, type ToolKind, type ToolState } from '../tools';
import { getAssignment, getSettings, newId, readPage, recordUsage, saveSettings, subscribe, updateAssignment, writePage } from '../store/db';
import { loadEvals, recordFeedback, saveCheckImage, subscribeEvals } from '../store/evals';
import { feedbackFor, type MarkFeedback } from '../store/evalRecords';
import { applyParse } from '../store/parseApply';
import { isTransientViewError, mayAutosave, withViewRetry } from '../store/saveGuard';
import { readSource } from '../store/sources';
import { findPart } from '../problems/flatten';
import { chunkLine } from '../tutor/chunks';
import { pruneMarks, resolveMarks } from '../tutor/marks';
import { escalate, issueKey, legacyIssueKey, pruneLadder, renameLadderKeys, rungFor } from '../tutor/ladder';
import { getIssue, isRepeat, noteHelp, recordCheck, renameIssueKeys } from '../tutor/issues';
import { HELP_LEVELS } from '../ai/prompts';
import { costUSD } from '../ai/pricing';
import type { Assignment } from '../store/types';
import { C } from '../theme';

type Props = { assignmentId: string; onBack: () => void };

const tutorContext = (a: Assignment): TutorContext => ({
  course: a.course,
  assignmentTitle: a.title,
  problems: a.problems,
  groups: a.groups,
  policy: a.policy,
  helpLevel: Math.min(a.helpLevel, a.policyMaxLevel) as HelpLevel,
  style: a.style,
});

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
    },
  });
};

export function WorkspaceScreen({ assignmentId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const settings = getSettings();
  const canvasRef = React.useRef<PencilCanvasHandle>(null);

  const [a, setA] = React.useState<Assignment | undefined>(() => getAssignment(assignmentId));
  React.useEffect(() => subscribe(() => setA(getAssignment(assignmentId))), [assignmentId]);

  const [pageIndex, setPageIndex] = React.useState(0);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [strokeCount, setStrokeCount] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);
  // Normal outcomes ("nothing new", "add a key", a failed check) are a quiet line on the page, not a system alert.
  const [notice, setNotice] = React.useState<{ text: string; tone: 'info' | 'warn' | 'error'; id: number } | null>(null);
  const say = React.useCallback((text: string, tone: 'info' | 'warn' | 'error' = 'info') => setNotice({ text, tone, id: Date.now() }), []);
  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), notice.tone === 'error' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const [sending, setSending] = React.useState(false);
  const [reparsing, setReparsing] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('feedback');
  const [draft, setDraft] = React.useState('');
  const [showMarks, setShowMarks] = React.useState(true);
  const activePart = a?.activePart;
  const setActivePart = React.useCallback(
    (label: string | undefined) => {
      updateAssignment(assignmentId, (x) => ({ ...x, activePart: label }));
    },
    [assignmentId]
  );
  const [showQuestion, setShowQuestion] = React.useState<boolean>(() => getSettings().showQuestion ?? true);
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
  const [viewport, setViewport] = React.useState<Viewport>(IDENTITY_VIEWPORT);
  const [toolState, setToolState] = React.useState<ToolState>(() => normalizeToolState(getSettings().toolState));
  const toolIsPixelEraser = toolState.tool === 'eraser' && toolState.eraserMode === 'pixel';
  // Pages where the pixel eraser was used since their last check (it can shrink a stroke without changing its box).
  const pixelErased = React.useRef(new Set<string>());
  const prevToolRef = React.useRef<ToolKind>('pen');
  const [evals, setEvals] = React.useState(loadEvals);
  React.useEffect(() => subscribeEvals(() => setEvals({ ...loadEvals() })), []);

  // Tools: the toolbar is JS; the native canvas only receives a small generic spec.
  React.useEffect(() => {
    if (!modern) return;
    const c = canvasRef.current;
    if (!c) return;
    c.setTool(toNativeSpec(toolState)).catch((e) => console.warn('setTool failed', e));
    c.setRulerActive(toolState.ruler).catch((e) => console.warn('setRulerActive failed', e));
    saveSettings({ toolState });
  }, [modern, toolState]);

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

  const onViewportChanged = React.useCallback((e: ViewportEvent) => {
    setViewport((prev) => {
      const next = parseViewport(e, prev);
      return sameViewport(prev, next) ? prev : next;
    });
  }, []);

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
  }, []);

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
  const capture = async (): Promise<{ lines: Line[]; image: ExportedImage | null; strokes: number; strokeList: StrokeBox[] }> => {
    const c = canvasRef.current;
    if (!c) throw new Error('Canvas not ready');
    const strokes = await c.getStrokes();
    const lines = groupLines(strokes);
    const image = await c.exportImage(
      lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
      2000
    );
    return { lines, image, strokes: strokes.length, strokeList: strokes };
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
        <Text>Assignment not found.</Text>
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
  const markLines = check && marksUsable ? (modern ? check.lines.map((l) => ({ ...l, ...boxToScreen(l, viewport) })) : check.lines) : [];

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
    if (pageBlocks.some((b) => b.kind === kind && b.label === label)) {
      Alert.alert('Already on this page', 'Drag it by its handle, or remove it with ✕ and place it again.');
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
  const tutorMarks = (a?.tutorMarks && a.tutorMarks[pageId]) || [];
  const [focusTurn, setFocusTurn] = React.useState<number | undefined>(undefined);
  const [focusTag, setFocusTag] = React.useState<number | undefined>(undefined);
  const marksByTurn = React.useMemo(() => tutorMarks.reduce<Record<number, number[]>>((m, t) => ((m[t.turn] = [...(m[t.turn] ?? []), t.tag]), m), {}), [tutorMarks]);
  const showTurnMarks = (turn: number, tag?: number) => {
    setFocusTurn(turn);
    setFocusTag(tag);
    if (narrow) setPanelOpen(false);
    setTimeout(() => {
      setFocusTurn((t) => (t === turn ? undefined : t));
      setFocusTag(undefined);
    }, 3500);
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
  const removeBlock = React.useCallback(
    (id: string) => {
      updateAssignment(assignmentId, (x) => ({ ...x, blocks: { ...(x.blocks ?? {}), [pageId]: ((x.blocks ?? {})[pageId] ?? []).filter((b) => b.id !== id) } }));
    },
    [assignmentId, pageId]
  );

  // ---- actions -----------------------------------------------------------
  const runCheck = async () => {
    if (!hasKey) {
      say('Add your Anthropic API key in Settings to check your work.', 'warn');
      return;
    }
    setChecking(true);
    try {
      await savePage();
      const { lines, image, strokes, strokeList } = await capture();
      if (strokes === 0 || !image) {
        say('Nothing to check yet. Write something on this page first.');
        return;
      }
      const prev = a.checks[pageId];
      // Only grade what is new or changed: lines verified earlier and untouched since stay as they were (src/check/carry.ts).
      // The pixel eraser can shrink a stroke without changing its box, so after using it nothing is carried.
      const sigs = signatures(lines, strokeList);
      const current = lines.map((l) => ({ id: l.id, sig: sigs.get(l.id) ?? '' }));
      const plan = planCarry(current, prev && prev.space === 'page-v2' ? prev.result.lines : undefined, pixelErased.current.has(pageId) || (toolState.tool === 'eraser' && toolState.eraserMode === 'pixel'));
      if (prev && plan.toGrade.length === 0 && plan.dirtyParts.size === 0) {
        setShowMarks(true);
        setTab('feedback');
        setPanelOpen(true);
        say('Nothing new since your last check.');
        return;
      }
      const settled = [...plan.settled.entries()].map(([id, l]) => ({ id, part: l.part, reading: l.reading }));
      // Readings the student confirmed for ink that hasn't changed (src/check/confirmed.ts).
      const conf = confirmedFor(a.confirmedReadings?.[pageId], current);
      const spend = { total: 0 };
      const fresh = await providerFromSettings(spend).check({
        ...tutorContext(a),
        image: { base64: image.base64, mediaType: 'image/png' },
        lines: lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        pageNumber: pageIndex + 1,
        focusPart: activePart && a.problems.some((p) => p.label === activePart) ? activePart : undefined,
        previous: prev ? { feedback: prev.result.feedback, stillOpen: prev.result.stillOpen } : undefined,
        settled: settled.length ? settled : undefined,
        confirmed: conf.input.length ? conf.input : undefined,
      });
      const mergedLines = mergeVerdicts(current, plan, fresh.lines);
      // Re-run the guards on the whole merged page: the provider's guards only saw the freshly graded lines (src/check/finalize.ts).
      const result = guardMerged({ ...fresh, lines: mergedLines, parts: mergeParts(fresh.parts, prev?.result.parts, plan, mergedLines) }, tutorContext(a).helpLevel);
      if (!toolIsPixelEraser) pixelErased.current.delete(pageId);
      try {
        saveCheckImage(pageId, image.base64);
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
      setShowMarks(true);
      setTab('feedback');
      setPanelOpen(true);
    } catch (e) {
      say(`Check didn't finish: ${String(e instanceof Error ? e.message : e)}. Tap Check to try again.`, 'error');
    } finally {
      setChecking(false);
    }
  };

  const send = async (message: string, attachPage: boolean, levelOverride?: HelpLevel, intent?: ReplyIntent, evidence?: string) => {
    setSending(true);
    setDraft('');
    try {
      const cap = attachPage ? await capture() : null;
      const image = cap?.image ?? null;
      const level = levelOverride ?? tutorContext(a).helpLevel;
      const strokeBox = new Map((cap?.strokeList ?? []).map((st) => [st.i, st]));
      const chunksByLine = Object.fromEntries((cap?.lines ?? []).map((l) => [l.id, chunkLine(l.strokes.map((i) => strokeBox.get(i)).filter((b): b is NonNullable<typeof b> => !!b))]));
      const spend = { total: 0 };
      const reply = await providerFromSettings(spend).reply({
        ...tutorContext(a),
        helpLevel: level,
        lines: check?.result.lines.map((l) => ({ id: l.id, reading: l.reading, verdict: l.verdict })),
        history: a.chat,
        message,
        image: image ? { base64: image.base64, mediaType: 'image/png' } : undefined,
        lastCheck: check ? { feedback: check.result.feedback, stillOpen: check.result.stillOpen } : undefined,
        intent,
        evidence,
        part: activePart,
        markLineIds: cap && image ? cap.lines.map((l) => l.id) : undefined,
      });
      const type = intent === 'start' ? 'start' : intent === 'dispute' ? 'dispute' : 'reply';
      updateAssignment(a.id, (x) => ({
        ...x,
        chat: [...x.chat, { role: 'user', text: message }, { role: 'assistant', text: reply.text, costUSD: spend.total }],
        tutorMarks: reply.marks.length
          ? {
              ...(x.tutorMarks ?? {}),
              [pageId]: pruneMarks(
                [...((x.tutorMarks ?? {})[pageId] ?? []), ...resolveMarks(reply.marks, cap?.lines ?? [], chunksByLine, x.chat.length + 1, () => newId('t_'))],
                x.chat.length + 1
              ),
            }
          : x.tutorMarks,
        events: [
          ...x.events,
          { t: Date.now(), type, page: pageIndex + 1, level, detail: intent === 'more_help' ? 'hint ladder' : type === 'start' ? activePart : undefined, costUSD: spend.total },
        ],
      }));
    } catch (e) {
      setDraft(message);
      Alert.alert('Message failed', String(e instanceof Error ? e.message : e));
    } finally {
      setSending(false);
    }
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
    await send(`I think the mark on ${v.id} ("${v.reading}") is wrong. Can you re-check it?`, true, undefined, 'dispute', evidence);
  };

  /** "Help me start": no attempt needed; a policy-capped first move for the active part. */
  const helpStart = async () => {
    setTab('chat');
    setPanelOpen(true);
    await send(`I don't know how to start${activePart ? ` ${activePart}` : ' this problem'}.`, true, undefined, 'start');
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
          onReparse={reparse}
          reparsing={reparsing}
          activePart={activePart}
          onSelectPart={setActivePart}
          marksByTurn={marksByTurn}
          onShowMarks={showTurnMarks}
          header={
            <View style={styles.sideHeader}>
              <HelpLevelPicker value={tutorContext(a).helpLevel} max={a.policyMaxLevel} onChange={setLevel} />
              <Button small title={showMarks ? 'Hide marks' : 'Show marks'} onPress={() => setShowMarks((v) => !v)} />
            </View>
          }
          onClose={() => setPanelOpen(false)}
          onInputBlur={() => canvasRef.current?.focus()}
        />
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
        tool={toolState}
        onToolChange={setToolState}
        onUndo={() => canvasRef.current?.undo()}
        onRedo={() => canvasRef.current?.redo()}
        onFit={() => canvasRef.current?.fitToWidth()}
        zoomPercent={Math.round(viewport.scale * 100)}
        questionOn={showQuestion}
        onToggleQuestion={toggleQuestion}
        checking={checking}
        onCheck={runCheck}
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
        />
        {modern && pageBlocks.length > 0 && size.w > 0 && (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: viewport.interacting ? 0.4 : 1 }]}>
            <BlocksLayer blocks={pageBlocks} viewport={viewport} onMove={moveBlock} onRemove={removeBlock} />
          </View>
        )}
        {modern && tutorMarks.length > 0 && size.w > 0 && (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { opacity: viewport.interacting ? 0.35 : 1 }]}>
            <TutorMarksLayer marks={tutorMarks} viewport={viewport} focusTurn={focusTurn} focusTag={focusTag} onDismiss={dismissMark} onClear={clearMarks} />
          </View>
        )}
        {!showQuestion && <QuestionPill label={activePart} onPress={toggleQuestion} insetLeft={insets.left} />}
        {check && marksUsable && showMarks && size.w > 0 && (
          <View pointerEvents={viewport.interacting ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, { opacity: viewport.interacting ? 0 : 1 }]}>
            <MarksOverlay
              width={size.w}
              height={size.h}
              lines={markLines}
              verdicts={check.result.lines}
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
            />
          </View>
        )}
        {notice && (
          <Pressable onPress={() => setNotice(null)} style={[styles.notice, notice.tone !== 'info' && { backgroundColor: notice.tone === 'error' ? C.incorrectSoft : C.partialSoft }]} accessibilityRole="alert" accessibilityLabel={notice.text}>
            <Text style={[styles.noticeText, notice.tone !== 'info' && { color: notice.tone === 'error' ? C.incorrect : C.partial }]}>{notice.text}</Text>
          </Pressable>
        )}
        {oldCheck && showMarks && (
          <View pointerEvents="none" style={styles.staleTag}>
            <Text style={styles.staleText}>Marks from an older version · Check again</Text>
          </View>
        )}
        {loadFailed && (
          <Pressable onPress={() => setLoadNonce((n) => n + 1)} style={styles.loadBanner}>
            <Text style={styles.loadBannerText}>{loadFailed} Tap to retry. Nothing has been overwritten.</Text>
          </Pressable>
        )}
        {!hasKey && (
          <View pointerEvents="none" style={styles.keyBanner}>
            <Text style={styles.keyBannerText}>No API key: add one in Settings to check your work</Text>
          </View>
        )}
        {stale && showMarks && (
          <View pointerEvents="none" style={styles.staleTag}>
            <Text style={styles.staleText}>Page changed · Check again</Text>
          </View>
        )}
        {!panelOpen && <AiFab onPress={() => setPanelOpen(true)} counts={counts} stale={stale} insetRight={insets.right} insetBottom={insets.bottom} />}
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
  root: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sideHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, flexWrap: 'wrap', backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  body: { flex: 1, flexDirection: 'row' },
  page: { flex: 1, overflow: 'hidden' },
  dock: { backgroundColor: C.bg, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  drawer: {
    position: 'absolute',
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
  loadBanner: { position: 'absolute', top: 8, alignSelf: 'center', maxWidth: '90%', backgroundColor: C.incorrectSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, zIndex: 5 },
  loadBannerText: { color: C.incorrect, fontWeight: '700', fontSize: 13 },
  keyBanner: { position: 'absolute', top: 8, alignSelf: 'center', backgroundColor: C.incorrectSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  keyBannerText: { color: C.incorrect, fontWeight: '700', fontSize: 12 },
  staleTag: { position: 'absolute', top: 8, left: 8, backgroundColor: C.partialSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  staleText: { color: C.partial, fontWeight: '700', fontSize: 12 },
  notice: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
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
});
