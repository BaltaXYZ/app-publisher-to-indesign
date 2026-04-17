import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ConversionReport } from "../conversion/report.js";
import type { DesignDocument } from "../odg/types.js";
import { runInDesignJavaScriptFile } from "./applescript.js";

function escapeForExtendScriptPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("\"", "\\\"");
}

function buildExporterScript(model: DesignDocument, assetMap: Record<string, string>, idmlPath: string): string {
  const modelLiteral = JSON.stringify(model);
  const assetMapLiteral = JSON.stringify(assetMap);
  const escapedIdmlPath = escapeForExtendScriptPath(idmlPath);

  return `#target indesign

(function () {
  function ensureColor(doc, name, hex) {
    try {
      return doc.colors.itemByName(name).name ? doc.colors.itemByName(name) : null;
    } catch (e) {}

    var color = doc.colors.add();
    color.name = name;
    color.model = ColorModel.process;
    color.space = ColorSpace.RGB;
    color.colorValue = [
      parseInt(hex.substring(1, 3), 16),
      parseInt(hex.substring(3, 5), 16),
      parseInt(hex.substring(5, 7), 16)
    ];
    return color;
  }

  function ensureParagraphStyle(doc, styleDef) {
    var style;
    try {
      style = doc.paragraphStyles.itemByName(styleDef.id);
      style.name;
    } catch (e) {
      style = doc.paragraphStyles.add({ name: styleDef.id });
    }

    if (styleDef.align) {
      if (styleDef.align === "center") style.justification = Justification.CENTER_ALIGN;
      else if (styleDef.align === "right") style.justification = Justification.RIGHT_ALIGN;
      else if (styleDef.align === "justify") style.justification = Justification.FULLY_JUSTIFIED;
      else style.justification = Justification.LEFT_ALIGN;
    }
    if (styleDef.marginTopPt !== undefined) style.spaceBefore = styleDef.marginTopPt;
    if (styleDef.marginBottomPt !== undefined) style.spaceAfter = styleDef.marginBottomPt;

    return style;
  }

  function ensureCharacterStyle(doc, styleDef) {
    var style;
    try {
      style = doc.characterStyles.itemByName(styleDef.id);
      style.name;
    } catch (e) {
      style = doc.characterStyles.add({ name: styleDef.id });
    }

    if (styleDef.fontFamily) {
      try { style.appliedFont = styleDef.fontFamily; } catch (e) {}
    }
    if (styleDef.fontSizePt !== undefined) style.pointSize = styleDef.fontSizePt;
    if (styleDef.color && styleDef.color.hex) {
      style.fillColor = ensureColor(doc, "AutoColor_" + styleDef.color.hex.replace("#", ""), styleDef.color.hex);
    }
    if (styleDef.fontWeight === "bold") style.fontStyle = "Bold";
    if (styleDef.fontStyle === "italic") style.fontStyle = "Italic";

    return style;
  }

  function paragraphsToString(paragraphs) {
    var lines = [];
    for (var i = 0; i < paragraphs.length; i += 1) {
      var para = paragraphs[i];
      var parts = [];
      for (var j = 0; j < para.runs.length; j += 1) {
        parts.push(para.runs[j].text);
      }
      lines.push(parts.join(""));
    }
    return lines.join("\\r");
  }

  function applyTextStyles(story, paragraphs, doc) {
    var offset = 0;
    for (var i = 0; i < paragraphs.length; i += 1) {
      var paragraph = paragraphs[i];
      var paragraphText = "";
      for (var j = 0; j < paragraph.runs.length; j += 1) {
        paragraphText += paragraph.runs[j].text;
      }

      var paragraphLength = paragraphText.length;
      var paraObject = story.paragraphs[i];
      if (paragraph.styleId) {
        try {
          paraObject.appliedParagraphStyle = doc.paragraphStyles.itemByName(paragraph.styleId);
        } catch (e) {}
      }

      var runOffset = 0;
      for (var k = 0; k < paragraph.runs.length; k += 1) {
        var run = paragraph.runs[k];
        var runLength = run.text.length;
        if (run.characterStyleId && runLength > 0) {
          try {
            story.characters.itemByRange(offset + runOffset, offset + runOffset + runLength - 1).appliedCharacterStyle =
              doc.characterStyles.itemByName(run.characterStyleId);
          } catch (e) {}
        }
        runOffset += runLength;
      }

      offset += paragraphLength + 1;
    }
  }

  var model = ${modelLiteral};
  var assetMap = ${assetMapLiteral};
  var idmlFile = new File("${escapedIdmlPath}");

  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  var doc = app.documents.add();
  doc.documentPreferences.pageWidth = model.pageWidthPt + "pt";
  doc.documentPreferences.pageHeight = model.pageHeightPt + "pt";
  doc.documentPreferences.pagesPerDocument = model.pages.length;
  doc.documentPreferences.facingPages = false;

  for (var p = 0; p < model.paragraphStyles.length; p += 1) {
    ensureParagraphStyle(doc, model.paragraphStyles[p]);
  }
  for (var c = 0; c < model.characterStyles.length; c += 1) {
    ensureCharacterStyle(doc, model.characterStyles[c]);
  }

  for (var pageIndex = 0; pageIndex < model.pages.length; pageIndex += 1) {
    var page = doc.pages[pageIndex];
    var sourcePage = model.pages[pageIndex];

    for (var itemIndex = 0; itemIndex < sourcePage.items.length; itemIndex += 1) {
      var item = sourcePage.items[itemIndex];
      var bounds = [item.yPt, item.xPt, item.yPt + item.heightPt, item.xPt + item.widthPt];

      if (item.kind === "textFrame") {
        var textFrame = page.textFrames.add();
        textFrame.geometricBounds = bounds;
        textFrame.contents = paragraphsToString(item.paragraphs);
        applyTextStyles(textFrame.parentStory, item.paragraphs, doc);
      } else {
        var rect = page.rectangles.add();
        rect.geometricBounds = bounds;
        rect.strokeWeight = 0;

        if (item.fillImage && assetMap[item.fillImage.name]) {
          rect.place(File(assetMap[item.fillImage.name]));
          rect.fit(FitOptions.FILL_PROPORTIONALLY);
          rect.fit(FitOptions.CENTER_CONTENT);
        } else {
          rect.fillColor = doc.swatches.itemByName("Paper");
        }
      }
    }
  }

  doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
  doc.close(SaveOptions.NO);
  "ok";
}());`;
}

export async function exportModelToIdml(options: {
  document: DesignDocument;
  assetMap: Map<string, string>;
  outputDir: string;
  baseName: string;
  report: ConversionReport;
}): Promise<{ idmlPath: string; reportPath: string }> {
  const { document, assetMap, outputDir, baseName, report } = options;
  await mkdir(outputDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pub2indesign-export-"));
  const scriptPath = path.join(tempDir, "export-idml.jsx");
  const idmlPath = path.join(outputDir, `${baseName}.idml`);
  const reportPath = path.join(outputDir, `${baseName}.report.json`);

  try {
    await writeFile(scriptPath, buildExporterScript(document, Object.fromEntries(assetMap), idmlPath), "utf8");
    await runInDesignJavaScriptFile(scriptPath);
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    return { idmlPath, reportPath };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
