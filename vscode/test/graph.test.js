import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { indexed } from "./indexed.js";

/** @typedef {import("../src/graph.js").TreeRow} TreeRow */

const fixture = join(import.meta.dirname, "fixture");
const db = await indexed(fixture);
const graph = new Graph(db, fixture);

/** @param {TreeRow[]} rows */
const labels = (rows) => rows.map((row) => `${row.kind} ${row.label}${row.repeated ? " (repeated)" : ""}`);

test("the generated JavaScript in generated/ is no source", () => {
  assert.deepEqual(db.prepare(`SELECT path FROM files WHERE path LIKE 'generated/%'`).all(), []);
});

test("a call goes to the procedure the indexer resolved", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 3, "helper"), [{ path: "shop/helper.pli", line: 1, col: 0, endCol: 6 }]);
});

test("a call to a nested procedure goes to it", () => {
  assert.deepEqual(graph.definitions("shop/helper.pli", 4, "INNER"), [{ path: "shop/helper.pli", line: 2, col: 2, endCol: 7 }]);
});

test("an include member goes to the top of its file", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 2, "shopdcl"), [{ path: "copy/shopdcl.pli", line: 1, col: 0, endCol: 0 }]);
});

test("a procedure name outside any call falls back to name lookup", () => {
  assert.deepEqual(graph.definitions("copy/shopdcl.pli", 1, "report"), [{ path: "ABREPT01", line: 1, col: 0, endCol: 6 }]);
});

test("unknown names have no definition", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 4, "nowhere"), []);
});

/** @param {string} path @param {number} line @param {string} word */
const sites = (path, line, word) =>
  graph.references(path, line, word).map((s) => `${s.path}:${s.line}`).sort();

test("references of a procedure are its calls, from a call or its definition", () => {
  assert.deepEqual(sites("shop/main.pli", 3, "helper"), ["ABREPT01:2", "shop/main.pli:3"]);
  assert.deepEqual(sites("shop/helper.pli", 1, "helper"), ["ABREPT01:2", "shop/main.pli:3"]);
});

test("references of an include member are its %INCLUDEs", () => {
  assert.deepEqual(sites("shop/main.pli", 2, "shopdcl"), ["shop/main.pli:2"]);
});

test("unknown names have no references", () => {
  assert.deepEqual(sites("shop/main.pli", 4, "nowhere"), []);
});

test("dependencies list includes, outside calls and unresolved names", () => {
  const root = /** @type {TreeRow} */ (graph.root("shop/main.pli"));
  const rows = graph.dependencies(root);
  assert.deepEqual(labels(rows), [
    "include shopdcl.pli",
    "unresolved %INCLUDE MISSING",
    "call CALL HELPER",
    "unresolved CALL NOWHERE",
  ]);
  const helper = /** @type {TreeRow} */ (rows.find((row) => row.kind === "call"));
  assert.deepEqual(helper.target, { path: "shop/helper.pli", line: 1, col: 0, endCol: 6 });
  // helper calls main back, which is already open above it.
  assert.deepEqual(labels(graph.dependencies(helper)), ["call CALL MAIN (repeated)"]);
});

test("dependents list includers and outside callers", () => {
  assert.deepEqual(labels(graph.dependents(/** @type {TreeRow} */ (graph.root("copy/shopdcl.pli")))), ["includedBy main.pli"]);
  assert.deepEqual(labels(graph.dependents(/** @type {TreeRow} */ (graph.root("shop/helper.pli")))), [
    "calledBy MAIN → HELPER",
    "calledBy REPORT → HELPER",
  ]);
  const callers = graph.dependents(/** @type {TreeRow} */ (graph.root("shop/helper.pli")));
  // A caller's row opens the call, not the caller's first line.
  assert.deepEqual(callers.map((row) => row.target), [
    { path: "shop/main.pli", line: 3, col: 7, endCol: 13 },
    { path: "ABREPT01", line: 2, col: 7, endCol: 13 },
  ]);
});

test("extensionless members are modules", () => {
  assert.equal(graph.root("ABREPT01")?.label, "ABREPT01");
});

test("the graph version is readable", () => {
  assert.ok(Graph.version(db));
});

test("the graph page's overview sums up the calls and includes between folders", () => {
  const top = graph.pageOverview("", false);
  assert.deepEqual(top.folders, [
    { id: "dir:copy", modules: 1 },
    { id: "dir:shop", modules: 2 },
  ]);
  assert.deepEqual(top.modules.map((n) => n.id).sort(), ["ABREPT01", "external:MISSING"]);
  assert.deepEqual(top.edges.sort(), [
    ["ABREPT01", "dir:shop", "calls", 1],
    ["dir:shop", "dir:copy", "imports", 1],
    ["dir:shop", "external:MISSING", "imports", 1],
  ]);
  const shop = graph.pageOverview("shop", false);
  assert.deepEqual(shop.modules.map((n) => n.id).sort(), ["shop/helper.pli", "shop/main.pli"]);
  assert.deepEqual(shop.edges.sort(), [
    ["shop/helper.pli", "shop/main.pli", "calls", 1],
    ["shop/main.pli", "shop/helper.pli", "calls", 1],
  ]);
  assert.equal(graph.pageOverview("", false, 3).modules.length, 1, "past the limit only the most connected");
});

