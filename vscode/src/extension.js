// Each workspace folder gets its own graph, a SQLite file in the extension's
// storage. A worker thread (worker.js) builds it on start and keeps it in
// sync with the files; the extension only reads it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import { Graph } from "./graph.js";
import { createHighlighter, highlight, TOKEN_MODIFIERS, TOKEN_TYPES } from "./highlight.js";
import { mfsFormats } from "./mfs.js";
import { describe } from "./progress.js";
import { PLI_BUILTINS, insertBlanks } from "./source.js";
import { Symbols } from "./symbols.js";

/** @typedef {import("./graph.js").Target} Target */
/** @typedef {import("./graph.js").TreeRow} TreeRow */
/** @typedef {import("./symbols.js").Symbol} Symbol */
/** @typedef {import("./worker.js").SyncRequest} SyncRequest */
/** @typedef {import("./worker.js").SyncReply} SyncReply */

/**
 * @typedef {object} Workspace
 * @property {vscode.WorkspaceFolder} folder
 * @property {string} graphFile
 * @property {import("node:sqlite").DatabaseSync} [db] the extension's read connection
 * @property {Graph} [graph]
 * @property {Symbols} [symbols] variables, fields, labels and columns, read from the source
 * @property {string} [error]
 * @property {Indexing} [indexing] the sync the worker is running, while it runs
 * @property {Set<string>} changes files the watcher reported while a sync ran, for the next one
 * @property {number} running syncs sent to the worker and not answered yet
 */

/**
 * A running sync: how far it is, and the notification showing it, if any.
 * @typedef {object} Indexing
 * @property {number} id
 * @property {number} percent
 * @property {string} message
 * @property {number} shown
 * @property {(value: { message?: string, increment?: number }) => void} [report]
 * @property {() => void} [finish]
 */

// Smaller syncs, such as the one after saving a file, show only in the status bar.
const NOTIFY_FROM_FILES = 50;

const log = vscode.window.createOutputChannel("PL/I Graph", { log: true });
/** @type {Map<string, Workspace>} */
const workspaces = new Map();
const changed = new vscode.EventEmitter();
// Every step of a sync's progress, and undefined when it ends; for the end-to-end test.
/** @type {vscode.EventEmitter<{ percent: number, message: string } | undefined>} */
const indexingChanged = new vscode.EventEmitter();
/** @type {typeof import("node:sqlite") | undefined} */
let sqlite;
/** @type {string | undefined} */
let sqliteError;
/** @type {Worker | undefined} */
let worker;
/** @type {Map<number, Workspace>} */
const requests = new Map();
let nextRequest = 1;
let stopping = false;
let showStatus = () => {};
// Opening a file from a tree must not re-root the tree being explored.
/** @type {string | undefined} */
let openedFromTree;
/** @type {string | undefined} the file the dependency views show, as a URI */
let shownInTree;
// The Show Graph page and the flow diagram page; `hash` is the view each
// shows, kept for reloads.
/** @typedef {{ panel: vscode.WebviewPanel, workspace: Workspace, hash: string }} PagePanel */
/** @type {PagePanel | undefined} */
let graphPanel;
/** @type {PagePanel | undefined} */
let flowPanel;

/** @param {vscode.ExtensionContext} context */
export function activate(context) {
  const storage = (context.storageUri ?? context.globalStorageUri).fsPath;
  mkdirSync(storage, { recursive: true });
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const name = createHash("sha256").update(folder.uri.toString()).digest("hex").slice(0, 16);
    workspaces.set(folder.uri.toString(), { folder, graphFile: join(storage, `${name}.sqlite`), changes: new Set(), running: 0 });
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = "pliGraph.menu";
  showStatus = () => {
    const all = [...workspaces.values()];
    const indexing = all.find((w) => w.indexing)?.indexing;
    const failed = sqliteError ?? all.find((w) => w.error)?.error;
    if (failed) {
      status.text = "$(error) PL/I graph";
      status.tooltip = failed;
    } else if (indexing) {
      status.text = `$(sync~spin) PL/I graph ${indexing.percent}%`;
      status.tooltip = `Indexing. ${indexing.message}`;
    } else if (all.some((w) => !w.graph)) {
      status.text = "$(sync~spin) PL/I graph";
      status.tooltip = "Building the graph for the first time…";
    } else {
      status.text = "$(type-hierarchy) PL/I graph";
      status.tooltip = "The graph follows every change. Click for the graph, the log or a rebuild.";
    }
    status.show();
  };

  context.subscriptions.push(
    log,
    status,
    vscode.commands.registerCommand("pliGraph.rebuild", () => {
      for (const workspace of workspaces.values()) requestSync(workspace, { rebuild: true });
    }),
    vscode.commands.registerCommand("pliGraph.menu", async () => {
      const items = [
        { label: "$(type-hierarchy) Show Graph", run: () => vscode.commands.executeCommand("pliGraph.show") },
        { label: "$(checklist) Coverage Report", detail: "What the grammars could not read and which names resolve to nothing.", run: () => vscode.commands.executeCommand("pliGraph.coverage") },
        { label: "$(output) Show Log", run: () => log.show() },
        { label: "$(refresh) Rebuild Graph", detail: "Reads every file again, which takes minutes on a large repository.", run: () => vscode.commands.executeCommand("pliGraph.rebuild") },
      ];
      const choice = await vscode.window.showQuickPick(items, { title: "PL/I Graph" });
      log.info(`status bar menu: ${choice?.label ?? "dismissed"}`);
      await choice?.run();
    }),
    vscode.commands.registerCommand("pliGraph.open", open),
    vscode.commands.registerCommand("pliGraph.show", () => showGraph(context)),
    vscode.commands.registerCommand("pliGraph.flow", () => showFlowAtCursor(context)),
    vscode.commands.registerCommand("pliGraph.flowOf", (/** @type {string | undefined} */ name) => showFlowOf(context, name)),
    vscode.commands.registerCommand("pliGraph.coverage", () => showCoverage(context)),
    vscode.commands.registerCommand("pliGraph.showScreen", (/** @type {vscode.Uri | undefined} */ uri) => showScreen(context, uri)),
    vscode.commands.registerCommand("pliGraph.tab", pliTab),
    registerMcpServer(context),
    vscode.languages.registerDefinitionProvider(
      LANGUAGES.map((language) => ({ language })),
      { provideDefinition },
    ),
    vscode.languages.registerReferenceProvider(
      LANGUAGES.map((language) => ({ language })),
      { provideReferences },
    ),
    vscode.languages.registerCodeActionsProvider({ language: "pli" }, { provideCodeActions }),
    vscode.languages.registerCompletionItemProvider(
      ["pli", "hlasm", "jcl"].map((language) => ({ language })),
      { provideCompletionItems },
      ".",
      ":",
    ),
    vscode.languages.registerDocumentSemanticTokensProvider(
      LANGUAGES.map((language) => ({ language })),
      highlighting(context),
      SEMANTIC_LEGEND,
    ),
    treeView("pliGraphDependencies", "dependencies"),
    treeView("pliGraphDependents", "dependents"),
    vscode.window.onDidChangeActiveTextEditor(() => followEditor()),
    // A file opened from the views keeps them where they are until its
    // editor is used: a click or key there doesn't change the active editor.
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const document = event.textEditor.document;
      if (event.kind === undefined || event.textEditor !== vscode.window.activeTextEditor) return;
      if (document.uri.toString() === shownInTree || !inGraph(document)) return;
      log.info(`${vscode.workspace.asRelativePath(document.uri)} focused, reloading the dependency views`);
      // Hidden views don't ask for their rows, so this fires once per file, not per click.
      shownInTree = document.uri.toString();
      changed.fire(undefined);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      // Changing the language reopens the document in the same editor.
      if (document === vscode.window.activeTextEditor?.document) {
        followEditor();
      }
      vscode.window.visibleTextEditors.filter((editor) => editor.document === document).forEach(fitIndentation);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach((editor) => claimMember(editor.document));
      editors.forEach(fitIndentation);
    }),
    changed.event(() => vscode.window.visibleTextEditors.forEach((editor) => claimMember(editor.document))),
    vscode.workspace.onDidChangeConfiguration((event) => {
      for (const workspace of workspaces.values()) {
        if (event.affectsConfiguration("pliGraph.extensionlessMembers", workspace.folder)) requestSync(workspace, {});
      }
    }),
  );

  vscode.window.visibleTextEditors.forEach(fitIndentation);

  if (loadSqlite()) {
    startWorker(context);
    for (const workspace of workspaces.values()) {
      context.subscriptions.push(watch(workspace));
      // The graph of the last session answers until the first sync is done.
      if (existsSync(workspace.graphFile)) openGraph(workspace);
      requestSync(workspace, {});
    }
  }
  showStatus();
  followEditor();
  // Lets the end-to-end test wait for the graph instead of sleeping.
  return { onDidUpdateGraph: changed.event, onDidChangeIndexing: indexingChanged.event };
}

