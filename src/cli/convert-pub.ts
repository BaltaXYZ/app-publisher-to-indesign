import path from "node:path";

import { runConversionPipeline } from "../lib/conversion/pipeline.js";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: pnpm convert:pub <path-to-pub-file>");
  }

  const resolvedPath = path.resolve(inputPath);
  const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
  const outputRoot = path.resolve("artifacts", "jobs", baseName);
  const result = await runConversionPipeline(resolvedPath, outputRoot);

  console.log(`PUB inspection: ${result.pubInspectionPath}`);
  console.log(`ODG: ${result.odgPath}`);
  console.log(`Model: ${result.modelPath}`);
  console.log(`IDML: ${result.idmlPath}`);
  console.log(`Report: ${result.reportPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
