import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import type {
  DesignCharacterStyle,
  DesignDocument,
  DesignGraphicStyle,
  DesignImageFill,
  DesignPage,
  DesignPageItem,
  DesignParagraph,
  DesignParagraphStyle,
  DesignShape,
  DesignTextFrame,
  DesignTextRun,
  DesignTextStory,
  PageLayoutAnalysis
} from "../odg/types.js";

const execFileAsync = promisify(execFile);

const PUB2RAW_CANDIDATES = [
  "/opt/homebrew/bin/pub2raw",
  "/usr/local/bin/pub2raw",
  "/opt/homebrew/Cellar/libmspub/0.1.4_19/bin/pub2raw",
  "pub2raw"
];

interface RawShapeStyle {
  fillImage?: { mimeType: string; base64: string };
}

interface MutableRawTextFrame {
  kind: "textFrame";
  id: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  columnCount?: number;
  columnGapPt?: number;
  paragraphs: DesignParagraph[];
  storyId?: string;
  fingerprint?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fingerprintForText(value: string): string {
  return createHash("sha1").update(normalizeText(value)).digest("hex");
}

function mapMimeTypeToExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/svg+xml") {
    return "svg";
  }
  return "png";
}

function parseCommandAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const segments = value.split(/, (?=[a-z:-]+: )/g);

  for (const segment of segments) {
    const separatorIndex = segment.indexOf(": ");
    if (separatorIndex === -1) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim();
    const rawValue = segment.slice(separatorIndex + 2).trim();
    attributes[key] = rawValue;
  }

  return attributes;
}

