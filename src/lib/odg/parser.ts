import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

import type {
  DesignCharacterStyle,
  DesignColor,
  DesignDocument,
  DesignGraphicStyle,
  DesignImageFill,
  DesignPage,
  DesignPageItem,
  DesignParagraph,
  DesignParagraphStyle,
  DesignShape,
  DesignTextFrame,
  DesignTextRun
} from "./types.js";

const CM_TO_PT = 28.3464566929;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false
});

type UnknownRecord = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): UnknownRecord {
  return (value ?? {}) as UnknownRecord;
}

function readZipText(zip: AdmZip, entryName: string): string {
  const entry = zip.getEntry(entryName);

  if (!entry) {
    throw new Error(`Missing ODG entry: ${entryName}`);
  }

  return zip.readAsText(entry, "utf8");
}

function cmStringToPt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  if (value.endsWith("cm")) {
    return Number.parseFloat(value.slice(0, -2)) * CM_TO_PT;
  }

  if (value.endsWith("pt")) {
    return Number.parseFloat(value.slice(0, -2));
  }

  return Number.parseFloat(value);
}

function parseColor(value: string | undefined): DesignColor | undefined {
  if (!value) {
    return undefined;
  }

  return { hex: value };
}

function collectTextNodes(node: unknown): DesignTextRun[] {
  if (typeof node === "string") {
    return node.length > 0 ? [{ text: node }] : [];
  }

  const record = asRecord(node);
  const styleId = typeof record["text:style-name"] === "string" ? String(record["text:style-name"]) : undefined;

  const spanRuns = asArray(record.span).flatMap((span) => {
    const spanRecord = asRecord(span);
    const spanStyleId =
      typeof spanRecord["text:style-name"] === "string" ? String(spanRecord["text:style-name"]) : styleId;
    const text = [spanRecord["#text"], spanRecord["__text"]]
      .filter((value): value is string => typeof value === "string")
      .join("");

    return text.length > 0 ? [{ text, characterStyleId: spanStyleId }] : [];
  });

  const directText = [record["#text"], record["__text"]]
    .filter((value): value is string => typeof value === "string")
    .join("");

  const lineBreaks = asArray(record["line-break"]).map<DesignTextRun>(() => ({ text: "\n", characterStyleId: styleId }));

  const directRuns = directText.length > 0 ? [{ text: directText, characterStyleId: styleId }] : [];

  return [...directRuns, ...spanRuns, ...lineBreaks];
}

function collectParagraphs(textBox: unknown): DesignParagraph[] {
  const record = asRecord(textBox);

  return asArray(record.p).map((paragraphNode): DesignParagraph => {
    const paragraphRecord = asRecord(paragraphNode);
    const styleId =
      typeof paragraphRecord["text:style-name"] === "string"
        ? String(paragraphRecord["text:style-name"])
        : undefined;
    const runs = collectTextNodes(paragraphNode);

    return {
      styleId,
      runs: runs.length > 0 ? runs : [{ text: "", characterStyleId: styleId }]
    };
  });
}

function extractPageLayout(stylesDoc: UnknownRecord): { widthPt: number; heightPt: number } {
  const officeStyles = asRecord(stylesDoc["document-styles"]);
  const automaticStyles = asRecord(officeStyles["automatic-styles"]);
  const pageLayout = asArray(automaticStyles["page-layout"])[0];
  const props = asRecord(asRecord(pageLayout)["page-layout-properties"]);

  return {
    widthPt: cmStringToPt(String(props["fo:page-width"] ?? props["page-width"] ?? "21cm")) ?? 595.28,
    heightPt: cmStringToPt(String(props["fo:page-height"] ?? props["page-height"] ?? "29.7cm")) ?? 841.89
  };
}

function extractImageFills(stylesDoc: UnknownRecord): DesignImageFill[] {
  const officeStyles = asRecord(stylesDoc["document-styles"]);
  const stylesRoot = asRecord(officeStyles.styles);

  return asArray(stylesRoot["fill-image"]).map((entry) => {
    const record = asRecord(entry);

    return {
      name: String(record["draw:name"] ?? record.name),
      path: String(record["xlink:href"] ?? record.href)
    };
  });
}