export function deactivate() {
  stopping = true;
  void worker?.terminate();
  for (const workspace of workspaces.values()) workspace.db?.close();
}

const SEMANTIC_LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

/**
 * Colors documents from the grammars' highlights queries.
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.DocumentSemanticTokensProvider}
 */
function highlighting(context) {
  const ready = createHighlighter(join(context.extensionPath, "out")).catch((error) => {
    log.error(`[PLG014E] Loading the grammars for highlighting failed; only the TextMate colors remain.`, error);
    return undefined;
  });
  return {
    async provideDocumentSemanticTokens(document) {
      const highlighter = await ready;
      if (!highlighter) return undefined;
      try {
        const builder = new vscode.SemanticTokensBuilder(SEMANTIC_LEGEND);
        const language = /** @type {import("./highlight.js").HighlightLanguage} */ (document.languageId);
        for (const token of highlight(highlighter, language, document.getText())) {
          builder.push(token.line, token.char, token.length, token.type, token.modifiers);
        }
        return builder.build();
      } catch (error) {
        log.error(`[PLG015E] Highlighting ${document.uri.fsPath} failed.`, error);
        return undefined;
      }
    },
  };
}

// Electron ships node:sqlite only in recent VS Code versions, so it is loaded
// here, where its absence can be reported, and not at import time.
function loadSqlite() {
  try {
    sqlite = createRequire(__filename)("node:sqlite");
    return true;
  } catch (error) {
    sqliteError = `[PLG005E] This VS Code has no node:sqlite (Node ${process.versions.node}); update VS Code. ${error}`;
    log.error(sqliteError);
    void vscode.window.showErrorMessage(sqliteError);
    return false;
  }
}

/** @param {vscode.ExtensionContext} context */
function startWorker(context) {
  const started = new Worker(join(context.extensionPath, "out", "worker.cjs"), {
    workerData: { grammars: join(context.extensionPath, "out") },
  });
  worker = started;
  started.on("message", (/** @type {SyncReply} */ reply) => {
    const workspace = requests.get(reply.id);
    if (!workspace) return;
    if ("progress" in reply) {
      progressed(workspace, reply.id, reply.progress);
      return;
    }
    if ("focused" in reply) {
      log.info(`${workspace.folder.name}: the open file and what it uses are indexed, reading the rest`);
      openGraph(workspace);
      changed.fire(undefined);
      void graphPanel?.panel.webview.postMessage({ type: "changed" });
      void flowPanel?.panel.webview.postMessage({ type: "changed" });
      return;
    }
    requests.delete(reply.id);
    workspace.running--;
    endIndexing(workspace);
    syncChanges(workspace);
    if ("error" in reply) {
      workspace.error = `[PLG011E] Indexing ${workspace.folder.name} failed; the graph may be out of date. See the 'PL/I Graph' output.`;
      log.error(`${workspace.error}\n${reply.error}`);
      void vscode.window.showErrorMessage(workspace.error, "Show Output").then((choice) => choice && log.show());
      showStatus();
      return;
    }
    const result = reply.result;
    log.info(
      `${workspace.folder.name}: synced ${result.changed} files (read in ${result.parseMs} ms), ` +
        `linked ${result.relinked} references in ${result.linkMs} ms`,
    );
    for (const f of result.failures) {
      const what = f.code === "PLG024E" ? "Resolving the fields of" : "Reading";
      log.error(`[${f.code}] ${what} ${f.path} failed; its facts are missing. Please report it with the file.\n${f.error}`);
    }
    for (const e of result.syntaxErrors) {
      log.warn(`[PLG023W] ${e.path}:${e.line}: ${e.count} syntax error${e.count > 1 ? "s" : ""} the grammar does not know; facts there may be missing.`);
    }
    if (result.syntaxErrors.length) {
      log.warn(`[PLG023W] ${workspace.folder.name}: ${result.syntaxErrors.length} of ${result.changed} files read have syntax the grammar does not know. The graph's files table lists them (syntax_errors, error_line).`);
    }
    workspace.error = undefined;
    const first = !workspace.graph;
    if (first) openGraph(workspace);
    if (first || result.changed > 0) {
      changed.fire(undefined);
      void graphPanel?.panel.webview.postMessage({ type: "changed" });
      void flowPanel?.panel.webview.postMessage({ type: "changed" });
    }
    showStatus();
  });
  const failed = (/** @type {unknown} */ why) => {
    if (stopping || worker !== started) return;
    worker = undefined;
    const message = `[PLG012E] The indexer stopped (${why}); the graph is no longer updated. Reload the window to start it again.`;
    log.error(message);
    for (const workspace of workspaces.values()) {
      workspace.error = message;
      endIndexing(workspace);
    }
    showStatus();
    void vscode.window.showErrorMessage(message, "Show Output").then((choice) => choice && log.show());
  };
  started.on("error", (error) => failed(error.stack ?? error));
  started.on("exit", (code) => failed(`exit code ${code}`));
}