/** @param {import("../src/graph.js").PageGraph | null} page */
const named = (page) => {
  const name = new Map(page?.nodes.map((n) => [n.id, n.name]));
  return page?.edges.map(([source, type, target]) => `${name.get(source)} ${type} ${name.get(target)}`).sort();
};

test("the graph page's module view holds its procedures and the calls in and out", () => {
  assert.deepEqual(named(graph.pageModule("shop/main.pli")), ["HELPER CALLS MAIN", "MAIN CALLS HELPER", "main.pli DEFINES MAIN"]);
  assert.deepEqual(named(graph.pageModule("shop/helper.pli")), [
    "HELPER CALLS INNER",
    "HELPER CALLS MAIN",
    "HELPER DEFINES INNER",
    "MAIN CALLS HELPER",
    "REPORT CALLS HELPER",
    "helper.pli DEFINES HELPER",
  ]);
  assert.equal(graph.pageModule("nowhere.pli"), null);
});

test("the graph page's procedure view walks calls both ways as deep as asked", () => {
  assert.deepEqual(named(graph.pageProcedure("ABREPT01:REPORT:1", 1)), ["REPORT CALLS HELPER"]);
  assert.deepEqual(named(graph.pageProcedure("ABREPT01:REPORT:1", 2)), ["HELPER CALLS INNER", "HELPER CALLS MAIN", "MAIN CALLS HELPER", "REPORT CALLS HELPER"]);
  assert.deepEqual(named(graph.pageProcedure("shop/helper.pli:INNER:2", 1)), ["HELPER CALLS INNER"]);
  const main = graph.pageProcedure("shop/main.pli:MAIN:1", 1)?.nodes.find((n) => n.name === "MAIN");
  assert.deepEqual([main?.kind, main?.path, main?.line, main?.mods], ["function", "shop/main.pli", 1, ["MAIN"]]);
  assert.equal(graph.pageProcedure("shop/main.pli:MAIN:2", 1), null);
});

test("the graph page's procedure view walks all the way down, up or both", () => {
  assert.deepEqual(named(graph.pageProcedure("ABREPT01:REPORT:1", 0, "down")), ["HELPER CALLS INNER", "HELPER CALLS MAIN", "MAIN CALLS HELPER", "REPORT CALLS HELPER"]);
  assert.deepEqual(named(graph.pageProcedure("ABREPT01:REPORT:1", 0, "up")), []);
  assert.deepEqual(named(graph.pageProcedure("shop/helper.pli:INNER:2", 0, "up")), ["HELPER CALLS INNER", "HELPER CALLS MAIN", "MAIN CALLS HELPER", "REPORT CALLS HELPER"]);
  assert.deepEqual(named(graph.pageProcedure("shop/helper.pli:INNER:2", 0, "down")), []);
  assert.deepEqual(named(graph.pageProcedure("shop/main.pli:MAIN:1", 1, "down")), ["HELPER CALLS MAIN", "MAIN CALLS HELPER"]);
});

test("the graph page's dependency view walks the modules a module uses, or is used by, all the way", () => {
  /** @param {import("../src/graph.js").PageGraph | null} page */
  const edges = (page) => page?.edges.map(([source, type, target]) => `${source} ${type} ${target}`).sort();
  const down = [
    "ABREPT01 CALLS shop/helper.pli",
    "shop/helper.pli CALLS shop/main.pli",
    "shop/main.pli CALLS shop/helper.pli",
    "shop/main.pli INCLUDES copy/shopdcl.pli",
  ];
  assert.deepEqual(edges(graph.pageDependencies("ABREPT01", "down")), down);
  assert.deepEqual(edges(graph.pageDependencies("ABREPT01", "up")), []);
  assert.deepEqual(edges(graph.pageDependencies("ABREPT01", "both")), down);
  assert.deepEqual(edges(graph.pageDependencies("copy/shopdcl.pli", "up")), down);
  assert.deepEqual(edges(graph.pageDependencies("copy/shopdcl.pli", "down")), []);
  assert.deepEqual(graph.pageDependencies("copy/shopdcl.pli", "down")?.nodes.map((n) => n.id), ["copy/shopdcl.pli"]);
  assert.equal(graph.pageDependencies("nowhere.pli", "down"), null);
});

test("the graph page lists every dependency or dependent with its distance, as tab-separated text", () => {
  assert.equal(
    graph.pageDependencyList("ABREPT01", "down"),
    "direction\tlevel\tmodule\tprocedure\tline\nuses\t1\tshop/helper.pli\t\t\nuses\t2\tshop/main.pli\t\t\nuses\t3\tcopy/shopdcl.pli\t\t\n",
  );
  assert.equal(
    graph.pageDependencyList("shop/helper.pli:INNER:2", "both"),
    "direction\tlevel\tmodule\tprocedure\tline\nused by\t1\tshop/helper.pli\tHELPER\t1\nused by\t2\tABREPT01\tREPORT\t1\nused by\t2\tshop/main.pli\tMAIN\t1\n",
  );
  assert.equal(graph.pageDependencyList("nowhere.pli", "both"), null);
});

