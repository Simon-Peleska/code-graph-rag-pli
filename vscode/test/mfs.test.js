import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mfsFormats } from "../src/mfs.js";

/** Columns 1-71 as given, a continuation mark in 72 when asked for. */
const line = (/** @type {string} */ text, continued = false) => (continued ? `${text.padEnd(71)}X` : text);

test("literals, fields, attributes and colors", () => {
  const source = [
    "CUSTFMT  FMT",
    "         DEV   TYPE=(3270,2),FEAT=IGNORE",
    "         DIV   TYPE=INOUT",
    "         DPAGE CURSOR=((5,20))",
    "         DFLD  'CUSTOMER INQUIRY',POS=(1,30),ATTR=(PROT,HI)",
    "         DFLD  'IT''S ID:',POS=(5,2)",
    "CUSTID   DFLD  POS=(5,20),LTH=8,ATTR=(NUM)",
    line("CUSTNM   DFLD  POS=(6,20),", true),
    "               LTH=30,EATTR=(YELLOW,HUL)",
    "PASSWD   DFLD  POS=(7,20),LTH=8,ATTR=(NODISP)",
    "STATUS   DFLD  POS=(23,2),LTH=40,ATTR=(PROT)",
    "         DFLD  POS=(8,20),LTH=4",
    "         FMTEND",
  ].join("\n");
  const [format] = mfsFormats(source);
  assert.equal(format.name, "CUSTFMT");
  assert.deepEqual([format.rows, format.cols, format.cursor], [24, 80, { row: 4, col: 19 }]);
  assert.deepEqual(format.texts, [
    { row: 0, col: 29, text: "CUSTOMER INQUIRY", fg: "white", gr: "highlight" },
    { row: 4, col: 1, text: "IT'S ID:", fg: "blue", gr: null },
  ]);
  assert.deepEqual(
    format.fields.map((f) => [f.name, f.row, f.col, f.width, f.protected, f.hidden, f.numeric, f.fg]),
    [
      ["CUSTID", 4, 19, 8, false, false, true, "green"],
      ["CUSTNM", 5, 19, 30, false, false, false, "yellow"],
      ["PASSWD", 6, 19, 8, false, true, false, "green"],
      ["STATUS", 22, 1, 40, true, false, false, "blue"],
      ["R8C20", 7, 19, 4, false, false, false, "green"],
    ],
  );
});

test("a literal continued in column 16 of the next line", () => {
  const source = [
    "F        FMT",
    "         DEV   TYPE=3270-A4",
    line("         DFLD  'ONE TWO", true),
    "               THREE',POS=(2,2)",
    "         FMTEND",
  ].join("\n");
  const [format] = mfsFormats(source);
  assert.deepEqual([format.rows, format.cols], [43, 80]);
  assert.equal(format.texts[0].text, `ONE TWO${" ".repeat(48)}THREE`);
});

test("only the first device of a format counts", () => {
  const source = ["F        FMT", "         DEV   TYPE=(3270,2)", "A        DFLD  POS=(1,2)", "         DEV   TYPE=(3270,5)", "B        DFLD  POS=(1,2)", "         FMTEND"].join("\n");
  const [format] = mfsFormats(source);
  assert.deepEqual([format.rows, format.cols, format.fields.map((f) => f.name)], [24, 80, ["A"]]);
});

test("every sample screen has its fields", () => {
  const formats = mfsFormats(readFileSync(join(import.meta.dirname, "zos/MFS/ABF00001"), "utf-8"));
  assert.deepEqual(
    formats.map((f) => [f.name, f.fields.map((field) => `${field.name}@${field.row},${field.col}`)]),
    [["CUSTFMT", ["F00@2,19"]]],
  );
});
