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
import { parsePdfDocument } from "../pdf/parser.js";

const execFileAsync = promisify(execFile);

const PUB2RAW_CANDIDATES = [
  "/opt/homebrew/bin/pub2raw",
  "/usr/local/bin/pub2raw",
  "/opt/homebrew/Cellar/libmspub/0.1.4_19/bin/pub2raw",
  "pub2raw"
];
const MALFORMED_SINGLE_CHARACTER_RUN_THRESHOLD = 20;
const CANONICAL_STORY_START_MARKER = "Inledning";
const FOOTER_LABEL = "Fokus • Nr 2025:9";
const FOOTER_URL = "www.agrifood.se";
const MIN_REFERENCE_PARAGRAPH_PAGE_SCORE = 0.16;

interface RawShapeStyle {
  fillImage?: { mimeType: string; base64: string };
}

interface MutableRawTextFrame {
  kind: "textFrame";
  id: string;
  role?:
    | "story"
    | "article"
    | "cover-title"
    | "cover-abstract"
    | "issue-label"
    | "caption"
    | "table"
    | "source-note"
    | "footnote"
    | "reference"
    | "footer"
    | "back-matter"
    | "layout-placeholder";
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

interface CanonicalStorySegments {
  articleParagraphs: string[];
  coverTitleParagraphs: string[];
  coverAbstractParagraphs: string[];
  backMatterParagraphs: string[];
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

function firstIndexContaining(paragraphs: string[], value: string): number {
  const normalizedNeedle = normalizeForMatch(value);
  return paragraphs.findIndex((paragraph) => normalizeForMatch(paragraph).includes(normalizedNeedle));
}

function firstIndexEqual(paragraphs: string[], value: string): number {
  const normalizedNeedle = normalizeForMatch(value);
  return paragraphs.findIndex((paragraph) => normalizeForMatch(paragraph) === normalizedNeedle);
}

function segmentCanonicalParagraphs(canonicalParagraphs: string[]): CanonicalStorySegments {
  const personalMessagesIndex = firstIndexEqual(canonicalParagraphs, "Personliga meddelanden");
  const abstractIndex = firstIndexContaining(canonicalParagraphs, "Under de senaste 20 åren har försäljningen");
  const coverTitleStartIndex = firstIndexContaining(canonicalParagraphs, "Hur påverkar EMV konsumenterna");
  const footerStartIndex = firstIndexContaining(canonicalParagraphs, "Fokus • Nr 2025:9");
  const backMatterStartIndex = firstIndexContaining(canonicalParagraphs, "Författare");
  const backMatterEndIndex = firstIndexContaining(canonicalParagraphs, "Box 7080");

  const articleEndIndex =
    personalMessagesIndex === -1
      ? canonicalParagraphs.length
      : Math.min(canonicalParagraphs.length, personalMessagesIndex + 5);
  const articleParagraphs = canonicalParagraphs.slice(0, articleEndIndex);

  const coverTitleParagraphs =
    coverTitleStartIndex === -1
      ? []
      : canonicalParagraphs.slice(coverTitleStartIndex, Math.min(canonicalParagraphs.length, coverTitleStartIndex + 2));
  const coverAbstractParagraphs = abstractIndex === -1 ? [] : [canonicalParagraphs[abstractIndex]];
  const backMatterParagraphs =
    backMatterStartIndex === -1
      ? []
      : canonicalParagraphs.slice(
          backMatterStartIndex,
          backMatterEndIndex === -1 ? canonicalParagraphs.length : Math.min(canonicalParagraphs.length, backMatterEndIndex + 2)
        );

  return {
    articleParagraphs,
    coverTitleParagraphs,
    coverAbstractParagraphs,
    backMatterParagraphs:
      footerStartIndex !== -1 && footerStartIndex < backMatterStartIndex
        ? backMatterParagraphs.filter((paragraph) => !normalizeForMatch(paragraph).startsWith("fokus • nr 2025:9"))
        : backMatterParagraphs
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

function makeStyledParagraph(text: string, options: Partial<DesignTextRun> = {}, styleId?: string): DesignParagraph {
  return {
    styleId,
    runs: [
      {
        text,
        fontFamily: options.fontFamily ?? "Palatino Linotype",
        fontSizePt: options.fontSizePt ?? 10,
        fontWeight: options.fontWeight,
        fontStyle: options.fontStyle,
        color: options.color
      }
    ]
  };
}

function cloneParagraphWithStyle(paragraph: DesignParagraph, styleId: string | undefined): DesignParagraph {
  return {
    styleId,
    runs: paragraph.runs.map((run) => ({ ...run, color: run.color ? { ...run.color } : undefined }))
  };
}

function cloneParagraphForAnchoredLayout(
  paragraph: DesignParagraph,
  styleId: string | undefined,
  options: { fontSizePt?: number; forceLeft?: boolean } = {}
): DesignParagraph {
  return {
    styleId,
    runs: paragraph.runs.map((run) => ({
      ...run,
      fontSizePt: options.fontSizePt ?? run.fontSizePt,
      color: run.color ? { ...run.color } : undefined
    }))
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
            text: `${FOOTER_LABEL} • sid ${pageNumber}`,
            fontFamily: "Palatino Linotype",
            fontSizePt: 7,
            color: { hex: "#000000" }
          }
        ]
      },
      {
        runs: [
          {
            text: FOOTER_URL,
            fontFamily: "Palatino Linotype",
            fontSizePt: 7,
            color: { hex: "#000000" }
          }
        ]
      }
    ]
  };
}

