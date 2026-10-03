import ExpoModulesCore

// JS <-> native bridge for the PencilKit canvas.
// Functions return JSON strings (Sendable, trivially bridged) and are parsed in JS.
public class PencilCanvasModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PencilCanvas")

    View(PencilCanvasView.self) {
      Events("onDrawingChanged")

      Prop("allowFingerDrawing") { (view: PencilCanvasView, value: Bool) in
        view.setAllowFingerDrawing(value)
      }

      Prop("showToolPicker") { (view: PencilCanvasView, value: Bool) in
        view.setShowToolPicker(value)
      }

      Prop("paper") { (view: PencilCanvasView, value: String) in
        view.setPaper(value)
      }

      // [{ i, x, y, w, h, t, n }] in canvas points (same coordinate space as the RN view).
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

      // linesJSON: [{ id, x, y, w, h }]. Returns { base64, width, height, gutter, scale }.
      AsyncFunction("exportImage") { (view: PencilCanvasView, linesJSON: String, maxDimension: Double) -> String in
        return MainActor.assumeIsolated { view.exportImageJSON(linesJSON: linesJSON, maxDimension: maxDimension) }
      }
    }
  }
}
