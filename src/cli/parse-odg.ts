import path from "node:path";

import { parseOdgDocument, writeParsedOdgArtifact } from "../lib/odg/parser.js";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: pnpm parse:odg <path-to-odg-file>");
  }

  const resolvedPath = path.resolve(inputPath);
  const document = parseOdgDocument(resolvedPath);
  const artifactPath = await writeParsedOdgArtifact(document);

  console.log(`Parsed: ${resolvedPath}`);
  console.log(`Pages: ${document.pages.length}`);
  console.log(`Paragraph styles: ${document.paragraphStyles.length}`);
  console.log(`Character styles: ${document.characterStyles.length}`);
  console.log(`Graphic styles: ${document.graphicStyles.length}`);
  console.log(`Artifact: ${artifactPath}`);

  for (const page of document.pages.slice(0, 3)) {
    console.log(`${page.name}: ${page.items.length} items`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
