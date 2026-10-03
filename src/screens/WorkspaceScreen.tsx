import * as React from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PencilCanvas, type ExportedImage, type PencilCanvasHandle } from '../../modules/pencil-canvas';
import { getProvider } from '../ai';
import type { HelpLevel, LineVerdict, TutorContext } from '../ai/types';
import { Button } from '../components/Button';
import { HelpLevelPicker } from '../components/HelpLevelPicker';
import { MarksOverlay } from '../components/MarksOverlay';
import { SidePanel, type Tab } from '../components/SidePanel';
import { groupLines, type Line } from '../ink/lines';
import { getAssignment, getSettings, newId, readPage, subscribe, updateAssignment, writePage } from '../store/db';
import { loadEvals, recordFeedback, saveCheckImage, subscribeEvals } from '../store/evals';
import { feedbackFor, type MarkFeedback } from '../store/evalRecords';
import { readSource } from '../store/sources';
import type { Assignment } from '../store/types';
import { C } from '../theme';

type Props = { assignmentId: string; onBack: () => void };

const tutorContext = (a: Assignment): TutorContext => ({
  course: a.course,
  assignmentTitle: a.title,
  problems: a.problems,
  policy: a.policy,
  helpLevel: Math.min(a.helpLevel, a.policyMaxLevel) as HelpLevel,
  style: a.style,
});

const providerFromSettings = () => {
  const s = getSettings();
  return getProvider({ apiKey: s.apiKey, checkModel: s.checkModel, parseModel: s.parseModel });
};

