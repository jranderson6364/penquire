import { requireNativeView } from 'expo';
import * as React from 'react';
import type { NativeSyntheticEvent } from 'react-native';

import type { PencilCanvasHandle, PencilCanvasProps } from './types';

type NativeMethods = {
  getStrokes(): Promise<string>;
  getDrawing(): Promise<string>;
  setDrawing(base64: string): Promise<boolean>;
  clear(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  focus(): Promise<void>;
  exportImage(linesJSON: string, maxDimension: number): Promise<string>;
};

type NativeProps = Omit<PencilCanvasProps, 'onDrawingChanged'> & {
  ref?: React.Ref<NativeMethods>;
  onDrawingChanged?: (e: NativeSyntheticEvent<{ strokeCount: number }>) => void;
};

const NativeView: React.ComponentType<NativeProps> = requireNativeView('PencilCanvas');

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
      };
    },
    []
  );

  return (
    <NativeView
      ref={nativeRef}
      {...props}
      onDrawingChanged={(e) => onDrawingChanged?.(e.nativeEvent)}
    />
  );
}
