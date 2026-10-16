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

/** apiVersion >= 3: the ink of one stroke, visible runs only (pixel-erased parts dropped). */
export type StrokePoints = {
  /** index in the PKDrawing stroke list (same as StrokeBox.i) */
  i: number;
  /** creation time, ms since epoch */
  t: number;
  /** visible runs; each point is [x, y, ms since the stroke began, force] in page space */
  pts: [number, number, number, number][][];
};

export type ExportPageOptions = {
  lines?: LineBoxInput[];
  maxDimension?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  /** cut the blank page below the lowest ink; the origin stays put, so line boxes keep their coordinates */
  cropBottom?: boolean;
};

export type ExportedPage = ExportedImage & { mediaType: 'image/png' | 'image/jpeg'; pageHeight: number };

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
  /** apiVersion >= 4, Apple Pencil Pro: squeeze began / ended (push-to-talk) */
  onPencilSqueeze?: (phase: 'began' | 'ended' | 'cancelled') => void;
  /** apiVersion >= 5: palm protection, one finger or palm never pans (pan is also paused while the Pencil draws) */
  twoFingerScroll?: boolean;
  /** apiVersion >= 6: children are the overlay layer, laid out at page * overlayScale; native moves them with the ink */
  overlayScale?: number;
  children?: import('react').ReactNode;
  /** apiVersion >= 4: the desk behind the page, "#RRGGBB" */
  surroundColor?: string;
};

/** apiVersion >= 4: input for exportPDF (page space; blocks typeset as Unicode text). */
export type PdfRequest = {
  title: string;
  pageWidth: number;
  pageHeight: number;
  pages: { drawing: string; blocks?: { x: number; y: number; w: number; heading?: string; lines: string[]; fontSize?: number }[] }[];
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
  /** null on a binary older than apiVersion 3 */
  getStrokePoints(): Promise<StrokePoints[] | null>;
  /** null on a binary older than apiVersion 3 (callers fall back to exportImage) */
  exportPage(options: ExportPageOptions): Promise<ExportedPage | null>;
  /** apiVersion >= 5: bring a page rect into view (no-op if visible or on older binaries) */
  scrollToPageRect(r: { x: number; y: number; w: number; h: number }): Promise<void>;
};
