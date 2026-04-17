import type { DesignDocument } from "../odg/types.js";

export interface ConversionReport {
  sourceFile: string;
  pageCount: number;
  convertedTextFrames: number;
  convertedShapes: number;
  imageFillAssets: number;
  validatedInInDesign?: boolean;
  exact: string[];
  approximate: string[];
  unsupported: string[];
}

export function createConversionReport(sourceFile: string, document: DesignDocument): ConversionReport {
  let convertedTextFrames = 0;
  let convertedShapes = 0;

  for (const page of document.pages) {
    for (const item of page.items) {
      if (item.kind === "textFrame") {
        convertedTextFrames += 1;
      } else {
        convertedShapes += 1;
      }
    }
  }

  return {
    sourceFile,
    pageCount: document.pages.length,
    convertedTextFrames,
    convertedShapes,
    imageFillAssets: document.imageFills.length,
    exact: [
      "Publisher ingest through LibreOffice Draw",
      "Page count and page size extraction",
      "Text frame geometry extraction",
      "Paragraph and character style catalog extraction",
      "Bitmap fill asset extraction"
    ],
    approximate: [
      "Graphic shapes are normalized to rectangles or simplified polygons in the first export",
      "Bitmap fills are placed as images in fitted frames rather than native InDesign shape fills",
      "Fine typography and rotation are not fully mapped yet"
    ],
    unsupported: [
      "Native semantic table reconstruction",
      "Full polygon path fidelity for all shapes",
      "Complex grouped objects and advanced effects"
    ]
  };
}
