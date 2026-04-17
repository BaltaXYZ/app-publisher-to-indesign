import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DesignDocument, DesignParagraph } from "../odg/types.js";
import { runInDesignJavaScriptFile } from "./applescript.js";

function escapeForExtendScriptPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("\"", "\\\"");
}

function toExtendScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function buildExporterScript(model: DesignDocument, assetMap: Record<string, string>, idmlPath: string): string {
  const modelLiteral = toExtendScriptLiteral(model);
  const assetMapLiteral = toExtendScriptLiteral(assetMap);
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

  function resolveFont(fontName) {
    var candidates = [fontName];
    var lower = String(fontName).toLowerCase();

    if (lower === "arial-boldmt") candidates.push("Arial\\tBold");
    if (lower === "arialmt") candidates.push("Arial\\tRegular");
    if (lower === "palatino-roman") candidates.push("Palatino\\tRegular");
    if (lower === "timesnewromanpsmt") candidates.push("Times New Roman\\tRegular");

    if (fontName.indexOf("-") !== -1) {
      var parts = fontName.split("-");
      if (parts.length === 2) {
        var stylePart = parts[1].replace("MT", "").replace("PS", "");
        candidates.push(parts[0] + "\\t" + stylePart);
      }
    }

    for (var index = 0; index < candidates.length; index += 1) {
      try {
        var font = app.fonts.itemByName(candidates[index]);
        font.name;
        return font;
      } catch (error) {}
    }

    return null;
  }

  function applyCharacterFormatting(target, styleDef, doc) {
    if (!styleDef) {
      return;
    }

    if (styleDef.fontFamily) {
      try {
        var resolvedFont = resolveFont(styleDef.fontFamily);
        if (resolvedFont) {
          target.appliedFont = resolvedFont.name;
        }
      } catch (e) {}
    }
    if (styleDef.fontSizePt !== undefined) {
      try {
        target.pointSize = styleDef.fontSizePt;
      } catch (e) {}
    }
    if (styleDef.color && styleDef.color.hex) {
      try {
        target.fillColor = ensureColor(doc, "AutoColor_" + styleDef.color.hex.replace("#", ""), styleDef.color.hex);
      } catch (e) {}
    }
  }

  function ensureCharacterStyle(doc, styleDef) {

    var style;
    try {
      style = doc.characterStyles.itemByName(styleDef.id);
      style.name;
    } catch (e) {
      style = doc.characterStyles.add({ name: styleDef.id });
    }

    applyCharacterFormatting(style, styleDef, doc);

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
        if (runLength > 0) {
          try {
            var characterRange = story.characters.itemByRange(offset + runOffset, offset + runOffset + runLength - 1);
            applyCharacterFormatting(characterRange, run, doc);
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
  var storyMap = {};
  for (var storyIndex = 0; storyIndex < model.textStories.length; storyIndex += 1) {
    storyMap[model.textStories[storyIndex].id] = model.textStories[storyIndex];
  }
  var previousFrameByStory = {};
  var rootFrameByStory = {};

  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  var doc = app.documents.add();
  doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
  doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
  doc.zeroPoint = [0, 0];
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
        textFrame.textFramePreferences.insetSpacing = [0, 0, 0, 0];
        if (item.columnCount && item.columnCount > 1) {
          try {
            textFrame.textFramePreferences.textColumnCount = item.columnCount;
          } catch (error) {}
        }
        if (item.columnGapPt !== undefined) {
          try {
            textFrame.textFramePreferences.textColumnGutter = item.columnGapPt;
          } catch (error) {}
        }

        if (item.storyId) {
          if (!rootFrameByStory[item.storyId]) {
            rootFrameByStory[item.storyId] = textFrame;
          }

          if (previousFrameByStory[item.storyId]) {
            try {
              previousFrameByStory[item.storyId].nextTextFrame = textFrame;
            } catch (error) {}
          }

          previousFrameByStory[item.storyId] = textFrame;
        } else {
          var inlineParagraphs = item.paragraphs || [];
          textFrame.contents = paragraphsToString(inlineParagraphs);
          if (inlineParagraphs.length === 1 && inlineParagraphs[0].runs.length === 1) {
            applyCharacterFormatting(textFrame.parentStory.characters.everyItem(), inlineParagraphs[0].runs[0], doc);
          }
          applyTextStyles(textFrame.parentStory, inlineParagraphs, doc);
        }
      } else {
        var rect = page.rectangles.add();
        rect.geometricBounds = bounds;
        rect.strokeWeight = 0;

        if (item.fillImage && assetMap[item.fillImage.name]) {
          rect.place(File(assetMap[item.fillImage.name]));
          rect.fit(FitOptions.CONTENT_TO_FRAME);
        } else {
          rect.fillColor = doc.swatches.itemByName("None");
        }
      }
    }
  }

  for (var storyId in rootFrameByStory) {
    if (!rootFrameByStory.hasOwnProperty(storyId) || !storyMap[storyId]) {
      continue;
    }

    var storyFrame = rootFrameByStory[storyId];
    var paragraphs = storyMap[storyId].paragraphs || [];
    storyFrame.contents = paragraphsToString(paragraphs);
    if (paragraphs.length === 1 && paragraphs[0].runs.length === 1) {
      applyCharacterFormatting(storyFrame.parentStory.characters.everyItem(), paragraphs[0].runs[0], doc);
    }
    applyTextStyles(storyFrame.parentStory, paragraphs, doc);
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
}): Promise<{ idmlPath: string; reportPath: string }> {
  const { document, assetMap, outputDir, baseName } = options;
  await mkdir(outputDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pub2indesign-export-"));
  const scriptPath = path.join(tempDir, "export-idml.jsx");
  const idmlPath = path.join(outputDir, `${baseName}.idml`);
  const reportPath = path.join(outputDir, `${baseName}.report.json`);

  try {
    const script = buildExporterScript(document, Object.fromEntries(assetMap), idmlPath);
    await writeFile(scriptPath, script, "utf8");
    await runInDesignJavaScriptFile(scriptPath);

    return { idmlPath, reportPath };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
