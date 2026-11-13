// Real code has syntax the grammar does not know and shapes the indexer
// never saw: a sync must read everything else and say what it missed.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { openGraph, sync } from "../src/indexer.js";
import { indexer } from "./indexed.js";

const GOOD = " GOOD: PROC;\n   DCL A CHAR(1);\n   A = 'X';\n END GOOD;\n";
const ODD = " ODD: PROC;\n   DCL A CHAR(1);\n   A = = 'X' ));\n   CALL GOOD;\n END ODD;\n";

// Stands in for a bug in the fact extraction that one file's shape triggers.
const failing = { ...indexer, pli: { parse: (/** @type {string} */ text) => {
  if (text.includes("BOOM")) throw new Error("boom");
  return indexer.pli.parse(text);
} } };

function folder() {
  const root = mkdtempSync(join(tmpdir(), "pli-odd-"));
  writeFileSync(join(root, "GOOD"), GOOD);
  writeFileSync(join(root, "ODD"), ODD);
  writeFileSync(join(root, "BAD"), " BAD: PROC;\n   CALL BOOM;\n END BAD;\n");
  const db = openGraph(join(root, ".graph.sqlite"));
  return { root, db };
}

test("a file the indexer fails on is logged and skipped, and the rest is read", async () => {
  const { root, db } = folder();
  const result = await sync(db, root, /** @type {any} */ (failing));
  assert.deepEqual(result.failures.map((f) => [f.path, f.code, f.error.split("\n")[0]]), [["BAD", "PLG022E", "Error: boom"]]);
  assert.deepEqual(
    db.prepare("SELECT path, failure IS NOT NULL AS failed, (SELECT count(*) FROM symbols s WHERE s.file = f.id) AS symbols FROM files f ORDER BY path").all().map((r) => ({ ...r })),
    [
      { path: "BAD", failed: 1, symbols: 0 },
      { path: "GOOD", failed: 0, symbols: 1 },
      { path: "ODD", failed: 0, symbols: 1 },
    ],
  );
  // Not read again until it changes; then it gets its facts.
  assert.equal((await sync(db, root, /** @type {any} */ (failing))).changed, 0);
  writeFileSync(join(root, "BAD"), " BAD: PROC;\n   CALL GOOD;\n END BAD;\n");
  assert.deepEqual((await sync(db, root, /** @type {any} */ (failing))).failures, []);
  assert.deepEqual({ ...db.prepare("SELECT failure, (SELECT count(*) FROM symbols s WHERE s.file = f.id) AS symbols FROM files f WHERE path = 'BAD'").get() }, { failure: null, symbols: 1 });
});

test("syntax the grammar does not know is counted, and what follows is still read", async () => {
  const { root, db } = folder();
  const result = await sync(db, root, indexer);
  assert.deepEqual(result.syntaxErrors, [{ path: "ODD", count: 2, line: 3 }]);
  assert.deepEqual(
    db.prepare("SELECT path, syntax_errors, error_line FROM files ORDER BY path").all().map((r) => ({ ...r })),
    [
      { path: "BAD", syntax_errors: 0, error_line: null },
      { path: "GOOD", syntax_errors: 0, error_line: null },
      { path: "ODD", syntax_errors: 2, error_line: 3 },
    ],
  );
  assert.deepEqual(
    db.prepare("SELECT r.name, r.line FROM refs r JOIN files f ON f.id = r.file WHERE f.path = 'ODD' AND r.kind = 'call'").all().map((r) => ({ ...r })),
    [{ name: "GOOD", line: 4 }],
  );
});

test("a sync waits out another connection's short write lock instead of failing", async () => {
  const { root, db } = folder();
  // Stands in for a reader checkpointing the WAL, or a virus scanner, holding the file for a moment.
  const holder = new Worker(
    `const { DatabaseSync } = require("node:sqlite");
     const { parentPort, workerData } = require("node:worker_threads");
     const db = new DatabaseSync(workerData);
     db.exec("BEGIN IMMEDIATE");
     parentPort.postMessage("locked");
     setTimeout(() => { db.exec("COMMIT"); db.close(); }, 300);`,
    { eval: true, workerData: join(root, ".graph.sqlite") },
  );
  await once(holder, "message");
  const result = await sync(db, root, indexer);
  assert.equal(result.changed, 3);
  await holder.terminate();
});

// Deleting a file cascades to its rows; a foreign key without an index scans
// its whole table for every deleted row, and a rebuild never ends.
test("every foreign key has an index starting with its column", () => {
  const { db } = folder();
  const unindexed = [];
  for (const { name } of /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())) {
    const firsts = /** @type {{ first: string }[]} */ (
      db.prepare("SELECT (SELECT name FROM pragma_index_info(il.name) WHERE seqno = 0) AS first FROM pragma_index_list(?) il").all(name)
    ).map((index) => index.first);
    for (const fk of /** @type {{ from: string }[]} */ (db.prepare("SELECT * FROM pragma_foreign_key_list(?)").all(name))) {
      if (!firsts.includes(fk.from)) unindexed.push(`${name}.${fk.from}`);
    }
  }
  assert.deepEqual(unindexed, []);
});

test("a changed include re-matches the accesses of the unchanged files using it, and a changed file gets its own", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-resync-"));
  writeFileSync(join(root, "KDREC"), " DCL 1 KD_REC,\n   2 KD_NR CHAR(8);\n");
  writeFileSync(join(root, "KDMAIN"), " KDMAIN: PROC;\n   %INCLUDE KDREC;\n   KD_NR = 'X';\n END KDMAIN;\n");
  const db = openGraph(join(root, ".graph.sqlite"));
  const matched = () =>
    db
      .prepare("SELECT a.name, v.line FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file LEFT JOIN variables v ON v.id = a.variable WHERE f.path = 'KDMAIN'")
      .all()
      .map((r) => ({ ...r }));
  await sync(db, root, indexer);
  assert.deepEqual(matched(), [{ name: "KD_NR", line: 2 }]);
  writeFileSync(join(root, "KDREC"), " DCL 1 KD_REC,\n   2 KD_ART CHAR(1),\n   2 KD_NR CHAR(8);\n");
  await sync(db, root, indexer, { paths: ["KDREC"] });
  assert.deepEqual(matched(), [{ name: "KD_NR", line: 3 }]);
  writeFileSync(join(root, "KDMAIN"), " KDMAIN: PROC;\n   %INCLUDE KDREC;\n   KD_ART = 'G';\n   KD_NR = 'X';\n END KDMAIN;\n");
  await sync(db, root, indexer, { paths: ["KDMAIN"] });
  assert.deepEqual(matched(), [{ name: "KD_ART", line: 2 }, { name: "KD_NR", line: 3 }]);
});
