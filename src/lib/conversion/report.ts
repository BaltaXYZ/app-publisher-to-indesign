import type { InDesignAuditResult } from "../indesign/quality.js";
import type { DesignDocument } from "../odg/types.js";
import type { PdfComparisonResult } from "../verification/pdf-diff.js";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeExpectedColumns(document: DesignDocument): number[] {
  return document.layoutAnalysis.map((page) => page.columnCount);
}

function summarizeActualColumns(audit: InDesignAuditResult): number[] {
  return audit.pageSummaries.map((page) => page.maxColumnCount);
}

function detectDuplicatePageContent(audit: InDesignAuditResult): boolean {
  const seen = new Set<string>();

  for (const page of audit.pageSummaries) {
    const normalized = normalizeText(page.textFingerprint);
    if (normalized.length < 32) {
      continue;
    }

    if (seen.has(normalized)) {
      return true;
    }

    seen.add(normalized);
  }

  return false;
}

function pageFingerprintMatches(audit: InDesignAuditResult): boolean[] {
  const seen = new Set<string>();

  return audit.pageSummaries.map((page) => {
    const normalized = normalizeText(page.textFingerprint);
    if (normalized.length < 32) {
      return true;
    }

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

export interface ConversionReport {
  sourceFile: string;
  referencePdfPath?: string;
  candidatePdfPath: string;
  pageCount: number;
  pageCountMatches: boolean;
  visualMatchPassed: boolean;
  visualDiffThreshold: number;
  nativeAuditPassed: boolean;
  structuralMatchPassed: boolean;
  columnStructureMatches: boolean;
  duplicatePageContentDetected: boolean;
  backgroundSurrogatesDetected: boolean;
  pageFingerprintMatches: boolean[];
  expectedPageColumns: number[];
  actualPageColumns: number[];
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
  fullPageImagePlacements: string[];
  pageDiffs: PdfComparisonResult["pageDiffs"];
}

export function createConversionReport(
  sourceFile: string,
  referencePdfPath: string | undefined,
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

  const expectedPageColumns = summarizeExpectedColumns(document);
  const actualPageColumns = summarizeActualColumns(audit);
  const columnStructureMatches =
    expectedPageColumns.length === actualPageColumns.length &&
    expectedPageColumns.every((expected, index) => {
      if (expected <= 1) {
        return true;
      }

      return actualPageColumns[index] === expected;
    });
  const duplicatePageContentDetected = detectDuplicatePageContent(audit);
  const pageFingerprintMatchFlags = pageFingerprintMatches(audit);
  const backgroundSurrogatesDetected = audit.fullPagePdfPlacements.length > 0 || audit.fullPageImagePlacements.length > 0;
  const structuralMatchPassed = columnStructureMatches && !duplicatePageContentDetected && !backgroundSurrogatesDetected;

  return {
    sourceFile,
    referencePdfPath,
    candidatePdfPath,
    pageCount: document.pages.length,
    pageCountMatches: comparison.pageCountMatches && comparison.referencePageCount === audit.pageCount,
    visualMatchPassed: comparison.visualMatchPassed,
    visualDiffThreshold: comparison.visualDiffThreshold,
    nativeAuditPassed: audit.nativeAuditPassed,
    structuralMatchPassed,
    columnStructureMatches,
    duplicatePageContentDetected,
    backgroundSurrogatesDetected,
    pageFingerprintMatches: pageFingerprintMatchFlags,
    expectedPageColumns,
    actualPageColumns,
    releaseApproved:
      comparison.pageCountMatches &&
      comparison.referencePageCount === audit.pageCount &&
      audit.nativeAuditPassed &&
      structuralMatchPassed,
    convertedTextFrames,
    convertedShapes,
    imageFillAssets: document.imageFills.length,
    totalGraphics: audit.totalGraphics,
    totalTables: audit.totalTables,
    oversetText: audit.oversetText,
    missingLinks: audit.missingLinks,
    fontIssues: audit.fontIssues,
    fullPagePdfPlacements: audit.fullPagePdfPlacements,
    fullPageImagePlacements: audit.fullPageImagePlacements,
    pageDiffs: comparison.pageDiffs
  };
}
