import ExpoModulesCore
import PencilKit
import UIKit

// MARK: - Paper background (grid / lined / blank), drawn in page space and clipped to what is visible.
//
// The page is a fixed logical size (pageSize). Only the visible part of it gets a view, so zooming in
// never allocates a giant backing store. Not included in exported images.

final class PaperView: UIView {
  var style: String = "grid" {
    didSet { setNeedsDisplay() }
  }
  /// screen points per page point
  var scale: CGFloat = 1
  /// where the page origin sits in this view's own coordinates (negative when the page is cut off)
  var pageOffset: CGPoint = .zero

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
    let step = 32 * scale
    guard step > 4 else { return } // too dense to be useful
    ctx.setStrokeColor(UIColor(red: 0.82, green: 0.87, blue: 0.95, alpha: 1).cgColor)
    ctx.setLineWidth(0.6)

    var y = pageOffset.y + ceil((rect.minY - pageOffset.y) / step) * step
    while y <= rect.maxY {
      if y > pageOffset.y + 0.5 {
        ctx.move(to: CGPoint(x: rect.minX, y: y))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: y))
      }
      y += step
    }
    if style == "grid" {
      var x = pageOffset.x + ceil((rect.minX - pageOffset.x) / step) * step
      while x <= rect.maxX {
        if x > pageOffset.x + 0.5 {
          ctx.move(to: CGPoint(x: x, y: rect.minY))
          ctx.addLine(to: CGPoint(x: x, y: rect.maxY))
        }
        x += step
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

private struct ToolSpec: Decodable {
  let kind: String // "ink" | "eraser" | "lasso"
  let ink: String? // pen | marker | pencil | monoline | fountain | watercolor | crayon
  let color: String? // "#RRGGBB" or "#RRGGBBAA"
  let width: Double?
  let eraser: String? // vector | bitmap | fixed
  let eraserWidth: Double?
}

/// Thrown instead of silently showing a blank page: an autosave would overwrite the saved drawing.
final class InvalidDrawingException: Exception, @unchecked Sendable {
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

private func parseColor(_ hex: String?) -> UIColor {
  guard var h = hex?.trimmingCharacters(in: .whitespaces), !h.isEmpty else { return .black }
  if h.hasPrefix("#") { h.removeFirst() }
  guard h.count == 6 || h.count == 8, let value = UInt64(h, radix: 16) else { return .black }
  let hasAlpha = h.count == 8
  let r = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
  let g = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
  let b = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
  let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
  return UIColor(red: r, green: g, blue: b, alpha: a)
}

private func inkType(_ name: String?) -> PKInk.InkType {
  switch name {
  case "marker": return .marker
  case "pencil": return .pencil
  default: break
  }
  if #available(iOS 17.0, *) {
    switch name {
    case "monoline": return .monoline
    case "fountain": return .fountainPen
    case "watercolor": return .watercolor
    case "crayon": return .crayon
    default: break
    }
  }
  return .pen
}

// MARK: - Canvas view

final class PencilCanvasView: ExpoView, PKCanvasViewDelegate, UIPencilInteractionDelegate {
  let canvas = PKCanvasView()
  let paper = PaperView(frame: .zero)
  let onDrawingChanged = EventDispatcher()
  let onViewportChanged = EventDispatcher()
  let onPencilDoubleTap = EventDispatcher()

  private var toolPicker: PKToolPicker?
  private var wantsToolPicker = false
  private var suppressChangeEvents = false
  private var pendingChange: Task<Void, Never>?

  /// Fixed logical page, in the same units as stroke coordinates (page space). Never changes with zoom or rotation.
  private var pageSize = CGSize(width: 816, height: 1056)
  private var userHasZoomed = false
  private var lastBoundsSize = CGSize.zero
  private var isAdjusting = false
  private var lastViewportSend: CFTimeInterval = 0
  private var settleTask: Task<Void, Never>?
  private var offsetObservation: NSKeyValueObservation?
  private var zoomObservation: NSKeyValueObservation?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(white: 0.90, alpha: 1) // the surround, like a desk behind the page
    // Keep ink black-on-white regardless of system dark mode (also keeps exports consistent).
    overrideUserInterfaceStyle = .light

    addSubview(paper)

    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    canvas.drawingPolicy = .pencilOnly
    canvas.isScrollEnabled = true
    canvas.bounces = true
    canvas.bouncesZoom = true
    canvas.showsVerticalScrollIndicator = true
    canvas.showsHorizontalScrollIndicator = true
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.alwaysBounceVertical = true
    canvas.alwaysBounceHorizontal = true
    canvas.contentSize = pageSize
    canvas.minimumZoomScale = 0.25
    canvas.maximumZoomScale = 8
    canvas.tool = PKInkingTool(.pen, color: .black, width: 3)
    canvas.delegate = self
    addSubview(canvas)

    // Redundant on purpose: the delegate may not forward every scroll callback of PKCanvasView.
    offsetObservation = canvas.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
      Task { @MainActor [weak self] in self?.viewportDidChange() }
    }
    zoomObservation = canvas.observe(\.zoomScale, options: [.new]) { [weak self] _, _ in
      Task { @MainActor [weak self] in self?.viewportDidChange() }
    }

    let pencil = UIPencilInteraction()
    pencil.delegate = self
    addInteraction(pencil)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    if bounds.size != lastBoundsSize, bounds.width > 1, bounds.height > 1 {
      lastBoundsSize = bounds.size
      refit(forceFit: false)
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateToolPicker()
  }

  // MARK: Page geometry

  /// Zoom limits and (unless the user zoomed by hand) fit-to-width. Runs when the view's size changes: rotation, Split View.
  private func refit(forceFit: Bool) {
    guard bounds.width > 1, bounds.height > 1, pageSize.width > 1 else { return }
    isAdjusting = true
    let fitW = bounds.width / pageSize.width
    let fitH = bounds.height / pageSize.height
    let minZoom = max(0.1, min(fitW, fitH) * 0.85)
    let maxZoom: CGFloat = 8
    canvas.minimumZoomScale = minZoom
    canvas.maximumZoomScale = maxZoom
    if forceFit || !userHasZoomed {
      userHasZoomed = false
      let target = min(max(fitW, minZoom), maxZoom)
      if !forceFit && abs(canvas.zoomScale - target) < 0.001 {
        // Same zoom, only the height changed (a banner or sidebar appeared): keep where the student is looking.
        updateInsets()
        clampOffset()
      } else {
        canvas.setZoomScale(target, animated: false)
        updateInsets()
        canvas.setContentOffset(CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top), animated: false)
      }
    } else {
      canvas.setZoomScale(min(max(canvas.zoomScale, minZoom), maxZoom), animated: false)
      updateInsets()
      clampOffset()
    }
    isAdjusting = false
    updatePaper()
    sendViewport()
  }

  /// Keep the scroll position inside the page after the view resized (it can end up out of range when the view grows).
  private func clampOffset() {
    let z = canvas.zoomScale
    let minX = -canvas.contentInset.left
    let minY = -canvas.contentInset.top
    let maxX = max(minX, pageSize.width * z + canvas.contentInset.right - bounds.width)
    let maxY = max(minY, pageSize.height * z + canvas.contentInset.bottom - bounds.height)
    let o = canvas.contentOffset
    let clamped = CGPoint(x: min(max(o.x, minX), maxX), y: min(max(o.y, minY), maxY))
    if clamped != o { canvas.setContentOffset(clamped, animated: false) }
  }

  /// When the page is smaller than the view (zoomed out, or a wide window), centre it.
  private func updateInsets() {
    let z = canvas.zoomScale
    let ix = max(0, (bounds.width - pageSize.width * z) / 2)
    let iy = max(0, (bounds.height - pageSize.height * z) / 2)
    let inset = UIEdgeInsets(top: iy, left: ix, bottom: iy, right: ix)
    if canvas.contentInset != inset { canvas.contentInset = inset }
  }

  private func updatePaper() {
    let z = canvas.zoomScale
    let pageRect = CGRect(x: -canvas.contentOffset.x, y: -canvas.contentOffset.y, width: pageSize.width * z, height: pageSize.height * z)
    let visible = pageRect.intersection(bounds)
    if visible.isNull || visible.isEmpty || visible.width < 1 || visible.height < 1 {
      paper.isHidden = true
      return
    }
    paper.isHidden = false
    paper.frame = visible
    paper.scale = z
    paper.pageOffset = CGPoint(x: pageRect.minX - visible.minX, y: pageRect.minY - visible.minY)
    paper.setNeedsDisplay()
  }

  private func viewportDidChange() {
    guard !isAdjusting else { return }
    updateInsets()
    updatePaper()
    if CACurrentMediaTime() - lastViewportSend >= 0.033 { sendViewport() }
    // Trailing event: always report the final, settled viewport (interacting = false).
    settleTask?.cancel()
    settleTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 160_000_000)
      guard let self = self, !Task.isCancelled else { return }
      self.sendViewport()
    }
  }

  private func viewportDict() -> [String: Any] {
    let interacting = canvas.isTracking || canvas.isDragging || canvas.isDecelerating || canvas.isZooming || canvas.isZoomBouncing
    return [
      "scale": Double(canvas.zoomScale),
      "tx": Double(-canvas.contentOffset.x),
      "ty": Double(-canvas.contentOffset.y),
      "viewWidth": Double(bounds.width),
      "viewHeight": Double(bounds.height),
      "interacting": interacting,
    ]
  }

  private func sendViewport() {
    lastViewportSend = CACurrentMediaTime()
    onViewportChanged(viewportDict())
  }

  // MARK: Props

  func setPageSize(width: Double?, height: Double?) {
    let w = CGFloat(width ?? Double(pageSize.width))
    let h = CGFloat(height ?? Double(pageSize.height))
    guard w > 1, h > 1, CGSize(width: w, height: h) != pageSize else { return }
    pageSize = CGSize(width: w, height: h)
    isAdjusting = true
    canvas.setZoomScale(1, animated: false) // contentSize is defined at zoom 1
    canvas.contentSize = pageSize
    isAdjusting = false
    userHasZoomed = false
    refit(forceFit: true)
  }

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
    if !wantsToolPicker {
      // The app draws its own toolbar. A picker observing the canvas would overwrite canvas.tool.
      toolPicker?.setVisible(false, forFirstResponder: canvas)
      if let picker = toolPicker {
        picker.removeObserver(canvas)
        toolPicker = nil
      }
      return
    }
    if toolPicker == nil {
      let picker = PKToolPicker()
      picker.addObserver(canvas)
      toolPicker = picker
    }
    toolPicker?.setVisible(true, forFirstResponder: canvas)
    Task { @MainActor [weak self] in
      _ = self?.canvas.becomeFirstResponder()
    }
  }

  func focusCanvas() {
    updateToolPicker()
  }

  // MARK: Tools (the toolbar UI lives in JS; native only applies a small generic spec)

  func setToolJSON(_ json: String) -> Bool {
    guard let data = json.data(using: .utf8), let spec = try? JSONDecoder().decode(ToolSpec.self, from: data) else {
      return false
    }
    switch spec.kind {
    case "eraser":
      switch spec.eraser {
      case "bitmap":
        canvas.tool = PKEraserTool(.bitmap)
      case "fixed":
        canvas.tool = PKEraserTool(.fixedWidthBitmap, width: CGFloat(spec.eraserWidth ?? 16))
      default:
        canvas.tool = PKEraserTool(.vector)
      }
    case "lasso":
      canvas.tool = PKLassoTool()
    default:
      let type = inkType(spec.ink)
      canvas.tool = PKInkingTool(type, color: parseColor(spec.color), width: CGFloat(spec.width ?? 3))
    }
    return true
  }

  func setRulerActive(_ active: Bool) {
    canvas.isRulerActive = active
  }

  func fitToWidth() {
    refit(forceFit: true)
  }

  func viewportJSON() -> String {
    return jsonString(viewportDict())
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

  func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
    userHasZoomed = true
  }

  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    viewportDidChange()
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    viewportDidChange()
  }

  // MARK: UIPencilInteractionDelegate (Apple Pencil double-tap; JS decides what it does)

  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    onPencilDoubleTap([:])
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

  /// The ink itself, for stroke-based reading and replayable eval cases (apiVersion >= 3).
  /// [{ i, t, pts: [[x, y, ms, force], ...][] }] in PAGE space: one point list per VISIBLE run of the stroke, so
  /// pixel-erased parts (masked, not removed, in PencilKit) are never sent. Fully erased strokes are skipped.
  /// Points are sampled on the curve every ~2 page points; ms is the time since the stroke began.
  func strokePointsJSON() -> String {
    var out: [[String: Any]] = []
    for (index, stroke) in canvas.drawing.strokes.enumerated() {
      let path = stroke.path
      guard path.count > 0 else { continue }
      let ranges: [ClosedRange<CGFloat>?]
      if stroke.mask == nil {
        ranges = [nil]
      } else {
        let visible = stroke.maskedPathRanges
        if visible.isEmpty { continue }
        ranges = visible.map { Optional($0) }
      }
      var runs: [[[Double]]] = []
      for range in ranges {
        var run: [[Double]] = []
        for p in path.interpolatedPoints(in: range, by: .distance(2)) {
          let loc = p.location.applying(stroke.transform)
          run.append([
            (Double(loc.x) * 10).rounded() / 10,
            (Double(loc.y) * 10).rounded() / 10,
            (p.timeOffset * 1000).rounded(),
            (Double(p.force) * 100).rounded() / 100,
          ])
        }
        if !run.isEmpty { runs.append(run) }
      }
      if runs.isEmpty { continue }
      out.append([
        "i": index,
        "t": path.creationDate.timeIntervalSince1970 * 1000.0,
        "pts": runs,
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

  /// Renders the PAGE (fixed logical size, independent of zoom and window) on white with a left gutter
  /// containing line labels (L1, L2, ...) and faint dashed boxes, so the model can refer to lines by ID.
  func exportImageJSON(linesJSON: String, maxDimension: Double) -> String {
    return exportPage(linesJSON: linesJSON, maxDimension: maxDimension, jpegQuality: nil, cropBottom: false)
  }

  /// exportImage with options (apiVersion >= 3):
  /// { lines?: [{id,x,y,w,h}], maxDimension?, format?: "png"|"jpeg", quality?: 0...1, cropBottom?: bool }.
  /// cropBottom cuts the blank page below the lowest ink (plus a margin); the origin stays at the page's top-left, so
  /// line boxes keep their page coordinates. Fewer image tokens per check. No lines = a clean page, no gutter.
  func exportPageJSON(optionsJSON: String) -> String {
    let opts = (optionsJSON.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    var linesJSON = "[]"
    if let lines = opts["lines"], JSONSerialization.isValidJSONObject(lines),
       let data = try? JSONSerialization.data(withJSONObject: lines), let s = String(data: data, encoding: .utf8) {
      linesJSON = s
    }
    let maxDim = (opts["maxDimension"] as? NSNumber)?.doubleValue ?? 2000
    let jpeg = (opts["format"] as? String) == "jpeg"
    let quality = (opts["quality"] as? NSNumber)?.doubleValue ?? 0.85
    let crop = (opts["cropBottom"] as? Bool) ?? false
    return exportPage(linesJSON: linesJSON, maxDimension: maxDim, jpegQuality: jpeg ? min(1, max(0.3, quality)) : nil, cropBottom: crop)
  }

  private func exportPage(linesJSON: String, maxDimension: Double, jpegQuality: Double?, cropBottom: Bool) -> String {
    var size = pageSize
    guard size.width > 1, size.height > 1 else { return "null" }

    var lines: [LineBox] = []
    if let data = linesJSON.data(using: .utf8),
       let decoded = try? JSONDecoder().decode([LineBox].self, from: data) {
      lines = decoded
    }

    if cropBottom {
      let ink = canvas.drawing.bounds
      var bottom = ink.isNull || ink.isEmpty ? 0 : ink.maxY
      for line in lines { bottom = max(bottom, CGFloat(line.y + line.h)) }
      // keep at least a quarter page so a nearly empty page still reads as a page
      size.height = min(pageSize.height, max(pageSize.height / 4, bottom + 48))
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

    let encoded: Data?
    if let q = jpegQuality {
      encoded = image.jpegData(compressionQuality: CGFloat(q))
    } else {
      encoded = image.pngData()
    }
    guard let bytes = encoded else { return "null" }
    return jsonString([
      "base64": bytes.base64EncodedString(),
      "mediaType": jpegQuality == nil ? "image/png" : "image/jpeg",
      "width": Double(outSize.width * scale),
      "height": Double(outSize.height * scale),
      "gutter": Double(gutter),
      "scale": Double(scale),
      "pageHeight": Double(size.height),
    ])
  }
}
