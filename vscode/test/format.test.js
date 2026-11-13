import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { format } from "../src/format.js";
import { createHighlighter } from "../src/highlight.js";
import { languageOf } from "../src/source.js";

const { pli } = await createHighlighter(join(import.meta.dirname, "../grammars"));

/**
 * The lines formatted, without the empty one after the final line break.
 * @param {import("../src/source.js").Language} language
 * @param {string[]} lines
 * @param {Partial<import("../src/format.js").Options>} [options]
 */
function formatted(language, lines, options = {}) {
  const result = format(language, lines.join("\n"), { indent: 3, pli: pli.parser, ...options });
  if ("error" in result) return result.error;
  assert.equal(result.lines.at(-1), "");
  return result.lines.slice(0, -1);
}

test("PL/I: statements one level in from their DO, BEGIN, SELECT, PROC, ON or IF", () => {
  assert.deepEqual(
    formatted("pli", [
      " P: PROC OPTIONS(MAIN);",
      " DCL 1 S, 2 A CHAR(8),",
      "          2 B FIXED BIN(31);",
      " /* a comment",
      "    on two lines */",
      " IF A = 'X' THEN DO;",
      " B = 1;",
      " END;",
      " ELSE",
      " B = 2;",
      " SELECT (A);",
      " WHEN ('Y') B = 3;",
      " OTHERWISE",
      " B = 4;",
      " END;",
      " ON ERROR BEGIN;",
      " PUT SKIP LIST('E');",
      " END;",
      " Q: PROC(K);",
      " DCL K CHAR(8);",
      " EXEC SQL UPDATE T",
      "          SET ID = 1;",
      " END Q;",
      " END P;",
    ]),
    [
      " P: PROC OPTIONS(MAIN);",
      "    DCL 1 S,",
      "          2 A CHAR(8),",
      "          2 B FIXED BIN(31);",
      "    /* a comment",
      "       on two lines */",
      "    IF A = 'X' THEN DO;",
      "       B = 1;",
      "    END;",
      "    ELSE B = 2;",
      "    SELECT (A);",
      "       WHEN ('Y') B = 3;",
      "       OTHER B = 4;",
      "    END;",
      "    ON ERROR BEGIN;",
      "       PUT SKIP LIST('E');",
      "    END;",
      "",
      "    Q: PROC(K);",
      "       DCL K CHAR(8);",
      "       EXEC SQL UPDATE T",
      "                SET ID = 1;",
      "    END Q;",
      " END P;",
    ],
  );
});

test("PL/I: sequence numbers and carriage control go, a string over a line end stays put", () => {
  const numbered = ["1P: PROC;", "  X = 1;", "0END P;"].map((line, i) => `${line.padEnd(72)}0000${i}00`);
  assert.deepEqual(formatted("pli", numbered), [" P: PROC;", "    X = 1;", " END P;"]);
  const kept = [" P: PROC;", "  X = 'A STRING THAT GOES ON", "  ON THE NEXT LINE';", " END P;"];
  assert.deepEqual(formatted("pli", kept), [" P: PROC;", "    X = 'A STRING THAT GOES ON", "  ON THE NEXT LINE';", " END P;"]);
});

test("PL/I: a statement's lines join when they fit and wrap after a comma or before an operator", () => {
  assert.deepEqual(
    formatted("pli", [
      " P: PROC;", "  DCL KEY", "   ", "", " CHAR(8);", "", "    CALL AAP00004(KEY,", "       RC);",
      ` X = ${"AA + ".repeat(14)}B;`,
      " CALL VERYLONGPROCEDURENAME(FIRSTARGUMENT,SECONDARGUMENT,THIRDARGUMENT,", " FOURTHARGUMENT);",
      " END P;",
    ]),
    [
      " P: PROC;",
      "    DCL KEY CHAR(8);",
      "",
      "    CALL AAP00004(KEY, RC);",
      `    X = ${"AA + ".repeat(12)}AA`,
      "       + AA + B;",
      "    CALL VERYLONGPROCEDURENAME(FIRSTARGUMENT, SECONDARGUMENT,",
      "                               THIRDARGUMENT, FOURTHARGUMENT);",
      " END P;",
    ],
  );
});

