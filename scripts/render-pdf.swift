#!/usr/bin/env swift

import AppKit
import Foundation
import PDFKit

enum RenderError: Error {
  case invalidArguments
  case invalidInput
  case invalidPage
  case failedImageRep
}

func renderPage(page: PDFPage, scale: CGFloat) throws -> CGImage {
  let pageRect = page.bounds(for: .mediaBox)
  let pixelWidth = max(1, Int((pageRect.width * scale).rounded()))
  let pixelHeight = max(1, Int((pageRect.height * scale).rounded()))
  let bytesPerRow = pixelWidth * 4

  guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
    throw RenderError.invalidPage
  }

  guard let context = CGContext(
    data: nil,
    width: pixelWidth,
    height: pixelHeight,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    throw RenderError.invalidPage
  }

  context.interpolationQuality = .high
  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)

  guard let image = context.makeImage() else {
    throw RenderError.invalidPage
  }

  return image
}

func main() throws {
  let arguments = CommandLine.arguments
  guard arguments.count == 4 else {
    throw RenderError.invalidArguments
  }

  let inputURL = URL(fileURLWithPath: arguments[1])
  let outputURL = URL(fileURLWithPath: arguments[2], isDirectory: true)
  guard let dpi = Double(arguments[3]), dpi > 0 else {
    throw RenderError.invalidArguments
  }

  guard let document = PDFDocument(url: inputURL) else {
    throw RenderError.invalidInput
  }

  let scale = CGFloat(dpi / 72.0)
  try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

  for pageIndex in 0 ..< document.pageCount {
    guard let page = document.page(at: pageIndex) else {
      throw RenderError.invalidPage
    }

    let image = try renderPage(page: page, scale: scale)
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
      throw RenderError.failedImageRep
    }

    let fileURL = outputURL.appendingPathComponent(String(format: "page-%04d.png", pageIndex + 1))
    try data.write(to: fileURL)
  }

  FileHandle.standardOutput.write("{\"ok\":true}\n".data(using: .utf8)!)
}

do {
  try main()
} catch {
  FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
  exit(1)
}
