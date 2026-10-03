import ExpoModulesCore
import PencilKit
import UIKit

// MARK: - Paper background (grid / lined / blank). Not included in exported images.

final class PaperView: UIView {
  var style: String = "grid" {
    didSet { setNeedsDisplay() }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .white
    isOpaque = true
    contentMode = .redraw
    isUserInteractionEnabled = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func draw(_ rect: CGRect) {
    guard style != "blank", let ctx = UIGraphicsGetCurrentContext() else { return }
    let spacing: CGFloat = 32
    ctx.setStrokeColor(UIColor(red: 0.82, green: 0.87, blue: 0.95, alpha: 1).cgColor)
    ctx.setLineWidth(0.6)
    var y = spacing
    while y < bounds.height {
      ctx.move(to: CGPoint(x: 0, y: y))
      ctx.addLine(to: CGPoint(x: bounds.width, y: y))
      y += spacing
    }
    if style == "grid" {
      var x = spacing
      while x < bounds.width {
        ctx.move(to: CGPoint(x: x, y: 0))
        ctx.addLine(to: CGPoint(x: x, y: bounds.height))
        x += spacing
      }
    }
    ctx.strokePath()
  }
}

// MARK: - Codable helpers for JSON bridging

private struct LineBox: Decodable {
  let id: String
  let x: Double
  let y: Double
  let w: Double
  let h: Double
}

/// Thrown instead of silently showing a blank page: an autosave would overwrite the saved drawing.
final class InvalidDrawingException: Exception {
  override var reason: String {
    "The saved drawing could not be decoded; the canvas was left unchanged"
  }
}

private func jsonString(_ object: Any) -> String {
  guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object),
        let str = String(data: data, encoding: .utf8) else {
    return "null"
  }
  return str
}

// MARK: - Canvas view

final class PencilCanvasView: ExpoView, PKCanvasViewDelegate {
  let canvas = PKCanvasView()
  let paper = PaperView(frame: .zero)
  let onDrawingChanged = EventDispatcher()

  private var toolPicker: PKToolPicker?
  private var wantsToolPicker = true
  private var suppressChangeEvents = false
  private var pendingChange: Task<Void, Never>?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .white
    // Keep ink black-on-white regardless of system dark mode (also keeps exports consistent).
    overrideUserInterfaceStyle = .light

