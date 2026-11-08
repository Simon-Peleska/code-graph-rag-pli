import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Graph, type TreeRow } from "../src/graph.ts";

// Syncs test/fixture into a fresh cgr home with the patched checkout, so the
// tests query the database cgr really writes.
const here = import.meta.dirname;
const fixture = join(here, "fixture");
const home = mkdtempSync(join(tmpdir(), "pli-graph-"));
execFileSync(
  "uv",
  ["run", "--project", join(here, "../../upstream"), "cgr", "-q", "start", "--repo-path", fixture, "--update-graph"],
  {
    env: { ...process.env, CGR_HOME: home, GRAPH_BACKEND: "sqlite", CGR_PLI_EXTENSIONLESS_MEMBERS: "true" },
    stdio: ["ignore", "ignore", "inherit"],
  },
);
const db = new DatabaseSync(join(home, "graph.sqlite"), { readOnly: true });
const graph = new Graph(db, fixture);

const labels = (rows: TreeRow[]) => rows.map((row) => `${row.kind} ${row.label}${row.repeated ? " (repeated)" : ""}`);

test("a call goes to the procedure cgr resolved", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 3, "helper"), [{ path: "shop/helper.pli", line: 1 }]);
});

test("a call to a nested procedure goes to it", () => {
  assert.deepEqual(graph.definitions("shop/helper.pli", 4, "INNER"), [{ path: "shop/helper.pli", line: 2 }]);
});

test("an include member goes to the top of its file", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 2, "shopdcl"), [{ path: "copy/shopdcl.pli", line: 1 }]);
});

test("a procedure name outside any call falls back to name lookup", () => {
  assert.deepEqual(graph.definitions("copy/shopdcl.pli", 1, "report"), [{ path: "ABREPT01", line: 1 }]);
});

test("unknown names have no definition", () => {
  assert.deepEqual(graph.definitions("shop/main.pli", 4, "nowhere"), []);
});

const sites = (path: string, line: number, word: string) =>
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
  const root = graph.root("shop/main.pli")!;
  const rows = graph.dependencies(root);
  assert.deepEqual(labels(rows), [
    "include shopdcl.pli",
    "unresolved %INCLUDE MISSING",
    "call CALL HELPER",
    "unresolved CALL NOWHERE",
  ]);
  const helper = rows.find((row) => row.kind === "call")!;
  assert.deepEqual(helper.target, { path: "shop/helper.pli", line: 1 });
  // helper calls main back, which is already open above it.
  assert.deepEqual(labels(graph.dependencies(helper)), ["call CALL MAIN (repeated)"]);
});

test("dependents list includers and outside callers", () => {
  assert.deepEqual(labels(graph.dependents(graph.root("copy/shopdcl.pli")!)), ["includedBy main.pli"]);
  assert.deepEqual(labels(graph.dependents(graph.root("shop/helper.pli")!)), [
    "calledBy MAIN → HELPER",
    "calledBy REPORT → HELPER",
  ]);
});

test("extensionless members are modules", () => {
  assert.equal(graph.root("ABREPT01")?.label, "ABREPT01");
});

test("the graph version is readable", () => {
  assert.ok(Graph.version(db));
});

test("a folder cgr never synced is refused", () => {
  assert.throws(() => new Graph(db, join(here, "elsewhere")), /no project/);
});

test("the whole graph holds modules, procedures and their links for Show Graph", () => {
  const whole = graph.whole();
  const at = (i: number) => whole.nodes[i];
  const edges = whole.edges.map(([source, type, target]) => `${at(source).name} ${type} ${at(target).name}`);
  assert.deepEqual(
    whole.nodes.filter((n) => n.kind === "module").map((n) => n.path).sort(),
    ["ABREPT01", "copy/shopdcl.pli", "shop/helper.pli", "shop/main.pli"],
  );
  assert.ok(edges.includes("MAIN CALLS HELPER"), edges.join("\n"));
  assert.ok(edges.includes("main.pli IMPORTS shopdcl.pli"), edges.join("\n"));
  assert.ok(edges.includes("main.pli IMPORTS MISSING"), edges.join("\n"));
  assert.ok(edges.includes("main.pli DEFINES MAIN"), edges.join("\n"));
  const main = whole.nodes.find((n) => n.name === "MAIN")!;
  assert.deepEqual([main.kind, main.path, main.line], ["function", "shop/main.pli", 1]);
});