test("the graph page's details list a module's and a procedure's neighbours", () => {
  /** @param {import("../src/graph.js").GraphNode[]} nodes */
  const ids = (nodes) => nodes.map((n) => n.id).sort();
  const module = /** @type {any} */ (graph.pageDetails("shop/main.pli"));
  assert.deepEqual(ids(module.procedures), ["shop/main.pli:MAIN:1"]);
  assert.deepEqual(ids(module.includes), ["copy/shopdcl.pli", "external:MISSING"]);
  assert.deepEqual(ids(module.includedBy), []);
  assert.deepEqual(ids(module.callsInto), ["shop/helper.pli"]);
  assert.deepEqual(ids(module.calledFrom), ["shop/helper.pli"]);
  assert.deepEqual(module.unresolved, ["NOWHERE"]);
  const helper = /** @type {any} */ (graph.pageDetails("shop/helper.pli:HELPER:1"));
  assert.deepEqual(ids(helper.definedIn), ["shop/helper.pli"]);
  assert.deepEqual(ids(helper.calledBy), ["ABREPT01:REPORT:1", "shop/main.pli:MAIN:1"]);
  assert.deepEqual(ids(helper.calls), ["shop/helper.pli:INNER:2", "shop/main.pli:MAIN:1"]);
  assert.deepEqual(ids(helper.defines), ["shop/helper.pli:INNER:2"]);
  assert.equal(graph.pageDetails("external:MISSING"), null);
});

test("the graph page finds procedures and modules, exact names first, and lists the sidebar's tabs", () => {
  assert.deepEqual(graph.pageSearch("help").map((n) => n.id), ["shop/helper.pli:HELPER:1", "shop/helper.pli"]);
  assert.deepEqual(graph.pageSearch("main").map((n) => n.id), ["shop/main.pli:MAIN:1", "shop/main.pli"]);
  assert.deepEqual(graph.pageSearch("50%"), []);
  assert.deepEqual(graph.pageList("modules", "").rows.map((r) => [r.id, r.count]), [
    ["ABREPT01", 1],
    ["copy/shopdcl.pli", 0],
    ["shop/helper.pli", 2],
    ["shop/main.pli", 1],
  ]);
  assert.deepEqual(graph.pageList("modules", "shop/", 1), { rows: [{ id: "shop/helper.pli", text: "shop/helper.pli", count: 2 }], total: 2 });
  assert.deepEqual(graph.pageList("entries", "").rows, [{ id: "shop/main.pli:MAIN:1", text: "MAIN", sub: "shop/main.pli", count: 1 }]);
  assert.deepEqual(graph.pageList("unresolved", "").rows, [{ id: "shop/main.pli", text: "NOWHERE", count: 1, title: "referenced in shop/main.pli" }]);
  assert.deepEqual(graph.pageSummary(), { project: "fixture", modules: 4, procedures: 4, calls: 4, unresolved: 1 });
});

test("the graph page's worker answers questions and reports failures", async () => {
  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(join(import.meta.dirname, "..", "src", "graphpage.js"), { workerData: { graph: db.location(), root: fixture } });
  /** @param {number} id @param {string} what @param {unknown[]} args */
  const ask = (id, what, args) =>
    new Promise((resolve) => {
      worker.on("message", (answer) => answer.id === id && resolve(answer));
      worker.postMessage({ id, what, args });
    });
  try {
    const answer = /** @type {any} */ (await ask(1, "module", ["shop/main.pli"]));
    assert.deepEqual(answer.result.edges.length, 3);
    assert.equal(typeof answer.ms, "number");
    const used = /** @type {any} */ (await ask(3, "dependencies", ["ABREPT01", "down"]));
    assert.equal(used.result.edges.length, 4);
    const all = /** @type {any} */ (await ask(4, "procedure", ["ABREPT01:REPORT:1", 0, "down"]));
    assert.equal(all.result.edges.length, 4);
    const flow = /** @type {any} */ (await ask(5, "flow", ["shop/main.pli:MAIN:1", 1]));
    assert.deepEqual(flow.result.lanes.map((/** @type {any} */ l) => l.name), ["MAIN", "SHOPDCL", "HELPER"]);
    const failed = /** @type {any} */ (await ask(2, "nonsense", []));
    assert.match(failed.error, /no question nonsense/);
  } finally {
    await worker.terminate();
  }
});

test("SQL uses plain ? parameters, which the Node of VS Code 1.105 binds; it skips ?1", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = join(import.meta.dirname, "..", "src");
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const text = await readFile(join(entry.parentPath, entry.name), "utf8");
    assert.doesNotMatch(text, /[=(,|] *\?\d/, entry.name);
  }
});
