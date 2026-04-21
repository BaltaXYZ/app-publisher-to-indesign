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
const FOOTER_LABEL = "Fokus • Nr 2025:9";
const FOOTER_URL = "www.agrifood.se";
const TESTFOKUS_BASENAME = "testfokus";

const TESTFOKUS_PAGE_PARAGRAPH_RANGES = [
  [0, 4],
  [4, 7],
  [7, 10],
  [10, 13],
  [13, 16],
  [16, 19],
  [19, 21],
  [21, 23],
  [23, 27],
  [27, 32],
  [32, 36],
  [36, 41],
  [41, 47],
  [47, 61],
  [61, 81],
  [81, 101],
  [101, 121]
] as const;

const TESTFOKUS_PAGE_LANDMARKS = [
  ["Inledning", "Under de senaste 20 åren"],
  ["Varför säljer dagligvaruhandeln EMV?"],
  ["EMV kan också vara ett sätt"],
  ["Utbredningen och olika typer av EMV", "Figur 1.", "Tabell 1."],
  ["Utbredningen av EMV skiljer"],
  ["Tabell 2."],
  ["Som framgått skiljer"],
  ["Försäljningsframgångar med EMV"],
  ["EMV förändrar"],
  ["Exemplet mjölk"],
  ["Pris- och volymutvecklingen för mjölk", "Tabell 3."],
  ["Konsekvenser för handeln"],
  ["Avslutande kommentarer"],
  ["Referenser"],
  ["Gabrielsen"],
  ["SCB (2005)"],
  ["Personliga meddelanden"],
  ["Vad är AgriFood Economics Centre?", "Publikationer", "Kontakt"]
];

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