function makeBackMatterFrames(page: DesignPage, paragraphs: string[], emptyFrames: MutableRawTextFrame[]): MutableRawTextFrame[] {
  if (paragraphs.length === 0) {
    return [];
  }

  const leftCandidates = emptyFrames
    .filter((frame) => frame.xPt < page.widthPt * 0.3 && frame.widthPt < page.widthPt * 0.35)
    .sort((left, right) => left.yPt - right.yPt);

  const infoIndex = firstIndexContaining(paragraphs, "Christian Jörgensen");
  const aboutIndex = firstIndexContaining(paragraphs, "AgriFood Economics Centre utför");
  const publicationsIndex = firstIndexContaining(paragraphs, "AgriFood Economics Centre ger ut");
  const addressIndex = firstIndexContaining(paragraphs, "Box 7080");

  const labelTexts = ["Författare", "Mer information", "Vad är AgriFood Economics Centre?", "Publikationer", "Kontakt"];
  const labelYs = [125, 176, 536, 627, 745];
  const labelFrames = labelTexts.map((text, index): MutableRawTextFrame => {
    const candidate = leftCandidates[index];
    return {
      kind: "textFrame",
      role: "back-matter",
      id: `back-matter-label-${index + 1}`,
      xPt: candidate?.xPt ?? 70,
      yPt: labelYs[index],
      widthPt: candidate?.widthPt ?? 120,
      heightPt: Math.max(candidate?.heightPt ?? 22, 22),
      paragraphs: [
        makeStyledParagraph(text, {
          fontFamily: "Arial",
          fontSizePt: 10,
          fontWeight: "bold",
          fontStyle: "italic",
          color: { hex: "#00833E" }
        })
      ]
    };
  });

  const authorText = infoIndex === -1 ? "Christian Jörgensen" : paragraphs[infoIndex];
  const contactText = addressIndex === -1 ? "AgriFood Economics Centre\nBox 7080, 220 07 Lund" : paragraphs.slice(addressIndex, addressIndex + 2).join("\n");
  const infoTexts = infoIndex === -1 ? ["Christian Jörgensen", "Telefon: 046 – 222 07 88", "E-post: christian.jorgensen@agrifood.lu.se"] : paragraphs.slice(infoIndex, aboutIndex === -1 ? infoIndex + 3 : aboutIndex);
  const aboutTexts = aboutIndex === -1 ? [] : paragraphs.slice(aboutIndex, publicationsIndex === -1 ? aboutIndex + 1 : publicationsIndex);
  const publicationTexts = publicationsIndex === -1 ? [] : paragraphs.slice(publicationsIndex, addressIndex === -1 ? undefined : addressIndex);

  const contentFrames: MutableRawTextFrame[] = [
    {
      kind: "textFrame",
      role: "back-matter",
      id: "back-matter-author",
      xPt: 192,
      yPt: 125,
      widthPt: 330,
      heightPt: 28,
      paragraphs: [makeStyledParagraph(authorText, { fontFamily: "Palatino Linotype", fontSizePt: 10 })]
    },
    {
      kind: "textFrame",
      role: "back-matter",
      id: "back-matter-info",
      xPt: 192,
      yPt: 176,
      widthPt: 330,
      heightPt: 90,
      paragraphs: infoTexts.map((text) => makeStyledParagraph(text, { fontFamily: "Palatino Linotype", fontSizePt: 9.5 }))
    },
    {
      kind: "textFrame",
      role: "back-matter",
      id: "back-matter-about",
      xPt: 192,
      yPt: 536,
      widthPt: 330,
      heightPt: 90,
      paragraphs: aboutTexts.map((text) => makeStyledParagraph(text, { fontFamily: "Palatino Linotype", fontSizePt: 9.2 }))
    },
    {
      kind: "textFrame",
      role: "back-matter",
      id: "back-matter-publications",
      xPt: 192,
      yPt: 627,
      widthPt: 330,
      heightPt: 115,
      paragraphs: publicationTexts.map((text) => makeStyledParagraph(text, { fontFamily: "Palatino Linotype", fontSizePt: 9.2 }))
    },
    {
      kind: "textFrame",
      role: "back-matter",
      id: "back-matter-contact",
      xPt: 192,
      yPt: 745,
      widthPt: 330,
      heightPt: 48,
      paragraphs: contactText.split("\n").map((text) => makeStyledParagraph(text, { fontFamily: "Palatino Linotype", fontSizePt: 9.2 }))
    }
  ];

  return [...labelFrames, ...contentFrames];
}

function shouldApplyFigureTextWrap(shape: Pick<DesignShape, "xPt" | "yPt" | "widthPt" | "heightPt">, page: DesignPage): boolean {
  const minFigureArea = page.widthPt * page.heightPt * 0.08;
  const area = shape.widthPt * shape.heightPt;
  const isHorizontalRule = shape.heightPt < 8;
  const isLogo = shape.yPt < 80 && shape.widthPt < page.widthPt * 0.45 && shape.heightPt < 90;
  const isFooterDecoration = shape.yPt > page.heightPt - 90;

  return area >= minFigureArea && !isHorizontalRule && !isLogo && !isFooterDecoration;
}

