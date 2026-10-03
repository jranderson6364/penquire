/** A stroke's bounding box in canvas points (same space as the React Native view). */
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

export type PencilCanvasProps = {
  style?: import('react-native').StyleProp<import('react-native').ViewStyle>;
  allowFingerDrawing?: boolean;
  showToolPicker?: boolean;
  paper?: PaperStyle;
  onDrawingChanged?: (e: { strokeCount: number }) => void;
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
};
