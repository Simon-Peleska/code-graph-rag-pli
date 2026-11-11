// The file open in the editor, and everything it uses, is in the graph
// before the rest of a sync is done.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { grammarsIn, openGraph, sync } from "../src/indexer.js";
import { indexer } from "./indexed.js";

const parsers = { script: join(import.meta.dirname, "../src/parser.js"), grammars: grammarsIn(join(import.meta.dirname, "../grammars")) };

// MAINPGM includes MAININC and calls SUBPGM, which calls LEAFPGM. OTHER calls
// OTHSUB. 150 FILLnnn members come first in the folder, more than the 100
// from which a sync parses in threads.
function repository() {
  const root = mkdtempSync(join(tmpdir(), "pli-focus-"));
  mkdirSync(join(root, "SRC"));
  const write = (/** @type {string} */ name, /** @type {string} */ text) => writeFileSync(join(root, "SRC", name), text);
  write("MAINPGM", " MAINPGM: PROC OPTIONS(MAIN);\n %INCLUDE MAININC;\n   CALL SUBPGM;\n   ZAEHLER = 1;\n END MAINPGM;\n");
  write("MAININC", " DCL ZAEHLER FIXED BIN(31);\n");
  write("SUBPGM", " SUBPGM: PROC;\n   CALL LEAFPGM;\n END SUBPGM;\n");
  write("LEAFPGM", " LEAFPGM: PROC;\n END LEAFPGM;\n");
  write("OTHER", " OTHER: PROC;\n   CALL OTHSUB;\n END OTHER;\n");
  write("OTHSUB", " OTHSUB: PROC;\n END OTHSUB;\n");
  for (let i = 0; i < 150; i++) write(`FILL${String(i).padStart(3, "0")}`, ` FILL${i}: PROC;\n END FILL${i};\n`);
  return root;
}

/** @param {DatabaseSync} db @param {string} sql */
const column = (db, sql) => /** @type {Record<string, string>[]} */ (db.prepare(sql).all()).map((r) => Object.values(r)[0]);

/** @param {DatabaseSync} db */
function facts(db) {
  return {
    files: column(db, "SELECT member FROM files ORDER BY member"),
    links: column(
      db,
      `SELECT f.member || ' ' || r.kind || ' ' || r.name || ' -> ' || t.member FROM refs r JOIN files f ON f.id = r.file
       JOIN links l ON l.ref = r.id JOIN files t ON t.id = l.target_file ORDER BY 1`,
    ),
    accesses: column(db, `SELECT a.name || ' ' || a.mode || ' ' || coalesce(v.qualified, '-') FROM accesses a LEFT JOIN variables v ON v.id = a.variable ORDER BY 1`),
  };
}

const notFiller = (/** @type {string[]} */ members) => members.filter((m) => !m.startsWith("FILL"));

for (const threads of [false, true]) {
  test(`the focused file and what it uses, transitively, are committed first${threads ? " (in threads)" : ""}`, async () => {
    const root = repository();
    const file = join(root, ".graph.sqlite");
    const db = openGraph(file);
    /** @type {ReturnType<typeof facts>[]} */
    const seen = [];
    await sync(db, root, indexer, {
      focus: () => "SRC/MAINPGM",
      onFocus: () => seen.push(facts(new DatabaseSync(file, { readOnly: true }))),
      ...(threads ? { parsers } : {}),
    });
    assert.equal(seen.length, 2);
    // First what the file uses directly, then what that uses.
    assert.deepEqual(seen[0], {
      files: ["MAININC", "MAINPGM", "SUBPGM"],
      links: ["MAINPGM call SUBPGM -> SUBPGM", "MAINPGM include MAININC -> MAININC"],
      accesses: ["ZAEHLER write ZAEHLER"],
    });
    assert.deepEqual(seen[1], {
      files: ["LEAFPGM", "MAININC", "MAINPGM", "SUBPGM"],
      links: ["MAINPGM call SUBPGM -> SUBPGM", "MAINPGM include MAININC -> MAININC", "SUBPGM call LEAFPGM -> LEAFPGM"],
      accesses: ["ZAEHLER write ZAEHLER"],
    });

    const plain = openGraph(join(mkdtempSync(join(tmpdir(), "pli-graph-")), "graph.sqlite"));
    await sync(plain, root, indexer);
    assert.deepEqual(facts(db), facts(plain));
  });
}

test("a file focused while syncing goes ahead of the one focused before", async () => {
  const root = repository();
  const file = join(root, ".graph.sqlite");
  const db = openGraph(file);
  let asked = 0;
  /** @type {string[][]} */
  const committed = [];
  await sync(db, root, indexer, {
    focus: () => (asked++ === 0 ? "SRC/MAINPGM" : "SRC/OTHER"),
    onFocus: () => committed.push(notFiller(facts(new DatabaseSync(file, { readOnly: true })).files)),
  });
  // MAINPGM was read before OTHER was focused; what it uses waits.
  assert.deepEqual(committed, [["MAINPGM", "OTHER", "OTHSUB"]]);
});

test("a focused file that is already indexed brings its changed dependencies first", async () => {
  const root = repository();
  const file = join(root, ".graph.sqlite");
  const db = openGraph(file);
  await sync(db, root, indexer);
  writeFileSync(join(root, "SRC", "LEAFPGM"), " LEAFPGM: PROC;\n   CALL OTHSUB;\n END LEAFPGM;\n");
  writeFileSync(join(root, "SRC", "FILL000"), " FILL000: PROC;\n   CALL OTHSUB;\n END FILL000;\n");
  /** @type {string[][]} */
  const committed = [];
  await sync(db, root, indexer, {
    focus: () => "SRC/MAINPGM",
    onFocus: () => committed.push(facts(new DatabaseSync(file, { readOnly: true })).links.filter((l) => l.includes("OTHSUB"))),
  });
  assert.deepEqual(committed, [["LEAFPGM call OTHSUB -> OTHSUB", "OTHER call OTHSUB -> OTHSUB"]]);
});
