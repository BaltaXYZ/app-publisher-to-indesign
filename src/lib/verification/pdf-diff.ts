import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const execFileAsync = promisify(execFile);
const DEFAULT_DPI = 144;
const VISUAL_DIFF_THRESHOLD = 0.3;

export interface PageDiff {
  pageNumber: number;
  referenceImagePath: string;
  candidateImagePath: string;
  diffImagePath: string;
  differingPixels: number;
  totalPixels: number;
  mismatchRatio: number;
  fontTolerantMissingRatio: number;
  fontTolerantExtraRatio: number;
  fontTolerantPassed: boolean;
}

export interface PdfComparisonResult {
  visualMatchPassed: boolean;
  exactVisualMatchPassed: boolean;
  fontTolerantVisualMatchPassed: boolean;
  pageCountMatches: boolean;
  referencePageCount: number;
  candidatePageCount: number;
  visualDiffThreshold: number;
  rawPixelMismatchRatio: number;
  pageDiffs: PageDiff[];
}

async function rasterizePdf(pdfPath: string, outputDir: string, dpi = DEFAULT_DPI): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  await execFileAsync("swift", [path.resolve("scripts", "render-pdf.swift"), path.resolve(pdfPath), outputDir, String(dpi)], {
    maxBuffer: 1024 * 1024 * 20
  });

  return (await readdir(outputDir))
    .filter((entry) => entry.endsWith(".png"))
    .sort()
    .map((entry) => path.join(outputDir, entry));
}

export async function renderPdfPages(pdfPath: string, outputDir: string, dpi = DEFAULT_DPI): Promise<string[]> {
  return rasterizePdf(pdfPath, outputDir, dpi);
}

async function readPng(filePath: string): Promise<PNG> {
  const buffer = await readFile(filePath);
  return PNG.sync.read(buffer);
}

function inkMask(png: PNG): Uint8Array {
  const mask = new Uint8Array(png.width * png.height);
  for (let index = 0; index < mask.length; index += 1) {
    const pixelIndex = index * 4;
    const red = png.data[pixelIndex];
    const green = png.data[pixelIndex + 1];
    const blue = png.data[pixelIndex + 2];
    const alpha = png.data[pixelIndex + 3];
    mask[index] = alpha > 10 && (red < 246 || green < 246 || blue < 246) ? 1 : 0;
  }

  return mask;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || dx * dx + dy * dy > radius * radius) {
            continue;
          }
          output[ny * width + nx] = 1;
        }
      }
    }
  }

  return output;
}

function fontTolerantMaskDiff(referencePng: PNG, candidatePng: PNG): {
  missingRatio: number;
  extraRatio: number;
  passed: boolean;
} {
  const referenceMask = inkMask(referencePng);
  const candidateMask = inkMask(candidatePng);
  const dilatedReference = dilateMask(referenceMask, referencePng.width, referencePng.height, 5);
  const dilatedCandidate = dilateMask(candidateMask, candidatePng.width, candidatePng.height, 5);
  let referenceInk = 0;
  let candidateInk = 0;
  let missing = 0;
  let extra = 0;

  for (let index = 0; index < referenceMask.length; index += 1) {
    if (referenceMask[index]) {
      referenceInk += 1;
      if (!dilatedCandidate[index]) {
        missing += 1;
      }
    }
    if (candidateMask[index]) {
      candidateInk += 1;
      if (!dilatedReference[index]) {
        extra += 1;
      }
    }
  }

  const missingRatio = referenceInk === 0 ? 0 : missing / referenceInk;
  const extraRatio = candidateInk === 0 ? 0 : extra / candidateInk;

  const rawContentMismatchProxy = Math.max(missingRatio, extraRatio);

  return {
    missingRatio,
    extraRatio,
    passed: rawContentMismatchProxy <= 0.62
  };
}

export async function comparePdfVisuals(
  referencePdfPath: string,
  candidatePdfPath: string,
  outputRoot: string
): Promise<PdfComparisonResult> {
  const referenceDir = path.join(outputRoot, "reference");
  const candidateDir = path.join(outputRoot, "candidate");
  const diffDir = path.join(outputRoot, "diff");

  await mkdir(diffDir, { recursive: true });

  const referencePages = await rasterizePdf(referencePdfPath, referenceDir);
  const candidatePages = await rasterizePdf(candidatePdfPath, candidateDir);
  const pageCountMatches = referencePages.length === candidatePages.length;
  const comparablePageCount = Math.min(referencePages.length, candidatePages.length);
  const pageDiffs: PageDiff[] = [];
  let totalDifferingPixels = 0;
  let totalPixels = 0;

  for (let index = 0; index < comparablePageCount; index += 1) {
    const referencePng = await readPng(referencePages[index]);
    const candidatePng = await readPng(candidatePages[index]);

    const width = Math.max(referencePng.width, candidatePng.width);
    const height = Math.max(referencePng.height, candidatePng.height);
    const referenceCanvas = new PNG({ width, height, fill: true });
    const candidateCanvas = new PNG({ width, height, fill: true });

    PNG.bitblt(referencePng, referenceCanvas, 0, 0, referencePng.width, referencePng.height, 0, 0);
    PNG.bitblt(candidatePng, candidateCanvas, 0, 0, candidatePng.width, candidatePng.height, 0, 0);

    const diff = new PNG({ width, height, fill: true });
    const differingPixels = pixelmatch(referenceCanvas.data, candidateCanvas.data, diff.data, width, height, {
      threshold: VISUAL_DIFF_THRESHOLD,
      includeAA: false
    });
    const tolerantDiff = fontTolerantMaskDiff(referenceCanvas, candidateCanvas);
    const mismatchRatio = differingPixels / (width * height);
    const diffImagePath = path.join(diffDir, `page-${String(index + 1).padStart(4, "0")}.png`);

    await writeFile(diffImagePath, PNG.sync.write(diff));
    totalDifferingPixels += differingPixels;
    totalPixels += width * height;

    pageDiffs.push({
      pageNumber: index + 1,
      referenceImagePath: referencePages[index],
      candidateImagePath: candidatePages[index],
      diffImagePath,
      differingPixels,
      totalPixels: width * height,
      mismatchRatio,
      fontTolerantMissingRatio: tolerantDiff.missingRatio,
      fontTolerantExtraRatio: tolerantDiff.extraRatio,
      fontTolerantPassed: tolerantDiff.passed || mismatchRatio <= 0.09
    });
  }

  const exactVisualMatchPassed = pageCountMatches && pageDiffs.every((page) => page.differingPixels === 0);
  const fontTolerantVisualMatchPassed = pageCountMatches && pageDiffs.every((page) => page.fontTolerantPassed);

  return {
    visualMatchPassed: fontTolerantVisualMatchPassed,
    exactVisualMatchPassed,
    fontTolerantVisualMatchPassed,
    pageCountMatches,
    referencePageCount: referencePages.length,
    candidatePageCount: candidatePages.length,
    visualDiffThreshold: VISUAL_DIFF_THRESHOLD,
    rawPixelMismatchRatio: totalPixels === 0 ? 0 : totalDifferingPixels / totalPixels,
    pageDiffs
  };
}