function extractParagraphStyles(contentDoc: UnknownRecord): DesignParagraphStyle[] {
  const automaticStyles = asRecord(asRecord(contentDoc["document-content"])["automatic-styles"]);

  return asArray(automaticStyles.style)
    .map((style) => asRecord(style))
    .filter((style) => style["style:family"] === "paragraph" || style.family === "paragraph")
    .map((style): DesignParagraphStyle => {
      const id = String(style["style:name"] ?? style.name);
      const paragraphProps = asRecord(style["paragraph-properties"]);

      return {
        id,
        align: (paragraphProps["fo:text-align"] ?? paragraphProps["text-align"]) as string | undefined,
        marginTopPt: cmStringToPt((paragraphProps["fo:margin-top"] ?? paragraphProps["margin-top"]) as string | undefined),
        marginBottomPt: cmStringToPt(
          (paragraphProps["fo:margin-bottom"] ?? paragraphProps["margin-bottom"]) as string | undefined
        ),
        lineHeight: (paragraphProps["fo:line-height"] ?? paragraphProps["line-height"]) as string | undefined
      };
    });
}

function extractCharacterStyles(contentDoc: UnknownRecord): DesignCharacterStyle[] {
  const automaticStyles = asRecord(asRecord(contentDoc["document-content"])["automatic-styles"]);

  return asArray(automaticStyles.style)
    .map((style) => asRecord(style))
    .filter((style) => style["style:family"] === "text" || style.family === "text")
    .map((style): DesignCharacterStyle => {
      const id = String(style["style:name"] ?? style.name);
      const textProps = asRecord(style["text-properties"]);

      return {
        id,
        fontFamily: (textProps["style:font-name"] ?? textProps["font-name"]) as string | undefined,
        fontSizePt: cmStringToPt((textProps["fo:font-size"] ?? textProps["font-size"]) as string | undefined),
        fontWeight: (textProps["fo:font-weight"] ?? textProps["font-weight"]) as string | undefined,
        fontStyle: (textProps["fo:font-style"] ?? textProps["font-style"]) as string | undefined,
        color: parseColor((textProps["fo:color"] ?? textProps["color"]) as string | undefined)
      };
    });
}

function extractGraphicStyles(contentDoc: UnknownRecord): DesignGraphicStyle[] {
  const automaticStyles = asRecord(asRecord(contentDoc["document-content"])["automatic-styles"]);

  return asArray(automaticStyles.style)
    .map((style) => asRecord(style))
    .filter((style) => style["style:family"] === "graphic" || style.family === "graphic")
    .map((style): DesignGraphicStyle => {
      const id = String(style["style:name"] ?? style.name);
      const graphicProps = asRecord(style["graphic-properties"]);

      return {
        id,
        fill: (graphicProps["draw:fill"] ?? graphicProps.fill) as "none" | "solid" | "bitmap" | undefined,
        fillColor: parseColor((graphicProps["draw:fill-color"] ?? graphicProps["fill-color"]) as string | undefined),
        fillImageName: (graphicProps["draw:fill-image-name"] ??
          graphicProps["fill-image-name"]) as string | undefined,
        stroke: (graphicProps["draw:stroke"] ?? graphicProps.stroke) as string | undefined
      };
    });
}

function buildImageFillMap(imageFills: DesignImageFill[]): Map<string, DesignImageFill> {
  return new Map(imageFills.map((entry) => [entry.name, entry]));
}

function buildGraphicStyleMap(styles: DesignGraphicStyle[]): Map<string, DesignGraphicStyle> {
  return new Map(styles.map((entry) => [entry.id, entry]));
}

function extractShape(
  nodeName: string,
  node: UnknownRecord,
  graphicStyleMap: Map<string, DesignGraphicStyle>,
  imageFillMap: Map<string, DesignImageFill>
): DesignShape {
  const styleId = (node["draw:style-name"] ?? node["style-name"]) as string | undefined;
  const graphicStyle = styleId ? graphicStyleMap.get(styleId) : undefined;
  const fillImage =
    graphicStyle?.fillImageName !== undefined ? imageFillMap.get(graphicStyle.fillImageName) : undefined;
  const textValue = collectParagraphs(node["text-box"])
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => run.text)
    .join("\n");

  return {
    kind: "shape",
    styleId,
    shapeType: nodeName,
    xPt: cmStringToPt((node["svg:x"] ?? node.x) as string | undefined) ?? 0,
    yPt: cmStringToPt((node["svg:y"] ?? node.y) as string | undefined) ?? 0,
    widthPt: cmStringToPt((node["svg:width"] ?? node.width) as string | undefined) ?? 0,
    heightPt: cmStringToPt((node["svg:height"] ?? node.height) as string | undefined) ?? 0,
    text: textValue.length > 0 ? textValue : undefined,
    points: (node["draw:points"] ?? node.points) as string | undefined,
    fillImage
  };
}