/**
 * @param {Workspace} workspace
 * @param {{ paths?: string[], rebuild?: boolean }} what
 */
function requestSync(workspace, what) {
  if (!worker) return;
  const id = nextRequest++;
  requests.set(id, workspace);
  workspace.running++;
  const members = vscode.workspace.getConfiguration("pliGraph", workspace.folder).get("extensionlessMembers", true);
  /** @type {SyncRequest} */
  const request = { id, graph: workspace.graphFile, root: workspace.folder.uri.fsPath, members, ...what };
  log.info(
    `${workspace.folder.name}: ${what.rebuild ? "rebuilding the graph" : what.paths ? `syncing ${what.paths.join(", ")}` : "syncing all files"}`,
  );
  worker.postMessage(request);
}

// Reports the folder's file changes to the worker. A change while the worker
// is busy waits for it, so a git checkout's thousands of changes become a few
// syncs, not thousands.
/** @param {Workspace} workspace */
function watch(workspace) {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace.folder, "**/*"));
  /** @param {vscode.Uri} uri */
  const report = (uri) => {
    const path = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    if (path.split("/").some((part) => part.startsWith("."))) return;
    workspace.changes.add(path);
    syncChanges(workspace);
  };
  watcher.onDidCreate(report);
  watcher.onDidChange(report);
  watcher.onDidDelete(report);
  return watcher;
}

/** @param {Workspace} workspace */
function syncChanges(workspace) {
  if (workspace.running > 0 || workspace.changes.size === 0) return;
  const paths = [...workspace.changes];
  workspace.changes.clear();
  requestSync(workspace, { paths });
}

/** @param {Workspace} workspace */
function openGraph(workspace) {
  if (!sqlite || workspace.graph) return;
  try {
    const db = new sqlite.DatabaseSync(workspace.graphFile);
    // The worker writes in WAL mode; wait out its commits instead of failing.
    db.exec("PRAGMA busy_timeout = 2000");
    const graph = new Graph(db, workspace.folder.uri.fsPath);
    // An open editor's text, unsaved changes included, is what the user sees.
    const fromDisk = graph.read;
    graph.read = (path) => openText(workspace.folder.uri, path) ?? fromDisk(path);
    workspace.db = db;
    workspace.graph = graph;
    workspace.symbols = new Symbols(graph);
    log.info(`${workspace.folder.name}: graph in ${workspace.graphFile}`);
  } catch (error) {
    workspace.error = `[PLG013E] Opening the graph of ${workspace.folder.name} failed: ${error}`;
    log.error(workspace.error);
  }
}

/**
 * Moves the progress bar of a sync on.
 * @param {Workspace} workspace
 * @param {number} id
 * @param {import("./indexer.js").Progress} progress
 */
