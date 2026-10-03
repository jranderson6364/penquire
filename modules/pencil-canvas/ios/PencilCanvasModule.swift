import ExpoModulesCore

// JS <-> native bridge for the PencilKit canvas.
// Functions return JSON strings (Sendable, trivially bridged) and are parsed in JS.
//
// Rule: native exposes small, generic primitives. All toolbar/tool UI lives in JS, so changing it never needs a build.
// apiVersion lets JS feature-detect the installed binary (an old dev build has no such constant -> JS treats it as 1).
public class PencilCanvasModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PencilCanvas")

    Constant("apiVersion") {
      return 2
    }

    View(PencilCanvasView.self) {
      Events("onDrawingChanged", "onViewportChanged", "onPencilDoubleTap")

      Prop("allowFingerDrawing") { (view: PencilCanvasView, value: Bool) in
        view.setAllowFingerDrawing(value)
      }

      Prop("showToolPicker") { (view: PencilCanvasView, value: Bool) in
        view.setShowToolPicker(value)
      }

      Prop("paper") { (view: PencilCanvasView, value: String) in
        view.setPaper(value)
      }

      // The fixed logical page, in stroke-coordinate units ("page space").
      Prop("pageWidth") { (view: PencilCanvasView, value: Double) in
        view.setPageSize(width: value, height: nil)
      }

      Prop("pageHeight") { (view: PencilCanvasView, value: Double) in
        view.setPageSize(width: nil, height: value)
      }

      // [{ i, x, y, w, h, t, n }] in page space (independent of zoom and window size).
      AsyncFunction("getStrokes") { (view: PencilCanvasView) -> String in
        return MainActor.assumeIsolated { view.strokesJSON() }
      }

      // PKDrawing.dataRepresentation() as base64 (lossless; used for persistence).
      AsyncFunction("getDrawing") { (view: PencilCanvasView) -> String in
        return MainActor.assumeIsolated { view.drawingBase64() }
      }

      AsyncFunction("setDrawing") { (view: PencilCanvasView, base64: String) -> Bool in
        return try MainActor.assumeIsolated { try view.setDrawingBase64(base64) }
      }

      AsyncFunction("clear") { (view: PencilCanvasView) in
        MainActor.assumeIsolated { view.clearDrawing() }
      }

      AsyncFunction("undo") { (view: PencilCanvasView) in
        MainActor.assumeIsolated { view.undo() }
      }

      AsyncFunction("redo") { (view: PencilCanvasView) in
        MainActor.assumeIsolated { view.redo() }
      }

      AsyncFunction("focus") { (view: PencilCanvasView) in
        MainActor.assumeIsolated { view.focusCanvas() }
      }

      // spec: { kind: "ink"|"eraser"|"lasso", ink?, color?, width?, eraser?: "vector"|"bitmap"|"fixed", eraserWidth? }
      AsyncFunction("setTool") { (view: PencilCanvasView, specJSON: String) -> Bool in
        return MainActor.assumeIsolated { view.setToolJSON(specJSON) }
      }

      AsyncFunction("setRulerActive") { (view: PencilCanvasView, active: Bool) in
        MainActor.assumeIsolated { view.setRulerActive(active) }
      }

      // Back to fit-to-width (and from then on follows window size changes again).
      AsyncFunction("fitToWidth") { (view: PencilCanvasView) in
        MainActor.assumeIsolated { view.fitToWidth() }
      }

      // { scale, tx, ty, viewWidth, viewHeight, interacting }: screen = page * scale + (tx, ty)
      AsyncFunction("getViewport") { (view: PencilCanvasView) -> String in
        return MainActor.assumeIsolated { view.viewportJSON() }
      }

      // linesJSON: [{ id, x, y, w, h }] in page space. Returns { base64, width, height, gutter, scale }.
      AsyncFunction("exportImage") { (view: PencilCanvasView, linesJSON: String, maxDimension: Double) -> String in
        return MainActor.assumeIsolated { view.exportImageJSON(linesJSON: linesJSON, maxDimension: maxDimension) }
      }
    }
  }
}
