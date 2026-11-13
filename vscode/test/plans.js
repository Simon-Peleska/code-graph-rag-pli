// Loaded into every test process (npm test's --import): collects the SQL the
// extension prepares and fails the file if a query that looks something up
// reads a whole table. On 5M lines one such query per symbol never ends.
// A query that reads every row on purpose says so with /* full scan */.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import { openGraph } from "../src/indexer.js";

const src = join(import.meta.dirname, "..", "src") + sep;
/** @type {Set<string>} */
const prepared = new Set();
const prepare = DatabaseSync.prototype.prepare;
/** @this {DatabaseSync} @param {string} sql @param {any[]} rest */
function preparing(sql, ...rest) {
  // The first frame outside this file is the code that asked.
  const caller = new Error().stack?.split("\n")[2] ?? "";
  if (caller.includes(src)) prepared.add(sql);
  return /** @type {any} */ (prepare).call(this, sql, ...rest);
}
DatabaseSync.prototype.prepare = preparing;

after(() => {
  if (!prepared.size) return;
  // Planned against the whole schema: a fresh sync drops some indexes while it runs.
  const db = openGraph(join(mkdtempSync(join(tmpdir(), "pli-plans-")), "graph.sqlite"));
  db.exec("CREATE TEMP TABLE IF NOT EXISTS pending_accesses (file INTEGER PRIMARY KEY, accesses TEXT NOT NULL)");
  const scans = [];
  for (const sql of prepared) {
    if (!/^\s*(SELECT|WITH|UPDATE|DELETE)/i.test(sql) || sql.includes("/* full scan */")) continue;
    if (!sql.replace(/'(?:[^']|'')*'/g, "").includes("?")) continue;
    const plan = /** @type {{ detail: string }[]} */ (prepare.call(db, `EXPLAIN QUERY PLAN ${sql}`).all());
    for (const { detail } of plan) {
      const name = /^SCAN (\w+)$/.exec(detail)?.[1];
      // A WITH's own tables are no tables of the graph.
      if (!name || new RegExp(`\\b${name}\\s*(\\([^)]*\\))?\\s+AS\\s*\\(`, "i").test(sql)) continue;
      scans.push(`${detail}: ${sql.replace(/\s+/g, " ").trim()}`);
    }
  }
  db.close();
  assert.deepEqual(scans, [], "queries with parameters that read a whole table; give them an index or mark them /* full scan */");
});