test("PL/I: blanks between tokens, IF and ELSE chains, comments where they were", () => {
  assert.deepEqual(
    formatted("pli", [
      " P:PROC OPTIONS ( MAIN ) ;",
      " DCL 1 KUNDE ,",
      "          2 NAME CHAR ( 40 ) ,  /* der Name */",
      "          2 ADR, 3 ORT CHAR(20), 3 PLZ PIC'99999';",
      " IF RC>0&KEY^='X' THEN",
      " DO; CALL ENDE; END;",
      " ELSE IF RC=0 THEN X='OK';  /* gut */",
      " ELSE",
      " X = 'SCHLECHT';",
      " ON ENDFILE(SYSIN) EOF='1'B;",
      " LOOP: DO WHILE(¬EOF); X=SUBSTR(NAME,1,8)||ORT; END LOOP;",
      " SELECT(RC); WHEN(1,2) X='A'; OTHERWISE; END;",
      " END P;",
    ]),
    [
      " P: PROC OPTIONS(MAIN);",
      "    DCL 1 KUNDE,",
      "          2 NAME CHAR(40),      /* der Name */",
      "          2 ADR,",
      "            3 ORT CHAR(20),",
      "            3 PLZ PIC '99999';",
      "    IF RC > 0 & KEY ¬= 'X' THEN DO;",
      "       CALL ENDE;",
      "    END;",
      "    ELSE IF RC = 0 THEN X = 'OK'; /* gut */",
      "    ELSE X = 'SCHLECHT';",
      "    ON ENDFILE(SYSIN) EOF = '1'B;",
      "    LOOP: DO WHILE (¬EOF);",
      "       X = SUBSTR(NAME, 1, 8) || ORT;",
      "    END LOOP;",
      "    SELECT (RC);",
      "       WHEN (1, 2) X = 'A';",
      "       OTHER;",
      "    END;",
      " END P;",
    ],
  );
});

test("PL/I: EXEC SQL is laid out a clause per line", () => {
  assert.deepEqual(
    formatted("pli", [
      " P: PROC;",
      " EXEC SQL SELECT NAME, SALDO INTO :NAME, :SALDO FROM PROD.KUNDE WHERE KDNR = :KDNR AND SALDO BETWEEN 1 AND 2",
      "   OR X IN (SELECT Y FROM Z WHERE Q = 'A  B') ORDER BY NAME;",
      " EXEC SQL DECLARE C1 CURSOR FOR SELECT A FROM T FOR UPDATE OF A;",
      " EXEC SQL INSERT INTO T (A, B) VALUES (:A, :B);",
      " EXEC SQL COMMIT;",
      " IF A THEN EXEC SQL DELETE FROM T WHERE B = 1;",
      " END P;",
    ]),
    [
      " P: PROC;",
      "    EXEC SQL SELECT NAME, SALDO",
      "             INTO :NAME, :SALDO",
      "             FROM PROD.KUNDE",
      "             WHERE KDNR = :KDNR",
      "               AND SALDO BETWEEN 1 AND 2",
      "               OR X IN (SELECT Y FROM Z WHERE Q = 'A  B')",
      "             ORDER BY NAME;",
      "    EXEC SQL DECLARE C1 CURSOR FOR",
      "             SELECT A",
      "             FROM T",
      "             FOR UPDATE OF A;",
      "    EXEC SQL INSERT INTO T (A, B)",
      "             VALUES (:A, :B);",
      "    EXEC SQL COMMIT;",
      "    IF A THEN",
      "       EXEC SQL DELETE FROM T",
      "                WHERE B = 1;",
      " END P;",
    ],
  );
});

test("PL/I: what the parser can't read is not formatted", () => {
  assert.match(String(formatted("pli", [" P: PROC;", " X = = ;", " END P;"])), /^\[PLG039W\] .* line 2\.$/);
});

