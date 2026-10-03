import { requireNativeView, requireOptionalNativeModule } from 'expo';
import * as React from 'react';
import type { NativeSyntheticEvent } from 'react-native';

import type { NativeToolSpec, PencilCanvasHandle, PencilCanvasProps, ViewportEvent } from './types';

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
