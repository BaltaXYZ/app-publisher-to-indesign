import path from "node:path";

import { runInDesignJavaScript } from "./applescript.js";

function escapeForExtendScriptPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("\"", "\\\"");
}

export async function validateIdmlOpens(idmlPath: string): Promise<void> {
  const escapedIdmlPath = escapeForExtendScriptPath(path.resolve(idmlPath));

  await runInDesignJavaScript(`#target indesign

(function () {
  app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
  var file = new File("${escapedIdmlPath}");
  var doc = app.open(file, false);
  doc.close(SaveOptions.NO);
  "validated";
}());`);
}
