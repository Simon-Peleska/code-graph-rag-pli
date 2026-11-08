// Runs inside VS Code on the workflow's smoke-test sample: ABMAIN01 calls
// helper (ABHELP01) and fetches dynpgm (ABDYNP01), all extensionless members.
// The extension's indexer builds the graph, then picks up a new file.
const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const vscode = require("vscode");

exports.run = async () => {
  const folder = vscode.workspace.workspaceFolders[0].uri;
  const api = await vscode.extensions.getExtension("local.pli-graph").activate();
  // The first sync's progress, recorded from the start.
  const progress = [];
  api.onDidChangeIndexing((state) => progress.push(state));

  // Re-checks after every graph update and every document (re)opened, which
  // is how a language switch arrives; the workflow's step timeout ends a hang.
  const until = async (what, check) => {
    for (;;) {
      const result = await check();
      if (result) {
        console.log(`${what}: ok`);
        return result;
      }
      await new Promise((resolve) => {
        const listeners = [api.onDidUpdateGraph(done), vscode.workspace.onDidOpenTextDocument(done)];
        function done() {
          listeners.forEach((l) => l.dispose());
          resolve();
        }
      });
    }
  };
  // A webview's tab shows up after the command that opens it returns.
  const webviewTab = async (title) => {
    const open = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => tab.input instanceof vscode.TabInputWebview && tab.label.startsWith(title));
    while (!open()) {
      await new Promise((resolve) => {
        const listener = vscode.window.tabGroups.onDidChangeTabs(() => {
          listener.dispose();
          resolve();
        });
      });
    }
  };
  const definitionOf = async (uri, line, character) => {
    const found = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(line, character),
    );
    return found.map((l) => `${vscode.workspace.asRelativePath(l.uri ?? l.targetUri)}:${(l.range ?? l.targetRange).start.line + 1}`);
  };

  const main = vscode.Uri.joinPath(folder, "ABMAIN01");
  const document = await until("ABMAIN01 becomes PL/I", async () => {
    const opened = await vscode.workspace.openTextDocument(main);
    return opened.languageId === "pli" && opened;
  });
  await vscode.window.showTextDocument(document);
  assert.deepEqual(await definitionOf(main, 1, 9), ["ABHELP01:1"]);
  assert.deepEqual(await definitionOf(main, 2, 10), ["ABDYNP01:1"]);
  console.log("Go to Definition works");

  // `main: proc options(main);` starts with the label, then the keyword.
  const legend = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokensLegend", main);
  const tokens = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", main);
  const [, , labelLength, label, , , , keywordLength, keyword] = tokens.data;
  assert.deepEqual([labelLength, legend.tokenTypes[label], keywordLength, legend.tokenTypes[keyword]], [4, "label", 4, "keyword"]);
  console.log("Highlighting works");

  // `select id ... from prod.customer`: id is a column of ABTCUST1's table.
  const show = vscode.Uri.joinPath(folder, "ABSHOW01");
  await until("ABSHOW01 becomes PL/I", async () => (await vscode.workspace.openTextDocument(show)).languageId === "pli");
  assert.deepEqual(await definitionOf(show, 2, 18), ["ABTCUST1:1"]);
  console.log("Go to Definition on a column works");

  const added = vscode.Uri.joinPath(folder, "ABNEWP01");
  writeFileSync(added.fsPath, "newpgm: proc;\n  call helper;\nend newpgm;\n");
  await until("the indexer picks up a new file", async () => {
    const found = await definitionOf(added, 1, 9);
    return found.length === 1 && found[0] === "ABHELP01:1";
  });

  // Rejects if the packaged page is missing or the graph cannot be read.
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("pliGraph.show");
  await webviewTab("PL/I Graph");
  console.log("Show Graph opens");

  // ABFCUST1 holds the format CUSTFMT.
  const screen = vscode.Uri.joinPath(folder, "ABFCUST1");
  await until("ABFCUST1 becomes HLASM", async () => (await vscode.workspace.openTextDocument(screen)).languageId === "hlasm");
  await vscode.commands.executeCommand("pliGraph.showScreen", screen);
  await webviewTab("3270: CUSTFMT");
  console.log("Show 3270 Screen opens");

  // The progress bar climbed through the first sync and ended with it.
  while (!progress.includes(undefined)) {
    await new Promise((resolve) => {
      const listener = api.onDidChangeIndexing(() => {
        listener.dispose();
        resolve();
      });
    });
  }
  const first = progress.slice(0, progress.indexOf(undefined));
  const percents = first.map((state) => state.percent);
  assert.ok(first.length > 0, "the first sync reported no progress");
  assert.deepEqual(percents, [...percents].sort((a, b) => a - b));
  assert.ok(first.some((state) => state.message.startsWith("Linking references")), JSON.stringify(first));
  console.log(`Progress bar works: ${first.map((s) => s.percent).join(" ")}`);
};
