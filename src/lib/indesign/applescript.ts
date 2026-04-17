import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INDESIGN_APP_NAME = "Adobe InDesign 2026";

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

