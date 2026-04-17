import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function convertPubToOdg(pubPath: string, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  await execFileAsync("soffice", ["--headless", "--convert-to", "odg", "--outdir", outputDir, pubPath], {
    maxBuffer: 1024 * 1024 * 10
  });

  return path.join(outputDir, `${path.basename(pubPath, path.extname(pubPath))}.odg`);
}

