import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createConversionReport } from "./report.js";
import type { ConversionReport } from "./report.js";
import { exportModelToIdml } from "../indesign/export-model-to-idml.js";
import { exportIdmlToPdfAndAudit } from "../indesign/quality.js";
import { convertPubToPdf } from "../libreoffice/convert.js";
import { parsePdfDocument } from "../pdf/parser.js";
import { inspectPubOle, writeInspectionArtifact } from "../pub/ole-inspector.js";
import { comparePdfVisuals, renderPdfPages } from "../verification/pdf-diff.js";

export interface ConversionArtifacts {
  pubInspectionPath: string;
  referencePdfPath: string;
  modelPath: string;
  idmlPath: string;
  candidatePdfPath: string;
  reportPath: string;
  report: ConversionReport;
}

export class ConversionQualityError extends Error {
  readonly artifacts: ConversionArtifacts;

  constructor(message: string, artifacts: ConversionArtifacts) {
    super(message);
    this.name = "ConversionQualityError";
    this.artifacts = artifacts;
  }
}

export async function runConversionPipeline(
  pubPath: string,
  outputRoot: string,
  options?: { referencePdfPath?: string }
): Promise<ConversionArtifacts> {
  await mkdir(outputRoot, { recursive: true });

  const inspection = await inspectPubOle(pubPath);
  const pubInspectionPath = await writeInspectionArtifact(inspection);

  const baseName = path.basename(pubPath, path.extname(pubPath));
  const referenceDir = path.join(outputRoot, "reference");
  const generatedReferencePdfPath = path.join(referenceDir, `${baseName}.pdf`);
  const referencePdfPath = options?.referencePdfPath
    ? (await mkdir(referenceDir, { recursive: true }), await copyFile(path.resolve(options.referencePdfPath), generatedReferencePdfPath), generatedReferencePdfPath)
    : await convertPubToPdf(pubPath, referenceDir);
  const assetsDir = path.join(outputRoot, "assets");
  const { document, assetMap } = await parsePdfDocument(referencePdfPath, assetsDir);
  const backgroundPages = await renderPdfPages(referencePdfPath, path.join(outputRoot, "backgrounds"));
  const modelPath = path.join(outputRoot, "model", `${baseName}.model.json`);

  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, JSON.stringify(document, null, 2), "utf8");

  const { idmlPath, reportPath } = await exportModelToIdml({
    document,
    assetMap,
    backgroundPages,
    outputDir: path.join(outputRoot, "exports"),
    baseName
  });
  const candidatePdfPath = path.join(outputRoot, "exports", `${baseName}.pdf`);
  const audit = await exportIdmlToPdfAndAudit(idmlPath, candidatePdfPath);
  const comparison = await comparePdfVisuals(referencePdfPath, candidatePdfPath, path.join(outputRoot, "comparison"));
  const report = createConversionReport(pubPath, referencePdfPath, candidatePdfPath, document, comparison, audit);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  const artifacts = {
    pubInspectionPath,
    referencePdfPath,
    modelPath,
    idmlPath,
    candidatePdfPath,
    reportPath,
    report
  } satisfies ConversionArtifacts;

  if (!report.releaseApproved) {
    const reasons = [
      !report.pageCountMatches ? "sidantalet matchar inte referensen" : null,
      !report.visualMatchPassed ? "visuell diff hittade skillnader" : null,
      !report.nativeAuditPassed ? "native-audit misslyckades" : null
    ].filter(Boolean);

    throw new ConversionQualityError(`Conversion failed acceptance gate: ${reasons.join(", ")}.`, artifacts);
  }

  return artifacts;
}
