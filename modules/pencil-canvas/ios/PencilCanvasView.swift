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
  /// where the Pencil tip is, in window coordinates; nil when it lifts (apiVersion >= 8: the eraser ring)
  var onPencilPoint: (@MainActor (CGPoint?) -> Void)?

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
      onPencilPoint?(t.preciseLocation(in: nil))
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
    for t in touches where t.type == .pencil {
      onPencilPoint?(t.preciseLocation(in: nil))
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
      if pencils.remove(id) != nil {
        pencilLiftedAt = CACurrentMediaTime()
        onPencilPoint?(nil)
      }
    }
    // Only fail once nothing is down: a failed recognizer gets no more touches for the rest of the sequence.
    if down.isEmpty && state == .possible { state = .failed }
    onChange?()
  }

  override func reset() {
    super.reset()
    if !pencils.isEmpty {
      pencilLiftedAt = CACurrentMediaTime()
      onPencilPoint?(nil)
    }
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

// MARK: - Page-attached layers (apiVersion >= 10)

/// The paper grid drawn in PAGE coordinates by tiles, at whatever resolution the zoom needs. Lives inside PencilKit's
/// zoomed page, so UIKit moves and scales it exactly with the ink (no syncing). Drawn on background threads.
final class TiledPaperLayer: CATiledLayer {
  override class func fadeDuration() -> CFTimeInterval { 0 }
  private let lock = NSLock()
  private var styleValue = "grid"
  /// written on the main thread, read by the tile threads
  var paperStyle: String { // not `style`: CALayer already has `style: [AnyHashable: Any]?`
    get {
      lock.lock()
      defer { lock.unlock() }
      return styleValue
    }
    set {
      lock.lock()
      styleValue = newValue
      lock.unlock()
    }
  }

  override func draw(in ctx: CGContext) {
    let style = paperStyle
    guard style != "blank" else { return }
    let rect = ctx.boundingBoxOfClipPath
    let pixelsPerPoint = max(0.01, abs(ctx.ctm.a))
    let step: CGFloat = 32
    ctx.setStrokeColor(UIColor(red: 0.82, green: 0.87, blue: 0.95, alpha: 1).cgColor)
    ctx.setLineWidth(1.2 / pixelsPerPoint) // about 0.6 pt on a 2x screen at any zoom, like the old paper
    var y = max(step, ceil(rect.minY / step) * step)
    while y <= rect.maxY {
      ctx.move(to: CGPoint(x: rect.minX, y: y))
      ctx.addLine(to: CGPoint(x: rect.maxX, y: y))
      y += step
    }
    if style == "grid" {
      var x = max(step, ceil(rect.minX / step) * step)
      while x <= rect.maxX {
        ctx.move(to: CGPoint(x: x, y: rect.minY))
        ctx.addLine(to: CGPoint(x: x, y: rect.maxY))
        x += step
      }
    }
    ctx.strokePath()
  }
}

final class TiledPaperView: UIView {
  override class var layerClass: AnyClass { TiledPaperLayer.self }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .white
    isUserInteractionEnabled = false
    layer.zPosition = -1 // under PencilKit's own layers whatever order it inserts them in
    if let tiled = layer as? TiledPaperLayer {
      tiled.levelsOfDetail = 8
      tiled.levelsOfDetailBias = 4 // tile levels from 1/8x to 16x of page points
      tiled.tileSize = CGSize(width: 512, height: 512)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  var style: String = "grid" {
    didSet {
      (layer as? TiledPaperLayer)?.paperStyle = style
      layer.setNeedsDisplay()
    }
  }
}

/// While a Pencil touch is on an overlay control (a mark, a block handle), PencilKit must not draw: inside the zoomed
/// page the overlay is a descendant of the canvas, so its drawing gesture sees those touches too. Never recognizes.
final class OverlayPencilGuard: UIGestureRecognizer, UIGestureRecognizerDelegate {
  var onPencil: (@MainActor (Bool) -> Void)?
  /// a finger is on an overlay control (a block handle being dragged): the page must not pan under it
  var onFinger: (@MainActor (Bool) -> Void)?
  private var pencils = Set<ObjectIdentifier>()
  private var fingers = Set<ObjectIdentifier>()
  private var down = Set<ObjectIdentifier>()

  override init(target: Any?, action: Selector?) {
    super.init(target: target, action: action)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    let had = !pencils.isEmpty
    let hadFinger = !fingers.isEmpty
    for t in touches {
      down.insert(ObjectIdentifier(t))
      if t.type == .pencil { pencils.insert(ObjectIdentifier(t)) }
      if t.type == .direct { fingers.insert(ObjectIdentifier(t)) }
    }
    if !had && !pencils.isEmpty { onPencil?(true) }
    if !hadFinger && !fingers.isEmpty { onFinger?(true) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { lift(touches) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { lift(touches) }

  private func lift(_ touches: Set<UITouch>) {
    let had = !pencils.isEmpty
    let hadFinger = !fingers.isEmpty
    for t in touches {
      down.remove(ObjectIdentifier(t))
      pencils.remove(ObjectIdentifier(t))
      fingers.remove(ObjectIdentifier(t))
    }
    if had && pencils.isEmpty { onPencil?(false) }
    if hadFinger && fingers.isEmpty { onFinger?(false) }
    if down.isEmpty && state == .possible { state = .failed }
  }

  override func reset() {
    super.reset()
    let had = !pencils.isEmpty
    let hadFinger = !fingers.isEmpty
    pencils.removeAll()
    fingers.removeAll()
    down.removeAll()
    if had { onPencil?(false) }
    if hadFinger { onFinger?(false) }
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}

/// CADisplayLink retains its target: this holds the canvas weakly.
@MainActor
private final class DisplayLinkTarget: NSObject {
  weak var view: PencilCanvasView?
  init(_ view: PencilCanvasView) {
    self.view = view
  }

  @objc func tick() {
    view?.followTick()
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
  /// apiVersion >= 8: a dashed ring around the Pencil tip while the eraser is the tool (diameter in screen points; 0 = off)
  private let eraserRing = CAShapeLayer()
  private var eraserDiameter: CGFloat = 0
  /// React children (the overlay layer) are mounted here, and moved with the page natively in the same frame as the ink.
  private let overlayHost = OverlayHostView()
  /// The zoom the overlay was laid out at (JS lays it out in page * overlayScale units; native scales by zoom / overlayScale).
  private var overlayScale: CGFloat = 1
  private var offsetObservation: NSKeyValueObservation?
  private var zoomObservation: NSKeyValueObservation?
  /// apiVersion >= 10: the overlay and the paper inside PencilKit's zoomed page (JS turns these on; off = synced siblings)
  private var wantsOverlayInPage = false
  private var wantsPaperInPage = false
  private weak var hostPage: UIView?
  private var paperInPage = false
  private let pagePaper = TiledPaperView(frame: .zero)
  private let pencilGuard = OverlayPencilGuard(target: nil, action: nil)
  private var lastSharpenWant: CGFloat = 0
  /// the drawing gesture's own state before an overlay Pencil touch turned it off (restored after)
  private var drawingWasEnabled: Bool?
  private var overlayFingerDown = false

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
    // Synchronous on the main thread (apiVersion >= 8): a zoom bounce sets the zoom inside UIKit's animation block, and
    // the overlay must change inside that same block to animate with the ink instead of snapping.
    offsetObservation = canvas.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
      if Thread.isMainThread {
        _ = MainActor.assumeIsolated { self?.viewportDidChange() }
      } else {
        Task { @MainActor [weak self] in self?.viewportDidChange() }
      }
    }
    zoomObservation = canvas.observe(\.zoomScale, options: [.new]) { [weak self] _, _ in
      if Thread.isMainThread {
        _ = MainActor.assumeIsolated { self?.viewportDidChange() }
      } else {
        Task { @MainActor [weak self] in self?.viewportDidChange() }
      }
    }

    let pencil = UIPencilInteraction()
    pencil.delegate = self
    addInteraction(pencil)

    palmWatcher.onChange = { [weak self] in self?.updateGestureGate() }
    palmWatcher.isSuspectOnLanding = { [weak self] in self?.withinPenWindow() ?? false }
    // apiVersion >= 9: the ring follows PencilKit's own drawing gesture, which reports every move while erasing
    canvas.drawingGestureRecognizer.addTarget(self, action: #selector(drawingGestureChanged(_:)))
    pencilGuard.onPencil = { [weak self] on in self?.overlayPencil(on) }
    pencilGuard.onFinger = { [weak self] on in
      self?.overlayFingerDown = on
      self?.updateGestureGate()
    }
    overlayHost.addGestureRecognizer(pencilGuard)
    canvas.addGestureRecognizer(palmWatcher)

    eraserRing.fillColor = nil
    eraserRing.strokeColor = UIColor(white: 0.35, alpha: 0.9).cgColor
    eraserRing.lineWidth = 1
    eraserRing.lineDashPattern = [3, 3]
    eraserRing.isHidden = true
    eraserRing.zPosition = 1000 // above the ink and the overlay layer
    layer.addSublayer(eraserRing)
  }

  // MARK: Overlay layer (apiVersion >= 6)

  /// React children of this view are the overlay layer: keep them in our own host above the canvas, not under it.
  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    overlayHost.insertSubview(childComponentView, at: min(index, overlayHost.subviews.count))
    scheduleSharpen()
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  func setOverlayScale(_ k: Double) {
    overlayScale = CGFloat(max(0.01, k))
    placeLayers()
    updateOverlayTransform()
    lastSharpenWant = 0
    scheduleSharpen()
  }

  func setOverlayInPage(_ on: Bool) {
    wantsOverlayInPage = on
    placeLayers()
  }

  func setPaperInPage(_ on: Bool) {
    wantsPaperInPage = on
    placeLayers()
  }

  // MARK: Hosting inside the zoomed page (apiVersion >= 10)

  /// PencilKit's zoomed page: the subview UIKit scales by the zoom, page-sized in its own coordinates. nil if none fits.
  private func zoomedPageView() -> UIView? {
    let z = canvas.zoomScale
    return canvas.subviews.first { v in
      !v.isHidden && v !== pagePaper && abs(v.bounds.width - pageSize.width) < 1 && abs(v.bounds.height - pageSize.height) < 1
        && abs(v.transform.a - z) < 0.001 && abs(v.transform.d - z) < 0.001
    }
  }

  private var overlayInPage: Bool { hostPage != nil && overlayHost.superview === hostPage }

  private func overlayPencil(_ on: Bool) {
    if on {
      if drawingWasEnabled == nil { drawingWasEnabled = canvas.drawingGestureRecognizer.isEnabled }
      canvas.drawingGestureRecognizer.isEnabled = false
    } else {
      canvas.drawingGestureRecognizer.isEnabled = drawingWasEnabled ?? true
      drawingWasEnabled = nil
    }
  }

  /// Put the overlay (and the paper) inside the zoomed page when asked and possible, else beside the canvas, synced.
  private func placeLayers() {
    var page: UIView? = nil
    if wantsOverlayInPage || wantsPaperInPage {
      // keep the page found before while it is still PencilKit's page (re-matching each frame could flip-flop)
      if let p = hostPage, p.superview === canvas, !p.isHidden, abs(p.bounds.width - pageSize.width) < 1, abs(p.bounds.height - pageSize.height) < 1 {
        page = p
      } else {
        page = zoomedPageView()
      }
    }
    hostPage = page
    CATransaction.begin()
    CATransaction.setDisableActions(true) // a move inside UIKit's bounce animation block must not animate
    defer { CATransaction.commit() }
    // overlay: only into a page that takes touches, or its marks and handles could not be tapped
    if wantsOverlayInPage, let page = page, page.isUserInteractionEnabled {
      if overlayHost.superview !== page {
        overlayHost.removeFromSuperview()
        page.addSubview(overlayHost)
      }
      if page.subviews.last !== overlayHost { page.bringSubviewToFront(overlayHost) }
      overlayHost.layer.anchorPoint = .zero
      overlayHost.bounds = CGRect(origin: .zero, size: CGSize(width: pageSize.width * overlayScale, height: pageSize.height * overlayScale))
      overlayHost.layer.position = page.bounds.origin
      let t = CGAffineTransform(scaleX: 1 / overlayScale, y: 1 / overlayScale)
      if overlayHost.transform != t {
        overlayHost.layer.removeAllAnimations()
        overlayHost.transform = t
      }
    } else if overlayHost.superview !== self {
      overlayHost.removeFromSuperview()
      overlayHost.layer.anchorPoint = .zero
      addSubview(overlayHost)
    }
    // paper: only where PencilKit draws its ink in subviews, so the paper can go underneath them
    if wantsPaperInPage, let page = page, page.subviews.contains(where: { $0 !== pagePaper && $0 !== overlayHost }) {
      if pagePaper.superview !== page { page.insertSubview(pagePaper, at: 0) }
      if page.subviews.first !== pagePaper { page.sendSubviewToBack(pagePaper) }
      if pagePaper.frame != page.bounds { pagePaper.frame = page.bounds }
      paperInPage = true
      paper.isHidden = true
    } else {
      if pagePaper.superview != nil { pagePaper.removeFromSuperview() }
      let was = paperInPage
      paperInPage = false
      if was {
        paper.isHidden = false
        updatePaper()
      }
    }
  }

  /// What the canvas is made of on this device, for diagnosing the page hosting (logged once from JS).
  func debugJSON() -> String {
    let subs: [[String: Any]] = canvas.subviews.map { v in
      [
        "class": String(describing: type(of: v)),
        "frame": NSCoder.string(for: v.frame),
        "bounds": NSCoder.string(for: v.bounds),
        "scale": Double(v.transform.a),
        "subviews": v.subviews.count,
        "layerSublayers": v.layer.sublayers?.count ?? 0,
      ]
    }
    return jsonString([
      "overlayInPage": overlayInPage,
      "paperInPage": paperInPage,
      "wants": ["overlay": wantsOverlayInPage, "paper": wantsPaperInPage],
      "pageFound": zoomedPageView() != nil,
      "pageInteractive": zoomedPageView()?.isUserInteractionEnabled ?? false,
      "zoom": Double(canvas.zoomScale),
      "contentSize": NSCoder.string(for: canvas.contentSize),
      "pageSize": NSCoder.string(for: pageSize),
      "canvasSubviews": subs,
    ])
  }

  /// screen = origin + (scale / overlayScale) * layer, where (origin, scale) is where the ink is on screen right now.
  private func updateOverlayTransform() {
    if overlayInPage { return } // UIKit moves it with the page
    let ink = inkFrame()
    let r = ink.scale / overlayScale
    let t = CGAffineTransform(a: r, b: 0, c: 0, d: r, tx: ink.origin.x, ty: ink.origin.y)
    guard overlayHost.transform != t || isAnimating(overlayHost.layer) else { return }
    // apiVersion >= 9: set exactly, never animated. While UIKit animates the ink (a zoom bounce), inkFrame() reads the
    // ink's on-screen (presentation) frame and the display link below re-applies it every frame, so the overlay and the
    // paper stay stuck to the page through the whole animation instead of jumping to its end.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    overlayHost.layer.removeAllAnimations()
    overlayHost.transform = t
    CATransaction.commit()
  }

  // MARK: Follow the ink frame by frame (apiVersion >= 9)

  private weak var inkView: UIView?
  private var displayLink: CADisplayLink?
  private var followUntil: CFTimeInterval = 0
  private var followStarted: CFTimeInterval = 0

  private func isAnimating(_ layer: CALayer) -> Bool {
    !(layer.animationKeys() ?? []).isEmpty
  }

  /// PencilKit's zoomed content view: the subview exactly the size of the zoomed page.
  private func inkContentView() -> UIView? {
    let size = canvas.contentSize
    if let v = inkView, v.superview === canvas, abs(v.frame.width - size.width) < 1 { return v }
    inkView = canvas.subviews.first { abs($0.frame.width - size.width) < 1 && abs($0.frame.height - size.height) < 1 && !$0.isHidden }
    return inkView
  }

  /// Where the page is on screen (origin) and its screen points per page point (scale). The scroll view's own values,
  /// unless UIKit is animating the ink: then what is actually on screen, from the presentation layers.
  private func inkFrame() -> (origin: CGPoint, scale: CGFloat) {
    let model = (origin: CGPoint(x: -canvas.contentOffset.x, y: -canvas.contentOffset.y), scale: canvas.zoomScale)
    // Only with an animation attached: otherwise the presentation is one frame behind during a pinch.
    guard let v = inkContentView(), isAnimating(v.layer) || isAnimating(canvas.layer),
          let ink = v.layer.presentation(), let scroll = canvas.layer.presentation(), pageSize.width > 1, ink.frame.width > 1 else {
      return model
    }
    let mf = v.frame, pf = ink.frame, mb = canvas.bounds, pb = scroll.bounds
    let same = abs(pf.width - mf.width) < 0.01 && abs(pf.minX - mf.minX) < 0.01 && abs(pf.minY - mf.minY) < 0.01
      && abs(pb.minX - mb.minX) < 0.01 && abs(pb.minY - mb.minY) < 0.01
    if same { return model }
    followInk()
    // the model position, corrected by how far the animation has still to go (no jump when it switches back)
    return (
      origin: CGPoint(x: model.origin.x + (pf.minX - mf.minX) - (pb.minX - mb.minX), y: model.origin.y + (pf.minY - mf.minY) - (pb.minY - mb.minY)),
      scale: model.scale * pf.width / mf.width
    )
  }

  /// Keep following for a moment after the last change: an animation reports its end values once, at its start.
  private func followInk() {
    followUntil = CACurrentMediaTime() + 0.35
    guard displayLink == nil, window != nil else { return }
    followStarted = CACurrentMediaTime()
    let link = CADisplayLink(target: DisplayLinkTarget(self), selector: #selector(DisplayLinkTarget.tick))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  fileprivate func followTick() {
    updateOverlayTransform()
    updatePaper()
    let now = CACurrentMediaTime()
    // never more than 2 s: an animation left attached (not removed on completion) must not keep this running
    if now > followUntil || now - followStarted > 2 {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  // MARK: Sharp overlay at any zoom (apiVersion >= 8)

  private var sharpenTask: Task<Void, Never>?
  /// keep any one layer's backing store under this many pixels (about 24 MB; a full-page SVG at 8x zoom would be hundreds)
  private let maxLayerPixels: CGFloat = 6_000_000

  private func scheduleSharpen() {
    sharpenTask?.cancel()
    sharpenTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 50_000_000) // after Fabric has laid the new views out
      guard let self = self, !Task.isCancelled else { return }
      self.sharpenOverlay(force: true)
    }
  }

  /// Text and SVG in the overlay are drawn at their own layout size and then scaled with the page, so past
  /// overlayScale they blur. Once a zoom settles, redraw them at the scale they are shown at. No React work and no
  /// re-layout: only the backing stores change, so nothing moves.
  private func sharpenOverlay(force: Bool = false) {
    let screen = window?.screen.scale ?? 2
    let want = screen * max(1, canvas.zoomScale / overlayScale)
    // every redraw at a new scale is a visible pop: only when the zoom changed by more than a quarter (or on mount)
    if !force && lastSharpenWant > 0 && abs(want / lastSharpenWant - 1) < 0.25 { return }
    lastSharpenWant = want
    sharpen(overlayHost, want: want, screen: screen)
  }

  private func sharpen(_ view: UIView, want: CGFloat, screen: CGFloat) {
    let name = String(describing: type(of: view))
    if name.contains("Paragraph") || name.contains("SvgView") {
      let area = max(1, view.bounds.width * view.bounds.height)
      let scale = max(screen, min(want, (maxLayerPixels / area).squareRoot()))
      if abs(view.contentScaleFactor - scale) > 0.01 {
        view.contentScaleFactor = scale // UIKit's setter: redraws the backing store at this scale
        view.setNeedsDisplay()
      }
    }
    for sub in view.subviews { sharpen(sub, want: want, screen: screen) }
  }

  // MARK: Eraser ring (apiVersion >= 8)

  /// diameter in screen points; 0 hides it. JS keeps it the same size on screen as the eraser it describes.
  func setEraserCursor(_ diameter: Double) {
    eraserDiameter = CGFloat(max(0, diameter))
    let d = eraserDiameter
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    eraserRing.path = d > 0 ? UIBezierPath(ovalIn: CGRect(x: -d / 2, y: -d / 2, width: d, height: d)).cgPath : nil
    if d <= 0 { eraserRing.isHidden = true }
    CATransaction.commit()
  }

  @objc private func drawingGestureChanged(_ gesture: UIGestureRecognizer) {
    switch gesture.state {
    case .began, .changed: moveEraserRing(toLocal: gesture.location(in: self))
    default: moveEraserRing(toLocal: nil)
    }
  }

  /// point in this view's coordinates; nil hides the ring
  private func moveEraserRing(toLocal point: CGPoint?) {
    let show = point != nil && eraserDiameter > 0 && canvas.tool is PKEraserTool
    CATransaction.begin()
    CATransaction.setDisableActions(true) // a standalone layer animates implicitly; the ring must sit on the tip
    if show, let p = point {
      eraserRing.position = p
      eraserRing.isHidden = false
    } else {
      eraserRing.isHidden = true
    }
    CATransaction.commit()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvas.frame = bounds
    placeLayers()
    if !overlayInPage {
      // beside the canvas: the host's origin is the page's top-left; its transform does the rest (anchor top-left)
      bringSubviewToFront(overlayHost)
      overlayHost.bounds = CGRect(origin: .zero, size: bounds.size)
      overlayHost.layer.position = .zero
    }
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
    if wantsOverlayInPage || wantsPaperInPage { placeLayers() }
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
    if paperInPage {
      paper.isHidden = true
      return
    }
    let ink = inkFrame()
    let z = ink.scale
    let pageRect = CGRect(x: ink.origin.x, y: ink.origin.y, width: pageSize.width * z, height: pageSize.height * z)
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
    // a zoom bounce may attach its animation after this callback: follow the ink for a moment anyway
    if !(overlayInPage && paperInPage) && (canvas.isZoomBouncing || canvas.isZooming) { followInk() }
    if wantsOverlayInPage || wantsPaperInPage { placeLayers() }
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
      self.sharpenOverlay()
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
    pagePaper.style = style
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
        // apiVersion >= 10: the whole-stroke eraser has a size too
        if let w = spec.eraserWidth {
          canvas.tool = PKEraserTool(.vector, width: CGFloat(w))
        } else {
          canvas.tool = PKEraserTool(.vector)
        }
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
    let blocked = withinPenWindow() || palmWatcher.hasSuspect || overlayFingerDown
    if canvas.panGestureRecognizer.isEnabled == blocked { canvas.panGestureRecognizer.isEnabled = !blocked }
    if let pinch = canvas.pinchGestureRecognizer, pinch.isEnabled == blocked { pinch.isEnabled = !blocked }
    resumeGestures?.cancel()
    resumeGestures = nil
    if blocked && !pencilDown && !palmWatcher.pencilTouching && !palmWatcher.hasSuspect && !overlayFingerDown {
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
    // PencilKit may add views to its page while drawing: keep the overlay on top and the paper underneath
    if wantsOverlayInPage || wantsPaperInPage { placeLayers() }
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
