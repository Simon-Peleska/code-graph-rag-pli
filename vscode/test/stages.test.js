// Dev and prod copies of the same members live side by side in one repo: a
// name must mean the nearest copy, not every copy or the alphabetically first.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { openGraph, sync } from "../src/indexer.js";
import { indexer } from "./indexed.js";

/** @param {string} name */
const proc = (name) => ` ${name}: PROC;\n END ${name};\n`;
const table = "CREATE TABLE KUNDE (KDNR CHAR(8));\n";

const FILES = {
  "DEV/SRC/P1": [
    " P1: PROC OPTIONS(MAIN);",
    "   %INCLUDE KDINC;",
    "   DCL X CHAR(8);",
    "   CALL SUBP;",
    "   CALL SUBQ;",
    "   CALL SUBR;",
    "   EXEC SQL SELECT KDNR INTO :X FROM KUNDE;",
    " END P1;",
    "",
  ].join("\n"),
  // The local copy, though a subfolder's sorts first.
  "DEV/SRC/KDINC": "   DCL LOCAL CHAR(1);\n",
  "DEV/SRC/A/KDINC": "   DCL SUB CHAR(1);\n",
  "PROD/SRC/KDINC": "   DCL PROD CHAR(1);\n",
  // A subfolder before the parent folder and a sibling.
  "DEV/SRC/A/SUBP": proc("SUBP"),
  "DEV/SUBP": proc("SUBP"),
  "DEV/LIB/SUBP": proc("SUBP"),
  "PROD/SRC/SUBP": proc("SUBP"),
  // The parent folder before its other subfolders, though they sort first.
  "DEV/SUBQ": proc("SUBQ"),
  "DEV/LIB/SUBQ": proc("SUBQ"),
  // A sibling of the same stage before the other stage.
  "DEV/LIB/SUBR": proc("SUBR"),
  "PROD/SRC/SUBR": proc("SUBR"),
  // A table only from the nearest DDL, not every one defining it.
  "DEV/DDL/KUNDE.ddl": table,
  "PROD/DDL/KUNDE.ddl": table,
};

test("a name links to the nearest copy: local, subfolder, parent, sibling, then further out", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-stages-"));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const db = openGraph(join(root, ".graph.sqlite"));
  await sync(db, root, indexer);
  const links = db
    .prepare(
      `SELECT r.kind, r.name, t.path FROM refs r JOIN files f ON f.id = r.file JOIN links l ON l.ref = r.id JOIN files t ON t.id = l.target_file
       WHERE f.path = 'DEV/SRC/P1' ORDER BY r.line, t.path`,
    )
    .all()
    .map((r) => `${r.kind} ${r.name} -> ${r.path}`);
  assert.deepEqual(links, [
    "include KDINC -> DEV/SRC/KDINC",
    "call SUBP -> DEV/SRC/A/SUBP",
    "call SUBQ -> DEV/SUBQ",
    "call SUBR -> DEV/LIB/SUBR",
    "table KUNDE -> DEV/DDL/KUNDE.ddl",
  ]);
});