function progressed(workspace, id, progress) {
  const state = describe(progress);
  let indexing = workspace.indexing;
  if (indexing?.id !== id) {
    endIndexing(workspace);
    indexing = { id, percent: 0, message: state.message, shown: 0 };
    workspace.indexing = indexing;
    if (progress.phase === "parse" && progress.total >= NOTIFY_FROM_FILES) {
      const shown = indexing;
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Indexing ${workspace.folder.name}` },
        (bar) =>
          new Promise((resolve) => {
            shown.report = (value) => bar.report(value);
            shown.finish = () => resolve(undefined);
            bar.report({ message: shown.message, increment: shown.percent });
            shown.shown = shown.percent;
          }),
      );
    }
  }
  indexing.percent = Math.max(indexing.percent, state.percent);
  indexing.message = state.message;
  if (indexing.report) {
    indexing.report({ message: indexing.message, increment: indexing.percent - indexing.shown });
    indexing.shown = indexing.percent;
  }
  indexingChanged.fire({ percent: indexing.percent, message: indexing.message });
  showStatus();
}

/** @param {Workspace} workspace */
function endIndexing(workspace) {
  if (!workspace.indexing) return;
  workspace.indexing.finish?.();
  workspace.indexing = undefined;
  indexingChanged.fire(undefined);
}

/**
 * The workspace and graph-relative path of a file, if it is in a folder.
 * @param {vscode.Uri} uri
 * @returns {{ workspace: Workspace, path: string } | undefined}
 */
function locate(uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const workspace = folder && workspaces.get(folder.uri.toString());
  if (!workspace) {
    return undefined;
  }
  const path = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  return { workspace, path };
}

const LANGUAGES = ["pli", "jcl", "hlasm", "db2"];

// z/OS members have no extension, so VS Code opens them as plain text. Those
// in the graph are switched to the language they were indexed as, once an
// editor shows them: a hover's definition preview opens the member without
// one, and switching that redoes the hover, which opens it again, forever.
/** @param {vscode.TextDocument} document */
function claimMember(document) {
  if (document.languageId !== "plaintext" || document.uri.scheme !== "file") {
    return;
  }
  const where = locate(document.uri);
  const module = where?.workspace.graph?.module(where.path);
  if (!where || !module) {
    return;
  }
  log.info(`${where.path} is a ${module.language} module in the graph, switching its language`);
  void vscode.languages.setTextDocumentLanguage(document, module.language);
}

// An editor keeps the indentation VS Code guessed while its document was plain
// text, or restored from before the extension ran, so a PL/I editor is set to
// the [pli] settings (3 columns, spaces) whenever it shows up.
/** @param {vscode.TextEditor} editor */
function fitIndentation(editor) {
  if (editor.document.languageId !== "pli") return;
  const settings = vscode.workspace.getConfiguration("editor", editor.document);
  const wanted = { tabSize: settings.get("tabSize", 3), indentSize: settings.get("tabSize", 3), insertSpaces: settings.get("insertSpaces", true) };
  if (editor.options.tabSize === wanted.tabSize && editor.options.indentSize === wanted.indentSize && editor.options.insertSpaces === wanted.insertSpaces) return;
  log.info(`${vscode.workspace.asRelativePath(editor.document.uri)} indents by ${editor.options.tabSize}, setting it to ${wanted.tabSize}`);
  editor.options = wanted;
}

// Files in one of the graph's languages, and any other file in the graph,
// whatever language VS Code gave it.
/** @param {vscode.TextDocument} document */
function inGraph(document) {
  if (LANGUAGES.includes(document.languageId)) {
    return true;
  }
  const where = locate(document.uri);
  return Boolean(where && where.workspace.graph?.module(where.path));
}

function followEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const where = locate(editor.document.uri);
  if (where && worker) {
    /** @type {import("./worker.js").FocusRequest} */
    const focus = { root: where.workspace.folder.uri.fsPath, focus: where.path };
    worker.postMessage(focus);
  }
  void vscode.commands.executeCommand("setContext", "pliGraph.activeEditorIsPli", inGraph(editor.document));
  const fromTree = editor.document.uri.toString() === openedFromTree;
  openedFromTree = undefined;
  if (!fromTree) {
    changed.fire(undefined);
  }
}

/**
 * The text of `path` in an open editor, if it is open.
 * @param {vscode.Uri} folder
 * @param {string} path
 * @returns {string | undefined}
 */
function openText(folder, path) {
  const uri = vscode.Uri.joinPath(folder, path).toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

/**
 * Lines and columns from 0.
 * @typedef {object} Place
 * @property {string} path
 * @property {number} line
 * @property {number} col
 * @property {number} [endCol]
 */

/** @param {Symbol} s @returns {Place} */
const symbolPlace = (s) => ({ path: s.path, line: s.line, col: s.col, endCol: s.endCol });
/** @param {Target} t @returns {Place} */
const targetPlace = (t) => ({ path: t.path, line: t.line - 1, col: t.col ?? 0, endCol: t.endCol });

/**
 * Where the name at `position` is defined: what the indexer resolved for
 * this place first, then a variable, field, label or column, then any
 * definition of that name. `how` says which answered, for the log.
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @returns {{ word: string, range: vscode.Range, places: Place[], how: string } | undefined}
 */
function definitionsAt(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_@#$]+/);
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  if (!range || !where || !graph) {
    return undefined;
  }
  const word = document.getText(range);
  const line = position.line + 1;
  const resolved = graph.definitions(where.path, line, word, false);
  if (resolved.length > 0) {
    return { word, range, places: resolved.map(targetPlace), how: "graph" };
  }
  /** @type {Symbol[]} */
  let declared = [];
  try {
    declared = where.workspace.symbols?.definitions(where.path, document.offsetAt(position)) ?? [];
  } catch (error) {
    log.error(`[PLG009E] reading the declarations of ${where.path} failed: ${error}`);
  }
  if (declared.length > 0) {
    return { word, range, places: declared.map(symbolPlace), how: "declaration" };
  }
  return { word, range, places: graph.definitions(where.path, line, word).map(targetPlace), how: "name" };
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @returns {vscode.Location[]}
 */
function provideDefinition(document, position) {
  const started = Date.now();
  const found = definitionsAt(document, position);
  const where = locate(document.uri);
  if (!found || !where) {
    return [];
  }
  const seen = new Set();
  const places = found.places.filter((p) => !seen.has(`${p.path}:${p.line}:${p.col}`) && seen.add(`${p.path}:${p.line}:${p.col}`));
  log.info(`definition of ${found.word} at ${where.path}:${position.line + 1}: ${places.length} found by ${found.how} in ${Date.now() - started} ms`);
  // Ctrl+click on a definition shows its references instead, but only when
  // the definition VS Code gets back covers the cursor.
  if (places.some((p) => p.path === where.path && p.line === position.line)) {
    return [new vscode.Location(document.uri, found.range)];
  }
  return places.map(
    (p) => new vscode.Location(vscode.Uri.joinPath(where.workspace.folder.uri, p.path), new vscode.Position(p.line, p.col)),
  );
}

// On a procedure's name, where it is declared or called: draw its flow.
// Runs on every cursor move, so it logs nothing; the command does.
/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Range} range
 * @returns {vscode.CodeAction[]}
 */
function provideCodeActions(document, range) {
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  const found = graph && definitionsAt(document, range.start);
  if (!where || !graph || !found) return [];
  const word = found.word.toUpperCase();
  const declared = [{ path: where.path, line: range.start.line }, ...found.places];
  const procedure = declared
    .map((p) => graph.flowProcedure(p.path, p.line + 1))
    .find((id, i) => id?.endsWith(`:${word}:${declared[i].line + 1}`));
  if (!procedure) return [];
  const action = new vscode.CodeAction(`Show Flow Diagram of ${word}`);
  action.command = { title: action.title, command: "pliGraph.flowOf", arguments: [procedure] };
  return [action];
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @param {vscode.ReferenceContext} context
 * @returns {vscode.Location[]}
 */
function provideReferences(document, position, context) {
  const found = definitionsAt(document, position);
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  if (!found || !where || !graph) {
    return [];
  }
  const started = Date.now();
  /** @param {string} path */
  const uri = (path) => vscode.Uri.joinPath(where.workspace.folder.uri, path);
  /** @type {{ path: string, line: number, col: number, endLine: number, endCol: number }[]} */
  let sites;
  if (found.how === "declaration") {
    sites = (where.workspace.symbols?.references(where.path, document.offsetAt(position)) ?? []).map((s) => ({
      ...s,
      endLine: s.line,
    }));
  } else {
    // The graph counts lines from 1.
    sites = graph
      .references(where.path, position.line + 1, found.word, found.how === "name")
      .map((s) => ({ ...s, line: s.line - 1, endLine: s.endLine - 1 }));
  }
  log.info(`references of ${found.word} at ${where.path}:${position.line + 1}: ${sites.length} found by ${found.how} in ${Date.now() - started} ms`);
  const locations = sites.map((s) => new vscode.Location(uri(s.path), new vscode.Range(s.line, s.col, s.endLine, s.endCol)));
  if (context.includeDeclaration) {
    for (const p of found.places) {
      const end = p.endCol ?? p.col;
      locations.unshift(new vscode.Location(uri(p.path), new vscode.Range(p.line, p.col, p.line, end)));
    }
  }
  return locations;
}

/** @type {Record<Symbol["kind"], vscode.CompletionItemKind>} */
const SYMBOL_KINDS = {
  variable: vscode.CompletionItemKind.Variable,
  field: vscode.CompletionItemKind.Field,
  label: vscode.CompletionItemKind.Constant,
  column: vscode.CompletionItemKind.Field,
};

// Completion items for the programs, tables and screens of the whole
// project, built once per graph version: a repository has thousands.
/** @type {Map<string, vscode.CompletionItem[]>} */
const projectItems = new Map();

/**
 * @param {Workspace} workspace
 * @param {string} language
 * @param {vscode.CompletionItemKind} kind
 * @param {string} what
 * @returns {vscode.CompletionItem[]}
 */
function topLevelItems(workspace, language, kind, what) {
  const graph = /** @type {Graph} */ (workspace.graph);
  const folder = workspace.folder.uri.toString();
  const key = `${folder}:${Graph.version(graph.db)}:${language}`;
  let items = projectItems.get(key);
  if (!items) {
    const seen = new Set();
    items = graph.topLevel(language).flatMap((d) => {
      if (seen.has(d.name)) return [];
      seen.add(d.name);
      const item = new vscode.CompletionItem({ label: d.name, description: d.path }, kind);
      item.detail = `${what} in ${d.path}`;
      return [item];
    });
    for (const old of projectItems.keys()) {
      if (old.startsWith(`${folder}:`) && old.endsWith(`:${language}`)) projectItems.delete(old);
    }
    projectItems.set(key, items);
  }
  return items;
}

/**
 * @param {vscode.TextDocument} document
 * @param {vscode.Position} position
 * @returns {vscode.CompletionItem[]}
 */
function provideCompletionItems(document, position) {
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  const symbols = where?.workspace.symbols;
  if (!where || !graph || !symbols) {
    return [];
  }
  const started = Date.now();
  const language = document.languageId;
  /** @type {vscode.CompletionItem[]} */
  const items = [];
  let context = "code";
  if (language === "jcl") {
    items.push(...topLevelItems(where.workspace, "pli", vscode.CompletionItemKind.Function, "program"));
    items.push(...topLevelItems(where.workspace, "jcl", vscode.CompletionItemKind.Module, "job or procedure"));
  } else {
    let found;
    try {
      found = symbols.completions(where.path, document.offsetAt(position));
    } catch (error) {
      log.error(`[PLG010E] completing in ${where.path} failed: ${error}`);
      return [];
    }
    context = found.context;
    for (const s of found.symbols) {
      const item = new vscode.CompletionItem(
        { label: s.name, description: s.path === where.path ? undefined : s.path },
        SYMBOL_KINDS[s.kind],
      );
      item.detail = s.detail;
      items.push(item);
    }
    if (context === "sql") {
      items.push(...topLevelItems(where.workspace, "db2", vscode.CompletionItemKind.Struct, "table"));
    } else if (context === "code" && language === "pli") {
      for (const block of graph.blocks(where.path)) {
        const item = new vscode.CompletionItem(block.name, vscode.CompletionItemKind.Function);
        item.detail = `procedure, line ${block.line}`;
        items.push(item);
      }
      for (const name of PLI_BUILTINS) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
        item.detail = "built-in function";
        items.push(item);
      }
      items.push(...topLevelItems(where.workspace, "pli", vscode.CompletionItemKind.Function, "program"));
    } else if (context === "code" && language === "hlasm") {
      items.push(...topLevelItems(where.workspace, "hlasm", vscode.CompletionItemKind.Reference, "format or message"));
    }
  }
  log.debug(`completion at ${where.path}:${position.line + 1} (${context}): ${items.length} items in ${Date.now() - started} ms`);
  return items;
}

/**
 * @typedef {object} Item
 * @property {TreeRow} row
 * @property {Workspace} workspace
 */

/** @type {Record<TreeRow["kind"], { icon: string, description: string }>} */
const ROW_LOOK = {
  file: { icon: "file-code", description: "" },
  include: { icon: "file-symlink-file", description: "%INCLUDE" },
  call: { icon: "symbol-method", description: "calls" },
  table: { icon: "database", description: "" },
  includedBy: { icon: "file-symlink-file", description: "includes it" },
  calledBy: { icon: "symbol-method", description: "calls it" },
  unresolved: { icon: "warning", description: "not found" },
};

/**
 * @param {string} id
 * @param {"dependencies" | "dependents"} direction
 * @returns {vscode.Disposable}
 */
function treeView(id, direction) {
  /** @type {vscode.TreeDataProvider<Item>} */
  const provider = {
    onDidChangeTreeData: changed.event,
    getChildren(item) {
      if (item) {
        const graph = /** @type {Graph} */ (item.workspace.graph);
        return graph[direction](item.row).map((row) => ({ row, workspace: item.workspace }));
      }
      const document = vscode.window.activeTextEditor?.document;
      const where = document && locate(document.uri);
      shownInTree = document?.uri.toString();
      view.message = undefined;
      if (!document || !inGraph(document)) {
        view.message = "Open a PL/I, JCL, MFS or Db2 file.";
        return [];
      }
      if (!where?.workspace.graph) {
        view.message = sqliteError ?? where?.workspace.error ?? "Building the graph for the first time…";
        return [];
      }
      const root = where.workspace.graph.root(where.path);
      if (!root) {
        view.message = `${where.path} is not in the graph yet.`;
        return [];
      }
      return [{ row: root, workspace: where.workspace }];
    },
    getTreeItem({ row, workspace }) {
      const expandable = row.kind !== "unresolved" && row.module !== undefined && !row.repeated;
      const item = new vscode.TreeItem(
        row.label,
        row.kind === "file"
          ? vscode.TreeItemCollapsibleState.Expanded
          : expandable
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
      );
      const look = ROW_LOOK[row.kind];
      const file = row.target && row.kind !== "file" && row.kind !== "include" ? row.target.path : "";
      item.description = [look.description, row.detail, file, row.repeated ? "(repeated)" : ""].filter(Boolean).join(" ");
      item.iconPath = new vscode.ThemeIcon(look.icon);
      item.tooltip = row.target ? `${row.target.path}:${row.target.line}` : "No definition found";
      if (row.target) {
        item.command = { command: "pliGraph.open", title: "Open", arguments: [workspace.folder.uri, row.target] };
      }
      return item;
    },
  };
  const view = vscode.window.createTreeView(id, { treeDataProvider: provider });
  return view;
}

/**
 * @param {vscode.Uri} folder
 * @param {Target} target
 */
async function open(folder, target) {
  const uri = vscode.Uri.joinPath(folder, target.path);
  const start = new vscode.Position(target.line - 1, target.col ?? 0);
  const end = new vscode.Position(target.line - 1, target.endCol ?? target.col ?? 0);
  if (uri.toString() !== vscode.window.activeTextEditor?.document.uri.toString()) {
    openedFromTree = uri.toString();
  }
  try {
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(start, end), preserveFocus: true });
  } catch (error) {
    const message = `[PLG004E] Opening ${target.path} failed: ${error}`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
  }
}

/**
 * What the graph page posts: the view it switched to, a file to open, a
 * question for the graph, or a list to save as a file.
 * @typedef {object} PageMessage
 * @property {"route" | "open" | "ask" | "save" | "flow"} type
 * @property {string} [procedure] the page id of the procedure whose flow to show
 * @property {string} [title] a new title for the page's tab
 * @property {string} [hash]
 * @property {number} [drawMs]
 * @property {number} [sinceLoadMs]
 * @property {string} [path]
 * @property {number} [line]
 * @property {number} [id]
 * @property {import("./graphpage.js").PageQuestion["what"]} [what]
 * @property {unknown[]} [args]
 * @property {string} [name] the file name a saved list is offered under
 * @property {string} [text]
 */

/** The workspace of the active editor's file, else the first; reports PLG006E when it has no graph yet. */
function workspaceShown() {
  const editor = vscode.window.activeTextEditor;
  const where = editor && locate(editor.document.uri);
  const workspace = where?.workspace ?? [...workspaces.values()][0];
  if (workspace?.graph) return { editor, where, workspace, graph: workspace.graph };
  const message = sqliteError ?? workspace?.error ?? "[PLG006E] There is no graph to show yet: it is still being built, or no folder is open.";
  log.error(message);
  void vscode.window.showErrorMessage(message);
  return undefined;
}

// PL/I's code starts in column 2, after the carriage control in column 1,
// so Tab stops there and then every 3 columns, which VS Code's even tab
// stops can't do. What ends in column 72 and the sequence number stay put.
async function pliTab() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const { line, character: column } = editor.selection.active;
  const next = column < 1 ? 1 : column + 3 - ((column - 1) % 3);
  const text = editor.document.lineAt(line).text;
  const indented = insertBlanks(text, column, next - column);
  if (indented === undefined) {
    const message = `[PLG036W] No room left before column 72 on line ${line + 1} to indent to column ${next + 1}.`;
    log.warn(message);
    vscode.window.setStatusBarMessage(`$(warning) ${message}`, 5000);
    return;
  }
  await editor.edit((edit) => edit.replace(new vscode.Range(line, 0, line, text.length), indented));
  editor.selection = new vscode.Selection(line, next, line, next);
}

/** @param {vscode.ExtensionContext} context */
function showGraph(context) {
  const shown = workspaceShown();
  if (!shown) return;
  const module = shown.where && shown.graph.module(shown.where.path);
  const hash = module ? `v=module&id=${encodeURIComponent(module.path)}` : (graphPanel?.hash ?? "");
  openPage(context, shown.workspace, "graph", hash, `PL/I Graph: ${shown.workspace.folder.name}`, Boolean(module));
}

// The flow of the procedure at the cursor, else of the file's main or first procedure.
/** @param {vscode.ExtensionContext} context */
function showFlowAtCursor(context) {
  const shown = workspaceShown();
  if (!shown) return;
  const procedure = shown.where && shown.graph.flowProcedure(shown.where.path, (shown.editor?.selection.active.line ?? 0) + 1);
  if (!procedure) {
    const message = `[PLG034E] There is no procedure to draw the flow of${shown.where ? ` in ${shown.where.path}` : ": no PL/I file is open"}.`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  showFlow(context, shown.workspace, procedure);
}

// The flow of a procedure picked by name: `name` when a caller passes one
// (or a procedure's exact page id, as the code action does), else a quick
// pick that searches the graph as the user types.
/** @param {vscode.ExtensionContext} context @param {string} [name] */
async function showFlowOf(context, name) {
  const shown = workspaceShown();
  if (!shown) return;
  const procedures = (/** @type {string} */ query) => shown.graph.pageSearch(query).filter((n) => n.kind === "function");
  if (name && shown.graph.symbolOf(name) !== undefined) return showFlow(context, shown.workspace, name);
  if (name) {
    const found = procedures(name).find((n) => n.name.toUpperCase() === name.toUpperCase());
    if (found) return showFlow(context, shown.workspace, found.id);
    const message = `[PLG035E] There is no procedure ${name} to draw the flow of in ${shown.workspace.folder.name}.`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  /** @type {vscode.QuickPick<vscode.QuickPickItem & { id: string }>} */
  const pick = vscode.window.createQuickPick();
  pick.placeholder = "Show the flow of procedure…";
  pick.matchOnDescription = true;
  pick.onDidChangeValue((query) => {
    pick.items = procedures(query).map((n) => ({ id: n.id, label: n.name, description: `${n.path}:${n.line}` }));
  });
  pick.onDidAccept(() => {
    const chosen = pick.selectedItems[0];
    pick.dispose();
    if (chosen) showFlow(context, shown.workspace, chosen.id);
  });
  pick.onDidHide(() => pick.dispose());
  pick.show();
}

/** @param {vscode.ExtensionContext} context @param {Workspace} workspace @param {string} procedure a page id */
function showFlow(context, workspace, procedure) {
  log.info(`flow diagram of ${procedure}`);
  const name = procedure.replace(/^.*:(.*):\d+$/, "$1");
  openPage(context, workspace, "flow", `v=flow&id=${encodeURIComponent(procedure)}`, `PL/I Flow: ${name}`, true);
}

// Both pages ask for what they draw. A worker of its own with its own
// connection answers, so the overview's second of SQL on a big graph never
// stalls the editor. A page already open for the workspace is reused.
/**
 * @param {vscode.ExtensionContext} context
 * @param {Workspace} workspace
 * @param {"graph" | "flow"} kind
 * @param {string} hash the view to show
 * @param {string} title
 * @param {boolean} go whether an open page goes to `hash`
 */
function openPage(context, workspace, kind, hash, title, go) {
  const open = kind === "graph" ? graphPanel : flowPanel;
  if (open?.workspace === workspace) {
    open.panel.reveal(undefined, true);
    if (go) {
      open.panel.title = title;
      void open.panel.webview.postMessage({ type: "go", hash });
    }
    return;
  }
  open?.panel.dispose();
  const panel = vscode.window.createWebviewPanel(
    kind === "graph" ? "pliGraph" : "pliFlow",
    title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  /** @type {PagePanel} */
  const shown = { panel, workspace, hash };
  const current = () => (kind === "graph" ? graphPanel : flowPanel) === shown;
  if (kind === "graph") graphPanel = shown;
  else flowPanel = shown;
  panel.webview.html = graphPage(context, workspace.folder.name, hash);

  const name = workspace.folder.name;
  /** @type {Map<number, { what: string, started: number }>} */
  const pending = new Map();
  const queries = new Worker(join(context.extensionPath, "out", "graphpage.cjs"), {
    workerData: { graph: workspace.graphFile, root: workspace.folder.uri.fsPath, grammars: join(context.extensionPath, "out") },
  });
  queries.on("message", (/** @type {import("./graphpage.js").PageAnswer} */ answer) => {
    const asked = pending.get(answer.id);
    pending.delete(answer.id);
    if ("error" in answer) {
      const text = `[PLG026E] The ${kind} page's question ${asked?.what} for ${name} failed: ${answer.error}`;
      log.error(text);
      void panel.webview.postMessage({ type: "answer", id: answer.id, error: text });
      return;
    }
    log.info(`${kind} page ${asked?.what}: ${answer.ms} ms in SQL, ${Date.now() - (asked?.started ?? 0)} ms in all`);
    void panel.webview.postMessage({ type: "answer", id: answer.id, result: answer.result });
  });
  /** @type {string | undefined} */
  let stopped;
  const failed = (/** @type {unknown} */ why) => {
    stopped ??= `[PLG027E] The ${kind} page's worker for ${name} stopped: ${why}`;
    log.error(stopped);
    for (const id of pending.keys()) void panel.webview.postMessage({ type: "answer", id, error: stopped });
    pending.clear();
  };
  queries.on("error", failed);
  queries.on("exit", (code) => {
    if (current()) failed(`exit code ${code}`);
  });

  panel.onDidDispose(() => {
    if (current() && kind === "graph") graphPanel = undefined;
    if (current() && kind === "flow") flowPanel = undefined;
    void queries.terminate();
  });
  panel.webview.onDidReceiveMessage((/** @type {PageMessage} */ message) => {
    if (message.type === "ask" && message.id !== undefined && stopped) {
      void panel.webview.postMessage({ type: "answer", id: message.id, error: stopped });
    } else if (message.type === "ask" && message.id !== undefined) {
      pending.set(message.id, { what: `${message.what}(${JSON.stringify(message.args).slice(1, -1)})`, started: Date.now() });
      queries.postMessage({ id: message.id, what: message.what, args: message.args ?? [] });
    } else if (message.type === "route") {
      shown.hash = message.hash ?? "";
      if (message.title) panel.title = message.title;
      log.info(`${kind} page shows #${shown.hash}: drawn in ${message.drawMs} ms, ${message.sinceLoadMs} ms after the page loaded`);
    } else if (message.type === "flow" && message.procedure) {
      showFlow(context, workspace, message.procedure);
    } else if (message.type === "save" && message.name && message.text !== undefined) {
      void saveList(workspace.folder.uri, message.name, message.text);
    } else if (message.type === "open" && message.path) {
      const uri = vscode.Uri.joinPath(workspace.folder.uri, message.path);
      const position = new vscode.Position((message.line ?? 1) - 1, 0);
      vscode.window
        .showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(position, position) })
        .then(undefined, (error) => {
          const text = `[PLG008E] Opening ${message.path} failed: ${error}`;
          log.error(text);
          void vscode.window.showErrorMessage(text);
        });
    }
  });
  log.info(`${kind} page for ${name} opened at #${hash}`);
}