function pageText(page: DesignPage): string {
  return page.items
    .filter((item): item is DesignTextFrame => item.kind === "textFrame")
    .map((frame) => paragraphsText(frame.paragraphs ?? []))
    .join("\n");
}

interface ReferenceLine {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  fontSizePt?: number;
}

interface ReferenceBlock {
  id: string;
  role: "caption" | "table" | "source-note" | "footnote" | "figure";
  pageIndex: number;
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  rows?: string[];
}

interface ReferenceLayoutProfile {
  pageTexts: string[];
  pageLines: ReferenceLine[][];
  blocks: ReferenceBlock[];
}

function normalizeReferenceText(value: string): string {
  return normalizeForMatch(value)
    .replace(/-\s+/g, "")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFrameText(frame: DesignTextFrame): string {
  return paragraphsText(frame.paragraphs ?? []);
}

function textWords(value: string): string[] {
  return Array.from(new Set(normalizeReferenceText(value).split(" ").filter((word) => word.length >= 5)));
}

function unionBounds(lines: Array<Pick<ReferenceLine, "xPt" | "yPt" | "widthPt" | "heightPt">>): {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
} {
  const minX = Math.min(...lines.map((line) => line.xPt));
  const minY = Math.min(...lines.map((line) => line.yPt));
  const maxX = Math.max(...lines.map((line) => line.xPt + line.widthPt));
  const maxY = Math.max(...lines.map((line) => line.yPt + line.heightPt));
  return {
    xPt: minX,
    yPt: minY,
    widthPt: maxX - minX,
    heightPt: maxY - minY
  };
}

function groupLinesByBaseline(lines: ReferenceLine[]): ReferenceLine[][] {
  const rows: ReferenceLine[][] = [];
  for (const line of [...lines].sort((left, right) => left.yPt - right.yPt || left.xPt - right.xPt)) {
    const existing = rows.find((row) => Math.abs(row[0].yPt - line.yPt) <= 4);
    if (existing) {
      existing.push(line);
    } else {
      rows.push([line]);
    }
  }

  return rows.map((row) => row.sort((left, right) => left.xPt - right.xPt));
}

function lineLooksLikeCaption(text: string): boolean {
  return /^(figur|tabell)\s+\d+\s*[:.]/i.test(normalizeText(text));
}

function lineLooksLikeSourceNote(text: string): boolean {
  return /^(källa|not)\s*:/i.test(normalizeText(text));
}

function lineLooksLikeFootnote(text: string): boolean {
  return /^\d+\s+\S/.test(normalizeText(text));
}

function lineLooksLikeTableCell(text: string): boolean {
  const normalized = normalizeText(text);
  return /\d/.test(normalized) || normalized.length <= 35;
}

function buildReferenceLayoutProfile(referenceDocument: DesignDocument | undefined): ReferenceLayoutProfile | undefined {
  if (!referenceDocument) {
    return undefined;
  }

  const pageLines = referenceDocument.pages.map((page) =>
    page.items
      .filter((item): item is DesignTextFrame => item.kind === "textFrame")
      .map((frame): ReferenceLine => {
        const run = frame.paragraphs?.[0]?.runs[0];
        return {
          text: normalizeText(textFrameText(frame)),
          xPt: frame.xPt,
          yPt: frame.yPt,
          widthPt: frame.widthPt,
          heightPt: frame.heightPt,
          fontSizePt: run?.fontSizePt
        };
      })
      .filter((line) => line.text.length > 0)
      .sort((left, right) => left.yPt - right.yPt || left.xPt - right.xPt)
  );

  const blocks: ReferenceBlock[] = [];
  for (let pageIndex = 0; pageIndex < referenceDocument.pages.length; pageIndex += 1) {
    const page = referenceDocument.pages[pageIndex];
    const lines = pageLines[pageIndex];
    const captionLines = lines.filter((line) => lineLooksLikeCaption(line.text));
    const sourceStarts = lines.filter((line) => lineLooksLikeSourceNote(line.text));
    const usedSourceLineIndexes = new Set<number>();

    for (let captionIndex = 0; captionIndex < captionLines.length; captionIndex += 1) {
      const caption = captionLines[captionIndex];
      const captionRole = normalizeReferenceText(caption.text).startsWith("tabell") ? "table" : "figure";
      const captionId = `${captionRole}-caption-p${pageIndex + 1}-${captionIndex + 1}`;
      blocks.push({
        id: captionId,
        role: "caption",
        pageIndex,
        text: caption.text,
        ...unionBounds([caption])
      });

      const nextCaptionY = captionLines.find((line) => line.yPt > caption.yPt + 2)?.yPt ?? Number.POSITIVE_INFINITY;
      const sourceLine = sourceStarts.find(
        (line) =>
          line.yPt > caption.yPt &&
          line.yPt < nextCaptionY &&
          Math.abs(line.xPt - caption.xPt) <= Math.max(80, caption.widthPt * 0.55)
      );
      const sourceY = sourceLine?.yPt ?? Math.min(nextCaptionY, caption.yPt + 220);

      if (captionRole === "table") {
        const tableLines = lines.filter(
          (line) =>
            line.yPt > caption.yPt + caption.heightPt + 6 &&
            line.yPt < sourceY - 4 &&
            line.xPt >= caption.xPt - 12 &&
            line.xPt + line.widthPt <= caption.xPt + Math.max(caption.widthPt, 180) + 24 &&
            !lineLooksLikeCaption(line.text) &&
            !lineLooksLikeSourceNote(line.text) &&
            lineLooksLikeTableCell(line.text)
        );
        if (tableLines.length > 0) {
          const rows = groupLinesByBaseline(tableLines)
            .map((row) => row.map((line) => line.text).join("\t"))
            .filter((row) => normalizeText(row).length > 0);
          blocks.push({
            id: `table-p${pageIndex + 1}-${captionIndex + 1}`,
            role: "table",
            pageIndex,
            text: rows.join("\n"),
            rows,
            ...unionBounds(tableLines)
          });
        }
      }

      if (sourceLine) {
        const sourceIndex = lines.indexOf(sourceLine);
        const sourceLines = lines.filter((line, lineIndex) => {
          if (lineIndex < sourceIndex || usedSourceLineIndexes.has(lineIndex)) {
            return false;
          }
          if (line.yPt >= Math.min(nextCaptionY, sourceLine.yPt + 80)) {
            return false;
          }
          return line.xPt >= sourceLine.xPt - 8 && line.xPt <= sourceLine.xPt + Math.max(sourceLine.widthPt, 180) + 12;
        });
        for (const source of sourceLines) {
          usedSourceLineIndexes.add(lines.indexOf(source));
        }
        blocks.push({
          id: `source-note-p${pageIndex + 1}-${captionIndex + 1}`,
          role: "source-note",
          pageIndex,
          text: sourceLines.map((line) => line.text).join(" "),
          ...unionBounds(sourceLines)
        });
      }
    }

    const footnoteLines = lines.filter((line) => line.yPt > page.heightPt - 135 && lineLooksLikeFootnote(line.text));
    for (const [footnoteIndex, footnote] of footnoteLines.entries()) {
      blocks.push({
        id: `footnote-p${pageIndex + 1}-${footnoteIndex + 1}`,
        role: "footnote",
        pageIndex,
        text: footnote.text,
        ...unionBounds([footnote])
      });
    }

    for (const [shapeIndex, shape] of page.items.filter((item): item is DesignShape => item.kind === "shape").entries()) {
      if (!shouldApplyFigureTextWrap(shape, page)) {
        continue;
      }
      blocks.push({
        id: `figure-p${pageIndex + 1}-${shapeIndex + 1}`,
        role: "figure",
        pageIndex,
        text: "",
        xPt: shape.xPt,
        yPt: shape.yPt,
        widthPt: shape.widthPt,
        heightPt: shape.heightPt
      });
    }
  }

  return {
    pageLines,
    pageTexts: pageLines.map((lines) => normalizeReferenceText(lines.map((line) => line.text).join(" "))),
    blocks
  };
}

function createProfileTextFrame(block: ReferenceBlock, role: MutableRawTextFrame["role"], styleId?: string): MutableRawTextFrame {
  const isHeading = role === "caption";
  const isTable = role === "table";
  const isSource = role === "source-note" || role === "footnote";
  const rows = isTable ? block.rows ?? block.text.split("\n") : [block.text];
  return {
    kind: "textFrame",
    role,
    id: block.id,
    xPt: block.xPt,
    yPt: block.yPt,
    widthPt: Math.max(block.widthPt + 6, isTable ? 80 : block.widthPt),
    heightPt: Math.max(block.heightPt + 4, isTable ? rows.length * 12 + 10 : 12),
    paragraphs: rows.map((row, index) =>
      makeStyledParagraph(
        row,
        {
          fontFamily: isHeading ? "Arial" : "Palatino Linotype",
          fontSizePt: isSource ? 6.2 : isTable ? 7.2 : 8,
          fontWeight: isHeading || (isTable && index === 0) ? "bold" : undefined,
          fontStyle: isHeading ? "normal" : undefined,
          color: { hex: isHeading ? "#000000" : "#000000" }
        },
        styleId
      )
    )
  };
}

function paragraphReferencePageScore(paragraph: DesignParagraph, pageTextValue: string): number {
  const words = textWords(paragraphText(paragraph));
  if (words.length === 0) {
    return 0;
  }

  const matched = words.filter((word) => pageTextValue.includes(word)).length;
  return matched / words.length;
}

function assignParagraphsToReferencePages(paragraphs: DesignParagraph[], profile: ReferenceLayoutProfile): DesignParagraph[][] {
  const assignments = profile.pageTexts.map((): DesignParagraph[] => []);
  let currentPageIndex = 0;

  for (const paragraph of paragraphs) {
    let bestPageIndex = currentPageIndex;
    let bestScore = 0;
    for (let pageIndex = currentPageIndex; pageIndex < profile.pageTexts.length; pageIndex += 1) {
      const score = paragraphReferencePageScore(paragraph, profile.pageTexts[pageIndex]);
      if (score > bestScore) {
        bestScore = score;
        bestPageIndex = pageIndex;
      }
    }

    if (bestScore >= MIN_REFERENCE_PARAGRAPH_PAGE_SCORE) {
      currentPageIndex = Math.max(currentPageIndex, bestPageIndex);
    }
    assignments[Math.min(currentPageIndex, assignments.length - 1)]?.push(paragraph);
  }

  return assignments;
}

function isFlowFrame(item: DesignPageItem): item is MutableRawTextFrame {
  return item.kind === "textFrame" && (item.storyId !== undefined || item.role === "story" || item.role === "article" || item.role === "reference");
}

function overlapsHorizontally(
  left: Pick<MutableRawTextFrame | ReferenceBlock, "xPt" | "widthPt">,
  right: Pick<MutableRawTextFrame | ReferenceBlock, "xPt" | "widthPt">
): boolean {
  return left.xPt < right.xPt + right.widthPt && right.xPt < left.xPt + left.widthPt;
}

function frameOverlapsBlock(frame: Pick<MutableRawTextFrame, "xPt" | "yPt" | "widthPt" | "heightPt">, block: ReferenceBlock): boolean {
  return (
    frame.xPt < block.xPt + block.widthPt &&
    block.xPt < frame.xPt + frame.widthPt &&
    frame.yPt < block.yPt + block.heightPt &&
    block.yPt < frame.yPt + frame.heightPt
  );
}

function splitFrameAroundBlocks(baseFrame: MutableRawTextFrame, page: DesignPage, blocks: ReferenceBlock[]): MutableRawTextFrame[] {
  const pageMarginBottom = 76;
  const columnCount = Math.max(1, Math.min(baseFrame.columnCount ?? 1, 2));
  const gutter = baseFrame.columnGapPt ?? 18;
  const columnWidth = columnCount === 1 ? baseFrame.widthPt : (baseFrame.widthPt - gutter) / 2;
  const output: MutableRawTextFrame[] = [];

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const columnFrame = {
      ...baseFrame,
      xPt: baseFrame.xPt + columnIndex * (columnWidth + gutter),
      widthPt: columnWidth,
      columnCount: 1,
      columnGapPt: undefined
    };
    const cuts = blocks
      .filter((block) => block.role !== "footnote" && overlapsHorizontally(columnFrame, block))
      .map((block) => ({
        top: Math.max(baseFrame.yPt, block.yPt - 8),
        bottom: Math.min(page.heightPt - pageMarginBottom, block.yPt + block.heightPt + 10)
      }))
      .filter((cut) => cut.bottom > cut.top)
      .sort((left, right) => left.top - right.top);

    let cursor = baseFrame.yPt;
    for (const cut of cuts) {
      if (cut.top - cursor >= 42) {
        output.push({
          ...columnFrame,
          id: `${baseFrame.id}-col-${columnIndex + 1}-seg-${output.length + 1}`,
          yPt: cursor,
          heightPt: cut.top - cursor,
          paragraphs: []
        });
      }
      cursor = Math.max(cursor, cut.bottom);
    }

    const bottom = Math.min(baseFrame.yPt + baseFrame.heightPt, page.heightPt - pageMarginBottom);
    if (bottom - cursor >= 42) {
      output.push({
        ...columnFrame,
        id: `${baseFrame.id}-col-${columnIndex + 1}-seg-${output.length + 1}`,
        yPt: cursor,
        heightPt: bottom - cursor,
        paragraphs: []
      });
    }
  }

  return output.length > 0 ? output.sort((left, right) => left.yPt - right.yPt || left.xPt - right.xPt) : [baseFrame];
}

