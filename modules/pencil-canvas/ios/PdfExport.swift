import ExpoModulesCore
import PencilKit
import UIKit

// Final PDF of an assignment (apiVersion >= 4): one US Letter page per page, the student's ink rendered at 3x on white,
// plus the question blocks they placed on the page (typeset as text, Unicode math). Tutor marks are not drawn: submitted
// work is the student's own. Runs off the main thread (PKDrawing is a value type; image rendering is thread-safe).

private struct PdfBlock: Decodable {
  let x: Double
  let y: Double
  let w: Double
  let heading: String?
  let lines: [String]
  let fontSize: Double?
}

private struct PdfPage: Decodable {
  let drawing: String // PKDrawing.dataRepresentation() base64; "" = blank page
  let blocks: [PdfBlock]?
}

private struct PdfRequest: Decodable {
  let title: String
  let pageWidth: Double
  let pageHeight: Double
  let pages: [PdfPage]
}

final class PdfExportException: Exception, @unchecked Sendable {
  private let why: String
  init(_ why: String) {
    self.why = why
    super.init()
  }
  override var reason: String { why }
}

enum PdfExport {
  /// Returns the file:// URL of the written PDF (in Caches/exports, overwritten per title).
  static func make(_ json: String) throws -> String {
    guard let data = json.data(using: .utf8), let req = try? JSONDecoder().decode(PdfRequest.self, from: data) else {
      throw PdfExportException("The export request could not be read")
    }
    guard req.pageWidth > 1, req.pageHeight > 1, !req.pages.isEmpty else { throw PdfExportException("Nothing to export") }

    let pageSize = CGSize(width: req.pageWidth, height: req.pageHeight)
    // PDF points are 1/72 in; the app's page is US Letter at 96 per inch. Scale so the paper is really Letter.
    let letter = CGRect(x: 0, y: 0, width: 612, height: 792)
    let fit = min(letter.width / pageSize.width, letter.height / pageSize.height)

    let meta: [String: Any] = [kCGPDFContextTitle as String: req.title, kCGPDFContextCreator as String: "Penquire"]
    let format = UIGraphicsPDFRendererFormat()
    format.documentInfo = meta
    let renderer = UIGraphicsPDFRenderer(bounds: letter, format: format)

    let pdf = renderer.pdfData { ctx in
      for page in req.pages {
        ctx.beginPage()
        let cg = ctx.cgContext
        cg.saveGState()
        cg.scaleBy(x: fit, y: fit)
        UIColor.white.setFill()
        cg.fill(CGRect(origin: .zero, size: pageSize))

        if !page.drawing.isEmpty, let bytes = Data(base64Encoded: page.drawing), let drawing = try? PKDrawing(data: bytes) {
          var ink = UIImage()
          UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            ink = drawing.image(from: CGRect(origin: .zero, size: pageSize), scale: 3)
          }
          ink.draw(in: CGRect(origin: .zero, size: pageSize))
        }

        for b in page.blocks ?? [] {
          drawBlock(b, in: cg)
        }
        cg.restoreGState()
      }
    }

    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("exports", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let safe = req.title.components(separatedBy: CharacterSet(charactersIn: "/\\?%*|\"<>:")).joined(separator: "-").trimmingCharacters(in: .whitespaces)
    let url = dir.appendingPathComponent((safe.isEmpty ? "Penquire" : safe) + ".pdf")
    do {
      try pdf.write(to: url, options: .atomic)
    } catch {
      throw PdfExportException("The PDF could not be saved: \(error.localizedDescription)")
    }
    return url.absoluteString
  }

  /// A placed question: a thin accent rule on the left, the heading, then its lines, wrapped to the block's width.
  private static func drawBlock(_ b: PdfBlock, in cg: CGContext) {
    let size = CGFloat(b.fontSize ?? 15)
    let padX: CGFloat = 12
    let padY: CGFloat = 8
    let width = CGFloat(b.w) - padX * 2
    guard width > 20 else { return }
    let para = NSMutableParagraphStyle()
    para.lineBreakMode = .byWordWrapping
    para.lineSpacing = size * 0.3
    let ink = UIColor(red: 0.06, green: 0.08, blue: 0.10, alpha: 1)
    let accent = UIColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1)
    var y = CGFloat(b.y) + padY
    let x = CGFloat(b.x) + padX
    if let heading = b.heading, !heading.isEmpty {
      let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size * 0.85, weight: .semibold), .foregroundColor: accent, .paragraphStyle: para]
      let s = heading as NSString
      let r = s.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attrs, context: nil)
      s.draw(with: CGRect(x: x, y: y, width: width, height: ceil(r.height)), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attrs, context: nil)
      y += ceil(r.height) + 2
    }
    let body: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size), .foregroundColor: ink, .paragraphStyle: para]
    for line in b.lines {
      let s = line as NSString
      let r = s.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: body, context: nil)
      s.draw(with: CGRect(x: x, y: y, width: width, height: ceil(r.height)), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: body, context: nil)
      y += ceil(r.height) + 4
    }
    cg.setFillColor(accent.cgColor)
    cg.fill(CGRect(x: CGFloat(b.x), y: CGFloat(b.y), width: 3, height: max(0, y - CGFloat(b.y))))
  }
}
