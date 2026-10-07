import { requireNativeView, requireOptionalNativeModule } from 'expo';
import * as React from 'react';
import type { NativeSyntheticEvent } from 'react-native';

import type { ExportedPage, NativeToolSpec, PencilCanvasHandle, PencilCanvasProps, StrokePoints, ViewportEvent } from './types';

type NativeMethods = {
  getStrokes(): Promise<string>;
  getDrawing(): Promise<string>;
  setDrawing(base64: string): Promise<boolean>;
  clear(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  focus(): Promise<void>;
  exportImage(linesJSON: string, maxDimension: number): Promise<string>;
  // apiVersion >= 2
  setTool?(specJSON: string): Promise<boolean>;
  setRulerActive?(active: boolean): Promise<void>;
  fitToWidth?(): Promise<void>;
  getViewport?(): Promise<string>;
  // apiVersion >= 3
  getStrokePoints?(): Promise<string>;
  exportPage?(optionsJSON: string): Promise<string>;
};

type NativeProps = Omit<PencilCanvasProps, 'onDrawingChanged' | 'onViewportChanged' | 'onPencilDoubleTap'> & {
  ref?: React.Ref<NativeMethods>;
  onDrawingChanged?: (e: NativeSyntheticEvent<{ strokeCount: number }>) => void;
  onViewportChanged?: (e: NativeSyntheticEvent<ViewportEvent>) => void;
  onPencilDoubleTap?: (e: NativeSyntheticEvent<object>) => void;
};

const nativeModule = requireOptionalNativeModule<{ apiVersion?: number }>('PencilCanvas');

/**
 * False when the installed app binary was built without the Swift module (an old dev build, or the module was not
 * packaged). Screens must check this instead of rendering the canvas, which would fail with an unhelpful warning.
 */
export const nativeCanvasAvailable = nativeModule != null;

/**
 * Native capability level of the installed binary. 1 = original canvas (no zoom, no tool spec); 2 = fixed page,
 * zoom/pan, viewport events, setTool. JS must keep working on both: this is how a JS-only update stays safe.
 */
export const nativeApiVersion: number = typeof nativeModule?.apiVersion === 'number' ? nativeModule.apiVersion : nativeCanvasAvailable ? 1 : 0;

/** For diagnostics: what the installed binary actually exposes (names only). */
/** Function names the installed binary registers for its views (read defensively: the structure is Expo-internal). */
function viewFunctionNames(): string[] {
  try {
    const protos = (nativeModule as unknown as { ViewPrototypes?: Record<string, unknown> } | null)?.ViewPrototypes;
    if (!protos || typeof protos !== 'object') return [];
    const names = new Set<string>();
    for (const proto of Object.values(protos)) {
      let o: object | null = proto && typeof proto === 'object' ? (proto as object) : null;
      for (let depth = 0; o && depth < 3; depth++, o = Object.getPrototypeOf(o)) {
        for (const n of Object.getOwnPropertyNames(o)) if (n !== 'constructor') names.add(n);
      }
    }
    return [...names].sort();
  } catch {
    return [];
  }
}

export const nativeModuleInfo = {
  available: nativeCanvasAvailable,
  apiVersion: nativeApiVersion,
  keys: nativeModule ? Object.keys(nativeModule as object).slice(0, 20) : [],
  viewFunctions: viewFunctionNames(),
};

/** True when the installed binary registers the new view functions, regardless of the version constant. */
export const nativeHasNewFunctions = nativeModuleInfo.viewFunctions.includes('getViewport') && nativeModuleInfo.viewFunctions.includes('setTool');

const NativeView: React.ComponentType<NativeProps> | null = nativeCanvasAvailable ? requireNativeView('PencilCanvas') : null;

function parse<T>(json: string, fallback: T): T {
  try {
    const v = JSON.parse(json);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function PencilCanvas({
  ref,
  onDrawingChanged,
  onViewportChanged,
  onPencilDoubleTap,
  ...props
}: PencilCanvasProps & { ref?: React.Ref<PencilCanvasHandle> }) {
  const nativeRef = React.useRef<NativeMethods>(null);

  React.useImperativeHandle(
    ref,
    (): PencilCanvasHandle => {
      const n = () => {
        if (!nativeRef.current) throw new Error('PencilCanvas is not mounted');
        return nativeRef.current;
      };
      return {
        getStrokes: async () => parse(await n().getStrokes(), []),
        getDrawing: () => n().getDrawing(),
        setDrawing: (b64) => n().setDrawing(b64),
        clear: () => n().clear(),
        undo: () => n().undo(),
        redo: () => n().redo(),
        focus: () => n().focus(),
        exportImage: async (lines, maxDimension = 2000) =>
          parse(await n().exportImage(JSON.stringify(lines), maxDimension), null),
        setTool: async (spec: NativeToolSpec) => (n().setTool ? n().setTool!(JSON.stringify(spec)) : false),
        setRulerActive: async (active) => {
          await n().setRulerActive?.(active);
        },
        fitToWidth: async () => {
          await n().fitToWidth?.();
        },
        getViewport: async () => (n().getViewport ? parse<ViewportEvent | null>(await n().getViewport!(), null) : null),
        getStrokePoints: async () => (n().getStrokePoints ? parse<StrokePoints[] | null>(await n().getStrokePoints!(), null) : null),
        exportPage: async (options) => (n().exportPage ? parse<ExportedPage | null>(await n().exportPage!(JSON.stringify(options)), null) : null),
      };
    },
    []
  );

  if (!NativeView) return null;
  return (
    <NativeView
      ref={nativeRef}
      {...props}
      onDrawingChanged={(e) => onDrawingChanged?.(e.nativeEvent)}
      onViewportChanged={(e) => onViewportChanged?.(e.nativeEvent)}
      onPencilDoubleTap={() => onPencilDoubleTap?.()}
    />
  );
}
