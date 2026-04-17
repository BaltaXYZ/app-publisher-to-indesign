import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { constants as fsConstants } from "node:fs";
import { promisify } from "node:util";

import type { DesignDocument } from "../odg/types.js";

const execFileAsync = promisify(execFile);

interface ParsedPdfPayload extends DesignDocument {}

const PYTHON_CANDIDATES = [path.resolve(".venv", "bin", "python3"), path.resolve(".venv", "bin", "python"), "python3"];

async function resolvePythonExecutable(): Promise<string> {
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return "python3";
}

export async function parsePdfDocument(
  pdfPath: string,
  assetsDir: string
): Promise<{ document: DesignDocument; assetMap: Map<string, string> }> {
  await mkdir(assetsDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pub2indesign-pdf-"));
  const outputJsonPath = path.join(tempDir, "layout.json");
  const scriptPath = path.resolve("scripts", "extract-pdf-layout.py");
  const python = await resolvePythonExecutable();

  try {
    await execFileAsync(python, [scriptPath, path.resolve(pdfPath), outputJsonPath, path.resolve(assetsDir)], {
      maxBuffer: 1024 * 1024 * 20
    });

    const payload = JSON.parse(await readFile(outputJsonPath, "utf8")) as ParsedPdfPayload;
    const assetMap = new Map(payload.imageFills.map((image) => [image.name, image.path]));

    return {
      document: payload,
      assetMap
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not extract PDF layout. Ensure requirements.txt is installed. ${message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
