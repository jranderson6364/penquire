/** A stroke's bounding box in PAGE space (independent of zoom and window size on apiVersion >= 2). */
export type StrokeBox = {
  /** index in the PKDrawing stroke list */
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** creation time, ms since epoch */
  t: number;
  /** number of points */
  n: number;
};

export type LineBoxInput = { id: string; x: number; y: number; w: number; h: number };

export type ExportedImage = {
  base64: string; // PNG
  width: number; // pixels
  height: number; // pixels
  gutter: number; // points of label gutter added on the left
  scale: number; // pixels per point
};

export type PaperStyle = 'grid' | 'lined' | 'blank';

/** Reported by the native canvas: screen = page * scale + (tx, ty). */
export type ViewportEvent = {
  scale: number;
  tx: number;
  ty: number;
  viewWidth: number;
  viewHeight: number;
  interacting: boolean;
};

/** Generic tool description; the toolbar UI is JS. See src/tools.ts. */
export type NativeToolSpec =
  | { kind: 'ink'; ink: 'pen' | 'fountain' | 'pencil' | 'marker' | 'monoline' | 'watercolor' | 'crayon'; color: string; width: number }
  | { kind: 'eraser'; eraser: 'vector' | 'bitmap' | 'fixed'; eraserWidth?: number }
  | { kind: 'lasso' };

export type PencilCanvasProps = {
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  allowFingerDrawing?: boolean;
  /** Apple's own tool palette. Leave off when the app draws its own toolbar (apiVersion >= 2). */
  showToolPicker?: boolean;
  paper?: PaperStyle;
  /** Fixed logical page, in page points (apiVersion >= 2). */
  pageWidth?: number;
  pageHeight?: number;
  onDrawingChanged?: (e: { strokeCount: number }) => void;
  onViewportChanged?: (e: ViewportEvent) => void;
  onPencilDoubleTap?: () => void;
};

export type PencilCanvasHandle = {
  getStrokes(): Promise<StrokeBox[]>;
  getDrawing(): Promise<string>;
  setDrawing(base64: string): Promise<boolean>;
  clear(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  focus(): Promise<void>;
  exportImage(lines: LineBoxInput[], maxDimension?: number): Promise<ExportedImage | null>;
  /** No-ops on a binary older than apiVersion 2. */
  setTool(spec: NativeToolSpec): Promise<boolean>;
  setRulerActive(active: boolean): Promise<void>;
  fitToWidth(): Promise<void>;
  getViewport(): Promise<ViewportEvent | null>;
};
