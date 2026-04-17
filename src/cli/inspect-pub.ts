import path from "node:path";

import { inspectPubOle, writeInspectionArtifact } from "../lib/pub/ole-inspector.js";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: pnpm inspect:pub <path-to-pub-file>");
  }

  const resolvedPath = path.resolve(inputPath);
  const summary = await inspectPubOle(resolvedPath);
  const artifactPath = await writeInspectionArtifact(summary);

  console.log(`Inspected: ${resolvedPath}`);
  console.log(`Entries: ${summary.entryCount}`);
  console.log(`Artifact: ${artifactPath}`);

  for (const entry of summary.entries.slice(0, 25)) {
    console.log(`${entry.type.padEnd(7)} ${String(entry.size).padStart(8)}  ${entry.path}`);
  }

  if (summary.entries.length > 25) {
    console.log(`... ${summary.entries.length - 25} more entries`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

