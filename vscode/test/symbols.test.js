import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { Lines } from "../src/source.js";
import { Symbols } from "../src/symbols.js";
import { indexed } from "./indexed.js";

/** @typedef {import("../src/graph.js").TreeRow} TreeRow */
/** @typedef {import("../src/symbols.js").Site} Site */
/** @typedef {import("../src/symbols.js").Symbol} Symbol */

// test/zos is a small z/OS repository of extensionless members.
const fixture = join(import.meta.dirname, "zos");
const graph = new Graph(indexed(fixture), fixture);
const symbols = new Symbols(graph);

/**
 * The offset of the `nth` `word` on `line` (from 1) of `path`.
 * @param {string} path @param {number} line @param {string} word
 */
const at = (path, line, word, nth = 1) => {
  const text = readFileSync(join(fixture, path), "utf-8");
  const start = new Lines(text).offset(line - 1, 0);
  let offset = start - 1;
  for (let i = 0; i < nth; i++) offset = text.indexOf(word, offset + 1);
  return offset;
};
/** @param {(Symbol | Site)[]} found */
const where = (found) => found.map((s) => `${s.path}:${s.line + 1}:${s.col}`).sort();
/** @param {string} path @param {number} line @param {string} word */
const definition = (path, line, word, nth = 1) =>
  where(symbols.definitions(path, at(path, line, word, nth)));
/** @param {string} path @param {number} line @param {string} word */
const references = (path, line, word, nth = 1) =>
  where(symbols.references(path, at(path, line, word, nth)));

test("a variable goes to its declaration, also in an include and a nested include", () => {
  assert.deepEqual(definition("SRC/ABP00001", 5, "KEY"), ["SRC/ABP00001:3:7"]);
  assert.deepEqual(definition("SRC/ABP00001", 6, "CITY"), ["INCLUDE/ABC00001:5:11"]);
  assert.deepEqual(definition("SRC/ABP00001", 8, "TOTAL", 2), ["INCLUDE/ABC00002:1:5"]);
});

test("a qualified field goes to its field, through LIKE too", () => {
  assert.deepEqual(definition("SRC/ABP00001", 5, "ID"), ["INCLUDE/ABC00001:3:9"]);
  assert.deepEqual(definition("SRC/ABP00001", 7, "CITY"), ["INCLUDE/ABC00001:5:11"]);
  assert.deepEqual(definition("SRC/ABP00001", 7, "CITY", 2), ["INCLUDE/ABC00001:5:11"]);
});

test("a local declaration hides the outer one", () => {
  assert.deepEqual(definition("SRC/ABP00001", 14, "KEY"), ["SRC/ABP00001:13:7"]);
});

test("in SQL, host variables are variables and other names are columns of the tables used", () => {
  assert.deepEqual(definition("SRC/ABP00001", 9, "KEY"), ["SRC/ABP00001:3:7"]);
  assert.deepEqual(definition("SRC/ABP00001", 9, "ID", 1), ["DDL/ABT00001:1:28"]);
  assert.deepEqual(definition("SRC/ABP00001", 9, "ID", 2), ["INCLUDE/ABC00001:3:9"]);
  assert.deepEqual(definition("SRC/ABP00001", 9, "NAME"), ["DDL/ABT00001:1:49"]);
  assert.deepEqual(definition("SRC/ABP00001", 10, "ID"), ["DDL/ABT00001:2:26"]);
});

test("on a declaration, the declaration itself", () => {
  assert.deepEqual(definition("INCLUDE/ABC00001", 3, "ID"), ["INCLUDE/ABC00001:3:9"]);
});

test("references of a field in an include reach every program including it", () => {
  assert.deepEqual(references("INCLUDE/ABC00001", 3, "ID"), [
    "SRC/ABP00001:5:8",
    "SRC/ABP00001:9:70",
    "SRC/ABP00002:3:3",
    "SRC/ABP00002:4:50",
  ]);
});

test("references of a variable leave out a local one of the same name", () => {
  assert.deepEqual(references("SRC/ABP00001", 3, "KEY"), ["SRC/ABP00001:5:13", "SRC/ABP00001:9:30"]);
  assert.deepEqual(references("SRC/ABP00001", 13, "KEY"), ["SRC/ABP00001:14:3"]);
});

test("references of a column are its uses in the SQL of the programs using its table", () => {
  assert.deepEqual(references("DDL/ABT00001", 1, "ID"), ["SRC/ABP00001:9:59", "SRC/ABP00002:4:44"]);
});

test("HLASM: a field and an equate, also from a COPY member", () => {
  assert.deepEqual(definition("MFS/ABF00001", 9, "F00"), ["MFS/ABF00001:5:0"]);
  assert.deepEqual(definition("ASM/ABF00003", 3, "R1"), ["ASM/ABF00009:1:0"]);
  assert.deepEqual(references("MFS/ABF00001", 5, "F00"), ["MFS/ABF00001:13:15", "MFS/ABF00001:9:15"]);
  assert.deepEqual(references("ASM/ABF00009", 1, "R1"), ["ASM/ABF00003:3:15"]);
});

/** @param {string} path @param {number} offset */
const names = (path, offset) => {
  const found = symbols.completions(path, offset);
  return `${found.context}: ${found.symbols.map((s) => s.name).sort().join(" ")}`;
};

test("completion: fields after a structure name, columns in SQL, variables elsewhere", () => {
  assert.equal(names("SRC/ABP00001", at("SRC/ABP00001", 5, "ID")), "fields: ADDR ID");
  assert.equal(names("SRC/ABP00001", at("SRC/ABP00001", 7, "ADDR")), "fields: ADDR ID");
  assert.equal(names("SRC/ABP00001", at("SRC/ABP00001", 9, "NAME")), "sql: CUST ID ID NAME");
  assert.equal(names("SRC/ABP00001", at("SRC/ABP00001", 9, "KEY")), "host: ADDR CITY COPYC CUST ID KEY TOTAL");
  assert.equal(names("SRC/ABP00001", at("SRC/ABP00001", 14, "KEY")), "code: ADDR CITY COPYC CUST ID KEY TOTAL");
  assert.equal(names("ASM/ABF00003", at("ASM/ABF00003", 3, "R1")), "code: ABF00003 R1 R14 R2");
});

/** @param {TreeRow[]} rows */
const labels = (rows) => rows.map((row) => `${row.kind} ${row.label}${row.detail ? ` (${row.detail})` : ""}`);

test("dependencies list the tables a program uses and what it does with them", () => {
  const rows = graph.dependencies(/** @type {TreeRow} */ (graph.root("SRC/ABP00001")));
  assert.deepEqual(labels(rows), ["include ABC00001", "table TABLE CUSTOMER (SELECT)", "table TABLE ORDERS (UPDATE)"]);
});

test("dependents of a DDL file list the programs using each table and how", () => {
  assert.deepEqual(labels(graph.dependents(/** @type {TreeRow} */ (graph.root("DDL/ABT00001")))), [
    "calledBy ABP00001 → CUSTOMER (SELECT)",
    "calledBy ABP00001 → ORDERS (UPDATE)",
    "calledBy ABP00002 → CUSTOMER (DELETE)",
  ]);
});
