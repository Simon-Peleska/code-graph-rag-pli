import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createHighlighter, highlight, TOKEN_MODIFIERS, TOKEN_TYPES } from "../src/highlight.js";

const highlighter = await createHighlighter(join(import.meta.dirname, "../grammars"));

/**
 * Each token as `type text`, modifiers after a dot.
 * @param {import("../src/highlight.js").HighlightLanguage} language
 * @param {string} text
 */
function tokens(language, text) {
  const lines = text.split(/\r?\n/);
  return highlight(highlighter, language, text).map((token) => {
    const modifiers = TOKEN_MODIFIERS.filter((_, bit) => token.modifiers & (1 << bit));
    return `${[TOKEN_TYPES[token.type], ...modifiers].join(".")} ${lines[token.line].slice(token.char, token.char + token.length)}`;
  });
}

test("PL/I keywords, labels, declarations, strings and comments", () => {
  const found = tokens("pli", "/* hi */\nMAIN: PROC OPTIONS(MAIN);\n  DCL NAME CHAR(8) INIT('X');\n  N = LENGTH(NAME);\nEND MAIN;\n");
  for (const expected of ["comment /* hi */", "label MAIN", "keyword PROC", "variable NAME", "type CHAR", "string 'X'", "function.defaultLibrary LENGTH"]) {
    assert.ok(found.includes(expected), `${expected} in ${found.join(", ")}`);
  }
});

test("a comment over several lines gives one token per line", () => {
  assert.deepEqual(tokens("pli", "/* one\r\n   two */\r\nX: PROC; END X;\r\n").slice(0, 2), ["comment /* one", "comment    two */"]);
});

test("EXEC SQL is read by the Db2 grammar", () => {
  const found = tokens("pli", "S: PROC;\n  EXEC SQL SELECT ID INTO :I FROM PROD.CUSTOMER WHERE ID = 1;\nEND S;\n");
  assert.ok(found.includes("type PROD.CUSTOMER"), found.join(", "));
  assert.ok(found.includes("keyword SELECT"), found.join(", "));
});

test("a fixed-format file's sequence numbers are no code", () => {
  const line = (/** @type {string} */ code) => ` ${code}`.padEnd(72) + "00010000";
  const found = tokens("pli", [line("X: PROC;"), line("CALL Y;"), line("END X;")].join("\n"));
  assert.ok(found.includes("keyword PROC"), found.join(", "));
  assert.ok(!found.some((token) => token.includes("00010000")), found.join(", "));
});

test("JCL, MFS and Db2 files get tokens", () => {
  assert.ok(tokens("jcl", "//ABJOB01 JOB (ACCT)\n//S1 EXEC PGM=ABMAIN01\n").length > 0);
  assert.ok(tokens("hlasm", "CUSTFMT  FMT\n         FMTEND\n").length > 0);
  assert.ok(tokens("db2", "CREATE TABLE PROD.CUSTOMER (ID INTEGER);\n").includes("keyword CREATE"));
});

test("every sample file highlights in order, no token past its line", () => {
  const root = join(import.meta.dirname, "zos");
  /** @type {Record<string, import("../src/highlight.js").HighlightLanguage>} */
  const languages = { SRC: "pli", INCLUDE: "pli", ASM: "hlasm", MFS: "hlasm", DDL: "db2" };
  for (const [folder, language] of Object.entries(languages)) {
    for (const name of readdirSync(join(root, folder))) {
      const text = readFileSync(join(root, folder, name), "utf-8");
      const lines = text.split("\n");
      let last = { line: 0, end: 0 };
      for (const token of highlight(highlighter, language, text)) {
        assert.ok(token.line > last.line || token.char >= last.end, `${folder}/${name}:${token.line + 1} out of order`);
        assert.ok(token.char + token.length <= lines[token.line].replace(/\r$/, "").length, `${folder}/${name}:${token.line + 1} past the line`);
        last = { line: token.line, end: token.char + token.length };
      }
    }
  }
});
