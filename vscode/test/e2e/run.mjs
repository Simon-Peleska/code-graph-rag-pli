// Starts a downloaded VS Code with this extension on the workspace given as
// the first argument and runs suite.cjs inside it. The workspace's
// .vscode/settings.json must set pliGraph.command.
import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const workspace = resolve(process.argv[2]);
await runTests({
  version: "1.105.0",
  extensionDevelopmentPath: resolve(import.meta.dirname, "../.."),
  extensionTestsPath: resolve(import.meta.dirname, "suite.cjs"),
  launchArgs: [workspace, "--disable-extensions"],
});