    addSubview(paper)

    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    canvas.drawingPolicy = .pencilOnly
    canvas.isScrollEnabled = false
    canvas.minimumZoomScale = 1
    canvas.maximumZoomScale = 1
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.alwaysBounceVertical = false
    canvas.tool = PKInkingTool(.pen, color: .black, width: 2.5)
    canvas.delegate = self
    addSubview(canvas)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    paper.frame = bounds
    canvas.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateToolPicker()
  }

  // MARK: Props

  func setAllowFingerDrawing(_ allow: Bool) {
    canvas.drawingPolicy = allow ? .anyInput : .pencilOnly
  }

  func setShowToolPicker(_ show: Bool) {
    wantsToolPicker = show
    updateToolPicker()
  }

  func setPaper(_ style: String) {
    paper.style = style
  }

  private func updateToolPicker() {
    guard window != nil else { return }
    if toolPicker == nil {
      let picker = PKToolPicker()
      picker.addObserver(canvas)
      toolPicker = picker
    }
    toolPicker?.setVisible(wantsToolPicker, forFirstResponder: canvas)
    if wantsToolPicker {
      Task { @MainActor [weak self] in
        _ = self?.canvas.becomeFirstResponder()
      }
    }
  }

  func focusCanvas() {
    updateToolPicker()
  }

  // MARK: PKCanvasViewDelegate

  func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
    // Re-show the tool picker if a text field elsewhere stole first responder.
    if wantsToolPicker && !canvas.isFirstResponder {
      _ = canvas.becomeFirstResponder()
    }
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    if suppressChangeEvents { return }
    // Debounce: report once the pen has been idle for a moment.
    pendingChange?.cancel()
    pendingChange = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 350_000_000)
      guard let self = self, !Task.isCancelled else { return }
      self.onDrawingChanged(["strokeCount": self.canvas.drawing.strokes.count])
    }
  }

  // MARK: Functions

  func strokesJSON() -> String {
    var out: [[String: Any]] = []
    for (index, stroke) in canvas.drawing.strokes.enumerated() {
      let b = stroke.renderBounds
      if b.isNull || b.isInfinite { continue }
      out.append([
        "i": index,
        "x": Double(b.minX),
        "y": Double(b.minY),
        "w": Double(b.width),
        "h": Double(b.height),
        "t": stroke.path.creationDate.timeIntervalSince1970 * 1000.0,
        "n": stroke.path.count,
      ])
    }
    return jsonString(out)
  }

  func drawingBase64() -> String {
    return canvas.drawing.dataRepresentation().base64EncodedString()
  }

  func setDrawingBase64(_ base64: String) throws -> Bool {
    // Drop any debounced change event from the previous drawing (e.g. when switching pages).
    pendingChange?.cancel()
    pendingChange = nil
    suppressChangeEvents = true
    defer { suppressChangeEvents = false }
    if base64.isEmpty {
      canvas.drawing = PKDrawing()
      canvas.undoManager?.removeAllActions()
      return true
    }
    guard let data = Data(base64Encoded: base64), let drawing = try? PKDrawing(data: data) else {
      throw InvalidDrawingException()
    }
    canvas.drawing = drawing
    canvas.undoManager?.removeAllActions()
    return true
  }

  func clearDrawing() {
    canvas.drawing = PKDrawing()
  }

  func undo() {
    canvas.undoManager?.undo()
  }

  func redo() {
    canvas.undoManager?.redo()
  }

  /// Renders the ink on white with a left gutter containing line labels (L1, L2, ...)
  /// and faint dashed boxes, so the model can refer to lines by ID.
  func exportImageJSON(linesJSON: String, maxDimension: Double) -> String {
    let size = canvas.bounds.size
    guard size.width > 1, size.height > 1 else { return "null" }

    var lines: [LineBox] = []
    if let data = linesJSON.data(using: .utf8),
       let decoded = try? JSONDecoder().decode([LineBox].self, from: data) {
      lines = decoded
    }

    let gutter: CGFloat = lines.isEmpty ? 0 : 56
    let outSize = CGSize(width: size.width + gutter, height: size.height)
    let maxDim = CGFloat(maxDimension > 0 ? maxDimension : 2000)
    let scale = min(2.0, maxDim / max(outSize.width, outSize.height))

    var ink = UIImage()
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
      ink = canvas.drawing.image(from: CGRect(origin: .zero, size: size), scale: scale)
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = scale
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: outSize, format: format)

    let image = renderer.image { ctx in
      UIColor.white.setFill()
      ctx.fill(CGRect(origin: .zero, size: outSize))
      if gutter > 0 {
        UIColor(white: 0.95, alpha: 1).setFill()
        ctx.fill(CGRect(x: 0, y: 0, width: gutter, height: outSize.height))
      }
      ink.draw(in: CGRect(x: gutter, y: 0, width: size.width, height: size.height))

      let color = UIColor(red: 0.15, green: 0.40, blue: 0.95, alpha: 0.75)
      let attrs: [NSAttributedString.Key: Any] = [
        .font: UIFont.monospacedSystemFont(ofSize: 13, weight: .bold),
        .foregroundColor: color,
      ]
      let dashes: [CGFloat] = [4, 3]
      for line in lines {
        let rect = CGRect(
          x: gutter + CGFloat(line.x) - 3,
          y: CGFloat(line.y) - 3,
          width: CGFloat(line.w) + 6,
          height: CGFloat(line.h) + 6
        )
        let path = UIBezierPath(rect: rect)
        path.lineWidth = 0.8
        path.setLineDash(dashes, count: dashes.count, phase: 0)
        color.withAlphaComponent(0.45).setStroke()
        path.stroke()

        let label = line.id as NSString
        let labelSize = label.size(withAttributes: attrs)
        let origin = CGPoint(x: max(2, (gutter - labelSize.width) / 2), y: rect.midY - labelSize.height / 2)
        label.draw(at: origin, withAttributes: attrs)
      }
    }

    guard let png = image.pngData() else { return "null" }
    return jsonString([
      "base64": png.base64EncodedString(),
      "width": Double(outSize.width * scale),
      "height": Double(outSize.height * scale),
      "gutter": Double(gutter),
      "scale": Double(scale),
    ])
  }
}