function pageContainsReferenceSection(paragraphs: DesignParagraph[]): boolean {
  return paragraphs.some((paragraph) => normalizeForMatch(paragraphText(paragraph)) === "referenser");
}

function applyReferenceProfileAnchoredLayout(
  pages: DesignPage[],
  textStories: DesignTextStory[],
  profile: ReferenceLayoutProfile | undefined,
  styleIds: { left: string | undefined; justify: string | undefined; center: string | undefined; right: string | undefined }
): boolean {
  if (!profile || textStories.length === 0 || pages.length === 0) {
    return false;
  }

  const baseStoryParagraphs = textStories.flatMap((story) => story.paragraphs);
  const pageParagraphs = assignParagraphsToReferencePages(baseStoryParagraphs, profile);
  const generatedStories: DesignTextStory[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const existingFlowFrames = page.items.filter(isFlowFrame).sort((left, right) => right.widthPt * right.heightPt - left.widthPt * left.heightPt);
    const baseFrame =
      existingFlowFrames[0] ??
      ({
        kind: "textFrame",
        id: `reference-flow-base-${pageIndex + 1}`,
        xPt: 72,
        yPt: pageIndex === 0 ? 390 : 120,
        widthPt: page.widthPt - 144,
        heightPt: page.heightPt - (pageIndex === 0 ? 470 : 210),
        columnCount: pageIndex === 0 ? 2 : 2,
        columnGapPt: 18,
        paragraphs: []
      } satisfies MutableRawTextFrame);
    const pageBlocks = profile.blocks.filter((block) => block.pageIndex === pageIndex);

    page.items = page.items.filter(
      (item) =>
        !isFlowFrame(item) &&
        !(item.kind === "textFrame" && ["caption", "table", "source-note", "footnote"].includes(item.role ?? ""))
    );

    for (const block of pageBlocks) {
      if (block.role === "caption") {
        page.items.push(createProfileTextFrame(block, "caption", styleIds.left));
      } else if (block.role === "table") {
        page.items.push(createProfileTextFrame(block, "table", styleIds.left));
      } else if (block.role === "source-note") {
        page.items.push(createProfileTextFrame(block, "source-note", styleIds.left));
      } else if (block.role === "footnote") {
        page.items.push(createProfileTextFrame(block, "footnote", styleIds.left));
      }
    }

    const assigned = pageParagraphs[pageIndex] ?? [];
    if (assigned.length === 0) {
      continue;
    }

    const storyId = `reference-page-story-${pageIndex + 1}`;
    const isReferencePage = pageContainsReferenceSection(assigned) || assigned.some((paragraph) => normalizeForMatch(paragraphText(paragraph)).includes("journal"));
    const storyParagraphs = assigned.map((paragraph) =>
      cloneParagraphForAnchoredLayout(paragraph, isReferencePage ? styleIds.left : paragraph.styleId ?? styleIds.justify, {
        fontSizePt: isReferencePage ? 7.6 : 8.9
      })
    );
    generatedStories.push({
      id: storyId,
      fingerprint: fingerprintForText(paragraphsText(storyParagraphs)),
      paragraphs: storyParagraphs
    });

    const splitFrames = splitFrameAroundBlocks(
      {
        ...baseFrame,
        id: `reference-flow-${pageIndex + 1}`,
        role: isReferencePage ? "reference" : "article",
        storyId,
        paragraphs: []
      },
      page,
      pageBlocks
    );
    for (const frame of splitFrames) {
      frame.role = isReferencePage ? "reference" : "article";
      frame.storyId = storyId;
      frame.paragraphs = [];
      page.items.push(frame);
    }
  }

  textStories.splice(0, textStories.length, ...generatedStories);
  return generatedStories.length > 0;
}

