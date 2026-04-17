import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as CFB from "cfb";

import type { PubInspectionSummary, PubOleEntrySummary, PubOleEntryType } from "./types.js";

interface CfbEntryLike {
  name?: string;
  type?: number;
  size?: number;
}

function mapEntryType(type: number | undefined): PubOleEntryType {
  if (type === 1) {
    return "storage";
  }
  if (type === 2) {
    return "stream";
  }
  if (type === 5) {
    return "root";
  }
  return "unknown";
}

export async function inspectPubOle(filePath: string): Promise<PubInspectionSummary> {
  const buffer = await readFile(filePath);
  const container = CFB.read(buffer, { type: "buffer" }) as {
    FullPaths?: string[];
    FileIndex?: CfbEntryLike[];
  };

  const fullPaths = container.FullPaths ?? [];
  const fileIndex = container.FileIndex ?? [];

  const entries: PubOleEntrySummary[] = fullPaths.map((fullPath, index) => {
    const entry = fileIndex[index] ?? {};
    const normalizedPath = fullPath.replace(/\/$/, "") || "/";

    return {
      path: normalizedPath,
      name: entry.name ?? (path.basename(normalizedPath) || "/"),
      type: mapEntryType(entry.type),
      size: entry.size ?? 0
    };
  });

  return {
    filePath,
    inspectedAt: new Date().toISOString(),
    container: "ole-cfb",
    entryCount: entries.length,
    entries
  };
}

export async function writeInspectionArtifact(summary: PubInspectionSummary): Promise<string> {
  const outputDir = path.resolve("artifacts", "inspection");
  const fileName = `${path.basename(summary.filePath)}.json`;
  const outputPath = path.join(outputDir, fileName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  return outputPath;
}