function inchesToPoints(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  if (value.endsWith("in")) {
    return Number.parseFloat(value.slice(0, -2)) * 72;
  }

  if (value.endsWith("pt")) {
    return Number.parseFloat(value.slice(0, -2));
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function resolvePub2RawExecutable(): Promise<string> {
  for (const candidate of PUB2RAW_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return "pub2raw";
}

function collectPolygonBounds(command: string): { xPt: number; yPt: number; widthPt: number; heightPt: number } | null {
  const matches = [...command.matchAll(/svg:x: ([0-9.]+in), svg:y: ([0-9.]+in)/g)];
  if (matches.length === 0) {
    return null;
  }

  const xPoints = matches
    .map((match) => inchesToPoints(match[1]))
    .filter((value): value is number => typeof value === "number");
  const yPoints = matches
    .map((match) => inchesToPoints(match[2]))
    .filter((value): value is number => typeof value === "number");

  if (xPoints.length === 0 || yPoints.length === 0) {
    return null;
  }

  const minX = Math.min(...xPoints);
  const maxX = Math.max(...xPoints);
  const minY = Math.min(...yPoints);
  const maxY = Math.max(...yPoints);

  return {
    xPt: minX,
    yPt: minY,
    widthPt: Math.max(0, maxX - minX),
    heightPt: Math.max(0, maxY - minY)
  };
}

function keyForParagraphStyle(attributes: Record<string, string>): string {
  return JSON.stringify({
    align: attributes["fo:text-align"],
    marginTopPt: inchesToPoints(attributes["fo:margin-top"]),
    marginBottomPt: inchesToPoints(attributes["fo:margin-bottom"]),
    lineHeight: attributes["fo:line-height"]
  });
}

function keyForCharacterStyle(attributes: Record<string, string>): string {
  return JSON.stringify({
    fontFamily: attributes["style:font-name"],
    fontSizePt: inchesToPoints(attributes["fo:font-size"]),
    fontWeight: attributes["fo:font-weight"],
    fontStyle: attributes["fo:font-style"],
    color: attributes["fo:color"]
  });
}

function keyForGraphicStyle(hasFillImage: boolean): string {
  return hasFillImage ? "bitmap" : "none";
}

function mergeRuns(runs: DesignTextRun[]): DesignTextRun[] {
  const merged: DesignTextRun[] = [];

  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.characterStyleId === run.characterStyleId &&
      previous.fontFamily === run.fontFamily &&
      previous.fontSizePt === run.fontSizePt &&
      previous.fontWeight === run.fontWeight &&
      previous.fontStyle === run.fontStyle &&
      previous.color?.hex === run.color?.hex
    ) {
      previous.text += run.text;
      continue;
    }

    merged.push({ ...run });
  }

  return merged;
}

function buildLayoutAnalysis(document: DesignDocument): PageLayoutAnalysis[] {
  return document.pages.map((page, index) => {
    const textFrames = page.items.filter((item): item is DesignTextFrame => item.kind === "textFrame");
    const columnCount = textFrames.reduce((max, frame) => Math.max(max, frame.columnCount ?? 1), 0);
    const columnBands = textFrames
      .filter((frame) => (frame.storyId || (frame.paragraphs?.length ?? 0) > 0) && (frame.columnCount ?? 1) > 1)
      .map((frame) => ({ leftPt: frame.xPt, rightPt: frame.xPt + frame.widthPt }))
      .sort((left, right) => left.leftPt - right.leftPt);
    const pageText = textFrames
      .map((frame) => (frame.paragraphs ?? []).map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n"))
      .join("\n");

    return {
      pageId: page.id,
      pageNumber: index + 1,
      textFrameCount: textFrames.length,
      columnCount,
      columnBands,
      pageTextFingerprint: fingerprintForText(pageText)
    };
  });
}

export async function parsePubDocument(
  pubPath: string,
  assetsDir: string
): Promise<{ document: DesignDocument; assetMap: Map<string, string> }> {
  await mkdir(assetsDir, { recursive: true });

  const executable = await resolvePub2RawExecutable();
  const { stdout } = await execFileAsync(executable, [path.resolve(pubPath)], {
    maxBuffer: 1024 * 1024 * 200
  });
  const rawOutput = stdout.replaceAll("\r", "");
  const lines = rawOutput.split("\n");

  const paragraphStyles: DesignParagraphStyle[] = [];
  const characterStyles: DesignCharacterStyle[] = [];
  const graphicStyles: DesignGraphicStyle[] = [];
  const paragraphStyleIds = new Map<string, string>();
  const characterStyleIds = new Map<string, string>();
  const graphicStyleIds = new Map<string, string>();
  const imageFills: DesignImageFill[] = [];
  const assetMap = new Map<string, string>();

  const pages: DesignPage[] = [];
  let currentPage: DesignPage | null = null;
  let currentShapeStyle: RawShapeStyle | null = null;
  let currentTextFrame: MutableRawTextFrame | null = null;
  let currentParagraph: DesignParagraph | null = null;
  let currentRun: DesignTextRun | null = null;
  let pageIndex = 0;
  let textFrameIndex = 0;
  let shapeIndex = 0;

  const ensureParagraphStyle = (attributes: Record<string, string>): string | undefined => {
    const key = keyForParagraphStyle(attributes);
    if (key === "{}") {
      return undefined;
    }

    const existing = paragraphStyleIds.get(key);
    if (existing) {
      return existing;
    }

    const id = `para-${paragraphStyles.length + 1}`;
    paragraphStyleIds.set(key, id);
    paragraphStyles.push({
      id,
      align: attributes["fo:text-align"],
      marginTopPt: inchesToPoints(attributes["fo:margin-top"]),
      marginBottomPt: inchesToPoints(attributes["fo:margin-bottom"]),
      lineHeight: attributes["fo:line-height"]
    });

    return id;
  };

  const ensureCharacterStyle = (attributes: Record<string, string>): string | undefined => {
    const key = keyForCharacterStyle(attributes);
    if (key === "{}") {
      return undefined;
    }

    const existing = characterStyleIds.get(key);
    if (existing) {
      return existing;
    }

    const id = `char-${characterStyles.length + 1}`;
    characterStyleIds.set(key, id);
    characterStyles.push({
      id,
      fontFamily: attributes["style:font-name"],
      fontSizePt: inchesToPoints(attributes["fo:font-size"]),
      fontWeight: attributes["fo:font-weight"],
      fontStyle: attributes["fo:font-style"],
      color: attributes["fo:color"] ? { hex: attributes["fo:color"] } : undefined
    });

    return id;
  };

  const ensureGraphicStyle = (hasFillImage: boolean): string => {
    const key = keyForGraphicStyle(hasFillImage);
    const existing = graphicStyleIds.get(key);
    if (existing) {
      return existing;
    }

    const id = `graphic-${graphicStyles.length + 1}`;
    graphicStyleIds.set(key, id);
    graphicStyles.push({
      id,
      fill: hasFillImage ? "bitmap" : "none",
      stroke: "none"
    });

    return id;
  };

  const flushParagraph = (): void => {
    if (!currentTextFrame || !currentParagraph) {
      currentParagraph = null;
      return;
    }

    if (currentRun && currentRun.text.length > 0) {
      currentParagraph.runs.push(currentRun);
      currentRun = null;
    }

    currentParagraph.runs = mergeRuns(currentParagraph.runs);
    if (currentParagraph.runs.some((run) => run.text.trim().length > 0)) {
      currentTextFrame.paragraphs.push(currentParagraph);
    }

    currentParagraph = null;
  };

  const flushTextFrame = (): void => {
    flushParagraph();

    if (!currentPage || !currentTextFrame) {
      currentTextFrame = null;
      return;
    }

    const hasText = currentTextFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim().length > 0));
    if (hasText) {
      currentPage.items.push(currentTextFrame);
    }

    currentTextFrame = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("startPage(")) {
      pageIndex += 1;
      currentPage = {
        id: `page-${pageIndex}`,
        name: `Page ${pageIndex}`,
        widthPt: inchesToPoints(line.match(/svg:width: ([0-9.]+in)/)?.[1]) ?? 0,
        heightPt: inchesToPoints(line.match(/svg:height: ([0-9.]+in)/)?.[1]) ?? 0,
        items: []
      };
      continue;
    }

    if (line.startsWith("endPage")) {
      flushTextFrame();
      if (currentPage) {
        pages.push(currentPage);
        currentPage = null;
      }
      continue;
    }

    if (line.startsWith("setStyle(")) {
      const attributes = parseCommandAttributes(line.slice("setStyle(".length, -1));
      const fillImage = attributes["draw:fill-image"];
      const mimeType = attributes["librevenge:mime-type"];

      currentShapeStyle = fillImage && mimeType ? { fillImage: { mimeType, base64: fillImage } } : null;
      continue;
    }

    if (line.startsWith("drawPolygon")) {
      if (!currentPage || !currentShapeStyle?.fillImage) {
        continue;
      }

      const bounds = collectPolygonBounds(line);
      if (!bounds) {
        continue;
      }

      const digest = createHash("sha1").update(currentShapeStyle.fillImage.base64).digest("hex").slice(0, 12);
      const extension = mapMimeTypeToExtension(currentShapeStyle.fillImage.mimeType);
      const name = `shape-${shapeIndex + 1}-${digest}.${extension}`;
      const filePath = path.join(assetsDir, name);

      if (!assetMap.has(name)) {
        const binary = Buffer.from(currentShapeStyle.fillImage.base64, "base64");
        await writeFile(filePath, binary);
        const fill: DesignImageFill = { name, path: filePath };
        imageFills.push(fill);
        assetMap.set(name, filePath);
      }

      const shape: DesignShape = {
        kind: "shape",
        shapeType: "frame",
        styleId: ensureGraphicStyle(true),
        xPt: bounds.xPt,
        yPt: bounds.yPt,
        widthPt: bounds.widthPt,
        heightPt: bounds.heightPt,
        fillImage: imageFills.find((image) => image.name === name)
      };

      currentPage.items.push(shape);
      shapeIndex += 1;
      continue;
    }

    if (line.startsWith("startTextObject")) {
      flushTextFrame();
      if (!currentPage) {
        continue;
      }

      const attributes = parseCommandAttributes(line.slice("startTextObject".length).trim().slice(1, -1));
      textFrameIndex += 1;
      currentTextFrame = {
        kind: "textFrame",
        id: `text-frame-${textFrameIndex}`,
        xPt: inchesToPoints(attributes["svg:x"]) ?? 0,
        yPt: inchesToPoints(attributes["svg:y"]) ?? 0,
        widthPt: inchesToPoints(attributes["svg:width"]) ?? 0,
        heightPt: inchesToPoints(attributes["svg:height"]) ?? 0,
        columnCount: attributes["fo:column-count"] ? Number.parseInt(attributes["fo:column-count"], 10) : undefined,
        columnGapPt: inchesToPoints(attributes["fo:column-gap"]),
        paragraphs: []
      };
      continue;
    }

    if (line.startsWith("endTextObject")) {
      flushTextFrame();
      continue;
    }

    if (line.startsWith("openParagraph")) {
      if (!currentTextFrame) {
        continue;
      }

      flushParagraph();
      const attributes = parseCommandAttributes(line.slice("openParagraph".length).trim().slice(1, -1));
      currentParagraph = {
        styleId: ensureParagraphStyle(attributes),
        runs: []
      };
      continue;
    }

    if (line.startsWith("closeParagraph")) {
      flushParagraph();
      continue;
    }

    if (line.startsWith("openSpan")) {
      if (!currentParagraph) {
        continue;
      }

      if (currentRun && currentRun.text.length > 0) {
        currentParagraph.runs.push(currentRun);
      }

      const attributes = parseCommandAttributes(line.slice("openSpan".length).trim().slice(1, -1));
      currentRun = {
        text: "",
        characterStyleId: ensureCharacterStyle(attributes),
        fontFamily: attributes["style:font-name"],
        fontSizePt: inchesToPoints(attributes["fo:font-size"]),
        fontWeight: attributes["fo:font-weight"],
        fontStyle: attributes["fo:font-style"],
        color: attributes["fo:color"] ? { hex: attributes["fo:color"] } : undefined
      };
      continue;
    }

    if (line.startsWith("closeSpan")) {
      if (currentParagraph && currentRun && currentRun.text.length > 0) {
        currentParagraph.runs.push(currentRun);
      }
      currentRun = null;
      continue;
    }

    if (line.startsWith("insertSpace")) {
      if (currentRun) {
        currentRun.text += " ";
      }
      continue;
    }

    if (line.startsWith("insertText")) {
      if (currentRun) {
        currentRun.text += line.slice("insertText (".length, -1);
      }
    }
  }

  flushTextFrame();

  const repeatedStoryGroups = new Map<string, MutableRawTextFrame[]>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind !== "textFrame") {
        continue;
      }

      const frame = item as MutableRawTextFrame;
      const text = frame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n");
      const normalized = normalizeText(text);
      if (normalized.length === 0) {
        continue;
      }

      const fingerprint = fingerprintForText(normalized);
      frame.fingerprint = fingerprint;
      const group = repeatedStoryGroups.get(fingerprint) ?? [];
      group.push(frame);
      repeatedStoryGroups.set(fingerprint, group);
    }
  }

  const textStories: DesignTextStory[] = [];
  let storyIndex = 0;

  for (const [fingerprint, frames] of repeatedStoryGroups.entries()) {
    if (frames.length <= 1) {
      continue;
    }

    storyIndex += 1;
    const storyId = `story-${storyIndex}`;
    textStories.push({
      id: storyId,
      fingerprint,
      paragraphs: frames[0].paragraphs
    });

    for (const frame of frames) {
      frame.storyId = storyId;
      frame.paragraphs = [];
    }
  }

  const document: DesignDocument = {
    sourcePath: path.resolve(pubPath),
    pageWidthPt: pages[0]?.widthPt ?? 0,
    pageHeightPt: pages[0]?.heightPt ?? 0,
    pages: pages.map((page) => ({
      ...page,
      items: page.items as DesignPageItem[]
    })),
    textStories,
    layoutAnalysis: [],
    paragraphStyles,
    characterStyles,
    graphicStyles,
    imageFills
  };

  document.layoutAnalysis = buildLayoutAnalysis(document);

  return { document, assetMap };
}
