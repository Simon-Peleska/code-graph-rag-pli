import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import * as vscode from "vscode";
import { Graph, type Target, type TreeRow, type WholeGraph } from "./graph.ts";
import { describe, type Progress, progressLine } from "./progress.ts";
import { PLI_BUILTINS } from "./source.ts";
import { type Symbol, Symbols } from "./symbols.ts";

// Each workspace folder gets a `cgr watch`, which keeps its project in cgr's
// SQLite graph in sync with the files. The extension only reads that database.
interface Workspace {
  folder: vscode.WorkspaceFolder;
  watcher?: ChildProcess;
  graph?: Graph;
  // Variables, fields, labels and columns, read from the source.
  symbols?: Symbols;
  error?: string;
  // The sync cgr is running, while it runs.
  indexing?: Indexing;
}

// A running sync: how far it is, and the notification showing it, if any.
interface Indexing {
  percent: number;
  message: string;
  shown: number;
  report?: (value: { message?: string; increment?: number }) => void;
  finish?: () => void;
}

// Smaller syncs, such as the one after saving a file, show only in the status bar.
const NOTIFY_FROM_FILES = 50;

const log = vscode.window.createOutputChannel("PL/I Graph", { log: true });
const workspaces = new Map<string, Workspace>();
const changed = new vscode.EventEmitter<void>();
// Every step of a sync's progress, and undefined when it ends; for the end-to-end test.
const indexingChanged = new vscode.EventEmitter<{ percent: number; message: string } | undefined>();
let db: DatabaseSync | undefined;
let dbError: string | undefined;
let version: string | undefined;
let stopping = false;
// Opening a file from a tree must not re-root the tree being explored.
let openedFromTree: string | undefined;
// The extension's own folder: the Windows package carries cgr in `cgr/`.
let extensionPath = "";
// The Show Graph page; `hash` is the view it shows, kept for reloads.
let graphPanel: { panel: vscode.WebviewPanel; workspace: Workspace; hash: string } | undefined;

// cgr's own rule for where the graph lives.
function graphFile(): string {
  if (process.env.SQLITE_GRAPH_PATH) {
    return process.env.SQLITE_GRAPH_PATH;
  }
  return join(process.env.CGR_HOME ?? join(homedir(), ".cgr"), "graph.sqlite");
}

export function activate(context: vscode.ExtensionContext) {
  extensionPath = context.extensionPath;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    workspaces.set(folder.uri.toString(), { folder });
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = "pliGraph.restart";
  const showStatus = () => {
    const syncing = [...workspaces.values()].some((w) => w.watcher && !w.graph);
    const indexing = [...workspaces.values()].find((w) => w.indexing)?.indexing;
    const failed = dbError ?? [...workspaces.values()].find((w) => w.error)?.error;
    if (failed) {
      status.text = "$(error) PL/I graph";
      status.tooltip = failed;
    } else if (indexing) {
      status.text = `$(sync~spin) PL/I graph ${indexing.percent}%`;
      status.tooltip = `cgr is indexing. ${indexing.message}`;
    } else if (syncing) {
      status.text = "$(sync~spin) PL/I graph";
      status.tooltip = "cgr is building the graph for the first time…";
    } else {
      status.text = "$(type-hierarchy) PL/I graph";
      status.tooltip = "cgr keeps the graph in sync. Click to restart it.";
    }
    status.show();
  };

  const refresh = () => {
    if (!openDatabase()) {
      showStatus();
      return;
    }
    let next: string | undefined;
    try {
      next = Graph.version(db!);
    } catch (error) {
      // cgr has not created its tables yet.
      log.debug(`graph not readable yet: ${error}`);
      return;
    }
    if (next === version) {
      return;
    }
    version = next;
    for (const workspace of workspaces.values()) {
      if (!workspace.graph) {
        try {
          const graph = new Graph(db!, workspace.folder.uri.fsPath);
          // An open editor's text, unsaved changes included, is what the user sees.
          const fromDisk = graph.read;
          graph.read = (path) => openText(workspace.folder.uri, path) ?? fromDisk(path);
          workspace.graph = graph;
          workspace.symbols = new Symbols(graph);
          log.info(`${workspace.folder.name} is project ${workspace.graph.project} in ${graphFile()}`);
        } catch {
          // Its first sync is still running.
        }
      }
    }
    log.info(`graph version ${version}`);
    showStatus();
    changed.fire();
    void graphPanel?.panel.webview.postMessage({ type: "changed" });
  };

  const restart = () => {
    for (const workspace of workspaces.values()) {
      stopWatcher(workspace);
      startWatcher(workspace, showStatus);
    }
    showStatus();
  };

  const poll = setInterval(refresh, 1000);
  context.subscriptions.push(
    log,
    status,
    { dispose: () => clearInterval(poll) },
    vscode.commands.registerCommand("pliGraph.restart", restart),
    vscode.commands.registerCommand("pliGraph.open", open),
    vscode.commands.registerCommand("pliGraph.show", () => showGraph(context)),
    vscode.languages.registerDefinitionProvider(
      LANGUAGES.map((language) => ({ language })),
      { provideDefinition },
    ),
    vscode.languages.registerReferenceProvider(
      LANGUAGES.map((language) => ({ language })),
      { provideReferences },
    ),
    vscode.languages.registerCompletionItemProvider(
      ["pli", "hlasm", "jcl"].map((language) => ({ language })),
      { provideCompletionItems },
      ".",
      ":",
    ),
    treeView("pliGraphDependencies", "dependencies"),
    treeView("pliGraphDependents", "dependents"),
    vscode.window.onDidChangeActiveTextEditor(() => followEditor()),
    vscode.workspace.onDidOpenTextDocument((document) => {
      claimMember(document);
      // Changing the language reopens the document in the same editor.
      if (document === vscode.window.activeTextEditor?.document) {
        followEditor();
      }
    }),
    changed.event(() => vscode.workspace.textDocuments.forEach(claimMember)),
  );

  restart();
  refresh();
  followEditor();
  // Lets the end-to-end test wait for cgr instead of sleeping.
  return { onDidUpdateGraph: changed.event, onDidChangeIndexing: indexingChanged.event };
}