test("JCL: the operation in column 12, a statement on one line or a parameter per line from column 16", () => {
  assert.deepEqual(
    formatted("jcl", [
      "//MYJOB JOB (ACCT),'A NAME',CLASS=A",
      "//* a comment   stays",
      "//STEP1 EXEC PGM=X   A COMMENT",
      "//IN DD DSN=A.B,",
      "//   DISP=SHR",
      "//OUT DD DSN=PROD.KUNDEN.AUSGABE,DISP=(NEW,CATLG,DELETE),UNIT=SYSDA,",
      "//  SPACE=(CYL,(10,5),RLSE)  THE OUTPUT",
      "//  DD DSN=C.D,DISP=SHR",
      "//SYSIN DD *",
      "  DATA   STAYS",
      "/*",
      "//S2 EXEC PGM=Y,PARM='A LONG PARAMETER THAT GOES ON UNTIL COLUMN SEVENTY ONE",
      "//             AND ON'",
      "//SYSUT1 DD DATA,DLM=$$",
      "//NOT    A STATEMENT",
      "$$",
      "//LAST  DD  DUMMY",
    ]),
    [
      "//MYJOB    JOB (ACCT),'A NAME',CLASS=A",
      "//* a comment   stays",
      "//STEP1    EXEC PGM=X A COMMENT",
      "//IN       DD DSN=A.B,DISP=SHR",
      "//OUT      DD DSN=PROD.KUNDEN.AUSGABE,",
      "//             DISP=(NEW,CATLG,DELETE),",
      "//             UNIT=SYSDA,",
      "//             SPACE=(CYL,(10,5),RLSE) THE OUTPUT",
      "//         DD DSN=C.D,DISP=SHR",
      "//SYSIN    DD *",
      "  DATA   STAYS",
      "/*",
      "//S2 EXEC PGM=Y,PARM='A LONG PARAMETER THAT GOES ON UNTIL COLUMN SEVENTY ONE",
      "//             AND ON'",
      "//SYSUT1   DD DATA,DLM=$$",
      "//NOT    A STATEMENT",
      "$$",
      "//LAST     DD DUMMY",
    ],
  );
});

test("HLASM: operation in column 10, operands in 16, remarks in 40; continuations stay", () => {
  const continued = `${"         PCB   TYPE=DB,DBDNAME=CUSTDB,".padEnd(71)}X`;
  assert.deepEqual(
    formatted("hlasm", [
      "* a comment   stays",
      "F00 DFLD 'NAME:  ',POS=(1,2) THE LABEL",
      " MVC  X,=C'A B'",
      " LA R1,L'FIELD the length",
      " AIF ('&X' EQ 'A').DONE",
      `${"  PCB TYPE=DB,DBDNAME=CUSTDB,".padEnd(71)}X`,
      "               PROCOPT=G",
      "MYLONGLABEL MSGEND",
    ]),
    [
      "* a comment   stays",
      "F00      DFLD  'NAME:  ',POS=(1,2)     THE LABEL",
      "         MVC   X,=C'A B'",
      "         LA    R1,L'FIELD              the length",
      "         AIF   ('&X' EQ 'A').DONE",
      continued,
      "               PROCOPT=G",
      "MYLONGLABEL MSGEND",
    ],
  );
});

test("Db2: a clause per line, a table's columns one per line and aligned", () => {
  assert.deepEqual(
    formatted("db2", [
      "-- customers",
      "CREATE TABLE PROD.KUNDE (",
      "KDNR CHAR(8) NOT NULL,",
      "      NAME VARCHAR(40),",
      "  SALDO DECIMAL(11,2) WITH DEFAULT 0,",
      "PRIMARY KEY (KDNR)",
      "    );",
      "CREATE VIEW PROD.V AS",
      "SELECT 'A  B' FROM PROD.KUNDE",
      "WHERE KDNR IN (SELECT KDNR",
      "FROM PROD.KONTO);",
      "CREATE TABLESPACE TS1 IN DB1 USING STOGROUP SG1 BUFFERPOOL BP0;",
    ]),
    [
      "-- customers",
      "CREATE TABLE PROD.KUNDE (",
      "  KDNR  CHAR(8)       NOT NULL,",
      "  NAME  VARCHAR(40),",
      "  SALDO DECIMAL(11,2) WITH DEFAULT 0,",
      "  PRIMARY KEY (KDNR)",
      ");",
      "CREATE VIEW PROD.V AS",
      "  SELECT 'A  B'",
      "  FROM PROD.KUNDE",
      "  WHERE KDNR IN (SELECT KDNR FROM PROD.KONTO);",
      "CREATE TABLESPACE TS1",
      "  IN DB1",
      "  USING STOGROUP SG1",
      "  BUFFERPOOL BP0;",
    ],
  );
});

