import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ConversionQualityError, runConversionPipeline } from "../lib/conversion/pipeline.js";

interface AcceptanceManifest {
  id: string;
  sourcePub: string;
  referencePdf?: string;
}

async function findManifestPaths(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const manifests: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await findManifestPaths(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name === "manifest.json") {
      manifests.push(entryPath);
    }
  }

  return manifests.sort();
}

async function main(): Promise<void> {
  const manifests = await findManifestPaths(path.resolve("acceptance"));
  if (manifests.length === 0) {
    throw new Error("No acceptance manifests found under acceptance/.");
  }

  let failed = false;

  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AcceptanceManifest;
    const manifestDir = path.dirname(manifestPath);
    const outputRoot = path.resolve("artifacts", "acceptance", manifest.id);

    try {
      const result = await runConversionPipeline(path.resolve(manifestDir, manifest.sourcePub), outputRoot, {
        referencePdfPath: manifest.referencePdf ? path.resolve(manifestDir, manifest.referencePdf) : undefined
      });
      console.log(`PASS ${manifest.id} -> ${result.reportPath}`);
    } catch (error) {
      failed = true;

      if (error instanceof ConversionQualityError) {
        console.error(`FAIL ${manifest.id} -> ${error.artifacts.reportPath}`);
      } else {
        throw error;
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