/**
 * Asks where to save a list from the graph page, saves it and opens it.
 * @param {vscode.Uri} folder
 * @param {string} name
 * @param {string} text
 */
async function saveList(folder, name, text) {
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(folder, name), filters: { "Tab-separated values": ["tsv"] } });
  if (!target) return;
  try {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    log.info(`graph page saved ${text.split("\n").length - 2} rows to ${target.fsPath}`);
    await vscode.window.showTextDocument(target, { preview: false });
  } catch (error) {
    const message = `[PLG033E] Saving the list to ${target.fsPath} failed: ${error}`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
  }
}

/**
 * Opens the coverage report of the active file's folder as a new Markdown
 * document: what the grammars could not read, what resolves to nothing.
 * @param {vscode.ExtensionContext} context
 */
async function showCoverage(context) {
  const document = vscode.window.activeTextEditor?.document;
  const workspace = (document && locate(document.uri)?.workspace) ?? [...workspaces.values()][0];
  if (!workspace?.graph) {
    const message = sqliteError ?? workspace?.error ?? "[PLG029E] There is no graph to report on yet: it is still being built, or no folder is open.";
    log.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const name = workspace.folder.name;
  const started = Date.now();
  log.info(`coverage report for ${name} started`);
  const worker = new Worker(join(context.extensionPath, "out", "graphpage.cjs"), {
    workerData: { graph: workspace.graphFile, root: workspace.folder.uri.fsPath, grammars: join(context.extensionPath, "out") },
  });
  try {
    const report = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Reading the coverage of the ${name} graph…` },
      () =>
        new Promise((resolve, reject) => {
          worker.on("message", (/** @type {import("./graphpage.js").PageAnswer} */ answer) =>
            "error" in answer ? reject(new Error(answer.error)) : resolve(answer.result),
          );
          worker.on("error", reject);
          worker.on("exit", (code) => reject(new Error(`the worker stopped with exit code ${code}`)));
          worker.postMessage({ id: 0, what: "coverage", args: [] });
        }),
    );
    log.info(`coverage report for ${name}: ${Date.now() - started} ms`);
    const opened = await vscode.workspace.openTextDocument({ language: "markdown", content: /** @type {string} */ (report) });
    await vscode.window.showTextDocument(opened, { viewColumn: vscode.ViewColumn.Active });
  } catch (error) {
    const text = `[PLG028E] The coverage report for ${name} failed: ${error instanceof Error ? error.message : error}`;
    log.error(text);
    void vscode.window.showErrorMessage(text);
  } finally {
    void worker.terminate();
  }
}

/** @type {string | undefined} */
let pageTemplate;
/**
 * @param {vscode.ExtensionContext} context
 * @param {string} project
 * @param {string} hash
 * @returns {string}
 */
function graphPage(context, project, hash) {
  pageTemplate ??= readFileSync(vscode.Uri.joinPath(context.extensionUri, "out", "graph.html").fsPath, "utf-8");
  /** @param {string} text */
  const html = (text) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  // The page reads its view from the URL hash, which a webview cannot be opened with.
  const route = `<script>history.replaceState(null, "", ${JSON.stringify(`#${hash}`)});</script>`;
  return /** @type {string} */ (pageTemplate)
    .replace("<head>", () => `<head>${WEBVIEW_CSP}`)
    .replace("<body>", () => `<body>${route}`)
    .replaceAll("__PROJECT__", () => html(project));
}

// ---- 3270 screen --------------------------------------------------------------

/**
 * Shows an MFS format as the 3270 screen it describes, in tn3270's terminal:
 * the one the cursor is in, or one picked from the file. The page follows
 * edits of the source.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri} [uri] from the explorer or the editor title
 */
async function showScreen(context, uri) {
  const editor = vscode.window.activeTextEditor;
  const document = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
  const formats = document ? mfsFormats(document.getText()) : [];
  if (!document || formats.length === 0) {
    const message = `[PLG016E] Show 3270 Screen: ${document ? `${vscode.workspace.asRelativePath(document.uri)} has no FMT` : "open an MFS source first"}.`;
    log.warn(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const cursorLine = editor?.document === document ? editor.selection.active.line : -1;
  let format = formats.filter((f) => f.line <= cursorLine).at(-1) ?? (formats.length === 1 ? formats[0] : undefined);
  if (!format) {
    const picked = await vscode.window.showQuickPick(
      formats.map((f) => ({ label: f.name, description: `${f.fields.filter((field) => !field.protected).length} input fields, ${f.rows}×${f.cols}`, format: f })),
      { placeHolder: "Which format?" },
    );
    if (!picked) return;
    format = picked.format;
  }

  const name = format.name;
  const file = vscode.workspace.asRelativePath(document.uri);
  const panel = vscode.window.createWebviewPanel(
    "pliGraphScreen",
    `3270: ${name}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  screenTemplate ??= readFileSync(vscode.Uri.joinPath(context.extensionUri, "out", "screen.html").fsPath, "utf-8");
  panel.webview.html = screenTemplate
    .replace("<head>", () => `<head>${WEBVIEW_CSP}`)
    .replace("__SCREEN_JSON__", () => JSON.stringify({ format, file }).replaceAll("</", "<\\/"));
  log.info(`3270 screen ${name} from ${file}: ${format.texts.length} literals, ${format.fields.length} fields`);

  // Most edits leave the format as it was, and the page redraws only for one that doesn't.
  let shown = JSON.stringify(format);
  const changes = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document !== document) return;
    const changed = mfsFormats(document.getText()).find((f) => f.name === name);
    const now = JSON.stringify(changed ?? null);
    if (now === shown) return;
    shown = now;
    if (changed) void panel.webview.postMessage({ type: "format", format: changed, file });
    else void panel.webview.postMessage({ type: "missing", text: `${file} no longer has the format ${name}.` });
  });
  panel.onDidDispose(() => changes.dispose());
  panel.webview.onDidReceiveMessage((/** @type {{ type: string, line?: number, aid?: string, values?: Record<string, string> }} */ message) => {
    if (message.type === "aid") {
      log.info(`3270 screen ${name}: ${message.aid} ${JSON.stringify(message.values)}`);
    } else if (message.type === "open" && message.line !== undefined) {
      const position = new vscode.Position(message.line, 0);
      vscode.window
        .showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(position, position) })
        .then(undefined, (error) => {
          const text = `[PLG017E] Opening ${file} failed: ${error}`;
          log.error(text);
          void vscode.window.showErrorMessage(text);
        });
    }
  });
}

