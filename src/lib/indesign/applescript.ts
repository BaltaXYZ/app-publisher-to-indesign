import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INDESIGN_APP_NAME = "Adobe InDesign 2026";

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
}

export async function getInDesignVersion(): Promise<string> {
  return runAppleScript(`tell application "${INDESIGN_APP_NAME}" to get version`);
}

export async function isInDesignRunning(): Promise<boolean> {
  const result = await runAppleScript(
    `tell application "System Events" to (name of processes) contains "${INDESIGN_APP_NAME}"`
  );

  return result === "true";
}

export async function runInDesignJavaScriptFile(scriptPath: string): Promise<string> {
  const escapedPath = escapeAppleScriptString(scriptPath);

  const { stdout } = await execFileAsync("osascript", [
    "-e",
    `tell application "${INDESIGN_APP_NAME}" to activate`,
    "-e",
    `tell application "${INDESIGN_APP_NAME}" to do script POSIX file "${escapedPath}" language javascript`,
  ]);

  return stdout.trim();
}

export async function runInDesignJavaScript(scriptSource: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pub2indesign-jsx-"));
  const scriptPath = path.join(tempDir, "script.jsx");

  try {
    await writeFile(scriptPath, scriptSource, "utf8");
    return await runInDesignJavaScriptFile(scriptPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
