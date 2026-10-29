import ExpoModulesCore
import PencilKit
import UIKit
import UIKit.UIGestureRecognizerSubclass

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

// MARK: - Palm watcher (apiVersion >= 7)

/// Watches every touch on the canvas and never recognizes, so it blocks nothing (drawing, scrolling and zooming keep
/// their own recognizers). The canvas uses what it sees to decide whether fingers may pan: a two-touch minimum is not
/// enough, because a resting palm usually lands as several touches.
final class PalmWatcher: UIGestureRecognizer, UIGestureRecognizerDelegate {
  /// a touch began, moved or ended; the canvas re-evaluates whether pan and pinch are allowed
  var onChange: (@MainActor () -> Void)?
  /// decides, when a finger touch lands, whether it must never pan (e.g. it arrived while the Pencil was writing)
  var isSuspectOnLanding: (@MainActor () -> Bool)?
  /// a contact at least this wide (points, majorRadius) is a palm, not a fingertip. 0 = never by size.
  var palmRadius: CGFloat = 32

  /// direct (finger/palm) touches currently down that must not pan the page
  private(set) var suspect = Set<ObjectIdentifier>()
  private var down = Set<ObjectIdentifier>()
  private var pencils = Set<ObjectIdentifier>()
  /// the Pencil is touching the glass (known at touch-down, before PencilKit reports that a stroke began)
  var pencilTouching: Bool { !pencils.isEmpty }
  private(set) var pencilLiftedAt: CFTimeInterval = 0

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  var hasSuspect: Bool { !suspect.isEmpty }

  private func isPalm(_ t: UITouch) -> Bool {
    palmRadius > 0 && t.majorRadius - t.majorRadiusTolerance >= palmRadius
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    for t in touches where t.type == .pencil {
      pencils.insert(ObjectIdentifier(t))
      down.insert(ObjectIdentifier(t))
    }
    let landingSuspect = isSuspectOnLanding?() ?? false
    for t in touches where t.type == .direct {
      let id = ObjectIdentifier(t)
      down.insert(id)
      if landingSuspect || isPalm(t) { suspect.insert(id) }
    }
    onChange?()
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    // A palm often lands as a small contact and spreads: check the size on every move, not just on landing.
    var changed = false
    for t in touches where t.type == .direct && isPalm(t) {
      if suspect.insert(ObjectIdentifier(t)).inserted { changed = true }
    }
    if changed { onChange?() }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    lift(touches)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    lift(touches)
  }

  private func lift(_ touches: Set<UITouch>) {
    for t in touches {
      let id = ObjectIdentifier(t)
      down.remove(id)
      suspect.remove(id)
      if pencils.remove(id) != nil { pencilLiftedAt = CACurrentMediaTime() }
    }
    // Only fail once nothing is down: a failed recognizer gets no more touches for the rest of the sequence.
    if down.isEmpty && state == .possible { state = .failed }
    onChange?()
  }

  override func reset() {
    super.reset()
    if !pencils.isEmpty { pencilLiftedAt = CACurrentMediaTime() }
    down.removeAll()
    suspect.removeAll()
    pencils.removeAll()
    onChange?()
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}

// MARK: - Canvas view

/// Hosts the React overlay layer (question blocks, tutor marks, verdict marks) above the ink. It takes no touches
/// itself: only the overlay's own touchable views (handles, marks) do; everything else falls through to the canvas.
final class OverlayHostView: UIView {
  // The layer is page-sized and can extend past this view's own bounds (zoomed, or low on the page), so never let
  // the bounds decide: ask the children directly, and take nothing ourselves.
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { true }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard isUserInteractionEnabled, !isHidden, alpha > 0.01 else { return nil }
    for sub in subviews.reversed() {
      if let hit = sub.hitTest(sub.convert(point, from: self), with: event) { return hit }
    }
    return nil
  }
}

final class PencilCanvasView: ExpoView, PKCanvasViewDelegate, UIPencilInteractionDelegate {
  let canvas = PKCanvasView()
  let paper = PaperView(frame: .zero)
  let onDrawingChanged = EventDispatcher()
  let onViewportChanged = EventDispatcher()
  let onPencilDoubleTap = EventDispatcher()
  /// Apple Pencil Pro squeeze (iPadOS 17.5+): { phase: "began" | "ended" | "cancelled" }. JS uses it as push-to-talk.
  let onPencilSqueeze = EventDispatcher()

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
  private var resumeGestures: Task<Void, Never>?
  /// Palm protection (apiVersion >= 7): see updateGestureGate.
  private let palmWatcher = PalmWatcher(target: nil, action: nil)
  private var pencilDown = false
  private var pencilLiftedAt: CFTimeInterval = 0
  /// after the Pencil lifts, how long fingers stay unable to pan (the hand is usually still resting). Seconds.
  private var penPause: CFTimeInterval = 0.35
  /// React children (the overlay layer) are mounted here, and moved with the page natively in the same frame as the ink.
  private let overlayHost = OverlayHostView()
  /// The zoom the overlay was laid out at (JS lays it out in page * overlayScale units; native scales by zoom / overlayScale).
  private var overlayScale: CGFloat = 1
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

