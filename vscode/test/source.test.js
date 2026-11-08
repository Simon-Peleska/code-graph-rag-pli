import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankMargins,
  ddlTables,
  hlasmStatements,
  languageOf,
  pliCode,
  pliDeclarations,
  pliUses,
  sqlOperation,
} from "../src/source.js";

/** @param {string} code */
const fields = (code) =>
  pliDeclarations(pliCode(code)).map((d) => `${d.parent ? `${d.parent.name}.` : ""}${d.name}:${d.level} ${d.attributes}`);

test("members get their language by the third character, files by extension", () => {
  assert.deepEqual(
    ["SRC/ABP00001", "JCL/ABJ00001", "MFS/ABF00001", "DDL/ABT00001", "a/b.ddl", "x.mlc", "x.txt"].map(languageOf),
    ["pli", "jcl", "hlasm", "db2", "db2", "hlasm", undefined],
  );
});

test("declarations: structures, factored names and attributes", () => {
  assert.deepEqual(
    fields(" DCL 1 CUST BASED(P), 2 ID CHAR(8), 2 ADDR, 3 (CITY, ZIP) CHAR(20), 2 AMT FIXED DEC(9,2);"),
    [
      "CUST:1 BASED(P)",
      "CUST.ID:2 CHAR(8)",
      "CUST.ADDR:2 ",
      "ADDR.CITY:3 CHAR(20)",
      "ADDR.ZIP:3 CHAR(20)",
      "CUST.AMT:2 FIXED DEC(9,2)",
    ],
  );
  assert.deepEqual(fields(" L: DECLARE (I, J) FIXED BIN(31), S CHAR(2) INIT('A;B');"), [
    "I:1 FIXED BIN(31)",
    "J:1 FIXED BIN(31)",
    "S:1 CHAR(2) INIT( )",
  ]);
});

test("comments, strings and sequence numbers are not code", () => {
  const text = [
    " /* DCL NOT_ME CHAR; */                                                 AAC00010",
    " DCL ME BIT(1) INIT('1'B);                                              AAC00020",
  ].join("\n");
  assert.deepEqual(fields(text), ["ME:1 BIT(1) INIT( )"]);
  assert.equal(pliCode(text).length, text.length);
  assert.equal(blankMargins(text, "pli").slice(72, 80), "        ");
});

test("uses carry their qualifiers and know SQL and host variables", () => {
  const code = pliCode(" X = CUST.ADDR.CITY; EXEC SQL SELECT NAME INTO :N FROM T; P->A.B = 1;");
  const uses = pliUses(code).map((u) => `${[...u.qualifiers, u.name].join(".")}${u.sql ? " sql" : ""}${u.host ? " host" : ""}`);
  assert.deepEqual(uses, [
    "X", "CUST", "CUST.ADDR", "CUST.ADDR.CITY",
    "EXEC sql", "SQL sql", "SELECT sql", "NAME sql", "INTO sql", "N sql host", "FROM sql", "T sql",
    "P", "A", "A.B",
  ]);
});

test("HLASM: labels, operations, operands without keywords, constants or remarks", () => {
  const text = [
    "* a comment",
    "CUSTI    MSG   TYPE=INPUT,SOR=(CUSTFMT,IGNORE),NXT=CUSTO   remark",
    "         MFLD  (F00,'LIT'),LTH=8",
    "LBL      DC    C'AB',A(TARGET)",
    "         MVC   0(L'FIELD,R1),=CL8'X'",
    "         DFLD  POS=(1,2),                                              X",
    "               ATTR=(PROT,NEXT)",
  ].join("\n");
  const statements = hlasmStatements(text).map(
    (s) => `${s.label?.name ?? ""} ${s.operation?.name} ${s.operands.map((o) => o.name).join(",")}`,
  );
  assert.deepEqual(statements, [
    "CUSTI MSG INPUT,CUSTFMT,IGNORE,CUSTO",
    " MFLD F00",
    "LBL DC TARGET",
    " MVC FIELD,R1",
    " DFLD PROT,NEXT",
  ]);
  const [first] = hlasmStatements(text);
  assert.equal(text.slice(first.operands[1].start, first.operands[1].end), "CUSTFMT");
});

test("DDL tables and their columns", () => {
  const tables = ddlTables(
    "-- orders\nCREATE TABLE PROD.ORDERS (ID INTEGER NOT NULL,\n  \"CUST\" INTEGER REFERENCES PROD.CUSTOMER,\n  PRIMARY KEY (ID));\nCREATE VIEW V AS SELECT 1 FROM X;",
  );
  assert.deepEqual(
    tables.map((t) => [t.qualified, t.name, t.columns.map((c) => `${c.name} ${c.attributes}`)]),
    [["PROD.ORDERS", "ORDERS", ["ID INTEGER NOT NULL", "CUST INTEGER REFERENCES PROD.CUSTOMER"]]],
  );
});

test("the SQL operation done on a table", () => {
  assert.equal(sqlOperation("EXEC SQL SELECT A INTO :A FROM PROD.T WHERE X = 1", "T"), "SELECT");
  assert.equal(sqlOperation("EXEC SQL UPDATE PROD.T SET A = (SELECT B FROM U)", "T"), "UPDATE");
  assert.equal(sqlOperation("EXEC SQL UPDATE PROD.T SET A = (SELECT B FROM U)", "U"), "SELECT");
  assert.equal(sqlOperation("exec sql insert into t values (1)", "T"), "INSERT");
  assert.equal(sqlOperation("EXEC SQL DELETE FROM T", "T"), "DELETE");
  assert.equal(sqlOperation("EXEC SQL DECLARE C1 CURSOR FOR SELECT * FROM T", "T"), "SELECT");
});
