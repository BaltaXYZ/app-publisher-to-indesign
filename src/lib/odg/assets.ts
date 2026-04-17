import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";

import type { DesignDocument } from "./types.js";

export async function extractOdgAssets(odgPath: string, document: DesignDocument, outputDir: string): Promise<Map<string, string>> {
  await mkdir(outputDir, { recursive: true });

  const zip = new AdmZip(odgPath);
  const result = new Map<string, string>();

  for (const imageFill of document.imageFills) {
    const entry = zip.getEntry(imageFill.path);

    if (!entry) {
      continue;
    }

    const outputPath = path.join(outputDir, path.basename(imageFill.path));
    const data = zip.readFile(entry);

    if (!data) {
      continue;
    }

    await writeFile(outputPath, data);
    result.set(imageFill.name, outputPath);
  }

  return result;
}
