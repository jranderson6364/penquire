/**
 * Pen/eraser/lasso state and the generic spec sent to the native canvas. The toolbar UI is JS, so tool
 * presets, colors and widths can change without a native build. Pure and tested.
 */
export type ToolKind = 'pen' | 'fountain' | 'pencil' | 'marker' | 'eraser' | 'lasso';
export type EraserMode = 'stroke' | 'pixel';

export type ToolState = {
  tool: ToolKind;
  /** per-tool colors, so switching from the highlighter back to the pen restores the pen's color */
  colors: Record<'pen' | 'fountain' | 'pencil' | 'marker', string>;
  /** per-tool width index into WIDTHS */
  widthIdx: Record<'pen' | 'fountain' | 'pencil' | 'marker', number>;
  eraserMode: EraserMode;
  eraserSizeIdx: number;
  ruler: boolean;
};

export const COLORS = ['#111111', '#1D4ED8', '#DC2626', '#16A34A', '#9333EA', '#F59E0B', '#0891B2', '#6B7280'];
export const HIGHLIGHT_COLORS = ['#FDE047', '#86EFAC', '#93C5FD', '#F9A8D4', '#FDBA74'];
export const ERASER_SIZES = [10, 20, 36];

/** Width presets per tool, in page points. Thin / medium / thick. */
export const WIDTHS: Record<'pen' | 'fountain' | 'pencil' | 'marker', number[]> = {
  pen: [2, 3.5, 6],
  fountain: [2.5, 4, 7],
  pencil: [2.5, 4, 7],
  marker: [14, 22, 34],
};

export const DEFAULT_TOOL_STATE: ToolState = {
  tool: 'pen',
  colors: { pen: '#111111', fountain: '#1D4ED8', pencil: '#374151', marker: '#FDE047' },
  widthIdx: { pen: 1, fountain: 1, pencil: 1, marker: 1 },
  eraserMode: 'stroke',
  eraserSizeIdx: 1,
  ruler: false,
};

export const isInk = (t: ToolKind): t is 'pen' | 'fountain' | 'pencil' | 'marker' => t !== 'eraser' && t !== 'lasso';

export type NativeToolSpec =
  | { kind: 'ink'; ink: 'pen' | 'fountain' | 'pencil' | 'marker'; color: string; width: number }
  | { kind: 'eraser'; eraser: 'vector' | 'fixed'; eraserWidth?: number }
  | { kind: 'lasso' };

/** Inks only exist from iOS 17 for 'fountain'; the native side falls back to the pen on older systems. */
export function toNativeSpec(s: ToolState): NativeToolSpec {
  if (s.tool === 'eraser') {
    return s.eraserMode === 'stroke'
      ? { kind: 'eraser', eraser: 'vector' }
      : { kind: 'eraser', eraser: 'fixed', eraserWidth: ERASER_SIZES[clampIdx(s.eraserSizeIdx, ERASER_SIZES.length)] };
  }
  if (s.tool === 'lasso') return { kind: 'lasso' };
  const t = s.tool;
  return { kind: 'ink', ink: t, color: s.colors[t], width: WIDTHS[t][clampIdx(s.widthIdx[t], WIDTHS[t].length)] };
}

const clampIdx = (i: number, len: number) => Math.max(0, Math.min(len - 1, Math.round(Number.isFinite(i) ? i : 0)));

export function selectTool(s: ToolState, tool: ToolKind): ToolState {
  return { ...s, tool };
}

export function setColor(s: ToolState, color: string): ToolState {
  return isInk(s.tool) ? { ...s, colors: { ...s.colors, [s.tool]: color } } : s;
}

export function setWidth(s: ToolState, idx: number): ToolState {
  return isInk(s.tool) ? { ...s, widthIdx: { ...s.widthIdx, [s.tool]: clampIdx(idx, WIDTHS[s.tool].length) } } : s;
}

/** Apple Pencil double-tap: flip between the eraser and whatever was in use; the previous tool is remembered by the caller. */
export function toggleEraser(s: ToolState, previous: ToolKind): { state: ToolState; previous: ToolKind } {
  if (s.tool === 'eraser') return { state: { ...s, tool: previous === 'eraser' ? 'pen' : previous }, previous };
  return { state: { ...s, tool: 'eraser' }, previous: s.tool };
}

/** Tolerate a persisted state from an older app version (missing keys, bad indexes). */
export function normalizeToolState(raw: unknown): ToolState {
  if (!raw || typeof raw !== 'object') return DEFAULT_TOOL_STATE;
  const r = raw as Partial<ToolState>;
  const tools: ToolKind[] = ['pen', 'fountain', 'pencil', 'marker', 'eraser', 'lasso'];
  return {
    tool: tools.includes(r.tool as ToolKind) ? (r.tool as ToolKind) : DEFAULT_TOOL_STATE.tool,
    colors: { ...DEFAULT_TOOL_STATE.colors, ...(typeof r.colors === 'object' && r.colors ? r.colors : {}) },
    widthIdx: { ...DEFAULT_TOOL_STATE.widthIdx, ...(typeof r.widthIdx === 'object' && r.widthIdx ? r.widthIdx : {}) },
    eraserMode: r.eraserMode === 'pixel' ? 'pixel' : 'stroke',
    eraserSizeIdx: clampIdx(r.eraserSizeIdx ?? DEFAULT_TOOL_STATE.eraserSizeIdx, ERASER_SIZES.length),
    ruler: r.ruler === true,
  };
}