    palmWatcher.onChange = { [weak self] in self?.updateGestureGate() }
    palmWatcher.isSuspectOnLanding = { [weak self] in self?.withinPenWindow() ?? false }
    canvas.addGestureRecognizer(palmWatcher)
  }

  // MARK: Overlay layer (apiVersion >= 6)

  /// React children of this view are the overlay layer: keep them in our own host above the canvas, not under it.
  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    overlayHost.insertSubview(childComponentView, at: min(index, overlayHost.subviews.count))
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  func setOverlayScale(_ k: Double) {
    overlayScale = CGFloat(max(0.01, k))
    updateOverlayTransform()
  }

  /// screen = (-contentOffset) + (zoom / overlayScale) * layer. Same frame as the ink: called from the scroll delegate.
  private func updateOverlayTransform() {
    let r = canvas.zoomScale / overlayScale
    let t = CGAffineTransform(a: r, b: 0, c: 0, d: r, tx: -canvas.contentOffset.x, ty: -canvas.contentOffset.y)
    if overlayHost.transform != t {
      CATransaction.begin()
      CATransaction.setDisableActions(true) // no implicit animation: it must sit exactly on the ink
      overlayHost.transform = t
      CATransaction.commit()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    // the host's origin is the page's top-left; its transform does the rest (anchor at the top-left corner)
    if overlayHost.superview == nil {
      overlayHost.layer.anchorPoint = .zero
      addSubview(overlayHost)
    }
    bringSubviewToFront(overlayHost)
    overlayHost.bounds = CGRect(origin: .zero, size: bounds.size)
    overlayHost.layer.position = .zero
    updateOverlayTransform()
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
    updateOverlayTransform()
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
    // the overlay follows the ink in this same frame, even mid-adjustment (no trip through JS)
    updateOverlayTransform()
    guard !isAdjusting else { return }
    updateInsets()
    updatePaper()
    updateOverlayTransform()
    // Every frame (up to 120 Hz): JS only moves one overlay layer per event (PageLayer), so it can keep up, and the
    // overlays no longer trail the ink at 30 Hz.
    if CACurrentMediaTime() - lastViewportSend >= 0.008 { sendViewport() }
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
    // Changing tools must never move the page: remember where the student is and put it back if anything nudged it.
    let keepOffset = canvas.contentOffset
    let keepZoom = canvas.zoomScale
    defer {
      if canvas.zoomScale == keepZoom && canvas.contentOffset != keepOffset {
        canvas.setContentOffset(keepOffset, animated: false)
      }
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
    // Palm protection: while the Pencil is on the glass, a resting hand must not pan or zoom the page.
    pencilDown = true
    updateGestureGate()
  }

  func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
    // Give the hand a moment to lift before fingers scroll again.
    pencilDown = false
    pencilLiftedAt = CACurrentMediaTime()
    updateGestureGate()
  }

  private func withinPenWindow() -> Bool {
    let lifted = max(pencilLiftedAt, palmWatcher.pencilLiftedAt)
    return pencilDown || palmWatcher.pencilTouching || CACurrentMediaTime() - lifted < penPause
  }

  /// One rule for whether fingers may pan and pinch: not while the Pencil writes or just after it lifts, and not while
  /// any palm-sized touch, or any touch that landed during writing, is still down. Disabling a recognizer cancels a
  /// pan already in progress, so a palm that spreads mid-gesture stops the page.
  private func updateGestureGate() {
    let blocked = withinPenWindow() || palmWatcher.hasSuspect
    if canvas.panGestureRecognizer.isEnabled == blocked { canvas.panGestureRecognizer.isEnabled = !blocked }
    if let pinch = canvas.pinchGestureRecognizer, pinch.isEnabled == blocked { pinch.isEnabled = !blocked }
    resumeGestures?.cancel()
    resumeGestures = nil
    if blocked && !pencilDown && !palmWatcher.pencilTouching && !palmWatcher.hasSuspect {
      // only the post-lift window is holding the gate: look again when it runs out
      let lifted = max(pencilLiftedAt, palmWatcher.pencilLiftedAt)
      let wait = max(0, penPause - (CACurrentMediaTime() - lifted))
      resumeGestures = Task { @MainActor [weak self] in
        try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000) + 5_000_000)
        guard let self = self, !Task.isCancelled else { return }
        self.updateGestureGate()
      }
    }
  }

  /// apiVersion >= 7: contacts at least this wide (points) count as a palm and stop panning. 0 turns size checks off.
  func setPalmRejectRadius(_ r: Double) {
    palmWatcher.palmRadius = CGFloat(max(0, r))
  }

  /// apiVersion >= 7: how long after the Pencil lifts fingers still cannot pan (ms, clamped to 0...2000).
  func setPenPauseMs(_ ms: Double) {
    penPause = min(2, max(0, ms / 1000))
    updateGestureGate()
  }

  /// Palm protection: with two-finger scrolling, one resting palm or finger never pans the page (pinch is two fingers
  /// anyway). Off = one finger scrolls, like before.
  func setTwoFingerScroll(_ on: Bool) {
    canvas.panGestureRecognizer.minimumNumberOfTouches = on ? 2 : 1
  }

  /// Bring a page rect (page points) into view if it is not already, without changing the zoom. For "show me" from chat.
  func scrollToPageRect(x: Double, y: Double, w: Double, h: Double) {
    let z = canvas.zoomScale
    let r = CGRect(x: x * z, y: y * z, width: w * z, height: h * z).insetBy(dx: -40, dy: -80)
    let visible = CGRect(origin: canvas.contentOffset, size: canvas.bounds.size)
    if visible.contains(r) { return }
    canvas.scrollRectToVisible(r, animated: true)
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

  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    switch squeeze.phase {
    case .began: onPencilSqueeze(["phase": "began"])
    case .ended: onPencilSqueeze(["phase": "ended"])
    case .cancelled: onPencilSqueeze(["phase": "cancelled"])
    default: break
    }
  }

  /// The desk behind the page (follows the app's light/dark theme; the page itself stays white paper).
  func setSurroundColor(_ hex: String) {
    backgroundColor = parseColor(hex)
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