export function deactivate() {
  stopping = true;
  for (const workspace of workspaces.values()) {
    stopWatcher(workspace);
  }
  db?.close();
}

// Electron ships node:sqlite only in recent VS Code versions, so it is loaded
// here, where its absence can be reported, and not at import time.
function openDatabase(): boolean {
  if (db) {
    return true;
  }
  if (dbError) {
    return false;
  }
  let sqlite: typeof import("node:sqlite");
  try {
    sqlite = createRequire(__filename)("node:sqlite");
  } catch (error) {
    dbError = `[PLG005E] This VS Code has no node:sqlite (Node ${process.versions.node}); update VS Code. ${error}`;
    log.error(dbError);
    void vscode.window.showErrorMessage(dbError);
    return false;
  }
  try {
    db = new sqlite.DatabaseSync(graphFile(), { readOnly: true });
    // cgr writes in WAL mode; wait out its commits instead of failing.
    db.exec("PRAGMA busy_timeout = 2000");
    log.info(`reading ${graphFile()}`);
    return true;
  } catch (error) {
    // The file appears once cgr has written to it.
    log.debug(`no graph at ${graphFile()} yet: ${error}`);
    return false;
  }
}

function startWatcher(workspace: Workspace, showStatus: () => void) {
  const config = vscode.workspace.getConfiguration("pliGraph", workspace.folder);
  const bundled = join(extensionPath, "cgr", "cgr.cmd");
  const command = config.get<string>("command", "").trim() || (existsSync(bundled) ? bundled : "");
  if (!command) {
    workspace.error = "[PLG001E] This package carries no cgr: set 'pliGraph.command' to cgr (the Windows package brings its own).";
    log.error(workspace.error);
    void vscode.window.showErrorMessage(workspace.error, "Open Settings").then((choice) => {
      if (choice) {
        void vscode.commands.executeCommand("workbench.action.openSettings", "pliGraph.command");
      }
    });
    return;
  }
  workspace.error = undefined;
  // A bare path may contain blanks; anything else is taken as a command line.
  const program = existsSync(command) ? `"${command}"` : command;
  const line = `${program} watch --repo-path "${workspace.folder.uri.fsPath}" --debounce 1 --no-start-stack`;
  const env = {
    ...process.env,
    GRAPH_BACKEND: "sqlite",
    CGR_PLI_EXTENSIONLESS_MEMBERS: config.get("extensionlessMembers", true) ? "true" : "false",
    // Progress lines on stderr, for the progress bar.
    CGR_PROGRESS: "1",
  };
  log.info(`watching ${workspace.folder.name}: ${line}`);
  const child = spawn(line, {
    shell: true,
    env,
    cwd: workspace.folder.uri.fsPath,
    // Its own process group, so stopping it also stops what the shell started.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  workspace.watcher = child;
  let tail = "";
  // Each stream is read line by line: a progress line goes to the progress
  // bar, everything else to the log.
  const collector = () => {
    let pending = "";
    return (chunk: Buffer) => {
      const lines = (pending + chunk.toString()).split(/\r?\n/);
      pending = lines.pop() ?? "";
      const output = lines.filter((line) => {
        const progress = progressLine(line);
        if (progress) progressed(workspace, progress, showStatus);
        return !progress;
      });
      if (output.length > 0) {
        tail = (tail + output.join("\n") + "\n").slice(-4000);
        log.info(output.join("\n").trimEnd());
      }
    };
  };
  child.stdout?.on("data", collector());
  child.stderr?.on("data", collector());
  const exited = (code: number | null | string) => {
    if (workspace.watcher !== child) {
      return;
    }
    workspace.watcher = undefined;
    workspace.indexing?.finish?.();
    workspace.indexing = undefined;
    if (stopping) {
      return;
    }
    workspace.error = `[PLG002E] cgr watch for ${workspace.folder.name} stopped (${code}); the graph is no longer updated. See the 'PL/I Graph' output.`;
    log.error(`${workspace.error}\n${tail}`);
    showStatus();
    void vscode.window.showErrorMessage(workspace.error, "Show Output", "Restart").then((choice) => {
      if (choice === "Show Output") {
        log.show();
      } else if (choice === "Restart") {
        void vscode.commands.executeCommand("pliGraph.restart");
      }
    });
  };
  child.on("error", (error) => exited(String(error)));
  child.on("exit", (code) => exited(code));
}

// Moves the progress bar of a sync on, or ends it.
function progressed(workspace: Workspace, progress: Progress, showStatus: () => void) {
  const state = describe(progress);
  if (!state) {
    if (progress.phase === "done" && workspace.indexing) {
      log.info(`${workspace.folder.name}: sync done`);
      workspace.indexing.finish?.();
      workspace.indexing = undefined;
      indexingChanged.fire(undefined);
      showStatus();
    }
    return;
  }
  let indexing = workspace.indexing;
  if (!indexing) {
    log.info(`${workspace.folder.name}: syncing ${progress.total} files`);
    indexing = { percent: 0, message: state.message, shown: 0 };
    workspace.indexing = indexing;
    if (progress.total >= NOTIFY_FROM_FILES && progress.phase !== "write") {
      const shown = indexing;
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Indexing ${workspace.folder.name}` },
        (bar) =>
          new Promise<void>((resolve) => {
            shown.report = (value) => bar.report(value);
            shown.finish = resolve;
            bar.report({ message: shown.message, increment: shown.percent });
            shown.shown = shown.percent;
          }),
      );
    }
  } else if (progress.done === 0) {
    log.info(`${workspace.folder.name}: ${state.message}`);
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

function stopWatcher(workspace: Workspace) {
  const child = workspace.watcher;
  workspace.watcher = undefined;
  workspace.indexing?.finish?.();
  workspace.indexing = undefined;
  if (!child?.pid || child.exitCode !== null) {
    return;
  }
  log.info(`stopping cgr watch for ${workspace.folder.name}`);
  // Killing the shell alone would leave cgr running.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      log.warn(`stopping cgr watch: ${error}`);
    }
  }
}

// The workspace and graph-relative path of a file, if it is in a folder.
function locate(uri: vscode.Uri): { workspace: Workspace; path: string } | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const workspace = folder && workspaces.get(folder.uri.toString());
  if (!workspace) {
    return undefined;
  }
  const path = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  return { workspace, path };
}

const LANGUAGES = ["pli", "jcl", "hlasm", "db2"];

// cgr reads a member whose third character is J, F or T as JCL, MFS or Db2,
// and any other member as PL/I.
const MEMBER_LANGUAGES: Record<string, string> = { J: "jcl", F: "hlasm", T: "db2" };

// z/OS members have no extension, so VS Code opens them as plain text. Those
// cgr indexed are switched to the language cgr read them as.
function claimMember(document: vscode.TextDocument) {
  if (document.languageId !== "plaintext" || document.uri.scheme !== "file") {
    return;
  }
  const where = locate(document.uri);
  if (!where?.workspace.graph?.module(where.path)) {
    return;
  }
  const member = where.path.split("/").pop() ?? "";
  const language = MEMBER_LANGUAGES[member.charAt(2).toUpperCase()] ?? "pli";
  log.info(`${where.path} is a ${language} module in the graph, switching its language`);
  void vscode.languages.setTextDocumentLanguage(document, language);
}

// Files in one of the graph's languages, and any other file cgr indexed,
// whatever language VS Code gave it.
function inGraph(document: vscode.TextDocument): boolean {
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
  void vscode.commands.executeCommand(
    "setContext",
    "pliGraph.activeEditorIsPli",
    inGraph(editor.document),
  );
  const fromTree = editor.document.uri.toString() === openedFromTree;
  openedFromTree = undefined;
  if (!fromTree) {
    changed.fire();
  }
}

// The text of `path` in an open editor, if it is open.
function openText(folder: vscode.Uri, path: string): string | undefined {
  const uri = vscode.Uri.joinPath(folder, path).toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)?.getText();
}

interface Place {
  path: string;
  line: number;
  col: number;
  endCol?: number;
}

const symbolPlace = (s: Symbol): Place => ({ path: s.path, line: s.line, col: s.col, endCol: s.endCol });
const targetPlace = (t: Target): Place => ({ path: t.path, line: t.line - 1, col: 0 });

// Where the name at `position` is defined: the procedure or include cgr
// resolved for this place first, then a variable, field, label or column,
// then any procedure of that name. `how` says which answered, for the log.
function definitionsAt(
  document: vscode.TextDocument,
  position: vscode.Position,
): { word: string; range: vscode.Range; places: Place[]; how: string } | undefined {
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
  let declared: Symbol[] = [];
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

function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Location[] {
  const found = definitionsAt(document, position);
  const where = locate(document.uri);
  if (!found || !where) {
    return [];
  }
  const seen = new Set<string>();
  const places = found.places.filter((p) => !seen.has(`${p.path}:${p.line}:${p.col}`) && seen.add(`${p.path}:${p.line}:${p.col}`));
  log.info(`definition of ${found.word} at ${where.path}:${position.line + 1}: ${places.length} found by ${found.how}`);
  // Ctrl+click on a definition shows its references instead, but only when
  // the definition VS Code gets back covers the cursor.
  if (places.some((p) => p.path === where.path && p.line === position.line)) {
    return [new vscode.Location(document.uri, found.range)];
  }
  return places.map(
    (p) => new vscode.Location(vscode.Uri.joinPath(where.workspace.folder.uri, p.path), new vscode.Position(p.line, p.col)),
  );
}

function provideReferences(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: vscode.ReferenceContext,
): vscode.Location[] {
  const found = definitionsAt(document, position);
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  if (!found || !where || !graph) {
    return [];
  }
  const started = Date.now();
  const uri = (path: string) => vscode.Uri.joinPath(where.workspace.folder.uri, path);
  let sites: { path: string; line: number; col: number; endLine: number; endCol: number }[];
  if (found.how === "declaration") {
    sites = (where.workspace.symbols?.references(where.path, document.offsetAt(position)) ?? []).map((s) => ({
      ...s,
      endLine: s.line,
    }));
  } else {
    // cgr's sites count lines from 1.
    sites = graph
      .references(where.path, position.line + 1, found.word, found.how === "name")
      .map((s) => ({ ...s, line: s.line - 1, endLine: s.endLine - 1 }));
  }
  log.info(`references of ${found.word} at ${where.path}:${position.line + 1}: ${sites.length} found by ${found.how} in ${Date.now() - started} ms`);
  const locations = sites.map(
    (s) => new vscode.Location(uri(s.path), new vscode.Range(s.line, s.col, s.endLine, s.endCol)),
  );
  if (context.includeDeclaration) {
    for (const p of found.places) {
      const end = p.endCol ?? p.col;
      locations.unshift(new vscode.Location(uri(p.path), new vscode.Range(p.line, p.col, p.line, end)));
    }
  }
  return locations;
}

const SYMBOL_KINDS: Record<Symbol["kind"], vscode.CompletionItemKind> = {
  variable: vscode.CompletionItemKind.Variable,
  field: vscode.CompletionItemKind.Field,
  label: vscode.CompletionItemKind.Constant,
  column: vscode.CompletionItemKind.Field,
};

// Completion items for the programs, tables and screens of the whole
// project, built once per graph version: a repository has thousands.
const projectItems = new Map<string, vscode.CompletionItem[]>();

function topLevelItems(graph: Graph, language: string, kind: vscode.CompletionItemKind, what: string): vscode.CompletionItem[] {
  const key = `${graph.project}:${version}:${language}`;
  let items = projectItems.get(key);
  if (!items) {
    const seen = new Set<string>();
    items = graph.topLevel(language).flatMap((d) => {
      if (seen.has(d.name)) return [];
      seen.add(d.name);
      const item = new vscode.CompletionItem({ label: d.name, description: d.path }, kind);
      item.detail = `${what} in ${d.path}`;
      return [item];
    });
    for (const old of projectItems.keys()) {
      if (old.startsWith(`${graph.project}:`)) projectItems.delete(old);
    }
    projectItems.set(key, items);
  }
  return items;
}

function provideCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.CompletionItem[] {
  const where = locate(document.uri);
  const graph = where?.workspace.graph;
  const symbols = where?.workspace.symbols;
  if (!where || !graph || !symbols) {
    return [];
  }
  const started = Date.now();
  const language = document.languageId;
  const items: vscode.CompletionItem[] = [];
  let context = "code";
  if (language === "jcl") {
    items.push(...topLevelItems(graph, "pli", vscode.CompletionItemKind.Function, "program"));
    items.push(...topLevelItems(graph, "jcl", vscode.CompletionItemKind.Module, "job or procedure"));
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
      const item = new vscode.CompletionItem({ label: s.name, description: s.path === where.path ? undefined : s.path }, SYMBOL_KINDS[s.kind]);
      item.detail = s.detail;
      items.push(item);
    }
    if (context === "sql") {
      items.push(...topLevelItems(graph, "db2", vscode.CompletionItemKind.Struct, "table"));
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
      items.push(...topLevelItems(graph, "pli", vscode.CompletionItemKind.Function, "program"));
    } else if (context === "code" && language === "hlasm") {
      items.push(...topLevelItems(graph, "hlasm", vscode.CompletionItemKind.Reference, "format or message"));
    }
  }
  log.debug(`completion at ${where.path}:${position.line + 1} (${context}): ${items.length} items in ${Date.now() - started} ms`);
  return items;
}

interface Item {
  row: TreeRow;
  workspace: Workspace;
}

const ROW_LOOK: Record<TreeRow["kind"], { icon: string; description: string }> = {
  file: { icon: "file-code", description: "" },
  include: { icon: "file-symlink-file", description: "%INCLUDE" },
  call: { icon: "symbol-method", description: "calls" },
  table: { icon: "database", description: "" },
  includedBy: { icon: "file-symlink-file", description: "includes it" },
  calledBy: { icon: "symbol-method", description: "calls it" },
  unresolved: { icon: "warning", description: "not found" },
};

function treeView(id: string, direction: "dependencies" | "dependents"): vscode.Disposable {
  const provider: vscode.TreeDataProvider<Item> = {
    onDidChangeTreeData: changed.event,
    getChildren(item) {
      if (item) {
        return item.workspace.graph![direction](item.row).map((row) => ({ row, workspace: item.workspace }));
      }
      const document = vscode.window.activeTextEditor?.document;
      const where = document && locate(document.uri);
      view.message = undefined;
      if (!document || !inGraph(document)) {
        view.message = "Open a PL/I, JCL, MFS or Db2 file.";
        return [];
      }
      if (!where?.workspace.graph) {
        view.message =
          dbError ?? where?.workspace.error ?? "cgr is building the graph for the first time. This can take a while.";
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
      item.tooltip = row.target ? `${row.target.path}:${row.target.line}` : "cgr found no definition";
      if (row.target) {
        item.command = { command: "pliGraph.open", title: "Open", arguments: [workspace.folder.uri, row.target] };
      }
      return item;
    },
  };
  const view = vscode.window.createTreeView(id, { treeDataProvider: provider });
  return view;
}

async function open(folder: vscode.Uri, target: Target) {
  const uri = vscode.Uri.joinPath(folder, target.path);
  const position = new vscode.Position(target.line - 1, 0);
  if (uri.toString() !== vscode.window.activeTextEditor?.document.uri.toString()) {
    openedFromTree = uri.toString();
  }
  try {
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position), preserveFocus: true });
  } catch (error) {
    const message = `[PLG004E] Opening ${target.path} failed: ${error}`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
  }
}

// The graph website's page, filled with this workspace's whole graph. A page
// for 20,000 files holds about 24 MB of JSON and takes a second to export.
function showGraph(context: vscode.ExtensionContext) {
  const document = vscode.window.activeTextEditor?.document;
  const where = document && locate(document.uri);
  const workspace = where?.workspace ?? [...workspaces.values()][0];
  if (!workspace?.graph) {
    const message =
      dbError ?? workspace?.error ?? "[PLG006E] There is no graph to show yet: cgr is still building it, or no folder is open.";
    log.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const started = Date.now();
  let whole: WholeGraph;
  try {
    whole = workspace.graph.whole();
  } catch (error) {
    const message = `[PLG007E] Reading the graph for ${workspace.folder.name} failed: ${error}`;
    log.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }
  const module = where && whole.nodes.find((n) => n.kind === "module" && n.path === where.path);
  const hash = module ? `v=module&id=${encodeURIComponent(module.id)}` : graphPanel?.hash ?? "";

  if (graphPanel?.workspace === workspace) {
    graphPanel.panel.reveal(undefined, true);
    if (module) {
      void graphPanel.panel.webview.postMessage({ type: "go", hash });
    }
    return;
  }
  graphPanel?.panel.dispose();
  const panel = vscode.window.createWebviewPanel(
    "pliGraph",
    `PL/I Graph: ${workspace.folder.name}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const shown = { panel, workspace, hash };
  graphPanel = shown;
  panel.webview.html = graphPage(context, whole, hash);
  log.info(`graph page for ${workspace.folder.name}: ${whole.nodes.length} nodes, ${whole.edges.length} edges in ${Date.now() - started} ms`);
  panel.onDidDispose(() => {
    if (graphPanel === shown) {
      graphPanel = undefined;
    }
  });
  panel.webview.onDidReceiveMessage((message: PageMessage) => {
    if (message.type === "route") {
      shown.hash = message.hash ?? "";
      log.info(`graph page shows #${shown.hash}: drawn in ${message.drawMs} ms, ${message.sinceLoadMs} ms after the page loaded`);
    } else if (message.type === "open" && message.path) {
      const uri = vscode.Uri.joinPath(workspace.folder.uri, message.path);
      const position = new vscode.Position((message.line ?? 1) - 1, 0);
      vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(position, position) }).then(
        undefined,
        (error) => {
          const text = `[PLG008E] Opening ${message.path} failed: ${error}`;
          log.error(text);
          void vscode.window.showErrorMessage(text);
        },
      );
    } else if (message.type === "reload" && workspace.graph) {
      try {
        panel.webview.html = graphPage(context, workspace.graph.whole(), shown.hash);
        log.info(`graph page for ${workspace.folder.name} reloaded`);
      } catch (error) {
        const text = `[PLG007E] Reading the graph for ${workspace.folder.name} failed: ${error}`;
        log.error(text);
        void vscode.window.showErrorMessage(text);
      }
    }
  });
}

// What the graph page posts: the view it switched to, or a file to open, or a reload request.
interface PageMessage {
  type: "route" | "open" | "reload";
  hash?: string;
  drawMs?: number;
  sinceLoadMs?: number;
  path?: string;
  line?: number;
}

let pageTemplate: string | undefined;
function graphPage(context: vscode.ExtensionContext, whole: WholeGraph, hash: string): string {
  pageTemplate ??= readFileSync(vscode.Uri.joinPath(context.extensionUri, "out", "graph.html").fsPath, "utf-8");
  const html = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  // The page's palette, taken from the VS Code theme.
  const theme = `<style>body {
  --bg: var(--vscode-editor-background); --panel: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --line: var(--vscode-panel-border, var(--vscode-widget-border, #8884)); --text: var(--vscode-editor-foreground);
  --muted: var(--vscode-descriptionForeground); --node: var(--vscode-editorWidget-background);
  --node-border: var(--vscode-editorWidget-border, var(--vscode-descriptionForeground));
  --edge: var(--vscode-editorLineNumber-foreground); --accent: var(--vscode-textLink-foreground);
  --accent-soft: var(--vscode-list-hoverBackground); --group: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --error: var(--vscode-errorForeground);
}</style>`;
  const head =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">` + theme;
  // The page reads its view from the URL hash, which a webview cannot be opened with.
  const route = `<script>history.replaceState(null, "", ${JSON.stringify(`#${hash}`)});</script>`;
  return pageTemplate
    .replace("<head>", () => `<head>${head}`)
    .replace("<body>", () => `<body>${route}`)
    .replaceAll("__PROJECT__", () => html(whole.project))
    .replace("__GRAPH_JSON__", () => JSON.stringify(whole).replaceAll("</", "<\\/"));
}
