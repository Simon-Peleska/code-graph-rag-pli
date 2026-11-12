import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankMargins,
  ddlTables,
  insertBlanks,
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

test("blanks typed into a line keep what ends at column 72 and the sequence number in place", () => {
  /** @param {string} code @param {string} [sequence] */
  const line = (code, sequence = "AAP00020") => code.padEnd(72) + sequence;
  /** @param {string} text @param {number} column */
  const blanks = (text, column, count = 3) => insertBlanks(text, column, count);
  // The trailing blanks of the code make room.
  assert.equal(blanks(line(" %INCLUDE AAC00021;"), 1), line("    %INCLUDE AAC00021;"));
  // So does the filler in front of a comment's closing */.
  const stars = " /* KUNDE LESEN " + "*".repeat(55) + "/";
  assert.equal(blanks(line(stars), 1), line("    /* KUNDE LESEN " + "*".repeat(52) + "/"));
  const dashes = " /* KUNDE LESEN " + "-".repeat(54) + "*/";
  assert.equal(blanks(line(dashes), 1), line("    /* KUNDE LESEN " + "-".repeat(51) + "*/"));
  const equals = " /* KUNDE LESEN " + "=".repeat(54) + "*/";
  assert.equal(blanks(line(equals), 1), line("    /* KUNDE LESEN " + "=".repeat(51) + "*/"));
  const spaced = " /* KUNDE LESEN" + " ".repeat(55) + "*/";
  assert.equal(blanks(line(spaced), 1), line("    /* KUNDE LESEN" + " ".repeat(52) + "*/"));
  // And the blanks in front of a comment's last word.
  const marked = " /* KUNDE LESEN" + " ".repeat(54) + "i*/";
  assert.equal(blanks(line(marked), 1), line("    /* KUNDE LESEN" + " ".repeat(51) + "i*/"));
  // Not enough in front of the last word: the blanks further left give the rest, one staying in each gap.
  const gap = "       %INCLUDE AAC00021;" + " ".repeat(33) + "/* asdfd   i*/AAP00020";
  assert.equal(blanks(gap, 7), "          %INCLUDE AAC00021;" + " ".repeat(32) + "/* asdfd i*/AAP00020");
  // Blanks in a string are its value: they stay.
  const quoted = " X = 'A" + " ".repeat(40) + "B';" + " ".repeat(15) + "/* Y */";
  assert.equal(blanks(quoted, 1, 15), undefined);
  assert.equal(blanks(quoted, 1, 14), " ".repeat(15) + "X = 'A" + " ".repeat(40) + "B'; /* Y */");
  // A string going on to the next line keeps its trailing blanks.
  assert.equal(blanks(line(" X = 'CONTINUED"), 1), undefined);
  // Without a sequence number the comment still ends in column 72.
  assert.equal(blanks(dashes, 1), "    /* KUNDE LESEN " + "-".repeat(51) + "*/");
  // A short line just gets the blanks.
  assert.equal(blanks(" IF A = B", 4), " IF    A = B");
  // The opening /* and the words of a comment are never taken.
  const full = " /* " + "X".repeat(60) + "      */";
  assert.equal(blanks(full, 1), "    /* " + "X".repeat(60) + "   */");
  assert.equal(blanks(full, 1, 7), undefined);
  assert.equal(blanks(" /*" + "*".repeat(67) + "*/", 3, 69), undefined);
  // Nothing before the cursor moves: no room after it, no blanks.
  assert.equal(blanks(line(" X = 1;" + " ".repeat(40) + "/* " + "Y".repeat(19) + "*/"), 60), undefined);
  // In the sequence number columns, the line just gets the blanks.
  assert.equal(blanks(line(" X = 1;"), 73, 1), line(" X = 1;", "A AP00020"));
});
