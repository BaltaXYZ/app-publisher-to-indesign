import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function convertPub(pubPath: string, outputDir: string, format: "odg" | "pdf", filter?: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const convertArg = filter ? `${format}:${filter}` : format;
  await execFileAsync("soffice", ["--headless", "--convert-to", convertArg, "--outdir", outputDir, pubPath], {
    maxBuffer: 1024 * 1024 * 10
  });

  return path.join(outputDir, `${path.basename(pubPath, path.extname(pubPath))}.${format}`);
}

export async function convertPubToOdg(pubPath: string, outputDir: string): Promise<string> {
  return convertPub(pubPath, outputDir, "odg");
}

export async function convertPubToPdf(pubPath: string, outputDir: string): Promise<string> {
  return convertPub(pubPath, outputDir, "pdf", "draw_pdf_Export");
}
