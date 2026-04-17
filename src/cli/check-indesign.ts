import { getInDesignVersion, isInDesignRunning } from "../lib/indesign/applescript.js";

async function main(): Promise<void> {
  const [running, version] = await Promise.all([isInDesignRunning(), getInDesignVersion()]);

  console.log(`InDesign running: ${running}`);
  console.log(`InDesign version: ${version}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
