// Runs inside VS Code on the workflow's smoke-test sample: ABMAIN01 calls
// helper (ABHELP01) and fetches dynpgm (ABDYNP01), all extensionless members.
// The extension's indexer builds the graph, then picks up a new file.
const assert = require("node:assert/strict");
const { existsSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const vscode = require("vscode");

exports.run = async () => {
  const folder = vscode.workspace.workspaceFolders[0].uri;
  const extension = vscode.extensions.getExtension("local.pli-graph");
  // The threads the extension starts: a package without one fails only when it starts.
  for (const thread of ["worker.cjs", "parser.cjs", "graphpage.cjs", "mcp.cjs"]) {
    assert.ok(existsSync(join(extension.extensionPath, "out", thread)), `out/${thread} is packaged`);
  }
  const api = await extension.activate();
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

  // A member gets its language once an editor shows it.
  const shownAs = (uri, language) =>
    until(`${vscode.workspace.asRelativePath(uri)} becomes ${language}`, async () => {
      const editor = await vscode.window.showTextDocument(uri);
      return editor.document.languageId === language && editor.document;
    });

  const main = vscode.Uri.joinPath(folder, "ABMAIN01");
  const document = await shownAs(main, "pli");
  assert.deepEqual(await definitionOf(main, 1, 9), ["ABHELP01:1"]);
  assert.deepEqual(await definitionOf(main, 2, 10), ["ABDYNP01:1"]);
  console.log("Go to Definition works");

  // A hover's definition preview opens the member without an editor. Switching
  // its language redid the hover, which opened it again as plain text, forever.
  const helper = vscode.Uri.joinPath(folder, "ABHELP01");
  await vscode.workspace.openTextDocument(helper);
  // Answered after the reopen a language switch would send.
  await definitionOf(main, 1, 9);
  assert.equal(vscode.workspace.textDocuments.find((d) => d.uri.toString() === helper.toString())?.languageId, "plaintext");
  await shownAs(helper, "pli");
  await vscode.window.showTextDocument(document);
  console.log("A member without an editor keeps its language");

  // `main: proc options(main);` starts with the label, then the keyword.
  const legend = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokensLegend", main);
  const tokens = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", main);
  const [, , labelLength, label, , , , keywordLength, keyword] = tokens.data;
  assert.deepEqual([labelLength, legend.tokenTypes[label], keywordLength, legend.tokenTypes[keyword]], [4, "label", 4, "keyword"]);
  console.log("Highlighting works");

  // PL/I's margins: column 1 is carriage control, 2-72 code, 73-80 sequence numbers.
  // A member opens as plain text, where VS Code guesses its indentation; as PL/I it indents by 3,
  // even when its editor was left at another size, like one restored from before the extension ran.
  const indented = await vscode.window.showTextDocument(document);
  assert.deepEqual([indented.options.tabSize, indented.options.insertSpaces], [3, true]);
  indented.options = { tabSize: 2, indentSize: 2 };
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  const reshown = await vscode.window.showTextDocument(document);
  while (reshown.options.tabSize !== 3) {
    await new Promise((resolve) => {
      const listener = vscode.window.onDidChangeTextEditorOptions(() => {
        listener.dispose();
        resolve();
      });
    });
  }
  assert.deepEqual([reshown.options.tabSize, reshown.options.indentSize, reshown.options.insertSpaces], [3, 3, true]);
  assert.deepEqual(vscode.workspace.getConfiguration("editor", { languageId: "pli" }).get("rulers"), [1, 72, 80]);
  // Tab stops at column 2, then every 3 columns.
  const typed = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "pli", content: "" }));
  await vscode.commands.executeCommand("pliGraph.tab");
  assert.equal(typed.document.getText(), " ");
  await vscode.commands.executeCommand("pliGraph.tab");
  await typed.edit((edit) => edit.insert(typed.selection.active, "IF"));
  await vscode.commands.executeCommand("pliGraph.tab");
  assert.equal(typed.document.getText(), "    IF ");
  // A comment ending in column 72 and the sequence number stay where they are.
  await typed.edit((edit) => edit.replace(new vscode.Range(0, 0, 0, 7), ` /* READ ${"*".repeat(62)}/AAP00020`));
  typed.selection = new vscode.Selection(0, 1, 0, 1);
  await vscode.commands.executeCommand("pliGraph.tab");
  assert.equal(typed.document.getText(), `    /* READ ${"*".repeat(59)}/AAP00020`);
  assert.equal(typed.selection.active.character, 4);
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  await vscode.window.showTextDocument(document);

  // Format Document indents PL/I by its blocks, writes its words the
  // configured way and lines up JCL's fields.
  const formatSettings = vscode.workspace.getConfiguration("pliGraph.format");
  for (const [language, content, expected, abbreviations] of [
    ["pli", " p: procedure;\n x = \"a\";\n  declare key\n\n char(8);\n end;\n", " P: PROC;\n    X = 'a';\n    DCL KEY CHAR(8);\n END P;\n", "short"],
    ["pli", " P: PROC;\n DCL KEY CHAR(8);\n END P;\n", " P: PROCEDURE;\n    DECLARE KEY CHARACTER(8);\n END P;\n", "long"],
    ["jcl", "//s1 exec pgm=x\n", "//S1       EXEC PGM=X\n", "short"],
  ]) {
    await formatSettings.update("abbreviations", abbreviations, vscode.ConfigurationTarget.Global);
    const formatting = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language, content }));
    await vscode.commands.executeCommand("editor.action.formatDocument");
    assert.equal(formatting.document.getText(), expected);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  await formatSettings.update("abbreviations", undefined, vscode.ConfigurationTarget.Global);
  await vscode.window.showTextDocument(document);
  console.log("PL/I rulers and tab stops work");

  // `select id ... from prod.customer`: id is a column of ABTCUST1's table.
  const show = vscode.Uri.joinPath(folder, "ABSHOW01");
  await shownAs(show, "pli");
  assert.deepEqual(await definitionOf(show, 2, 18), ["ABTCUST1:1"]);
  console.log("Go to Definition on a column works");

  const added = vscode.Uri.joinPath(folder, "ABNEWP01");
  writeFileSync(added.fsPath, "newpgm: proc;\n  call helper;\nend newpgm;\n");
  await shownAs(added, "pli");
  await until("the indexer picks up a new file", async () => {
    const found = await definitionOf(added, 1, 9);
    return found.length === 1 && found[0] === "ABHELP01:1";
  });

  // Rejects if the packaged page is missing or the graph cannot be read.
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("pliGraph.show");
  await webviewTab("PL/I Graph");
  console.log("Show Graph opens");

  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("pliGraph.flow");
  await webviewTab("PL/I Flow: ");
  console.log("Show Flow Diagram opens");

  // By name, as a caller would pass it; without one it asks in a quick pick.
  await vscode.commands.executeCommand("pliGraph.flowOf", "helper");
  await webviewTab("PL/I Flow: HELPER");
  console.log("Show Flow Diagram of Procedure opens");

  // On a call's procedure name (`call helper;`), the lightbulb offers its flow.
  const flowTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label.startsWith("PL/I Flow: "));
  await vscode.window.tabGroups.close(flowTabs);
  const actions = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", main, new vscode.Range(1, 9, 1, 9));
  const flowAction = actions.find((a) => a.title === "Show Flow Diagram of HELPER");
  assert.ok(flowAction, JSON.stringify(actions.map((a) => a.title)));
  await vscode.commands.executeCommand(flowAction.command.command, ...flowAction.command.arguments);
  await webviewTab("PL/I Flow: HELPER");
  console.log("The flow code action opens");
  // And on its declaration, `helper: proc;`.
  const declared = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", helper, new vscode.Range(0, 2, 0, 2));
  assert.ok(declared.some((a) => a.title === "Show Flow Diagram of HELPER"), JSON.stringify(declared.map((a) => a.title)));
  console.log("The flow code action is offered on a declaration");

  // ABTCUST1 creates the table PROD.CUSTOMER.
  const ddl = vscode.Uri.joinPath(folder, "ABTCUST1");
  await shownAs(ddl, "db2");
  await vscode.commands.executeCommand("pliGraph.dataModel");
  await webviewTab("Data Model: ABTCUST1");
  console.log("Show Data Model opens");
  // On `prod.customer` in ABSHOW01's SQL the lightbulb offers its data model, not on the column `id`.
  const titles = async (uri, line, character) =>
    (await vscode.commands.executeCommand("vscode.executeCodeActionProvider", uri, new vscode.Range(line, character, line, character))).map((a) => a.title);
  const onTable = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", show, new vscode.Range(2, 40, 2, 40));
  const modelAction = onTable.find((a) => a.title === "Show Data Model of CUSTOMER");
  assert.ok(modelAction, JSON.stringify(onTable.map((a) => a.title)));
  assert.ok(!(await titles(show, 2, 18)).some((t) => t.startsWith("Show Data Model")));
  assert.ok((await titles(ddl, 0, 1)).includes("Show Data Model of ABTCUST1"));
  await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label.startsWith("Data Model: ")));
  await vscode.commands.executeCommand(modelAction.command.command, ...modelAction.command.arguments);
  await webviewTab("Data Model: ABTCUST1");
  console.log("The data model code action opens");

  // On a variable's name (`dcl m char(8)`), the lightbulb offers its data flow.
  const onVariable = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", show, new vscode.Range(1, 6, 1, 6));
  const dataAction = onVariable.find((a) => a.title === "Show Data Flow of M");
  assert.ok(dataAction, JSON.stringify(onVariable.map((a) => a.title)));
  await vscode.commands.executeCommand(dataAction.command.command, ...dataAction.command.arguments);
  await webviewTab("PL/I Data Flow: M");
  console.log("The data flow code action opens");

  // Rejects if the packaged worker or the grammars' highlights queries are missing.
  await vscode.commands.executeCommand("pliGraph.coverage");
  assert.match(vscode.window.activeTextEditor?.document.getText() ?? "", /^# PL\/I Graph coverage/);
  console.log("Coverage Report opens");

  // ABFCUST1 holds the format CUSTFMT.
  const screen = vscode.Uri.joinPath(folder, "ABFCUST1");
  await shownAs(screen, "hlasm");
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
