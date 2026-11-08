// Starts a downloaded VS Code with the extension on the workspace given as the
// first argument and runs suite.cjs inside it.
//
//   node run.mjs <workspace> [<extension folder>]
//
// The extension folder defaults to this checkout; pass an unpacked .vsix
// (its `extension/` folder) to test the package itself. Without a cgr in the
// package, the workspace's .vscode/settings.json must set pliGraph.command.
import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const workspace = resolve(process.argv[2]);
const extension = resolve(process.argv[3] ?? resolve(import.meta.dirname, "../.."));
await runTests({
  version: "1.105.0",
  extensionDevelopmentPath: extension,
  extensionTestsPath: resolve(import.meta.dirname, "suite.cjs"),
  launchArgs: [workspace, "--disable-extensions"],
});
