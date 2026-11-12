// The data model page: a DDL file's tables, views and aliases with their
// columns, and the foreign keys, FROMs and FORs between them and their neighbors.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { indexed } from "./indexed.js";

const folder = join(import.meta.dirname, "model");
const graph = new Graph(await indexed(folder), folder);

/** @param {NonNullable<ReturnType<Graph["pageDataModel"]>>} model */
function outline(model) {
  const name = (/** @type {string} */ id) => id.replace(/^.*:(.*):\d+$/, "$1");
  return {
    entities: model.entities.map((e) =>
      [`${e.distance} ${e.kind} ${e.qualifier}.${e.name} ${e.path}`, ...e.columns.map((c) => `  ${c.name} ${c.type}${c.notNull ? " NOT NULL" : ""}${c.key ? ` PK${c.key}` : ""}${c.foreign ? " FK" : ""}`)].join("\n"),
    ),
    relations: model.relations.map((r) => `${name(r.from)} ${r.kind} ${name(r.to)}${r.columns.length ? ` (${r.columns.join(", ")})` : ""}`).sort(),
  };
}

test("a DDL file's data model holds its tables with columns, keys and the relations to tables in other files", () => {
  const model = /** @type {NonNullable<ReturnType<Graph["pageDataModel"]>>} */ (graph.pageDataModel("DDL/MDT00001", 1));
  assert.deepEqual(outline(model), {
    entities: [
      "0 table PROD.KUNDE DDL/MDT00001\n  KDNR CHAR(8) NOT NULL PK1\n  NAME VARCHAR(40) NOT NULL\n  FILIALE INTEGER FK",
      "0 table PROD.KONTO DDL/MDT00001\n  KTONR INTEGER NOT NULL PK1\n  KDNR CHAR(8) NOT NULL FK\n  SALDO DECIMAL(11,2)",
      "0 view PROD.KUNDENKONTO DDL/MDT00001",
      "0 alias PROD.KTO DDL/MDT00001",
      "1 table PROD.FILIALE DDL/MDT00002\n  FILNR INTEGER NOT NULL PK1\n  ORT VARCHAR(30)",
      "1 table PROD.BUCHUNG DDL/MDT00002\n  BUCHNR INTEGER NOT NULL PK1\n  KTONR INTEGER NOT NULL FK\n  BETRAG DECIMAL(11,2) NOT NULL",
    ],
    relations: [
      "BUCHUNG references KONTO (KTONR)",
      "KONTO references KUNDE (KDNR)",
      "KTO alias KONTO",
      "KUNDE references FILIALE (FILIALE)",
      "KUNDENKONTO view KONTO",
      "KUNDENKONTO view KUNDE",
    ],
  });
  assert.equal(model.truncated, false);
});

test("depth 0 keeps a data model to the file's own tables", () => {
  const model = /** @type {NonNullable<ReturnType<Graph["pageDataModel"]>>} */ (graph.pageDataModel("DDL/MDT00002", 0));
  assert.deepEqual(outline(model).relations, []);
  assert.deepEqual(model.entities.map((e) => e.name), ["FILIALE", "BUCHUNG"]);
});

test("a file without tables has no data model", () => {
  assert.equal(graph.pageDataModel("DDL/NONE", 1), null);
});
