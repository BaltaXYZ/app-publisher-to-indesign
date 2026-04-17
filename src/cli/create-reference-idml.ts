import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runInDesignJavaScriptFile } from "../lib/indesign/applescript.js";

const execFileAsync = promisify(execFile);

type StructureSummary = {
  idmlPath: string;
  inddPath: string;
  entries: string[];
  topLevelDirectories: string[];
  keyFiles: string[];
  designmapPreview: string[];
};

function escapeForExtendScriptPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("\"", "\\\"");
}

function buildReferenceScript(inddPath: string, idmlPath: string): string {
  const escapedInddPath = escapeForExtendScriptPath(inddPath);
  const escapedIdmlPath = escapeForExtendScriptPath(idmlPath);

  return `#target indesign

(function () {
  var inddFile = new File("${escapedInddPath}");
  var idmlFile = new File("${escapedIdmlPath}");

  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;

  var doc = app.documents.add();
  doc.documentPreferences.pageWidth = "210mm";
  doc.documentPreferences.pageHeight = "297mm";
  doc.documentPreferences.pagesPerDocument = 1;
  doc.documentPreferences.facingPages = false;

  var page = doc.pages.item(0);
  var blue = doc.colors.add({
    name: "ReferenceBlue",
    model: ColorModel.process,
    space: ColorSpace.CMYK,
    colorValue: [100, 15, 0, 0]
  });

  var heading = doc.paragraphStyles.add({
    name: "ReferenceHeading",
    pointSize: 24,
    leading: 28
  });

  var textFrame = page.textFrames.add();
  textFrame.geometricBounds = [20, 20, 55, 180];
  textFrame.contents = "Reference IDML";
  textFrame.parentStory.paragraphs.item(0).appliedParagraphStyle = heading;

  var rect = page.rectangles.add();
  rect.geometricBounds = [70, 20, 140, 180];
  rect.fillColor = blue;
  rect.strokeWeight = 0;

  doc.save(inddFile);
  doc.exportFile(ExportFormat.INDESIGN_MARKUP, idmlFile);
  doc.close(SaveOptions.NO);

  "created";
}());`;
}

async function collectStructureSummary(idmlPath: string, inddPath: string): Promise<StructureSummary> {
  const { stdout: entriesStdout } = await execFileAsync("unzip", ["-Z1", idmlPath]);
  const entries = entriesStdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();

  const { stdout: designmapStdout } = await execFileAsync("unzip", ["-p", idmlPath, "designmap.xml"]);
  const designmapPreview = designmapStdout.split("\n").slice(0, 12);

  const topLevelDirectories = Array.from(
    new Set(
      entries
        .map((entry) => entry.split("/")[0] ?? entry)
        .filter(Boolean)
    )
  ).sort();

  const keyFiles = entries.filter((entry) => {
    return (
      entry === "designmap.xml" ||
      entry.startsWith("Resources/") ||
      entry.startsWith("Spreads/") ||
      entry.startsWith("Stories/")
    );
  });

  return {
    idmlPath,
    inddPath,
    entries,
    topLevelDirectories,
    keyFiles,
    designmapPreview,
  };
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const outputDir = path.join(workspaceRoot, "artifacts", "reference-idml");
  const inddPath = path.join(outputDir, "minimal-reference.indd");
  const idmlPath = path.join(outputDir, "minimal-reference.idml");
  const summaryPath = path.join(outputDir, "minimal-reference.structure.json");

  await mkdir(outputDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pub2idml-reference-"));
  const scriptPath = path.join(tempDir, "create-reference-idml.jsx");

  try {
    await writeFile(scriptPath, buildReferenceScript(inddPath, idmlPath), "utf8");
    await runInDesignJavaScriptFile(scriptPath);

    const summary = await collectStructureSummary(idmlPath, inddPath);
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    console.log(`INDD: ${inddPath}`);
    console.log(`IDML: ${idmlPath}`);
    console.log(`Summary: ${summaryPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
