import path from "node:path";

import { runInDesignJavaScript } from "./applescript.js";

export interface InDesignAuditResult {
  pageCount: number;
  totalTextFrames: number;
  totalGraphics: number;
  totalTables: number;
  oversetText: boolean;
  missingLinks: string[];
  fontIssues: string[];
  fullPagePdfPlacements: string[];
  nativeAuditPassed: boolean;
}

function escapeForExtendScriptPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("\"", "\\\"");
}

export async function exportIdmlToPdfAndAudit(idmlPath: string, outputPdfPath: string): Promise<InDesignAuditResult> {
  const escapedIdmlPath = escapeForExtendScriptPath(path.resolve(idmlPath));
  const escapedOutputPdfPath = escapeForExtendScriptPath(path.resolve(outputPdfPath));

  const rawResult = await runInDesignJavaScript(`#target indesign

(function () {
  function jsonString(value) {
    return '"' + String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"';
  }

  function jsonArray(values) {
    var items = [];
    for (var index = 0; index < values.length; index += 1) {
      items.push(jsonString(values[index]));
    }
    return "[" + items.join(",") + "]";
  }

  function fileNameForLink(link) {
    try {
      return String(link.name || link.filePath || "unknown-link");
    } catch (error) {
      return "unknown-link";
    }
  }

  function fontState(font) {
    try {
      return String(font.status);
    } catch (error) {
      return "unknown";
    }
  }

  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  var file = new File("${escapedIdmlPath}");
  var pdfFile = new File("${escapedOutputPdfPath}");
  var doc = app.open(file, false);

  try {
    try {
      app.pdfExportPreferences.colorBitmapSampling = Sampling.NONE;
      app.pdfExportPreferences.grayscaleBitmapSampling = Sampling.NONE;
      app.pdfExportPreferences.monochromeBitmapSampling = Sampling.NONE;
      app.pdfExportPreferences.colorBitmapCompression = BitmapCompression.NONE;
      app.pdfExportPreferences.grayscaleBitmapCompression = BitmapCompression.NONE;
      app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;
    } catch (error) {}

    doc.exportFile(ExportFormat.PDF_TYPE, pdfFile);

    var missingLinks = [];
    var fontIssues = [];
    var fullPagePdfPlacements = [];
    var totalTables = 0;
    var oversetText = false;

    for (var storyIndex = 0; storyIndex < doc.stories.length; storyIndex += 1) {
      if (doc.stories[storyIndex].overflows) {
        oversetText = true;
      }
      totalTables += doc.stories[storyIndex].tables.length;
    }

    for (var linkIndex = 0; linkIndex < doc.links.length; linkIndex += 1) {
      var link = doc.links[linkIndex];
      try {
        if (!File(link.filePath).exists) {
          missingLinks.push(fileNameForLink(link));
        }
      } catch (error) {
        missingLinks.push(fileNameForLink(link));
      }
    }

    for (var fontIndex = 0; fontIndex < doc.fonts.length; fontIndex += 1) {
      var font = doc.fonts[fontIndex];
      var state = fontState(font).toLowerCase();
      if (state.indexOf("installed") === -1) {
        fontIssues.push(String(font.name) + " (" + fontState(font) + ")");
      }
    }

    for (var graphicIndex = 0; graphicIndex < doc.allGraphics.length; graphicIndex += 1) {
      var graphic = doc.allGraphics[graphicIndex];
      var parent = graphic.parent;
      var item = parent && parent.hasOwnProperty("geometricBounds") ? parent : null;
      if (!item) {
        continue;
      }

      var linkName = "";
      try {
        linkName = String(graphic.itemLink ? graphic.itemLink.name : "");
      } catch (error) {
        linkName = "";
      }

      if (linkName.toLowerCase().slice(-4) !== ".pdf") {
        continue;
      }

      var bounds = item.geometricBounds;
      var width = bounds[3] - bounds[1];
      var height = bounds[2] - bounds[0];
      if (Math.abs(bounds[0]) <= 2 && Math.abs(bounds[1]) <= 2 &&
          Math.abs(width - doc.documentPreferences.pageWidth) <= 2 &&
          Math.abs(height - doc.documentPreferences.pageHeight) <= 2) {
        fullPagePdfPlacements.push(linkName);
      }
    }

    var nativeAuditPassed = !oversetText && missingLinks.length === 0 && fontIssues.length === 0 && fullPagePdfPlacements.length === 0 && doc.textFrames.length > 0;

    return "{" +
      "\\"pageCount\\":" + doc.pages.length + "," +
      "\\"totalTextFrames\\":" + doc.textFrames.length + "," +
      "\\"totalGraphics\\":" + doc.allGraphics.length + "," +
      "\\"totalTables\\":" + totalTables + "," +
      "\\"oversetText\\":" + (oversetText ? "true" : "false") + "," +
      "\\"missingLinks\\":" + jsonArray(missingLinks) + "," +
      "\\"fontIssues\\":" + jsonArray(fontIssues) + "," +
      "\\"fullPagePdfPlacements\\":" + jsonArray(fullPagePdfPlacements) + "," +
      "\\"nativeAuditPassed\\":" + (nativeAuditPassed ? "true" : "false") +
    "}";
  } finally {
    doc.close(SaveOptions.NO);
  }
}());`);

  return JSON.parse(rawResult) as InDesignAuditResult;
}
