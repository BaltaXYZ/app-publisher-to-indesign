import { writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createConversionReport } from "./report.js";
import { exportModelToIdml } from "../indesign/export-model-to-idml.js";
import { validateIdmlOpens } from "../indesign/validate-idml.js";
import { convertPubToOdg } from "../libreoffice/convert.js";
import { extractOdgAssets } from "../odg/assets.js";
import { parseOdgDocument, writeParsedOdgArtifact } from "../odg/parser.js";
import { inspectPubOle, writeInspectionArtifact } from "../pub/ole-inspector.js";

export interface ConversionArtifacts {
  pubInspectionPath: string;
  odgPath: string;
  modelPath: string;
  idmlPath: string;
  reportPath: string;
}

export async function runConversionPipeline(pubPath: string, outputRoot: string): Promise<ConversionArtifacts> {
  await mkdir(outputRoot, { recursive: true });

  const inspection = await inspectPubOle(pubPath);
  const pubInspectionPath = await writeInspectionArtifact(inspection);

  const odgDir = path.join(outputRoot, "libreoffice");
  const odgPath = await convertPubToOdg(pubPath, odgDir);

  const document = parseOdgDocument(odgPath);
  const modelPath = await writeParsedOdgArtifact(document);

  const assetsDir = path.join(outputRoot, "assets");
  const assetMap = await extractOdgAssets(odgPath, document, assetsDir);

  const baseName = path.basename(pubPath, path.extname(pubPath));
  const report = createConversionReport(pubPath, document);
  const { idmlPath, reportPath } = await exportModelToIdml({
    document,
    assetMap,
    outputDir: path.join(outputRoot, "exports"),
    baseName,
    report
  });
  await validateIdmlOpens(idmlPath);
  report.validatedInInDesign = true;
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  return {
    pubInspectionPath,
    odgPath,
    modelPath,
    idmlPath,
    reportPath
  };
}
