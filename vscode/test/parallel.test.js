// A sync of many files parses them in threads; the graph must come out
// exactly as when one thread does it all.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { grammarsIn, openGraph, sync } from "../src/indexer.js";
import { indexer } from "./indexed.js";

const grammars = grammarsIn(join(import.meta.dirname, "../grammars"));

// Dev and prod copies of the test repositories, well over the 100 files
// from which a sync starts threads.
function repository() {
  const root = mkdtempSync(join(tmpdir(), "pli-parallel-"));
  for (const stage of ["dev", "test", "prod", "old"]) {
    for (const source of ["fixture", "facts", "zos"]) cpSync(join(import.meta.dirname, source), join(root, stage, source), { recursive: true });
  }
  return root;
}

/** @param {import("node:sqlite").DatabaseSync} db */
function dump(db) {
  const tables = /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('meta') AND name NOT LIKE 'sqlite_%' ORDER BY name").all());
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
}

test("parsing in threads gives the same graph as parsing in one", async () => {
  const root = repository();
  const alone = openGraph(join(mkdtempSync(join(tmpdir(), "pli-graph-")), "graph.sqlite"));
  const one = await sync(alone, root, indexer);
  const shared = openGraph(join(mkdtempSync(join(tmpdir(), "pli-graph-")), "graph.sqlite"));
  const many = await sync(shared, root, indexer, { parsers: { script: join(import.meta.dirname, "../src/parser.js"), grammars } });
  assert.ok(one.changed >= 100, `${one.changed} files`);
  assert.deepEqual({ ...many, parseMs: 0, linkMs: 0, resolveMs: 0 }, { ...one, parseMs: 0, linkMs: 0, resolveMs: 0 });
  assert.deepEqual(dump(shared), dump(alone));
});

test("a parser thread that dies fails its file, and a new thread reads the rest", async () => {
  const root = repository();
  writeFileSync(join(root, "dev", "DOOMED"), " DOOMED: PROC;\n END DOOMED;\n");
  const db = openGraph(join(root, ".graph.sqlite"));
  const result = await sync(db, root, indexer, { parsers: { script: join(import.meta.dirname, "dying-parser.js"), grammars } });
  assert.deepEqual(result.failures.map((f) => [f.path, f.code, f.error.split(":")[0]]), [["dev/DOOMED", "PLG025E", "The parser thread stopped with exit code 3"]]);
  assert.equal(/** @type {{ n: number }} */ (db.prepare("SELECT count(*) AS n FROM files WHERE failure IS NULL").get()).n, result.changed - 1);
});
