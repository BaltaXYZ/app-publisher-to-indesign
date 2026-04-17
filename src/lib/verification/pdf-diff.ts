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
}

export interface PdfComparisonResult {
  visualMatchPassed: boolean;
  pageCountMatches: boolean;
  referencePageCount: number;
  candidatePageCount: number;
  visualDiffThreshold: number;
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
    const diffImagePath = path.join(diffDir, `page-${String(index + 1).padStart(4, "0")}.png`);

    await writeFile(diffImagePath, PNG.sync.write(diff));

    pageDiffs.push({
      pageNumber: index + 1,
      referenceImagePath: referencePages[index],
      candidateImagePath: candidatePages[index],
      diffImagePath,
      differingPixels,
      totalPixels: width * height,
      mismatchRatio: differingPixels / (width * height)
    });
  }

  return {
    visualMatchPassed: pageCountMatches && pageDiffs.every((page) => page.differingPixels === 0),
    pageCountMatches,
    referencePageCount: referencePages.length,
    candidatePageCount: candidatePages.length,
    visualDiffThreshold: VISUAL_DIFF_THRESHOLD,
    pageDiffs
  };
}