export function WorkspaceScreen({ assignmentId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const settings = getSettings();
  const canvasRef = React.useRef<PencilCanvasHandle>(null);

  const [a, setA] = React.useState<Assignment | undefined>(() => getAssignment(assignmentId));
  React.useEffect(() => subscribe(() => setA(getAssignment(assignmentId))), [assignmentId]);

  const [pageIndex, setPageIndex] = React.useState(0);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [strokeCount, setStrokeCount] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [reparsing, setReparsing] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('feedback');
  const [draft, setDraft] = React.useState('');
  const [showMarks, setShowMarks] = React.useState(true);
  const [evals, setEvals] = React.useState(loadEvals);
  React.useEffect(() => subscribeEvals(() => setEvals({ ...loadEvals() })), []);

  const pageId = a?.pageIds[pageIndex] ?? '';
  const pageIdRef = React.useRef(pageId);
  pageIdRef.current = pageId;
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- persistence -------------------------------------------------------
  const savePage = React.useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = pageIdRef.current;
    if (!id || !canvasRef.current) return;
    writePage(id, await canvasRef.current.getDrawing());
  }, []);

  // Load the drawing whenever the page changes (and on first mount).
  React.useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    (async () => {
      const c = canvasRef.current;
      if (!c) return;
      await c.setDrawing(readPage(pageId));
      const strokes = await c.getStrokes();
      if (!cancelled) setStrokeCount(strokes.length);
    })().catch((e) => console.warn('load page failed', e));
    return () => {
      cancelled = true;
    };
  }, [pageId]);

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
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void savePage(), 1200);
    },
    [savePage]
  );

  // ---- capture -----------------------------------------------------------
  const capture = async (): Promise<{ lines: Line[]; image: ExportedImage | null; strokes: number }> => {
    const c = canvasRef.current;
    if (!c) throw new Error('Canvas not ready');
    const strokes = await c.getStrokes();
    const lines = groupLines(strokes);
    const image = await c.exportImage(
      lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
      2000
    );
    return { lines, image, strokes: strokes.length };
  };

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

  // ---- actions -----------------------------------------------------------
  const runCheck = async () => {
    setChecking(true);
    try {
      await savePage();
      const { lines, image, strokes } = await capture();
      if (strokes === 0 || !image) {
        Alert.alert('Nothing to check', 'Write something on this page first.');
        return;
      }
      const prev = a.checks[pageId];
      const result = await providerFromSettings().check({
        ...tutorContext(a),
        image: { base64: image.base64, mediaType: 'image/png' },
        lines: lines.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        pageNumber: pageIndex + 1,
        previous: prev ? { feedback: prev.result.feedback, stillOpen: prev.result.stillOpen } : undefined,
      });
      try {
        saveCheckImage(pageId, image.base64);
      } catch (e) {
        console.warn('saving check image failed', e);
      }
      const counts = result.lines.reduce<Record<string, number>>((m, l) => ((m[l.verdict] = (m[l.verdict] ?? 0) + 1), m), {});
      updateAssignment(a.id, (x) => ({
        ...x,
        checks: { ...x.checks, [pageId]: { id: newId('c_'), at: Date.now(), result, lines, strokeCount: strokes } },
        events: [
          ...x.events,
          {
            t: Date.now(),
            type: 'check',
            page: pageIndex + 1,
            level: tutorContext(x).helpLevel,
            detail: `✓${counts.valid ?? 0} ~${counts.partial ?? 0} ✗${counts.incorrect ?? 0} ?${counts.unreadable ?? 0}`,
          },
        ],
      }));
      setShowMarks(true);
      setTab('feedback');
      setPanelOpen(true);
    } catch (e) {
      Alert.alert('Check failed', String(e instanceof Error ? e.message : e));
    } finally {
      setChecking(false);
    }
  };

  const send = async (message: string, attachPage: boolean) => {
    setSending(true);
    setDraft('');
    try {
      const image = attachPage ? (await capture()).image : null;
      const reply = await providerFromSettings().reply({
        ...tutorContext(a),
        history: a.chat,
        message,
        image: image ? { base64: image.base64, mediaType: 'image/png' } : undefined,
        lastCheck: check ? { feedback: check.result.feedback, stillOpen: check.result.stillOpen } : undefined,
      });
      updateAssignment(a.id, (x) => ({
        ...x,
        chat: [...x.chat, { role: 'user', text: message }, { role: 'assistant', text: reply }],
        events: [...x.events, { t: Date.now(), type: 'reply', page: pageIndex + 1, level: tutorContext(x).helpLevel }],
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
      const parsed = await providerFromSettings().parseAssignment({ title: a.title, pdfBase64: pdf });
      updateAssignment(a.id, (x) => ({
        ...x,
        problems: parsed.problems,
        course: x.course || parsed.course || '',
        events: [...x.events, { t: Date.now(), type: 'parse', detail: `${parsed.problems.length} parts` }],
      }));
    } catch (e) {
      Alert.alert('Parsing failed', String(e instanceof Error ? e.message : e));
    } finally {
      setReparsing(false);
    }
  };

  const goToPage = async (index: number) => {
    if (index < 0 || index >= a.pageIds.length || index === pageIndex) return;
    await savePage();
    setPageIndex(index);
  };

  const addPage = async () => {
    await savePage();
    const updated = updateAssignment(a.id, (x) => ({ ...x, pageIds: [...x.pageIds, newId('p_')] }));
    if (updated) setPageIndex(updated.pageIds.length - 1);
  };

  const askAbout = (v: LineVerdict) => {
    setDraft(`About ${v.id}${v.reading ? ` ("${v.reading}")` : ''}: `);
    setTab('chat');
    setPanelOpen(true);
  };

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

  const drawerWidth = Math.min(420, Math.max(320, size.w * 0.46));

  return (
    <View style={styles.root}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 6 }]}>
        <Button
          small
          kind="ghost"
          title="‹ Back"
          onPress={async () => {
            await savePage();
            onBack();
          }}
        />
        <Text style={styles.title} numberOfLines={1}>
          {a.title}
        </Text>
        <View style={styles.pager}>
          <Pressable onPress={() => goToPage(pageIndex - 1)} hitSlop={8} disabled={pageIndex === 0}>
            <Text style={[styles.pagerArrow, pageIndex === 0 && styles.disabled]}>‹</Text>
          </Pressable>
          <Text style={styles.pagerText}>
            {pageIndex + 1}/{a.pageIds.length}
          </Text>
          <Pressable onPress={() => goToPage(pageIndex + 1)} hitSlop={8} disabled={pageIndex >= a.pageIds.length - 1}>
            <Text style={[styles.pagerArrow, pageIndex >= a.pageIds.length - 1 && styles.disabled]}>›</Text>
          </Pressable>
          <Pressable onPress={addPage} hitSlop={8}>
            <Text style={styles.pagerArrow}>＋</Text>
          </Pressable>
        </View>
        <Button small kind="ghost" title="↶" onPress={() => canvasRef.current?.undo()} />
        <Button small kind="ghost" title="↷" onPress={() => canvasRef.current?.redo()} />
        <HelpLevelPicker value={tutorContext(a).helpLevel} max={a.policyMaxLevel} onChange={setLevel} />
        <Button small title={showMarks ? 'Hide marks' : 'Show marks'} onPress={() => setShowMarks((v) => !v)} />
        <Button small title={panelOpen ? 'Close tutor' : 'Tutor'} onPress={() => setPanelOpen((v) => !v)} />
        <Button small kind="primary" title={checking ? 'Checking…' : 'Check'} loading={checking} onPress={runCheck} />
      </View>

      <View style={styles.page} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <PencilCanvas
          ref={canvasRef}
          style={StyleSheet.absoluteFill}
          paper={settings.paper}
          allowFingerDrawing={settings.allowFingerDrawing}
          showToolPicker
          onDrawingChanged={onDrawingChanged}
        />
        {check && showMarks && size.w > 0 && (
          <MarksOverlay
            width={size.w}
            height={size.h}
            lines={check.lines}
            verdicts={check.result.lines}
            stale={stale}
            onAsk={askAbout}
            feedbackFor={(lineId) => feedbackFor(evals, checkId, lineId)}
            onRate={rateMark}
            onInputBlur={() => canvasRef.current?.focus()}
          />
        )}
        {stale && showMarks && (
          <View pointerEvents="none" style={styles.staleTag}>
            <Text style={styles.staleText}>Page changed · Check again</Text>
          </View>
        )}
        {panelOpen && (
          <View style={[styles.drawer, { width: drawerWidth }]}>
            <SidePanel
              assignment={a}
              check={check}
              stale={stale}
              tab={tab}
              onTab={setTab}
              draft={draft}
              onDraft={setDraft}
              onSend={send}
              sending={sending}
              onReparse={reparse}
              reparsing={reparsing}
              onClose={() => setPanelOpen(false)}
              onInputBlur={() => canvasRef.current?.focus()}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 6,
    backgroundColor: C.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: C.ink },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  pagerArrow: { fontSize: 22, color: C.primary, fontWeight: '600' },
  pagerText: { fontSize: 14, color: C.sub, fontVariant: ['tabular-nums'] },
  disabled: { color: C.faint },
  page: { flex: 1, overflow: 'hidden' },
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
  staleTag: { position: 'absolute', top: 8, left: 8, backgroundColor: C.partialSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  staleText: { color: C.partial, fontWeight: '700', fontSize: 12 },
});