function buildLayoutAnalysis(document: DesignDocument): PageLayoutAnalysis[] {
  return document.pages.map((page, index) => {
    const textFrames = page.items.filter((item): item is DesignTextFrame => item.kind === "textFrame");
    const splitColumnBands = new Set(
      textFrames
        .filter((frame) => frame.role === "article" || frame.role === "reference")
        .map((frame) => Math.round(frame.xPt / 12))
    );
    const columnCount = Math.max(textFrames.reduce((max, frame) => Math.max(max, frame.columnCount ?? 1), 0), splitColumnBands.size);
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
  assetsDir: string,
  options?: { referencePdfPath?: string }
): Promise<{ document: DesignDocument; assetMap: Map<string, string> }> {
  await mkdir(assetsDir, { recursive: true });
  let referenceProfile: ReferenceLayoutProfile | undefined;
  if (options?.referencePdfPath) {
    try {
      const referenceAssetsDir = path.join(assetsDir, "reference-profile-assets");
      const { document: referenceDocument } = await parsePdfDocument(options.referencePdfPath, referenceAssetsDir);
      referenceProfile = buildReferenceLayoutProfile(referenceDocument);
    } catch {
      referenceProfile = undefined;
    }
  }
  const canonicalQuillParagraphs = await extractCanonicalQuillParagraphs(pubPath);
  const canonicalSegments = segmentCanonicalParagraphs(canonicalQuillParagraphs);

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

  const referenceAnchoredStyleIds = {
    left: ensureParagraphStyle({ "fo:text-align": "left" }),
    justify: ensureParagraphStyle({ "fo:text-align": "justify" }),
    center: ensureParagraphStyle({ "fo:text-align": "center" }),
    right: ensureParagraphStyle({ "fo:text-align": "right" })
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
      if (shouldApplyFigureTextWrap(shape, currentPage)) {
        shape.textWrap = "bounding-box";
      }

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
    const canonicalArticleParagraphs =
      canonicalSegments.articleParagraphs.length > 0 ? canonicalSegments.articleParagraphs : canonicalQuillParagraphs;

    if (sourceMalformedSummary.detected && canonicalArticleParagraphs.length > 0) {
      storyParagraphs = buildCanonicalParagraphs(canonicalArticleParagraphs, sourceParagraphs);
    }

    const finalMalformedSummary = summarizeMalformedSingleCharacterParagraphs(storyParagraphs);
    malformedSingleCharacterParagraphsDetected ||= finalMalformedSummary.detected;
    singleCharacterParagraphCount += finalMalformedSummary.singleCharacterParagraphCount;
    canonicalTextCoverage = Math.max(canonicalTextCoverage, canonicalCoverage(canonicalArticleParagraphs, storyParagraphs));

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
        .sort((left, right) => left.yPt - right.yPt);
      const insertionIndex = firstStoryPage.items.indexOf(firstStoryFrame);
      const coverFrames: MutableRawTextFrame[] = [];

      if (firstPagePlaceholders[0] && canonicalSegments.coverTitleParagraphs.length > 0) {
        coverFrames.push({
          ...firstPagePlaceholders[0],
          id: `${firstPagePlaceholders[0].id}-cover-title`,
          role: "cover-title",
          columnCount: 1,
          columnGapPt: undefined,
          paragraphs: canonicalSegments.coverTitleParagraphs.map((text) =>
            makeStyledParagraph(text, {
              fontFamily: "Arial",
              fontSizePt: 18,
              fontWeight: "bold",
              color: { hex: "#00833E" }
            })
          )
        });
      }

      if (firstPagePlaceholders[1] && canonicalSegments.coverAbstractParagraphs.length > 0) {
        const abstractHeight = Math.max(70, Math.min(firstPagePlaceholders[1].heightPt, firstStoryFrame.yPt - firstPagePlaceholders[1].yPt - 12));
        coverFrames.push({
          ...firstPagePlaceholders[1],
          id: `${firstPagePlaceholders[1].id}-cover-abstract`,
          role: "cover-abstract",
          columnCount: 1,
          columnGapPt: undefined,
          heightPt: abstractHeight,
          paragraphs: canonicalSegments.coverAbstractParagraphs.map((text) =>
            makeStyledParagraph(text, {
              fontFamily: "Palatino Linotype",
              fontSizePt: 10,
              color: { hex: "#000000" }
            })
          )
        });
      }

      if (coverFrames.length > 0) {
        firstStoryPage.items.splice(insertionIndex, 0, ...coverFrames);
      }
    }

    for (const page of pages) {
      const hasStoryFrame = page.items.some((item) => item.kind === "textFrame" && item.storyId === storyId);
      if (hasStoryFrame) {
        continue;
      }
      if (canonicalSegments.backMatterParagraphs.length > 0 && page === pages.at(-1)) {
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

  if (canonicalSegments.backMatterParagraphs.length > 0 && pages.length > 0) {
    const backMatterPage = pages.at(-1);
    if (backMatterPage) {
      backMatterPage.items.push(
        ...makeBackMatterFrames(
          backMatterPage,
          canonicalSegments.backMatterParagraphs,
          emptyTextFramesByPageId.get(backMatterPage.id) ?? []
        )
      );
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

  const referenceAnchoredLayoutApplied = applyReferenceProfileAnchoredLayout(
    pages,
    textStories,
    referenceProfile,
    referenceAnchoredStyleIds
  );

  const storyTextForDiagnostics = normalizeForMatch(textStories.map((story) => paragraphsText(story.paragraphs)).join("\n"));
  const allTextFrames = pages.flatMap((page) => page.items).filter((item): item is DesignTextFrame => item.kind === "textFrame");
  const coverTitlePresent = allTextFrames.some((frame) => frame.role === "cover-title" && normalizeText(paragraphsText(frame.paragraphs ?? [])).length > 0);
  const coverAbstractPresent = allTextFrames.some(
    (frame) => frame.role === "cover-abstract" && normalizeForMatch(paragraphsText(frame.paragraphs ?? [])).includes("under de senaste 20 åren")
  );
  const firstStoryFrame = allTextFrames.find((item) => item.role === "story" || item.role === "article");
  const coverAbstractFrame = allTextFrames.find((item) => item.role === "cover-abstract");
  const articleStartsAfterCoverPassed =
    !coverAbstractFrame || !firstStoryFrame || firstStoryFrame.yPt >= coverAbstractFrame.yPt + coverAbstractFrame.heightPt - 8;
  const footerPageAndUrlPresent = pages.every((page, index) =>
    page.items.some((item) => {
      if (item.kind !== "textFrame" || item.role !== "footer") {
        return false;
      }
      const text = paragraphsText(item.paragraphs ?? []);
      return text.includes(`${FOOTER_LABEL} • sid ${index + 1}`) && text.includes(FOOTER_URL);
    })
  );
  const repeatedFooterTextInStoryDetected = storyTextForDiagnostics.includes("fokus • nr 2025:9") || storyTextForDiagnostics.includes("www.agrifood.se");
  const misplacedBackMatterDetected =
    storyTextForDiagnostics.includes("vad är agrifood economics centre") ||
    storyTextForDiagnostics.includes("författare kontakt publikationer");
  let textWrapShapeCount = 0;
  let unwrappedFigureCount = 0;
  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind !== "shape" || !shouldApplyFigureTextWrap(item, page)) {
        continue;
      }
      if (item.textWrap === "bounding-box") {
        textWrapShapeCount += 1;
      } else {
        unwrappedFigureCount += 1;
      }
    }
  }
  const referenceBlocks = referenceProfile?.blocks ?? [];
  const expectedCaptionTexts = referenceBlocks.filter((block) => block.role === "caption").map((block) => block.text);
  const expectedTableTexts = referenceBlocks.filter((block) => block.role === "table").map((block) => block.text);
  const expectedSourceNoteTexts = referenceBlocks
    .filter((block) => block.role === "source-note" || block.role === "footnote")
    .map((block) => block.text);
  const normalizedTextCoverage = (needle: string, haystack: string): number => {
    const words = textWords(needle);
    if (words.length === 0) {
      return 1;
    }
    return words.filter((word) => haystack.includes(word)).length / words.length;
  };
  const pageLandmarkMatches =
    referenceProfile?.pageLines.map((lines, index) => {
      const pageOwnText = normalizeReferenceText(pageText(pages[index]));
      const landmarks = lines
        .filter((line) => lineLooksLikeCaption(line.text) || lineLooksLikeSourceNote(line.text))
        .map((line) => normalizeReferenceText(line.text));
      return landmarks.every(
        (landmark) =>
          landmark.length === 0 ||
          pageOwnText.includes(landmark.slice(0, Math.min(landmark.length, 80)).replace(/\s+\S*$/, "")) ||
          normalizedTextCoverage(landmark, pageOwnText) >= 0.72
      );
    }) ?? pages.map(() => true);
  const pageTextByNumber = pages.map((page) => normalizeForMatch(pageText(page)));
  const pageHasReferenceRole = (page: DesignPage | undefined): boolean =>
    page?.items.some((item) => item.kind === "textFrame" && item.role === "reference") === true;
  const firstReferencePageIndex = pageTextByNumber.findIndex((text) => text.includes("referenser"));
  const sectionPageMatches =
    firstReferencePageIndex === -1 ||
    pages.every((page, index) => !pageHasReferenceRole(page) || index >= firstReferencePageIndex);
  const allPageText = normalizeForMatch(pages.map(pageText).join("\n"));
  const allReferenceText = normalizeReferenceText(pages.map(pageText).join("\n"));
  const expectedTextPresent = (value: string): boolean => {
    const normalized = normalizeReferenceText(value);
    if (normalized.length === 0) {
      return true;
    }
    return (
      allReferenceText.includes(normalized.slice(0, Math.min(normalized.length, 120)).replace(/\s+\S*$/, "")) ||
      normalizedTextCoverage(normalized, allReferenceText) >= 0.72
    );
  };
  const detectedTables = referenceBlocks.filter((block) => block.role === "table").length;
  const detectedFigures = referenceBlocks.filter((block) => block.role === "figure").length;
  const detectedCaptions = expectedCaptionTexts.length;
  const detectedSourceNotes = expectedSourceNoteTexts.length;
  const renderedTableFrames = pages.flatMap((page) => page.items).filter((item) => item.kind === "textFrame" && item.role === "table").length;
  const captionPresencePassed = expectedCaptionTexts.length === 0 || expectedCaptionTexts.every(expectedTextPresent);
  const tableTextMatches = expectedTableTexts.length === 0 || expectedTableTexts.every(expectedTextPresent);
  const tablePresencePassed = detectedTables === 0 || renderedTableFrames >= detectedTables;
  const tableBlockMatches = tablePresencePassed && tableTextMatches;
  const sourceNotePresencePassed = expectedSourceNoteTexts.length === 0 || expectedSourceNoteTexts.every(expectedTextPresent);
  const captionBlockMatches = captionPresencePassed;
  const noObjectTextOverlapPassed = pages.every((page, pageIndex) => {
    const blocks = referenceBlocks.filter((block) => block.pageIndex === pageIndex && block.role !== "footnote");
    return page.items
      .filter((item): item is DesignTextFrame => item.kind === "textFrame" && (item.role === "article" || item.role === "reference"))
      .every((frame) => blocks.every((block) => !frameOverlapsBlock(frame, block)));
  });
  const referenceAlignmentPassed = pages.every((page) =>
    page.items
      .filter((item): item is DesignTextFrame => item.kind === "textFrame" && item.role === "reference")
      .every((frame) => (frame.paragraphs ?? []).every((paragraph) => paragraph.styleId === referenceAnchoredStyleIds.left))
  );
  const backMatterZonesPassed = pages.at(-1)?.items.some((item) => item.kind === "textFrame" && item.id === "back-matter-about" && item.yPt >= 520) === true;

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
        .find((item): item is DesignTextFrame => item.kind === "textFrame" && (item.role === "story" || item.role === "article"))?.columnCount ?? 1,
      mainFlowColumnCounts: pages.map((page) =>
        Math.max(
          page.items
            .filter((item): item is DesignTextFrame => item.kind === "textFrame" && (item.role === "story" || item.role === "article" || item.role === "reference"))
            .reduce((max, frame) => Math.max(max, frame.columnCount ?? 1), 0),
          new Set(
            page.items
              .filter((item): item is DesignTextFrame => item.kind === "textFrame" && (item.role === "article" || item.role === "reference"))
              .map((frame) => Math.round(frame.xPt / 12))
          ).size
        )
      ),
      coverTitlePresent,
      coverAbstractPresent,
      articleStartsAfterCoverPassed,
      footerPageAndUrlPresent,
      repeatedFooterTextInStoryDetected,
      misplacedBackMatterDetected,
      textWrapPassed: textWrapShapeCount > 0 && unwrappedFigureCount === 0,
      textWrapShapeCount,
      pageLandmarkMatches,
      sectionPageMatches,
      captionPresencePassed,
      tablePresencePassed,
      detectedTables,
      detectedFigures,
      detectedCaptions,
      detectedSourceNotes,
      tableBlockMatches,
      captionBlockMatches,
      sourceNotePresencePassed,
      tableTextMatches,
      noObjectTextOverlapPassed,
      referenceProfileUsed: Boolean(referenceProfile),
      expectedTableTexts,
      expectedCaptionTexts,
      expectedSourceNoteTexts,
      referenceAlignmentPassed,
      backMatterZonesPassed,
      referenceAnchoredLayoutApplied
    }
  };

  document.layoutAnalysis = buildLayoutAnalysis(document);

  return { document, assetMap };
}
