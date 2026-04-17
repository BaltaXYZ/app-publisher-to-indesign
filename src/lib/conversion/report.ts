import type { InDesignAuditResult } from "../indesign/quality.js";
import type { DesignDocument } from "../odg/types.js";
import type { PdfComparisonResult } from "../verification/pdf-diff.js";

export interface ConversionReport {
  sourceFile: string;
  referencePdfPath: string;
  candidatePdfPath: string;
  pageCount: number;
  pageCountMatches: boolean;
  visualMatchPassed: boolean;
  visualDiffThreshold: number;
  nativeAuditPassed: boolean;
  releaseApproved: boolean;
  convertedTextFrames: number;
  convertedShapes: number;
  imageFillAssets: number;
  totalGraphics: number;
  totalTables: number;
  oversetText: boolean;
  missingLinks: string[];
  fontIssues: string[];
  fullPagePdfPlacements: string[];
  pageDiffs: PdfComparisonResult["pageDiffs"];
}

export function createConversionReport(
  sourceFile: string,
  referencePdfPath: string,
  candidatePdfPath: string,
  document: DesignDocument,
  comparison: PdfComparisonResult,
  audit: InDesignAuditResult
): ConversionReport {
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
    referencePdfPath,
    candidatePdfPath,
    pageCount: document.pages.length,
    pageCountMatches: comparison.pageCountMatches && comparison.referencePageCount === audit.pageCount,
    visualMatchPassed: comparison.visualMatchPassed,
    visualDiffThreshold: comparison.visualDiffThreshold,
    nativeAuditPassed: audit.nativeAuditPassed,
    releaseApproved:
      comparison.visualMatchPassed &&
      comparison.pageCountMatches &&
      comparison.referencePageCount === audit.pageCount &&
      audit.nativeAuditPassed,
    convertedTextFrames,
    convertedShapes,
    imageFillAssets: document.imageFills.length,
    totalGraphics: audit.totalGraphics,
    totalTables: audit.totalTables,
    oversetText: audit.oversetText,
    missingLinks: audit.missingLinks,
    fontIssues: audit.fontIssues,
    fullPagePdfPlacements: audit.fullPagePdfPlacements,
    pageDiffs: comparison.pageDiffs
  };
}
