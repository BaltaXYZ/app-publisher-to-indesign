import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createConversionReport } from "./report.js";
import type { ConversionReport } from "./report.js";
import { exportModelToIdml } from "../indesign/export-model-to-idml.js";
import { exportIdmlToPdfAndAudit } from "../indesign/quality.js";
import { convertPubToPdf } from "../libreoffice/convert.js";
import { inspectPubOle, writeInspectionArtifact } from "../pub/ole-inspector.js";
import { parsePubDocument } from "../pub/raw-parser.js";
import { comparePdfVisuals } from "../verification/pdf-diff.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
  let referencePdfSource = "libreoffice";
  let sourceReferencePdfPath: string | undefined = options?.referencePdfPath ? path.resolve(options.referencePdfPath) : undefined;
  if (!sourceReferencePdfPath) {
    const adjacentReferencePdfPath = path.join(path.dirname(path.resolve(pubPath)), `${baseName}.pdf`);
    const rootReferencePdfPath = path.resolve(`${baseName}.pdf`);
    if (await fileExists(adjacentReferencePdfPath)) {
      sourceReferencePdfPath = adjacentReferencePdfPath;
      referencePdfSource = "adjacent";
    } else if (await fileExists(rootReferencePdfPath)) {
      sourceReferencePdfPath = rootReferencePdfPath;
      referencePdfSource = "project-root";
    }
  } else {
    referencePdfSource = "explicit";
  }

  const referencePdfPath = sourceReferencePdfPath
    ? (await mkdir(referenceDir, { recursive: true }), await copyFile(sourceReferencePdfPath, generatedReferencePdfPath), generatedReferencePdfPath)
    : await convertPubToPdf(pubPath, referenceDir);
  const assetsDir = path.join(outputRoot, "assets");
  const { document, assetMap } = await parsePubDocument(pubPath, assetsDir);
  const modelPath = path.join(outputRoot, "model", `${baseName}.model.json`);

  await mkdir(path.dirname(modelPath), { recursive: true });
  await writeFile(modelPath, JSON.stringify(document, null, 2), "utf8");

  const { idmlPath, reportPath } = await exportModelToIdml({
    document,
    assetMap,
    outputDir: path.join(outputRoot, "exports"),
    baseName
  });
  const candidatePdfPath = path.join(outputRoot, "exports", `${baseName}.pdf`);
  const audit = await exportIdmlToPdfAndAudit(idmlPath, candidatePdfPath);
  const comparison = await comparePdfVisuals(referencePdfPath, candidatePdfPath, path.join(outputRoot, "comparison"));
  const report = createConversionReport(pubPath, referencePdfPath, candidatePdfPath, document, comparison, audit, referencePdfSource);
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
      !report.structuralMatchPassed ? "strukturell layoutmatchning misslyckades" : null,
      report.malformedSingleCharacterParagraphsDetected ? "textflödet innehåller enbokstavsparagrafer" : null,
      !report.firstPageIntroColumnPassed ? "förstasidans inledande enkolumnsflöde saknas" : null,
      !report.mainFlowTwoColumnPassed ? "huvudflödet saknar tvåkolumnsstruktur" : null,
      !report.footerTextPresent ? "sidfot saknas på en eller flera sidor" : null,
      !report.footerPageAndUrlPresent ? "sidfot saknar sidnummer eller URL" : null,
      !report.coverTitlePresent ? "förstasidans titel saknas" : null,
      !report.coverAbstractPresent ? "förstasidans abstract saknas" : null,
      !report.articleStartsAfterCoverPassed ? "artikeltexten börjar inte efter förstasidesmaterialet" : null,
      report.repeatedFooterTextInStoryDetected ? "sidfotstext ligger kvar i huvudstoryn" : null,
      report.misplacedBackMatterDetected ? "eftermaterial ligger kvar i huvudstoryn" : null,
      !report.textWrapPassed ? "figur-textwrap saknas" : null,
      report.exportedCanonicalTextCoverage < 0.98 ? "kanonisk Publisher-text saknas i exporterad PDF" : null,
      !report.nativeAuditPassed ? "native-audit misslyckades" : null
    ].filter(Boolean);

    throw new ConversionQualityError(`Conversion failed acceptance gate: ${reasons.join(", ")}.`, artifacts);
  }

  return artifacts;
}
