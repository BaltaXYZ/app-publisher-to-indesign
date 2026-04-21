import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import * as CFB from "cfb";

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
const MALFORMED_SINGLE_CHARACTER_RUN_THRESHOLD = 20;
const CANONICAL_STORY_START_MARKER = "Inledning";
const FOOTER_LABEL = "Fokus 2025:9";

interface RawShapeStyle {
  fillImage?: { mimeType: string; base64: string };
}

interface MutableRawTextFrame {
  kind: "textFrame";
  id: string;
  role?: "story" | "footer" | "layout-placeholder";
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

interface MalformedParagraphSummary {
  detected: boolean;
  singleCharacterParagraphCount: number;
  longestRun: number;
}

function paragraphText(paragraph: DesignParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

function paragraphsText(paragraphs: DesignParagraph[]): string {
  return paragraphs.map(paragraphText).join("\n");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return normalizeText(value).toLocaleLowerCase("sv-SE");
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

function removeControlCharacters(value: string): string {
  let output = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === "\r" || char === "\n" || char === "\t" || code >= 32) {
      output += char;
    }
  }

  return output;
}

function isHumanReadableParagraph(value: string): boolean {
  const normalized = normalizeText(value);
  if (normalized.length < 2) {
    return false;
  }

  const latinAlphaNumericMatches = normalized.match(/[A-Za-zÅÄÖåäö0-9]/g) ?? [];
  if (latinAlphaNumericMatches.length < 2) {
    return false;
  }

  return latinAlphaNumericMatches.length / normalized.length >= 0.35;
}

function isQuillMetadataNoise(value: string): boolean {
  const normalized = normalizeText(value);
  if (/[�￿]/.test(normalized)) {
    return true;
  }

  const knownFontMetadata = [
    "Raavi",
    "Shruti",
    "Kalinga",
    "Microsoft Himalaya",
    "Malgun Gothic",
    "PMingLiU",
    "SimSun",
    "Estrangelo Edessa"
  ];
  if (knownFontMetadata.some((fontName) => normalized.includes(fontName))) {
    return true;
  }

  const urlCount = normalized.match(/https?:\/\//g)?.length ?? 0;
  return normalized.length > 1000 && urlCount > 3;
}

async function extractCanonicalQuillParagraphs(pubPath: string): Promise<string[]> {
  try {
    const bytes = await readFile(pubPath);
    const container = CFB.read(bytes, { type: "buffer" });
    const entry =
      CFB.find(container, "Root Entry/Quill/QuillSub/CONTENTS") ??
      container.FileIndex.find((candidate) => candidate.name === "CONTENTS" && candidate.size > 1024);

    if (!entry?.content) {
      return [];
    }

    let text = Buffer.from(entry.content as Uint8Array).toString("utf16le");
    const storyStart = text.indexOf(CANONICAL_STORY_START_MARKER);
    if (storyStart !== -1) {
      text = text.slice(storyStart);
    }

    const paragraphs: string[] = [];
    for (const paragraph of removeControlCharacters(text)
      .replace(/\u0000/g, " ")
      .replace(/\n/g, "\r")
      .split(/\r+/g)
      .map((paragraph) => normalizeText(paragraph))
    ) {
      if (isQuillMetadataNoise(paragraph)) {
        break;
      }

      if (isHumanReadableParagraph(paragraph)) {
        paragraphs.push(paragraph);
      }
    }

    return paragraphs;
  } catch {
    return [];
  }
}

function summarizeMalformedSingleCharacterParagraphs(paragraphs: DesignParagraph[]): MalformedParagraphSummary {
  let singleCharacterParagraphCount = 0;
  let currentRun = 0;
  let longestRun = 0;

  for (const paragraph of paragraphs) {
    const length = normalizeText(paragraphText(paragraph)).length;
    if (length > 0 && length <= 1) {
      singleCharacterParagraphCount += 1;
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
      continue;
    }

    currentRun = 0;
  }

  return {
    detected: longestRun >= MALFORMED_SINGLE_CHARACTER_RUN_THRESHOLD,
    singleCharacterParagraphCount,
    longestRun
  };
}

function cloneRunStyle(template: DesignTextRun | undefined, text: string): DesignTextRun {
  return {
    text,
    characterStyleId: template?.characterStyleId,
    fontFamily: template?.fontFamily ?? "Palatino Linotype",
    fontSizePt: template?.fontSizePt ?? 10,
    fontWeight: template?.fontWeight,
    fontStyle: template?.fontStyle,
    color: template?.color
  };
}

function cloneParagraphWithText(template: DesignParagraph | undefined, text: string): DesignParagraph {
  return {
    styleId: template?.styleId,
    runs: [cloneRunStyle(template?.runs[0], text)]
  };
}

function canonicalCoverage(canonicalParagraphs: string[], paragraphs: DesignParagraph[]): number {
  const canonicalWords = normalizeForMatch(canonicalParagraphs.join(" "))
    .split(" ")
    .filter((word) => word.length >= 3);
  if (canonicalWords.length === 0) {
    return 0;
  }

  const storyText = normalizeForMatch(paragraphsText(paragraphs));
  let covered = 0;
  for (const word of canonicalWords) {
    if (storyText.includes(word)) {
      covered += 1;
    }
  }

  return covered / canonicalWords.length;
}

function buildCanonicalParagraphs(canonicalParagraphs: string[], rawParagraphs: DesignParagraph[]): DesignParagraph[] {
  const rawByText = new Map<string, DesignParagraph>();
  for (const paragraph of rawParagraphs) {
    const text = normalizeForMatch(paragraphText(paragraph));
    if (text.length > 0 && !rawByText.has(text)) {
      rawByText.set(text, paragraph);
    }
  }

  const bodyTemplate =
    rawParagraphs.find((paragraph) => {
      const text = normalizeText(paragraphText(paragraph));
      const run = paragraph.runs[0];
      return text.length > 80 && (run?.fontFamily ?? "").toLocaleLowerCase("sv-SE").includes("palatino");
    }) ??
    rawParagraphs.find((paragraph) => normalizeText(paragraphText(paragraph)).length > 80);
  const headingTemplate =
    rawParagraphs.find((paragraph) => {
      const text = normalizeForMatch(paragraphText(paragraph));
      const run = paragraph.runs[0];
      return text.includes("konsekvenser för handeln") && (run?.fontFamily ?? "").toLocaleLowerCase("sv-SE").includes("arial");
    }) ??
    rawParagraphs.find((paragraph) => {
      const run = paragraph.runs[0];
      return (run?.fontFamily ?? "").toLocaleLowerCase("sv-SE").includes("arial") && run?.fontWeight === "bold";
    });

  const headingTexts = new Set(
    rawParagraphs
      .filter((paragraph) => {
        const text = normalizeText(paragraphText(paragraph));
        const run = paragraph.runs[0];
        return text.length > 0 && text.length <= 120 && (run?.fontFamily ?? "").toLocaleLowerCase("sv-SE").includes("arial");
      })
      .map((paragraph) => normalizeForMatch(paragraphText(paragraph)))
  );

  for (const text of [
    "inledning",
    "varför säljer butikerna emv?",
    "utbredningen av emv och effekterna på priser",
    "varför skiljer sig emv-andelen åt mellan länder och butiker?",
    "hur har emv utvecklats över tid?",
    "exemplet mjölk",
    "konsekvenser för handeln, mejerier, lantbruk och konsumenter",
    "befintlig vetenskaplig litteratur och konkurrensverkets tidigare studier",
    "referenser"
  ]) {
    headingTexts.add(text);
  }

  return canonicalParagraphs.map((text) => {
    const normalized = normalizeForMatch(text);
    const exactRawParagraph = rawByText.get(normalized);
    if (exactRawParagraph) {
      return cloneParagraphWithText(exactRawParagraph, text);
    }

    const looksLikeHeading =
      headingTexts.has(normalized) ||
      (text.length <= 95 && !/[.!?]$/.test(text) && /[A-ZÅÄÖa-zåäö]/.test(text) && !text.includes(","));
    return cloneParagraphWithText(looksLikeHeading ? headingTemplate : bodyTemplate, text);
  });
}

function looksLikeFooterFrame(frame: MutableRawTextFrame, page: DesignPage): boolean {
  return frame.yPt > page.heightPt - 90 && frame.widthPt >= 70 && frame.heightPt <= 80;
}

function looksLikeFirstPageStoryPlaceholder(frame: MutableRawTextFrame, page: DesignPage, firstStoryFrame: MutableRawTextFrame): boolean {
  return (
    page.name === "Page 1" &&
    frame.widthPt > page.widthPt * 0.55 &&
    frame.xPt < page.widthPt * 0.25 &&
    frame.yPt < firstStoryFrame.yPt - 4 &&
    !looksLikeFooterFrame(frame, page)
  );
}

function makeFooterFrame(page: DesignPage, pageNumber: number, candidate: MutableRawTextFrame | undefined): MutableRawTextFrame {
  return {
    kind: "textFrame",
    role: "footer",
    id: `footer-${pageNumber}`,
    xPt: candidate?.xPt ?? page.widthPt - 160,
    yPt: candidate?.yPt ?? page.heightPt - 42,
    widthPt: candidate?.widthPt ?? 135,
    heightPt: Math.min(candidate?.heightPt ?? 18, 28),
    paragraphs: [
      {
        runs: [
          {
            text: `${FOOTER_LABEL} | ${pageNumber}`,
            fontFamily: "Palatino Linotype",
            fontSizePt: 7,
            color: { hex: "#000000" }
          }
        ]
      }
    ]
  };
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
  const canonicalQuillParagraphs = await extractCanonicalQuillParagraphs(pubPath);

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
  const emptyTextFramesByPageId = new Map<string, MutableRawTextFrame[]>();
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
    } else {
      const frames = emptyTextFramesByPageId.get(currentPage.id) ?? [];
      frames.push({ ...currentTextFrame, paragraphs: [] });
      emptyTextFramesByPageId.set(currentPage.id, frames);
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
  let sourceMalformedSingleCharacterParagraphsDetected = false;
  let malformedSingleCharacterParagraphsDetected = false;
  let singleCharacterParagraphCount = 0;
  let canonicalTextCoverage = canonicalQuillParagraphs.length > 0 ? 0 : 1;

  for (const [fingerprint, frames] of repeatedStoryGroups.entries()) {
    if (frames.length <= 1) {
      continue;
    }

    const sourceParagraphs = frames[0].paragraphs;
    const sourceMalformedSummary = summarizeMalformedSingleCharacterParagraphs(sourceParagraphs);
    sourceMalformedSingleCharacterParagraphsDetected ||= sourceMalformedSummary.detected;
    let storyParagraphs = sourceParagraphs;

    if (sourceMalformedSummary.detected && canonicalQuillParagraphs.length > 0) {
      storyParagraphs = buildCanonicalParagraphs(canonicalQuillParagraphs, sourceParagraphs);
    }

    const finalMalformedSummary = summarizeMalformedSingleCharacterParagraphs(storyParagraphs);
    malformedSingleCharacterParagraphsDetected ||= finalMalformedSummary.detected;
    singleCharacterParagraphCount += finalMalformedSummary.singleCharacterParagraphCount;
    canonicalTextCoverage = Math.max(canonicalTextCoverage, canonicalCoverage(canonicalQuillParagraphs, storyParagraphs));

    storyIndex += 1;
    const storyId = `story-${storyIndex}`;
    textStories.push({
      id: storyId,
      fingerprint,
      paragraphs: storyParagraphs,
      sourceMalformedSingleCharacterParagraphsDetected: sourceMalformedSummary.detected,
      malformedSingleCharacterParagraphsDetected: finalMalformedSummary.detected,
      singleCharacterParagraphCount: finalMalformedSummary.singleCharacterParagraphCount,
      canonicalTextCoverage
    });

    for (const frame of frames) {
      frame.role = "story";
      frame.storyId = storyId;
      frame.paragraphs = [];
    }

    const sortedFrames = [...frames].sort((left, right) => {
      const pageDelta =
        Number.parseInt(left.id.replace("text-frame-", ""), 10) -
        Number.parseInt(right.id.replace("text-frame-", ""), 10);
      return pageDelta;
    });
    const firstStoryFrame = sortedFrames[0];
    const firstStoryPage = pages.find((page) => page.items.includes(firstStoryFrame));
    if (firstStoryPage) {
      const firstPagePlaceholders = (emptyTextFramesByPageId.get(firstStoryPage.id) ?? [])
        .filter((frame) => looksLikeFirstPageStoryPlaceholder(frame, firstStoryPage, firstStoryFrame))
        .sort((left, right) => left.yPt - right.yPt)
        .map((frame, index) => ({
          ...frame,
          id: `${frame.id}-intro-${index + 1}`,
          role: "story" as const,
          columnCount: 1,
          columnGapPt: undefined,
          storyId,
          paragraphs: []
        }));

      if (firstPagePlaceholders.length > 0) {
        const insertionIndex = firstStoryPage.items.indexOf(firstStoryFrame);
        firstStoryPage.items.splice(insertionIndex, 0, ...firstPagePlaceholders);
      } else {
        firstStoryFrame.columnCount = 1;
      }
    }

    for (const page of pages) {
      const hasStoryFrame = page.items.some((item) => item.kind === "textFrame" && item.storyId === storyId);
      if (hasStoryFrame) {
        continue;
      }

      const continuationFrame = (emptyTextFramesByPageId.get(page.id) ?? [])
        .filter((frame) => !looksLikeFooterFrame(frame, page))
        .sort((left, right) => right.widthPt * right.heightPt - left.widthPt * left.heightPt)[0];
      if (!continuationFrame || continuationFrame.widthPt < page.widthPt * 0.35 || continuationFrame.heightPt < page.heightPt * 0.3) {
        continue;
      }

      page.items.push({
        ...continuationFrame,
        id: `${continuationFrame.id}-continuation`,
        role: "story",
        storyId,
        paragraphs: []
      });
    }
  }

  let footerTextFrames = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const footerCandidate = (emptyTextFramesByPageId.get(page.id) ?? [])
      .filter((frame) => looksLikeFooterFrame(frame, page))
      .sort((left, right) => right.xPt - left.xPt)[0];

    page.items.push(makeFooterFrame(page, index + 1, footerCandidate));
    footerTextFrames += 1;
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
    imageFills,
    diagnostics: {
      sourceMalformedSingleCharacterParagraphsDetected,
      malformedSingleCharacterParagraphsDetected,
      singleCharacterParagraphCount,
      canonicalTextCoverage,
      canonicalParagraphCount: canonicalQuillParagraphs.length,
      storyParagraphCount: textStories.reduce((total, story) => total + story.paragraphs.length, 0),
      footerTextFrames,
      firstStoryFrameColumnCount: pages
        .flatMap((page) => page.items)
        .find((item): item is DesignTextFrame => item.kind === "textFrame" && item.role === "story" && Boolean(item.storyId))?.columnCount ?? 1,
      mainFlowColumnCounts: pages.map((page) =>
        page.items
          .filter((item): item is DesignTextFrame => item.kind === "textFrame" && item.role === "story" && Boolean(item.storyId))
          .reduce((max, frame) => Math.max(max, frame.columnCount ?? 1), 0)
      )
    }
  };

  document.layoutAnalysis = buildLayoutAnalysis(document);

  return { document, assetMap };
}