test("PL/I: case, abbreviations, quotes, comments, END names and blank lines", () => {
  const source = [
    "",
    " (nofixedoverflow): p: procedure options(main);",
    "",
    "   declare x fixed binary(31) initial(1e3),  /*the count*/",
    '           s character(8) varying initial("it\'s"),',
    "           b bit(1) initial('1'b);",
    "   on conversion go to done;",
    "",
    "",
    "   if x ^= 0 ! s = 'a' then x = 0;",
    "   s = s !! 'x';  /******/",
    "   /* the inner one */",
    "   q: proc;",
    "   end;",
    " done: end;",
    "",
    "",
  ];
  assert.deepEqual(formatted("pli", source), [
    " (NOFOFL): P: PROC OPTIONS(MAIN);",
    "    DCL X FIXED BIN(31) INIT(1E3),           /* the count */",
    "        S CHAR(8) VAR INIT('it''s'),",
    "        B BIT(1) INIT('1'B);",
    "    ON CONV GOTO DONE;",
    "",
    "    IF X ^= 0 ! S = 'a' THEN X = 0;",
    "    S = S !! 'x'; /******/",
    "    /* the inner one */",
    "    Q: PROC;",
    "    END Q;",
    " DONE: END P;",
  ]);
  assert.deepEqual(formatted("pli", source, { keywordCase: "lower", identifierCase: "keep", abbreviations: "long" }).slice(0, 5), [
    " (nofixedoverflow): p: procedure options(main);",
    "    declare x fixed binary(31) initial(1e3), /* the count */",
    "            s character(8) varying initial('it''s'),",
    "            b bit(1) initial('1'b);",
    "    on conversion go to done;",
  ]);
});

test("JCL, HLASM and SQL: the case of their words", () => {
  assert.deepEqual(formatted("jcl", ["//step1 exec pgm=abc,parm='keep me'  a comment"]), ["//STEP1    EXEC PGM=ABC,PARM='keep me' a comment"]);
  assert.deepEqual(formatted("hlasm", ["f00 dfld 'Name:',pos=(1,2) a remark"]), ["F00      DFLD  'Name:',POS=(1,2)       a remark"]);
  assert.deepEqual(formatted("db2", ["select a from t where b = 'x' and c = \"Mixed\";"], { keywordCase: "upper" }), [
    "SELECT A",
    "  FROM T",
    "  WHERE B = 'x'",
    "    AND C = \"Mixed\";",
  ]);
  assert.deepEqual(formatted("pli", [" exec sql select a into :hv from t;"], { identifierCase: "lower" }), [
    " EXEC sql SELECT A",
    "          INTO :hv",
    "          FROM T;",
  ]);
});

test("formatting the test sources keeps their meaning and twice is like once", () => {
  for (const dir of ["fixture", "flow", "model", "zos"]) {
    for (const entry of readdirSync(join(import.meta.dirname, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const language = languageOf(path);
      if (!language) continue;
      const text = readFileSync(path, "utf-8");
      const once = format(language, text, { indent: 3, pli: pli.parser });
      if ("error" in once) {
        assert.match(once.error, /PLG039W/, path);
        continue;
      }
      const twice = format(language, once.lines.join("\n"), { indent: 3, pli: pli.parser });
      assert.deepEqual("lines" in twice && twice.lines, once.lines, path);
    }
  }
});