/** @type {string | undefined} */
let screenTemplate;

// ---- MCP server -----------------------------------------------------------------

/**
 * Offers out/mcp.cjs to Copilot's agent mode, one server per workspace folder,
 * run by VS Code's own Node. @types/vscode 1.85 predates this API, hence the cast.
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.Disposable}
 */
function registerMcpServer(context) {
  const lm = /** @type {any} */ (vscode).lm;
  const Definition = /** @type {any} */ (vscode).McpStdioServerDefinition;
  if (!lm?.registerMcpServerDefinitionProvider || !Definition) {
    log.info("This VS Code has no MCP server API; the graph's MCP server is not offered.");
    return new vscode.Disposable(() => {});
  }
  const script = vscode.Uri.joinPath(context.extensionUri, "out", "mcp.cjs").fsPath;
  const version = context.extension.packageJSON.version;
  return lm.registerMcpServerDefinitionProvider("pliGraph.mcp", {
    provideMcpServerDefinitions: () =>
      [...workspaces.values()].map(
        (w) => new Definition(`PL/I Graph: ${w.folder.name}`, process.execPath, [script, w.graphFile, w.folder.uri.fsPath], { ELECTRON_RUN_AS_NODE: "1" }, version),
      ),
  });
}

// Webviews run only the scripts and styles inlined in their page.
const WEBVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;
