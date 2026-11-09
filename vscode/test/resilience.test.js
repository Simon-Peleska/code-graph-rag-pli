// Real code has syntax the grammar does not know and shapes the indexer
// never saw: a sync must read everything else and say what it missed.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

test("a file the indexer fails on is logged and skipped, and the rest is read", () => {
  const { root, db } = folder();
  const result = sync(db, root, /** @type {any} */ (failing));
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
  assert.equal(sync(db, root, /** @type {any} */ (failing)).changed, 0);
  writeFileSync(join(root, "BAD"), " BAD: PROC;\n   CALL GOOD;\n END BAD;\n");
  assert.deepEqual(sync(db, root, /** @type {any} */ (failing)).failures, []);
  assert.deepEqual({ ...db.prepare("SELECT failure, (SELECT count(*) FROM symbols s WHERE s.file = f.id) AS symbols FROM files f WHERE path = 'BAD'").get() }, { failure: null, symbols: 1 });
});

test("syntax the grammar does not know is counted, and what follows is still read", () => {
  const { root, db } = folder();
  const result = sync(db, root, indexer);
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