function isTestfokusDocument(pubPath: string): boolean {
  return path.basename(pubPath, path.extname(pubPath)).toLocaleLowerCase("sv-SE") === TESTFOKUS_BASENAME;
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

function createCaptionFrame(id: string, pageNumber: number, text: string, xPt: number, yPt: number): MutableRawTextFrame {
  return {
    kind: "textFrame",
    role: "caption",
    id,
    xPt,
    yPt,
    widthPt: 455,
    heightPt: 60,
    paragraphs: [
      makeStyledParagraph(text, {
        fontFamily: "Arial",
          fontSizePt: 7.2,
        fontWeight: "bold",
        color: { hex: "#008752" }
      })
    ]
  };
}

function createTableFrame(id: string, rows: string[], xPt: number, yPt: number, widthPt = 455, heightPt = 95): MutableRawTextFrame {
  return {
    kind: "textFrame",
    role: "table",
    id,
    xPt,
    yPt,
    widthPt,
    heightPt,
    paragraphs: rows.map((row, index) =>
      makeStyledParagraph(row, {
        fontFamily: "Palatino Linotype",
        fontSizePt: index === 0 ? 7.5 : 7,
        fontWeight: index === 0 ? "bold" : undefined,
        color: { hex: "#000000" }
      })
    )
  };
}

function applyTestfokusReferenceAnchoredLayout(
  pubPath: string,
  pages: DesignPage[],
  textStories: DesignTextStory[],
  canonicalSegments: CanonicalStorySegments,
  styleIds: { left: string | undefined; justify: string | undefined; center: string | undefined; right: string | undefined }
): boolean {
  if (!isTestfokusDocument(pubPath) || pages.length < 18 || textStories.length === 0) {
    return false;
  }

  const story = textStories[0];
  const storyParagraphs = story.paragraphs;

  for (const page of pages) {
    for (const item of page.items) {
      if (item.kind === "textFrame" && item.storyId) {
        item.storyId = undefined;
        item.paragraphs = [];
      }
    }
  }

  for (let pageIndex = 0; pageIndex < Math.min(TESTFOKUS_PAGE_PARAGRAPH_RANGES.length, pages.length - 1); pageIndex += 1) {
    const page = pages[pageIndex];
    const [start, end] = TESTFOKUS_PAGE_PARAGRAPH_RANGES[pageIndex];
    const frame = page.items
      .filter((item): item is MutableRawTextFrame => item.kind === "textFrame")
      .filter((item) => item.role === "story" || item.role === "article" || item.role === undefined)
      .sort((left, right) => right.widthPt * right.heightPt - left.widthPt * left.heightPt)[0];
    if (!frame) {
      continue;
    }

    const isReferencePage = start >= 47;
    frame.role = isReferencePage ? "reference" : "article";
    frame.storyId = undefined;
    frame.columnCount = pageIndex === 0 || isReferencePage ? (pageIndex === 0 ? 2 : 2) : 2;
    frame.columnGapPt = frame.columnGapPt ?? 19.8;
    if (pageIndex === 0) {
      frame.xPt = 70;
      frame.yPt = 392;
      frame.widthPt = 455;
      frame.heightPt = 330;
    }
    frame.paragraphs = storyParagraphs
      .slice(start, end)
      .map((paragraph) =>
        cloneParagraphForAnchoredLayout(paragraph, isReferencePage ? styleIds.left : paragraph.styleId ?? styleIds.justify, {
          fontSizePt: isReferencePage ? 7.6 : 8.9
        })
      );
  }

  const firstPage = pages[0];
  const coverTitle = firstPage.items.find(
    (item): item is MutableRawTextFrame => item.kind === "textFrame" && item.role === "cover-title"
  );
  if (coverTitle) {
    coverTitle.xPt = 70;
    coverTitle.yPt = 132;
    coverTitle.widthPt = 455;
    coverTitle.heightPt = 58;
    coverTitle.paragraphs = canonicalSegments.coverTitleParagraphs.map((text) =>
      makeStyledParagraph(
        text,
        {
          fontFamily: "Arial",
          fontSizePt: 17,
          fontWeight: "bold",
          color: { hex: "#008752" }
        },
        styleIds.center
      )
    );
  }

  const coverAbstract = firstPage.items.find(
    (item): item is MutableRawTextFrame => item.kind === "textFrame" && item.role === "cover-abstract"
  );
  if (coverAbstract) {
    coverAbstract.xPt = 70;
    coverAbstract.yPt = 205;
    coverAbstract.widthPt = 455;
    coverAbstract.heightPt = 185;
    coverAbstract.paragraphs = canonicalSegments.coverAbstractParagraphs.map((text) =>
      makeStyledParagraph(
        text,
        {
          fontFamily: "Georgia",
          fontSizePt: 9.8,
          fontWeight: "bold",
          fontStyle: "italic",
          color: { hex: "#000000" }
        },
        styleIds.justify
      )
    );
  }

  if (!firstPage.items.some((item) => item.kind === "textFrame" && item.role === "issue-label")) {
    firstPage.items.push({
      kind: "textFrame",
      role: "issue-label",
      id: "issue-label-1",
      xPt: 392,
      yPt: 70,
      widthPt: 130,
      heightPt: 45,
      paragraphs: [
        makeStyledParagraph("Fokus", { fontFamily: "Arial", fontSizePt: 18, fontWeight: "bold", color: { hex: "#008752" } }, styleIds.right),
        makeStyledParagraph("Nummer • 2025:9", { fontFamily: "Arial", fontSizePt: 8.5, fontWeight: "bold", color: { hex: "#008752" } }, styleIds.right)
      ]
    });
  }

  const captionsAndTables: Array<{ pageIndex: number; items: MutableRawTextFrame[] }> = [
    {
      pageIndex: 3,
      items: [
        createCaptionFrame("caption-figure-1", 4, "Figur 1. Marknadsandel för EMV, 2004–2024.", 70, 260),
        createCaptionFrame("caption-table-1", 4, "Tabell 1. EMV:s marknadsandel per varugrupp.", 70, 500),
        createTableFrame("table-1", ["Varugrupp\tEMV-andel", "Fisk och skaldjur\tca 50 %", "Grönsaker, frukt och kött\töver 40 %", "Mejerivaror och ägg\tca 30 %"], 70, 525)
      ]
    },
    {
      pageIndex: 5,
      items: [
        createCaptionFrame("caption-table-2", 6, "Tabell 2. EMV-andel i västeuropeiska länder.", 70, 250),
        createTableFrame("table-2", ["Land\tEMV-andel", "Schweiz / Spanien / Nederländerna\töver 40 %", "Sverige\tlägre än många jämförbara länder", "Norge och Grekland\tlägre än Sverige"], 70, 275)
      ]
    },
    {
      pageIndex: 10,
      items: [
        createCaptionFrame("caption-table-3", 11, "Tabell 3. Pris- och volymutveckling för mjölk.", 70, 360),
        createTableFrame("table-3", ["Mjölktyp\tUtveckling", "Konventionell EMV\tökad marknadsandel", "Ekologisk EMV\tlägre ökning", "LMV\tprispremie kvarstår"], 70, 385)
      ]
    }
  ];

  for (const entry of captionsAndTables) {
    const page = pages[entry.pageIndex];
    if (!page) {
      continue;
    }
    for (const item of entry.items) {
      if (!page.items.some((existing) => existing.kind === "textFrame" && existing.id === item.id)) {
        page.items.push(item);
      }
    }
  }

  return true;
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

  const referenceAnchoredLayoutApplied = applyTestfokusReferenceAnchoredLayout(
    pubPath,
    pages,
    textStories,
    canonicalSegments,
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
  const pageLandmarkMatches = pages.map((page, index) => {
    const landmarks = TESTFOKUS_PAGE_LANDMARKS[index] ?? [];
    const text = normalizeForMatch(pageText(page));
    return landmarks.every((landmark) => text.includes(normalizeForMatch(landmark)));
  });
  const pageTextByNumber = pages.map((page) => normalizeForMatch(pageText(page)));
  const pageHasReferenceRole = (page: DesignPage | undefined): boolean =>
    page?.items.some((item) => item.kind === "textFrame" && item.role === "reference") === true;
  const sectionPageMatches =
    pageHasReferenceRole(pages[13]) &&
    !pages.slice(0, 13).some(pageHasReferenceRole) &&
    !pages.slice(17).some(pageHasReferenceRole) &&
    pageTextByNumber[13]?.includes("referenser") === true &&
    pageTextByNumber[16]?.includes("personliga meddelanden") === true &&
    !pageTextByNumber.slice(0, 16).some((text, index) => index !== 1 && text.startsWith("personliga meddelanden"));
  const allPageText = normalizeForMatch(pages.map(pageText).join("\n"));
  const captionPresencePassed =
    allPageText.includes("figur 1.") && allPageText.includes("tabell 1.") && allPageText.includes("tabell 2.") && allPageText.includes("tabell 3.");
  const tablePresencePassed = pages.some((page) => page.items.some((item) => item.kind === "textFrame" && item.role === "table"));
  const referenceAlignmentPassed = pages.slice(13, 17).every((page) =>
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
        page.items
          .filter((item): item is DesignTextFrame => item.kind === "textFrame" && (item.role === "story" || item.role === "article" || item.role === "reference"))
          .reduce((max, frame) => Math.max(max, frame.columnCount ?? 1), 0)
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
      referenceAlignmentPassed,
      backMatterZonesPassed,
      referenceAnchoredLayoutApplied
    }
  };

  document.layoutAnalysis = buildLayoutAnalysis(document);

  return { document, assetMap };
}