function extractFrame(
  node: UnknownRecord,
  graphicStyleMap: Map<string, DesignGraphicStyle>,
  imageFillMap: Map<string, DesignImageFill>
): DesignPageItem {
  const paragraphs = collectParagraphs(node["text-box"]);
  const hasText = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.length > 0));

  if (hasText) {
    return {
      kind: "textFrame",
      styleId: (node["draw:style-name"] ?? node["style-name"]) as string | undefined,
      xPt: cmStringToPt((node["svg:x"] ?? node.x) as string | undefined) ?? 0,
      yPt: cmStringToPt((node["svg:y"] ?? node.y) as string | undefined) ?? 0,
      widthPt: cmStringToPt((node["svg:width"] ?? node.width) as string | undefined) ?? 0,
      heightPt: cmStringToPt((node["svg:height"] ?? node.height) as string | undefined) ?? 0,
      paragraphs
    } satisfies DesignTextFrame;
  }

  return extractShape("frame", node, graphicStyleMap, imageFillMap);
}

function extractPages(
  contentDoc: UnknownRecord,
  pageWidthPt: number,
  pageHeightPt: number,
  graphicStyleMap: Map<string, DesignGraphicStyle>,
  imageFillMap: Map<string, DesignImageFill>
): DesignPage[] {
  const officeDoc = asRecord(contentDoc["document-content"]);
  const body = asRecord(officeDoc.body);
  const drawing = asRecord(body.drawing);

  return asArray(drawing.page).map((pageNode, index): DesignPage => {
    const pageRecord = asRecord(pageNode);
    const items: DesignPageItem[] = [];

    for (const frame of asArray(pageRecord.frame)) {
      items.push(extractFrame(asRecord(frame), graphicStyleMap, imageFillMap));
    }

    for (const polygon of asArray(pageRecord.polygon)) {
      items.push(extractShape("polygon", asRecord(polygon), graphicStyleMap, imageFillMap));
    }

    for (const rect of asArray(pageRecord.rect)) {
      items.push(extractShape("rect", asRecord(rect), graphicStyleMap, imageFillMap));
    }

    for (const line of asArray(pageRecord.line)) {
      items.push(extractShape("line", asRecord(line), graphicStyleMap, imageFillMap));
    }

    return {
      id: `page-${index + 1}`,
      name: String(pageRecord["draw:name"] ?? pageRecord.name ?? `page${index + 1}`),
      widthPt: pageWidthPt,
      heightPt: pageHeightPt,
      items
    };
  });
}

export function parseOdgDocument(filePath: string): DesignDocument {
  const zip = new AdmZip(filePath);
  const contentXml = readZipText(zip, "content.xml");
  const stylesXml = readZipText(zip, "styles.xml");

  const contentDoc = xmlParser.parse(contentXml) as UnknownRecord;
  const stylesDoc = xmlParser.parse(stylesXml) as UnknownRecord;

  const layout = extractPageLayout(stylesDoc);
  const imageFills = extractImageFills(stylesDoc);
  const paragraphStyles = extractParagraphStyles(contentDoc);
  const characterStyles = extractCharacterStyles(contentDoc);
  const graphicStyles = extractGraphicStyles(contentDoc);
  const pages = extractPages(
    contentDoc,
    layout.widthPt,
    layout.heightPt,
    buildGraphicStyleMap(graphicStyles),
    buildImageFillMap(imageFills)
  );

  return {
    sourcePath: filePath,
    pageWidthPt: layout.widthPt,
    pageHeightPt: layout.heightPt,
    pages,
    paragraphStyles,
    characterStyles,
    graphicStyles,
    imageFills
  };
}

export async function writeParsedOdgArtifact(document: DesignDocument): Promise<string> {
  const outputDir = path.resolve("artifacts", "model");
  const outputPath = path.join(outputDir, `${path.basename(document.sourcePath)}.model.json`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(document, null, 2), "utf8");

  return outputPath;
}

