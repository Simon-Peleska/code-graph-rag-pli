import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { generateJs } from "../src/tojs.js";
import { indexed, indexer } from "./indexed.js";

const TEMPLATES = { templates: join(import.meta.dirname, "../src/jsruntime"), tn3270: join(import.meta.dirname, "../screen/vendor/tn3270") };
const root = join(import.meta.dirname, "facts");
const db = await indexed(root);
const out = mkdtempSync(join(tmpdir(), "pli-js-"));
const summary = generateJs(db, root, indexer, out, { ...TEMPLATES });

/** @param {string} file */
const load = (file) => import(pathToFileURL(join(out, file)).href);

const runtime = await load("runtime.js");
const kunden = new DatabaseSync(":memory:");
kunden.exec("ATTACH DATABASE ':memory:' AS PROD");
kunden.exec("CREATE TABLE PROD.KUNDE (KDNR TEXT PRIMARY KEY, SALDO NUMERIC)");
kunden.exec("INSERT INTO PROD.KUNDE VALUES ('00004711', 100.5)");
runtime.setDatabase({
  async query(/** @type {string} */ sql, /** @type {any[]} */ params) {
    const statement = kunden.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) {
      const rows = statement.all(...params).map((row) => Object.values(row));
      return { rows, count: rows.length };
    }
    return { rows: [], count: Number(statement.run(...params).changes) };
  },
});
const { handle } = await load("server.js");

test("a FIXED DEC drops the float noise of a subtraction instead of losing a cent", () => {
  assert.equal(runtime.dec(10116.31 - 10000, 15, 2), 116.31);
  assert.equal(runtime.dec(-(10116.31 - 10000), 15, 2), -116.31);
  assert.equal(runtime.dec(1.239, 15, 2), 1.23);
});

/** @param {string} kdnr @param {string} betrag */
const book = async (kdnr, betrag, serve = handle) => {
  const { status, body } = await serve("POST", "/KD07", { aid: "Enter", values: { KDNR: kdnr, BETRAG: betrag } });
  return { status, shown: JSON.parse(body) };
};

test("KD07 books an amount onto the customer's balance", async () => {
  const { status, shown } = await book("00004711", "25.25");
  assert.equal(status, 200, shown.error);
  assert.equal(shown.values.SALDO, "00000012575");
  assert.equal(shown.values.MELDUNG, "GEBUCHT");
  assert.equal(/** @type {{ SALDO: number }} */ (kunden.prepare("SELECT SALDO FROM PROD.KUNDE").get()).SALDO, 125.75);
});

test("KD07 without an amount answers KD201", async () => {
  const { shown } = await book("00004711", "");
  assert.equal(shown.values.MELDUNG, "KD201 BETRAG FEHLT");
});

test("KD07 shows its input screen on tn3270's terminal", async () => {
  const { status, body } = await handle("GET", "/KD07");
  assert.equal(status, 200);
  assert.match(body, /<script type="module" src="\/terminal.js">/);
  const shown = JSON.parse(/** @type {string[]} */ (/<script id="initial" type="application\/json">(.*?)<\/script>/s.exec(body))[1]);
  assert.ok(shown.format.texts.some((/** @type {{ text: string }} */ t) => /SALDO BUCHEN/.test(t.text)));
  assert.deepEqual(
    shown.format.fields.filter((/** @type {{ name: string }} */ f) => f.name === "KDNR").map((/** @type {any} */ f) => [f.width, f.protected]),
    [[8, false]],
  );
  for (const file of ["/terminal.js", "/tn3270/canvas.js", "/tn3270/local-host.js"]) {
    assert.equal((await handle("GET", file)).status, 200, file);
  }
});

test("with SQLITE set, KD07 books onto a customer in SQLite, its tables made from sqlite.sql", async () => {
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  generateJs(db, root, indexer, out, { ...TEMPLATES });
  const ddl = readFileSync(join(out, "sqlite.sql"), "utf-8");
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS "PROD\.KUNDE" \(\n  KDNR CHAR\(8\) NOT NULL,\n.*\n.*\n  TYP CHAR\(1\) NOT NULL DEFAULT '',\n  PRIMARY KEY \(KDNR\)\n\);/);
  const file = join(mkdtempSync(join(tmpdir(), "pli-sqlite-")), "data.db");
  process.env.SQLITE = file;
  const server = await import(pathToFileURL(join(out, "server.js")).href);
  // The first SQL makes the tables, without the customer yet.
  assert.equal((await book("00004711", "25.25", server.handle)).status, 200);
  delete process.env.SQLITE;
  const store = new DatabaseSync(file);
  store.exec(`INSERT INTO "PROD.KUNDE" (KDNR, NAME, SALDO) VALUES ('00004711', 'ANNA', 100.5)`);
  const { status, shown } = await book("00004711", "25.25", server.handle);
  assert.equal(status, 200, shown.error);
  assert.equal(shown.values.SALDO, "00000012575");
  assert.equal(shown.values.MELDUNG, "GEBUCHT");
  assert.equal(/** @type {{ SALDO: number }} */ (store.prepare(`SELECT SALDO FROM "PROD.KUNDE"`).get()).SALDO, 125.75);
});

test("an unknown transaction gets an error with its code", async () => {
  const { status, body } = await handle("GET", "/XX99");
  assert.equal(status, 404);
  assert.match(body, /PLG055E/);
});

test("KDP00013 translates without a TODO, with its types in JSDoc", () => {
  const program = summary.programs.find((p) => p.member === "KDP00013");
  assert.ok(program);
  assert.deepEqual(program.todos, []);
  const code = readFileSync(join(out, program.module), "utf-8");
  assert.match(code, /export async function KDP00013\(IOPCB_PTR\)/);
  assert.match(code, /\/\*\* @type \{number\} FIXED DEC\(11,2\) \*\/\n\s*let BUCHUNG = 0;/);
  assert.match(code, /await ims\.gu\(IOPCB, EINGABE, EINGABE_LAYOUT\);/);
  assert.match(code, /KD_NR = char\(toPic\(EINGABE\.KDNR, "\(8\)9"\), 8\);/);
});

test("every generated program loads", async () => {
  for (const program of summary.programs) await load(program.module);
});

test("parameters a procedure changes come back to the caller, and called programs are generated too", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00001"),
    ` ZZP00001: PROC(OUT);
   DCL OUT FIXED BIN(31);
   DCL KEY CHAR(8) INIT('A');
   DCL RC FIXED BIN(31) INIT(0);
   CALL ZZP00002(KEY, RC);
   OUT = RC * 10;
 END ZZP00001;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZP00002"),
    ` ZZP00002: PROC(K, RC);
   DCL K CHAR(8);
   DCL RC FIXED BIN(31);
   DCL P PTR;
   DCL 1 R BASED(P),
         2 A FIXED BIN(31);
   ALLOCATE R;
   R.A = 7;
   RC = R.A;
   CALL VERDOPPELN(RC);
   FREE R;
 VERDOPPELN: PROC(N);
   DCL N FIXED BIN(31);
   N = N * 2;
 END VERDOPPELN;
 END ZZP00002;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00001"] });
  assert.deepEqual(
    summary.programs.map((p) => [p.member, p.todos]),
    [
      ["ZZP00001", []],
      ["ZZP00002", []],
    ],
  );
  const caller = readFileSync(join(out, "programs/ZZP00001.js"), "utf-8");
  assert.match(caller, /import \{ ZZP00002 \} from "\.\/ZZP00002\.js";/);
  assert.match(caller, /\(\{ RC: RC \} = await ZZP00002\(KEY, RC\)\);/);
  const { ZZP00001 } = await import(pathToFileURL(join(out, "programs/ZZP00001.js")).href);
  assert.deepEqual(await ZZP00001(0), { OUT: 140 });
});

test("a function procedure called with empty parentheses runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZLEER"),
    ` ZZLEER: PROC(OUT);
   DCL OUT FIXED BIN(15);
   OUT = PRUEFEN();
 PRUEFEN: PROC RETURNS(FIXED BIN(15));
   RETURN(110);
 END PRUEFEN;
 END ZZLEER;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZLEER"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZLEER } = await import(pathToFileURL(join(out, "programs/ZZLEER.js")).href);
  assert.deepEqual(await ZZLEER(0), { OUT: 110 });
});

test("LEAVE ends the innermost DO group, a loop or not, a GOTO to the END's label ends the pass, and the bounds of a field come from its array of structures", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZLEAV"),
    ` ZZLEAV: PROC(OUT);
   DCL OUT FIXED BIN(31);
   DCL 1 TAB(0:3),
         2 K CHAR(1);
   DCL (I, P, Q, R) FIXED BIN(31) INIT(0);
   K(0) = 'A'; K(1) = 'C'; K(2) = 'D'; K(3) = 'B';
   DO I = LBOUND(K, 1) TO HBOUND(K, 1);
     IF K(I) > 'B' THEN DO;
       P = I;
       LEAVE;
     END;
   END;
   DO I = 0 TO 3;
     IF K(I) = 'D' THEN LEAVE;
   END;
   Q = I;
   DO I = 1 TO 4;
     IF I = 2 THEN GOTO WEITER;
     R = R + I;
  WEITER:
   END;
   OUT = R * 100000 + DIM(K, 1) * 10000 + HBOUND(K) * 1000 + LBOUND(K) * 100 + P * 10 + Q;
 END ZZLEAV;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZLEAV"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZLEAV } = await import(pathToFileURL(join(out, "programs/ZZLEAV.js")).href);
  assert.deepEqual(await ZZLEAV(0), { OUT: 843022 });
});

test("TRANSLATE, DIVIDE and SUM over a cross-section run without being declared", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZSUM"),
    ` ZZSUM: PROC(OUT, TXT);
   DCL OUT FIXED DEC(9,2);
   DCL TXT CHAR(4);
   DCL 1 TAB,
         3 ZEILE(2),
           5 ANZ(3) FIXED DEC(9);
   DCL I FIXED BIN(31);
   DO I = 1 TO 2;
     ANZ(I,*) = I;
   END;
   ANZ(2,3) = 5;
   OUT = DIVIDE(SUM(ANZ(2,*)), 4, 9, 2);
   TXT = TRANSLATE(' 1 2', '0', ' ');
 END ZZSUM;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZSUM"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZSUM } = await import(pathToFileURL(join(out, "programs/ZZSUM.js")).href);
  assert.deepEqual(await ZZSUM(0, ""), { OUT: 2.25, TXT: "0102" });
});

test("a variable or field named like a built-in is the variable", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZNAME"),
    ` ZZNAME: PROC(OUT);
   DCL OUT FIXED BIN(31);
   DCL 1 REC,
         3 LENGTH FIXED BIN(15),
         3 TEXT CHAR(4);
   DCL INDEX FIXED BIN(15);
   REC.LENGTH = 4;
   INDEX = 2;
   OUT = REC.LENGTH * 10 + INDEX + LENGTH(TEXT) * 100;
 END ZZNAME;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZNAME"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZNAME } = await import(pathToFileURL(join(out, "programs/ZZNAME.js")).href);
  assert.deepEqual(await ZZNAME(0), { OUT: 442 });
});

test("the procedures of an include are the includer's, seeing its variables", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZMAIN"),
    ` ZZMAIN: PROC(OUT) OPTIONS(MAIN);
   DCL OUT FIXED BIN(31);
   DCL ZAEHLER FIXED BIN(31) INIT(0);
   %INCLUDE ZZPROCS;
   CALL ERHOEHE(5);
   CALL ERHOEHE(2);
   OUT = ZAEHLER;
 END ZZMAIN;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZPROCS"),
    ` ERHOEHE: PROC(N);
   DCL N FIXED BIN(31);
   ZAEHLER = ZAEHLER + N;
 END ERHOEHE;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  /** @type {string[]} */
  const said = [];
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZMAIN"], progress: (/** @type {string} */ text) => said.push(text) });
  assert.deepEqual(summary.programs.map((p) => [p.member, p.todos]), [["ZZMAIN", []]]);
  assert.ok(!existsSync(join(out, "programs/ZZPROCS.js")));
  const { ZZMAIN } = await import(pathToFileURL(join(out, "programs/ZZMAIN.js")).href);
  assert.deepEqual(await ZZMAIN(0), { OUT: 7 });
  assert.ok(said.some((s) => s.includes("SRC/ZZMAIN")), said.join("\n"));
});

test("comments keep their lines, on procedures, fields and inside an IF", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZCMT"),
    ` /* PROGRAMM ZZCMT
    ZWEITE ZEILE */
 ZZCMT: PROC(OUT) OPTIONS(MAIN);
   DCL OUT FIXED BIN(31);
   DCL 1 S,
         2 A FIXED BIN(31), /* FELD A
                               ZEILE ZWEI */
         2 B CHAR(2);
   DCL Z FIXED BIN(31) INIT(0); /* ZAEHLER
                                   FUER ALLES */
   IF Z = 0 THEN /* IM THEN
      ZWEI */
     OUT = 2;
   ELSE /* IM ELSE */
     OUT = 3;
 END ZZCMT;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZCMT"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const code = readFileSync(join(out, "programs/ZZCMT.js"), "utf-8");
  assert.match(code, /\/\*\*\n \* PROGRAMM ZZCMT\n \* ZWEITE ZEILE\n/);
  assert.match(code, /\/\*\*\n {5}\* @type \{number\} FIXED BIN\(31\) FELD A\n {5}\* ZEILE ZWEI\n {5}\*\/\n {4}A: 0,/);
  assert.match(code, /\/\*\*\n {3}\* @type \{number\} FIXED BIN\(31\) INIT\(0\) ZAEHLER\n {3}\* FUER ALLES\n {3}\*\/\n {2}let Z/);
  assert.match(code, /if \(Z === 0\) \{\n\s+\/\/ IM THEN\n\s+\/\/ ZWEI\n\s+OUT = 2;\n\s+\} else \{\n\s+\/\/ IM ELSE\n\s+OUT = 3;/);
  const { ZZCMT } = await import(pathToFileURL(join(out, "programs/ZZCMT.js")).href);
  assert.deepEqual(await ZZCMT(0), { OUT: 2 });
});

test("a transaction whose program is not found is reported with why", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SYSDEF"));
  writeFileSync(join(root, "SYSDEF/ZZSYSDEF"), "* IMS STAGE 1\n         APPLCTN PSB=NIRGENDS,PGMTYPE=TP\n         TRANSACT CODE=ZZTX\n");
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  /** @type {string[]} */
  const said = [];
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, progress: (/** @type {string} */ text) => said.push(text) });
  assert.deepEqual(summary.skipped, [{ code: "ZZTX", program: "NIRGENDS", why: "no PL/I member NIRGENDS" }]);
  assert.ok(said.some((s) => s.includes("ZZTX")), said.join("\n"));
});

test("without a system definition a transaction is the program its input screen names, once for copies in several folders", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  for (const tree of ["prd", "dev"]) {
    mkdirSync(join(root, tree, "pli"), { recursive: true });
    mkdirSync(join(root, tree, "mfs"), { recursive: true });
    writeFileSync(join(root, tree, "pli/ZZS00001"), ` ZZS00001: PROC(IOPCB) OPTIONS(MAIN);\n   DCL IOPCB PTR;\n   CALL ZZS00009;\n END ZZS00001;\n`);
    writeFileSync(join(root, tree, "pli/ZZS00009"), ` ZZS00009: PROC;\n END ZZS00009;\n`);
    writeFileSync(
      join(root, tree, "mfs/ZZF001"),
      `ZZF001   FMT
         DEV   TYPE=(3270,2),FEAT=IGNORE
         DIV   TYPE=INOUT
         DPAGE CURSOR=((3,20))
KDNR     DFLD  POS=(3,20),LTH=8
         FMTEND
ZZF001I  MSG   TYPE=INPUT,SOR=(ZZF001,IGNORE),NXT=ZZF001O
         SEG
         MFLD  'ZZS00001 ',LTH=9
         MFLD  KDNR,LTH=8
         MSGEND
ZZF001O  MSG   TYPE=OUTPUT,SOR=(ZZF001,IGNORE)
         SEG
         MFLD  KDNR,LTH=8
         MSGEND
         END
`,
    );
  }
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  /** @type {string[]} */
  const said = [];
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, progress: (/** @type {string} */ text) => said.push(text) });
  assert.deepEqual(summary.transactions, ["ZZS00001"]);
  assert.deepEqual(
    summary.programs.map((p) => p.member),
    ["ZZS00001", "ZZS00009"],
  );
  assert.equal(summary.programs[0].path, "dev/pli/ZZS00001");
  assert.ok(said.some((s) => s.includes("ZZS00001 runs dev/pli/ZZS00001 from the screen dev/mfs/ZZF001")), said.join("\n"));
  const transactions = readFileSync(join(out, "transactions.js"), "utf-8");
  assert.match(transactions, /import \* as ZZF001 from "\.\/screens\/ZZF001\.js";/);
  assert.match(transactions, /ZZS00001: \{ program: \(\) => import\("\.\/programs\/ZZS00001\.js"\), entry: "ZZS00001", screens: ZZF001, input: "ZZF001I" \}/);
  assert.ok(said.some((s) => s.includes("prd/pli/ZZS00001") && s.includes("dev/pli/ZZS00001")), said.join("\n"));
});

test("a transaction code runs the program only its third character, the member type, tells apart", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "pli"));
  mkdirSync(join(root, "mfs"));
  writeFileSync(join(root, "pli/ZZS00400"), ` ZZS00400: PROC(IOPCB) OPTIONS(MAIN);\n   DCL IOPCB PTR;\n END ZZS00400;\n`);
  mkdirSync(join(root, "dev"));
  writeFileSync(join(root, "dev/ZZS00400"), ` ZZS00400: PROC(IOPCB) OPTIONS(MAIN);\n   DCL IOPCB PTR;\n END ZZS00400;\n`);
  writeFileSync(
    join(root, "mfs/ZZF004"),
    `         ALPHA 'abcdefghijklmnopqrstuvwxyzßäöüÖ'
         TITLE 'TEST2'
         PRINT NOGEN
ZZF004   FMT
         DEV   TYPE=(3270,2),FEAT=IGNORE,SYSMSG=WAIT
         DIV   TYPE=INOUT
         DPAGE CURSOR=((07,05))
         DFLD  'HR, Firmenbuch',POS=(1,2)
         DFLD  'ZZF004',POS=(1,47)
         DFLD  'ZZS00100',POS=(1,54)
         DFLD  'Firma',POS=(05,10)
SUCH     DFLD  POS=(04,16),LTH=42,ATTR=(PROT,HI)
         FMTEND
ZZF004I  MSG   TYPE=INPUT,SOR=(ZZF004,IGNORE),NXT=ZZF004O
         SEG
         MFLD  'ZZK00400 ',LTH=9
         MFLD  SUCH,LTH=42
         MSGEND
ZZF004O  MSG   TYPE=OUTPUT,SOR=(ZZF004,IGNORE)
         SEG
         MFLD  SUCH,LTH=42
         MSGEND
         END
`,
  );
  writeFileSync(join(root, "mfs/ZZF005"), `ZZF005   FMT\nKDNR     DFLD  POS=(3,20),LTH=8\n         FMTEND\nZZF005I  MSG   TYPE=INPUT,SOR=(ZZF005,IGNORE)\n         SEG\n         MFLD  'ZZK00500',LTH=8\n         MSGEND\n         END\n`);
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  /** @type {string[]} */
  const said = [];
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, progress: (/** @type {string} */ text) => said.push(text) });
  assert.deepEqual(summary.transactions, ["ZZK00400"]);
  assert.deepEqual(summary.skipped.map((s) => s.code), ["ZZK00500"]);
  assert.ok(said.some((s) => s.startsWith("[PLG088W] the input screen mfs/ZZF005 ZZF005I sends ZZK00500")), said.join("\n"));
  assert.match(readFileSync(join(out, "transactions.js"), "utf-8"), /ZZK00400: \{ program: \(\) => import\("\.\/programs\/ZZS00400\.js"\), entry: "ZZS00400", screens: ZZF004, input: "ZZF004I" \}/);
});

test("a graph without any transaction says why", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "mfs"));
  writeFileSync(join(root, "mfs/ZZF002"), `ZZF002   FMT\nKDNR     DFLD  POS=(3,20),LTH=8\n         FMTEND\nZZF002I  MSG   TYPE=INPUT,SOR=(ZZF002,IGNORE)\n         SEG\n         MFLD  'NIRGENDS',LTH=8\n         MSGEND\n         END\n`);
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  /** @type {string[]} */
  const said = [];
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, progress: (/** @type {string} */ text) => said.push(text) });
  assert.deepEqual(summary.transactions, []);
  assert.ok(said.some((s) => s.startsWith("[PLG087W]") && s.includes("NIRGENDS")), said.join("\n"));
});

test("the INIT of a field of an array of structures gives each element its own value", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZINIT"),
    ` ZZINIT: PROC(OUT, TXT);
   DCL OUT FIXED BIN(31);
   DCL TXT CHAR(6);
   DCL 1 T(3) STATIC,
         2 CD FIXED BIN(15) INIT(10, 20, 30),
         2 TX CHAR(2) INIT((2)'AA', 'BB');
   DCL §N FIXED BIN(15) INIT(3);
   OUT = CD(1) + CD(§N);
   TXT = TX(1) || TX(2) || TX(3);
 END ZZINIT;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZINIT"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZINIT } = await import(pathToFileURL(join(out, "programs/ZZINIT.js")).href);
  assert.deepEqual(await ZZINIT(0, ""), { OUT: 40, TXT: "AAAABB" });
});

test("a program's ENTRY points run from their statement and give back the parameters they change", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZRUF"),
    ` ZZRUF: PROC(OUT);
   DCL OUT FIXED BIN(31);
   DCL IX FIXED BIN(31) INIT(0);
   DCL ZZSUCH ENTRY(CHAR(3), FIXED BIN(31)) EXTERNAL;
   DCL TREFFER FIXED BIN(31) EXTERNAL INIT(0);
   CALL ZZPTAB;
   CALL ZZSUCH('BBB', IX);
   OUT = IX;
   CALL ZZSUCH('XXX', IX);
   OUT = OUT * 10 + IX + TREFFER * 100;
 END ZZRUF;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZPTAB"),
    ` ZZPTAB: PROC;
   DCL TAB(3) CHAR(3) STATIC;
   DCL I FIXED BIN(31);
   DCL S@KEY CHAR(3);
   DCL S@IX FIXED BIN(31);
   DCL TREFFER FIXED BIN(31) EXTERNAL INIT(0);
   TAB(1) = 'AAA';
   TAB(2) = 'BBB';
   TAB(3) = 'CCC';
   CALL ZZSUCH('CCC', I);
   RETURN;
 ZZSUCH: ENTRY(S@KEY, S@IX);
   S@IX = 0;
   I = 1;
 NAECHST:
   IF I > 3 THEN RETURN;
   IF TAB(I) = S@KEY THEN DO;
     S@IX = I;
     TREFFER = TREFFER + 1;
     RETURN;
   END;
   I = I + 1;
   GOTO NAECHST;
 END ZZPTAB;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZRUF"] });
  assert.deepEqual(
    summary.programs.map((p) => [p.member, p.todos]),
    [
      ["ZZRUF", []],
      ["ZZPTAB", []],
    ],
  );
  const { ZZRUF } = await import(pathToFileURL(join(out, "programs/ZZRUF.js")).href);
  assert.deepEqual(await ZZRUF(0), { OUT: 220 });
});

test("a program called again while it runs fails with PLG081E, unless it is RECURSIVE, and can run again afterwards", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(join(root, "SRC/ZZPING"), ` ZZPING: PROC(N);\n   DCL N FIXED BIN(31);\n   IF N > 0 THEN CALL ZZPONG(N - 1);\n END ZZPING;\n`);
  writeFileSync(join(root, "SRC/ZZPONG"), ` ZZPONG: PROC(N);\n   DCL N FIXED BIN(31);\n   IF N > 0 THEN CALL ZZPING(N - 1);\n END ZZPONG;\n`);
  writeFileSync(join(root, "SRC/ZZSELF"), ` ZZSELF: PROC(N) RECURSIVE;\n   DCL N FIXED BIN(31);\n   IF N > 0 THEN CALL ZZSELF(N - 1);\n END ZZSELF;\n`);
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZPING", "SRC/ZZSELF"] });
  const { ZZPING } = await import(pathToFileURL(join(out, "programs/ZZPING.js")).href);
  await ZZPING(1);
  await assert.rejects(ZZPING(2), /\[PLG081E\] ZZPING is called while it runs: ZZPING -> ZZPONG -> ZZPING/);
  await ZZPING(1);
  const { ZZSELF } = await import(pathToFileURL(join(out, "programs/ZZSELF.js")).href);
  await ZZSELF(3);
});

test("arrays and structures are assigned whole, by position and BY NAME; GOTO, ON units, SIGNAL, REVERT and STOP run", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00007"),
    ` ZZP00007: PROC(ERG);
   DCL ERG CHAR(40) VAR;
   DCL A(3) FIXED BIN(31);
   DCL B(3) FIXED DEC(5);
   DCL 1 S, 2 X CHAR(2), 2 Z CHAR(1), 2 V CHAR(1);
   DCL 1 T, 2 Z CHAR(1), 2 X CHAR(3), 2 W FIXED BIN(15);
   DCL 1 U, 2 P CHAR(1), 2 Q CHAR(3), 2 R FIXED BIN(15);
   DCL 1 L(2), 2 M CHAR(1), 2 N FIXED BIN(15);
   A = 7;
   B = A;
   S = '-';
   T.Z = 'Z';
   T.X = 'ABC';
   T.W = 5;
   S = T, BY NAME;
   U = T;
   L = U, BY NAME;
   L(2).M = 'M';
   L(1) = L(2);
   ERG = S.X || S.Z || S.V || B(3) || U.P || U.Q || U.R || L(1).M;
 END ZZP00007;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZP00008"),
    ` ZZP00008: PROC(ERG);
   DCL ERG CHAR(40) VAR;
   DCL I FIXED BIN(31) INIT(0);
   DCL KAPUTT CONDITION;
   ERG = '';
   ON CONDITION(KAPUTT) ERG = ERG || 'K';
   SIGNAL CONDITION(KAPUTT);
 NOCHMAL:
   I = I + 1;
   ERG = ERG || I;
   IF I < 3 THEN GOTO NOCHMAL;
   ON ERROR BEGIN;
     ERG = ERG || 'E' || ONCODE();
     GOTO ENDE;
   END;
   CALL FEHLER;
   ERG = ERG || 'NIE';
 ENDE:
   ERG = ERG || '!';
 FEHLER: PROC;
   SIGNAL ERROR;
 END FEHLER;
 END ZZP00008;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZP00009"),
    ` ZZP00009: PROC;
   ON ERROR GOTO RAUS;
   REVERT ERROR;
   SIGNAL ERROR;
 RAUS:
   STOP;
 END ZZP00009;
`,
  );
  writeFileSync(
    join(root, "SRC/ZZP00010"),
    ` ZZP00010: PROC;
   BEGIN;
     STOP;
   END;
 END ZZP00010;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, {
    ...TEMPLATES,
    paths: ["SRC/ZZP00007", "SRC/ZZP00008", "SRC/ZZP00009", "SRC/ZZP00010"],
  });
  assert.deepEqual(
    summary.programs.map((p) => [p.member, p.todos]),
    [
      ["ZZP00007", []],
      ["ZZP00008", []],
      ["ZZP00009", []],
      ["ZZP00010", []],
    ],
  );
  /** @param {string} member */
  const program = async (member) => (await import(pathToFileURL(join(out, `programs/${member}.js`)).href))[member];
  assert.deepEqual(await (await program("ZZP00007"))(""), { ERG: "ABZ-7ZABC5M" });
  assert.deepEqual(await (await program("ZZP00008"))(""), { ERG: "K123E9!" });
  await assert.rejects((await program("ZZP00009"))(), /PLG070E/);
  await assert.rejects((await program("ZZP00010"))(), { name: "Stop" });
});

test("DO with REPEAT, UNTIL and several ranges, R formats, repeated data items and GET DATA run", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00011"),
    ` ZZP00011: PROC(ERG);
   DCL ERG CHAR(80) VAR;
   DCL (I, J) FIXED BIN(31);
   DCL N FIXED BIN(31) INIT(2);
   DCL A(5) FIXED BIN(31);
   DCL W(3) FIXED BIN(31);
   DCL Z CHAR(20) VAR;
   DCL T CHAR(40);
   DCL 1 S, 2 X FIXED BIN(31), 2 Y CHAR(3);
   ERG = '';
   DO I = 1 REPEAT I * 2 WHILE (I < 20);
     ERG = ERG || I || ',';
   END;
   DO I = 1 TO 2, 7 TO 9 BY 2;
     ERG = ERG || I;
   END;
   DO I = 5 TO 10 UNTIL (I >= 6);
     ERG = ERG || I;
   END;
   ERG = ERG || '/';
   PUT STRING(Z) EDIT ((I DO I = 1 TO 3), 'X') (R(FM));
 FM: FORMAT (F(2), F(2), F(2), A(1));
   T = ' 4 5 6 7';
   GET STRING(T) LIST ((A(J) DO J = 1 TO N), A(5));
   T = 'Y=''AB'', X=12, W(2)=7;';
   GET STRING(T) DATA (S, W);
   ERG = ERG || Z || A(1) || A(2) || A(5) || S.X || S.Y || W(2);
 END ZZP00011;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00011"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZP00011 } = await import(pathToFileURL(join(out, "programs/ZZP00011.js")).href);
  assert.deepEqual(await ZZP00011(""), { ERG: "1,2,4,8,16,127956/ 1 2 3X45612AB 7" });
});

test("GET DATA fails on a name outside its data list and on text it cannot read", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00012"),
    ` ZZP00012: PROC(T);
   DCL T CHAR(40) VAR;
   DCL X FIXED BIN(31);
   DCL Y FIXED BIN(31);
   GET STRING(T) DATA (X);
 END ZZP00012;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00012"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZP00012 } = await import(pathToFileURL(join(out, "programs/ZZP00012.js")).href);
  await ZZP00012("X=3;");
  await assert.rejects(ZZP00012("Y=3;"), /PLG073E/);
  await assert.rejects(ZZP00012("X 3;"), /PLG072E/);
});

test("a DEFINED structure, scalar and array split a string and write back into it", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00013"),
    ` ZZP00013: PROC(ERG);
   DCL ERG CHAR(80) VAR;
   DCL INPUT CHAR(20);
   DCL 1 PARTS DEFINED(INPUT), 2 KEY CHAR(4), 2 NUM PIC '999', 2 REST CHAR(13);
   DCL MID CHAR(2) DEFINED(INPUT) POSITION(5);
   DCL WORDS(5) CHAR(4) DEFINED(INPUT);
   INPUT = 'ABCD042REST OF IT';
   ERG = PARTS.KEY || '/' || PARTS.NUM || '/' || MID || '/' || WORDS(2);
   PARTS.NUM = 7;
   MID = 'XY';
   ERG = ERG || '/' || INPUT;
 END ZZP00013;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00013"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZP00013 } = await import(pathToFileURL(join(out, "programs/ZZP00013.js")).href);
  assert.deepEqual(await ZZP00013(""), { ERG: "ABCD/042/04/042R/ABCDXY7REST OF IT   " });
});

test("a LIKE structure, also a LIKE field, has fields of its own", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00015"),
    ` ZZP00015: PROC(ERG);
   DCL ERG CHAR(80) VAR;
   DCL 1 KUNDE, 2 NR CHAR(2), 2 ADR, 3 ORT CHAR(3);
   DCL 1 ALT LIKE KUNDE;
   DCL 1 SATZ, 2 K LIKE KUNDE, 2 Z FIXED BIN(31);
   KUNDE.NR = 'K1';
   KUNDE.ORT = 'UlM';
   ALT = KUNDE;
   ALT.NR = 'A1';
   SATZ.K.ADR.ORT = 'BER';
   SATZ.K = ALT, BY NAME;
   SATZ.K.NR = 'S1';
   ERG = KUNDE.NR || KUNDE.ORT || ALT.NR || ALT.ADR.ORT || SATZ.K.NR || SATZ.K.ORT;
 END ZZP00015;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00015"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZP00015 } = await import(pathToFileURL(join(out, "programs/ZZP00015.js")).href);
  assert.deepEqual(await ZZP00015(""), { ERG: "K1UlMA1UlMS1UlM" });
});

test("masks BASED on a generic SPA area map its fields by position, also after the SPA is copied", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00014"),
    ` ZZP00014: PROC(MODE, NR, BETRAG, N);
   DCL MODE FIXED BIN(31);
   DCL NR CHAR(8);
   DCL BETRAG FIXED DEC(9,2);
   DCL N FIXED BIN(31);
   DCL 1 SPA, 2 TRAN CHAR(8), 2 GENERIC CHAR(100);
   DCL 1 SPA2 LIKE SPA;
   DCL P PTR;
   DCL 1 MASK1 BASED(P), 2 KDNR CHAR(8), 2 SALDO FIXED DEC(9,2), 2 ANZ FIXED BIN(31);
   DCL 1 MASK2 BASED(ADDR(SPA2.GENERIC)), 2 KUNDE CHAR(8), 2 SUMME FIXED DEC(9,2), 2 ZAHL FIXED BIN(31);
   DCL 1 BIG BASED(ADDR(SPA2.GENERIC)), 2 A CHAR(8), 2 B CHAR(8), 2 C CHAR(8), 2 D CHAR(8);
   P = ADDR(SPA.GENERIC);
   MASK1.KDNR = 'K1';
   MASK1.SALDO = 12.5;
   MASK1.ANZ = 3;
   SPA2 = SPA;
   MASK1.ANZ = 4;
   IF MODE = 1 THEN NR = BIG.D;
   NR = MASK2.KUNDE;
   BETRAG = MASK2.SUMME;
   N = MASK2.ZAHL;
 END ZZP00014;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00014"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const { ZZP00014 } = await import(pathToFileURL(join(out, "programs/ZZP00014.js")).href);
  assert.deepEqual(await ZZP00014(0, "", 0, 0), { NR: "K1      ", BETRAG: 12.5, N: 3 });
  await assert.rejects(ZZP00014(1, "", 0, 0), /PLG074E\] a view's field 4 \(D\)/);
});

test("a batch program reads one record file to its end and writes another", async () => {
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(db, root, indexer, out, { ...TEMPLATES, paths: ["SRC/KDP00017"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const files = mkdtempSync(join(tmpdir(), "pli-files-"));
  process.env.FILES = files;
  writeFileSync(join(files, "SALDEN.txt"), "0000000100000005000-\n0000000200000007500 \n0000000300000000125-\n");
  const { KDP00017 } = await import(pathToFileURL(join(out, "programs/KDP00017.js")).href);
  await KDP00017();
  assert.equal(readFileSync(join(files, "MAHNUNG.txt"), "utf-8"), "00000001     1\n00000003     1\n");

  // The include is its own module; each call gives a fresh record.
  assert.match(readFileSync(join(out, "programs/KDP00017.js"), "utf-8"), /import \* as KDC00004 from "\.\.\/includes\/KDC00004\.js";[^]*let SALDEN_SATZ = KDC00004\.SALDEN_SATZ\(\);/);
  const { SALDEN_SATZ } = await import(pathToFileURL(join(out, "includes/KDC00004.js")).href);
  assert.deepEqual(SALDEN_SATZ(), { KDNR: "        ", SALDO: 0 });
  assert.notEqual(SALDEN_SATZ(), SALDEN_SATZ());
});

test("KDDRUCK prints each record to a stream file and archives it", async () => {
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(db, root, indexer, out, { ...TEMPLATES, paths: ["SRC/KDDRUCK"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const files = mkdtempSync(join(tmpdir(), "pli-files-"));
  process.env.FILES = files;
  writeFileSync(join(files, "AUSZUG.txt"), "00000001       125.50\n");
  const { KDDRUCK } = await import(pathToFileURL(join(out, "programs/KDDRUCK.js")).href);
  await KDDRUCK();
  assert.equal(readFileSync(join(files, "LISTE.txt"), "utf-8"), "00000001         125.50\n");
  assert.equal(readFileSync(join(files, "ARCH.txt"), "utf-8"), "00000001       125.50\n");
});

test("KDJOB06 writes a new generation of the reminders and KDJOB07 prints it", async () => {
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(db, root, indexer, out, { ...TEMPLATES, jobs: ["JCL/KDJOB06", "JCL/KDJOB07"] });
  assert.deepEqual(
    summary.jobs.map((j) => [j.name, j.todos]),
    [
      ["KDJOB06", []],
      ["KDJOB07", []],
    ],
  );
  assert.deepEqual(summary.programs.map((p) => p.member).sort(), ["KDDRUCK", "KDP00017"]);
  const datasets = mkdtempSync(join(tmpdir(), "pli-datasets-"));
  process.env.DATASETS = datasets;
  try {
    writeFileSync(join(datasets, "PROD.KD.SALDEN.txt"), "0000000100000005000-\n0000000200000007500 \n0000000300000000125-\n");
    const { KDJOB06 } = await import(pathToFileURL(join(out, "jobs/KDJOB06.js")).href);
    const { KDJOB07 } = await import(pathToFileURL(join(out, "jobs/KDJOB07.js")).href);
    assert.equal(await KDJOB06(), 0);
    assert.equal(readFileSync(join(datasets, "PROD.KD.MAHNUNG/G0001V00.txt"), "utf-8"), "00000001     1\n00000003     1\n");
    assert.equal(await KDJOB07(), 0);
    assert.equal(readFileSync(join(datasets, "SYSOUT/KDJOB07/DRUCK.LISTE.txt"), "utf-8"), "00000001           1.0000000003           1.00\n");
  } finally {
    delete process.env.DATASETS;
  }
});

test("a job runs IKJEFT01's program on in-stream data, passes a temporary dataset on and ends with the highest return code", async () => {
  const src = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(src, "SRC"));
  mkdirSync(join(src, "JCL"));
  /** @param {string} name @param {string} extra */
  const copy = (name, extra) => ` ${name}: PROC OPTIONS(MAIN);
   DCL EINGABE FILE RECORD INPUT;
   DCL AUSGABE FILE RECORD OUTPUT;
   DCL SATZ CHAR(3);
   DCL EOF BIT(1) INIT('0'B);
   ON ENDFILE(EINGABE) EOF = '1'B;
   OPEN FILE(EINGABE), FILE(AUSGABE);
   READ FILE(EINGABE) INTO(SATZ);
   DO WHILE(EOF = '0'B);
     WRITE FILE(AUSGABE) FROM(SATZ);
     READ FILE(EINGABE) INTO(SATZ);
   END;
   CLOSE FILE(EINGABE), FILE(AUSGABE);${extra}
 END ${name};
`;
  writeFileSync(join(src, "SRC/ZZP00005"), copy("ZZP00005", ""));
  writeFileSync(join(src, "SRC/ZZP00006"), copy("ZZP00006", "\n   CALL PLIRETC(4);"));
  writeFileSync(
    join(src, "JCL/ZZJOB01"),
    `//ZZJOB01  JOB (ACCT),'KOPIEREN',CLASS=A
//EINS     EXEC PGM=IKJEFT01
//SYSTSIN  DD *
  RUN PROGRAM(ZZP00005)
/*
//EINGABE  DD DATA,DLM=@@
ABC
DEF
@@
//AUSGABE  DD DSN=&&ZWISCH,DISP=(NEW,PASS)
//ZWEI     EXEC PGM=ZZP00006
//EINGABE  DD DSN=&&ZWISCH,DISP=(OLD,DELETE)
//AUSGABE  DD DSN=ZZ.KOPIE,DISP=(NEW,CATLG)
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(src), src, indexer, out, { ...TEMPLATES, jobs: ["JCL/ZZJOB01"] });
  assert.deepEqual(summary.jobs[0].todos, []);
  const datasets = mkdtempSync(join(tmpdir(), "pli-datasets-"));
  process.env.DATASETS = datasets;
  try {
    const { ZZJOB01 } = await import(pathToFileURL(join(out, "jobs/ZZJOB01.js")).href);
    assert.equal(await ZZJOB01(), 4);
    assert.equal(readFileSync(join(datasets, "ZZ.KOPIE.txt"), "utf-8"), "ABC\nDEF\n");
    assert.equal(existsSync(join(datasets, "TEMP/ZZJOB01/ZWISCH.txt")), false);
  } finally {
    delete process.env.DATASETS;
  }
});

test("a job bypasses steps by COND and IF/ELSE, also inside a procedure, runs EVEN, ONLY and ABEND steps after a failure, and stops at the job's COND", async () => {
  const src = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(src, "SRC"));
  mkdirSync(join(src, "JCL"));
  /** @param {string} name @param {string} extra */
  const program = (name, extra) => ` ${name}: PROC OPTIONS(MAIN);
   DCL OUT FILE STREAM OUTPUT;
   PUT FILE(OUT) LIST('${name}');${extra}
 END ${name};
`;
  writeFileSync(join(src, "SRC/ZZRC0"), program("ZZRC0", ""));
  writeFileSync(join(src, "SRC/ZZRC8"), program("ZZRC8", "\n   CALL PLIRETC(8);"));
  writeFileSync(join(src, "SRC/ZZBOOM"), program("ZZBOOM", "\n   SIGNAL ERROR;"));
  /** @param {string} name @param {string} program @param {string} [more] */
  const step = (name, program, more = "") => `//${name.padEnd(8)} EXEC PGM=${program}${more}\n//OUT      DD SYSOUT=*\n`;
  writeFileSync(
    join(src, "JCL/ZZJOB02"),
    `//ZZJOB02  JOB (ACCT),'BEDINGT',CLASS=A
${step("A", "ZZRC8")}${step("B", "ZZRC0", ",COND=(4,LT)")}//C        EXEC PGM=ZZRC0,
//             COND=(8,GT,A)
//OUT      DD SYSOUT=*
//         IF (A.RC = 8 AND RC < 9) THEN
${step("D", "ZZRC0")}//         ELSE
${step("E", "ZZRC0")}//         ENDIF
${step("F", "ZZBOOM")}${step("G", "ZZRC0")}${step("H", "ZZRC0", ",COND=EVEN")}//         IF ABEND THEN
${step("I", "ZZRC0")}//         ENDIF
${step("J", "ZZRC0", ",COND=((9,LE),ONLY)")}${step("K", "ZZRC0", ",COND=((0,LE),ONLY)")}`,
  );
  writeFileSync(join(src, "JCL/ZZJOB03"), `//ZZJOB03  JOB (ACCT),'STOPP',COND=(4,LT)\n${step("A", "ZZRC8")}${step("B", "ZZRC0")}`);
  writeFileSync(
    join(src, "JCL/ZZJPRC2"),
    `//ZZJPRC2  PROC
${step("A", "ZZRC8")}//         IF (A.RC = 8) THEN
${step("B", "ZZRC0")}//         ELSE
${step("C", "ZZRC0")}//         ENDIF
${step("D", "ZZRC0", ",COND=(4,LT,A)")}`,
  );
  writeFileSync(
    join(src, "JCL/ZZJOB06"),
    `//ZZJOB06  JOB (ACCT),'PROZEDUR',CLASS=A
//         IF (RC = 0) THEN
//P        EXEC ZZJPRC2
//         ENDIF
//         IF (P.A.RC = 8) THEN
${step("E", "ZZRC0")}//         ENDIF
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(src), src, indexer, out, { ...TEMPLATES, jobs: ["JCL/ZZJOB02", "JCL/ZZJOB03", "JCL/ZZJOB06"] });
  assert.deepEqual(summary.jobs.map((j) => j.todos), [[], [], []]);
  const datasets = mkdtempSync(join(tmpdir(), "pli-datasets-"));
  process.env.DATASETS = datasets;
  /** @param {string} job */
  const ran = (job) => ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "P.A", "P.B", "P.C", "P.D"].filter((s) => existsSync(join(datasets, `SYSOUT/${job}/${s}.OUT.txt`)));
  try {
    const { ZZJOB02 } = await import(pathToFileURL(join(out, "jobs/ZZJOB02.js")).href);
    await assert.rejects(ZZJOB02(), /PLG067E\] ZZJOB02\.F/);
    assert.deepEqual(ran("ZZJOB02"), ["A", "C", "D", "F", "H", "I", "J"]);
    const { ZZJOB03 } = await import(pathToFileURL(join(out, "jobs/ZZJOB03.js")).href);
    assert.equal(await ZZJOB03(), 8);
    assert.deepEqual(ran("ZZJOB03"), ["A"]);
    const { ZZJOB06 } = await import(pathToFileURL(join(out, "jobs/ZZJOB06.js")).href);
    assert.equal(await ZZJOB06(), 8);
    assert.deepEqual(ran("ZZJOB06"), ["E", "P.A", "P.B"]);
  } finally {
    delete process.env.DATASETS;
  }
});

test("a job's datasets take symbolic parameters from SET, the procedure's defaults and the EXEC", async () => {
  const src = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(src, "SRC"));
  mkdirSync(join(src, "JCL"));
  writeFileSync(
    join(src, "SRC/ZZCOPY"),
    ` ZZCOPY: PROC OPTIONS(MAIN);
   DCL EINGABE FILE RECORD INPUT;
   DCL AUSGABE FILE RECORD OUTPUT;
   DCL SATZ CHAR(3);
   DCL EOF BIT(1) INIT('0'B);
   ON ENDFILE(EINGABE) EOF = '1'B;
   OPEN FILE(EINGABE), FILE(AUSGABE);
   READ FILE(EINGABE) INTO(SATZ);
   DO WHILE(EOF = '0'B);
     WRITE FILE(AUSGABE) FROM(SATZ);
     READ FILE(EINGABE) INTO(SATZ);
   END;
   CLOSE FILE(EINGABE), FILE(AUSGABE);
 END ZZCOPY;
`,
  );
  writeFileSync(
    join(src, "JCL/ZZJPRC1"),
    `//ZZJPRC1   PROC HLQ=TEST,GEN=0,SUFFIX=ALT
//KOPIE    EXEC PGM=ZZCOPY
//EINGABE  DD DSN=&HLQ..EIN,DISP=SHR
//AUSGABE  DD DSN=&HLQ..&SUFFIX(&GEN),DISP=(NEW,CATLG)
`,
  );
  writeFileSync(
    join(src, "JCL/ZZJOB04"),
    `//ZZJOB04  JOB (ACCT),'SYMBOLE',CLASS=A
//         SET HLQ=PROD,ZWEI=2
//LAUF     EXEC ZZJPRC1,SUFFIX=NEU,GEN='+1'
//EINS     EXEC PGM=ZZCOPY
//EINGABE  DD DSN=&HLQ..EIN,DISP=SHR
//AUSGABE  DD DSN=&HLQ..KOPIE&ZWEI,DISP=(NEW,CATLG)
`,
  );
  writeFileSync(join(src, "JCL/ZZJOB05"), `//ZZJOB05  JOB (ACCT),'FEHLT',CLASS=A\n//EINS     EXEC PGM=ZZCOPY\n//EINGABE  DD DSN=&NIX..EIN,DISP=SHR\n`);
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(src), src, indexer, out, { ...TEMPLATES, jobs: ["JCL/ZZJOB04", "JCL/ZZJOB05"] });
  assert.deepEqual(
    summary.jobs.map((j) => j.todos),
    [[], [{ line: 3, why: "the DD EINGABE of EINS: the symbolic parameter &NIX has no value" }]],
  );
  const datasets = mkdtempSync(join(tmpdir(), "pli-datasets-"));
  process.env.DATASETS = datasets;
  try {
    writeFileSync(join(datasets, "PROD.EIN.txt"), "ABC\n");
    const { ZZJOB04 } = await import(pathToFileURL(join(out, "jobs/ZZJOB04.js")).href);
    assert.equal(await ZZJOB04(), 0);
    assert.equal(readFileSync(join(datasets, "PROD.NEU/G0001V00.txt"), "utf-8"), "ABC\n");
    assert.equal(readFileSync(join(datasets, "PROD.KOPIE2.txt"), "utf-8"), "ABC\n");
  } finally {
    delete process.env.DATASETS;
  }
});

test("a keyed file is read, rewritten, added to and deleted from by key", async () => {
  const src = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(src, "SRC"));
  writeFileSync(
    join(src, "SRC/ZZP00003"),
    ` ZZP00003: PROC(KEY, FEHLT);
   DCL KEY CHAR(8);
   DCL FEHLT BIT(1);
   DCL KONTEN FILE RECORD KEYED UPDATE ENV(VSAM);
   DCL 1 KONTO,
         2 NAME  CHAR(10),
         2 STAND FIXED DEC(7,2);
   DCL NEU CHAR(8) INIT('00000009');
   FEHLT = '0'B;
   ON KEY(KONTEN) BEGIN;
     FEHLT = '1'B;
   END;
   OPEN FILE(KONTEN) UPDATE;
   READ FILE(KONTEN) INTO(KONTO) KEY(KEY);
   IF FEHLT THEN RETURN;
   KONTO.STAND = KONTO.STAND + 10;
   REWRITE FILE(KONTEN) FROM(KONTO) KEY(KEY);
   WRITE FILE(KONTEN) FROM(KONTO) KEYFROM(NEU);
   DELETE FILE(KONTEN) KEY('00000002');
   CLOSE FILE(KONTEN);
 END ZZP00003;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(src), src, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00003"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const files = mkdtempSync(join(tmpdir(), "pli-files-"));
  process.env.FILES = files;
  writeFileSync(join(files, "KONTEN.txt"), "00000001\tMEIER         12.50\n00000002\tSCHULZ         1.00\n");
  const { ZZP00003 } = await import(pathToFileURL(join(out, "programs/ZZP00003.js")).href);
  assert.deepEqual(await ZZP00003("00000001", false), { FEHLT: false });
  assert.equal(readFileSync(join(files, "KONTEN.txt"), "utf-8"), "00000001\tMEIER         22.50\n00000009\tMEIER         22.50\n");
  assert.deepEqual(await ZZP00003("00000007", false), { FEHLT: true });
});

test("a report is read and printed with stream I/O: EDIT, LIST, DATA and STRING", async () => {
  const src = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(src, "SRC"));
  writeFileSync(
    join(src, "SRC/ZZP00004"),
    ` ZZP00004: PROC(SUMME);
   DCL SUMME FIXED DEC(9,2);
   DCL EIN FILE STREAM INPUT;
   DCL LISTE FILE STREAM OUTPUT PRINT;
   DCL NAME CHAR(6);
   DCL BETRAG FIXED DEC(7,2);
   DCL ENDE BIT(1) INIT('0'B);
   DCL ZEILE CHAR(20);
   DCL A CHAR(3);
   DCL N FIXED BIN(31);
   DCL EINGABE CHAR(6) INIT('ABC 42');
   ON ENDFILE(EIN) ENDE = '1'B;
   SUMME = 0;
   PUT FILE(LISTE) PAGE EDIT('KUNDE', 'BETRAG') (A(6), X(2), A);
   GET FILE(EIN) EDIT(NAME, BETRAG) (A(6), F(8,2));
   DO WHILE(ENDE = '0'B);
     SUMME = SUMME + BETRAG;
     PUT FILE(LISTE) SKIP EDIT(NAME, BETRAG) (A(6), X(2), F(8,2));
     GET FILE(EIN) SKIP EDIT(NAME, BETRAG) (A(6), F(8,2));
   END;
   PUT STRING(ZEILE) EDIT('SUMME', SUMME) (A(5), P'ZZZZ9V.99');
   PUT FILE(LISTE) SKIP(2) LIST(ZEILE);
   GET STRING(EINGABE) LIST(A, N);
   PUT FILE(LISTE) SKIP DATA(A, N);
   CLOSE FILE(LISTE);
 END ZZP00004;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(src), src, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00004"] });
  assert.deepEqual(summary.programs[0].todos, []);
  const files = mkdtempSync(join(tmpdir(), "pli-files-"));
  process.env.FILES = files;
  writeFileSync(join(files, "EIN.txt"), "MEIER    12.50\nSCHULZ   20.00\n");
  const { ZZP00004 } = await import(pathToFileURL(join(out, "programs/ZZP00004.js")).href);
  assert.deepEqual(await ZZP00004(0), { SUMME: 32.5 });
  assert.equal(
    readFileSync(join(files, "LISTE.txt"), "utf-8"),
    "\fKUNDE   BETRAG\nMEIER      12.50\nSCHULZ     20.00\n\nSUMME   32.50       \nA='ABC' N=42;\n",
  );
});

test("IMS database calls run as SQL on a Db2 table per segment", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  mkdirSync(join(root, "IMS"));
  writeFileSync(
    join(root, "IMS/ZZDBD20"),
    `         DBD   NAME=ZZDBD20,ACCESS=(HIDAM,VSAM)
         SEGM  NAME=KUNDE,PARENT=0,BYTES=120
         FIELD NAME=(KDNR,SEQ,U),BYTES=8,START=1,TYPE=C
         FIELD NAME=NAME,BYTES=40,START=9,TYPE=C
         SEGM  NAME=KONTO,PARENT=((KUNDE,SNGL)),BYTES=60
         FIELD NAME=(KTONR,SEQ,U),BYTES=10,START=1,TYPE=C
         FIELD NAME=SALDO,BYTES=6,START=11,TYPE=P
         SEGM  NAME=NOTIZ,PARENT=((KUNDE,SNGL)),BYTES=20
         FIELD NAME=TEXT,BYTES=20,START=1,TYPE=C
         DBDGEN
         FINISH
         END
`,
  );
  writeFileSync(
    join(root, "IMS/ZZPSB20"),
    `         PCB   TYPE=DB,DBDNAME=ZZDBD20,PROCOPT=A,KEYLEN=18
         SENSEG NAME=KUNDE,PARENT=0
         SENSEG NAME=KONTO,PARENT=KUNDE
         PSBGEN LANG=PLI,PSBNAME=ZZP00020
         END
`,
  );
  writeFileSync(
    join(root, "SRC/ZZP00020"),
    ` ZZP00020: PROC(IOPCB_PTR, DBPCB_PTR, ERG) OPTIONS(MAIN);
   DCL (IOPCB_PTR, DBPCB_PTR) POINTER;
   DCL ERG CHAR(200) VAR;
   DCL PLITDLI ENTRY EXTERNAL OPTIONS(ASM INTER);
   DCL 1 DBPCB BASED(DBPCB_PTR),
         2 DBDNAME  CHAR(8),
         2 SEGLEVEL CHAR(2),
         2 STATUS   CHAR(2),
         2 PROCOPT  CHAR(4),
         2 RESERVED FIXED BIN(31),
         2 SEGNAME  CHAR(8),
         2 KEYLEN   FIXED BIN(31),
         2 NUMSENS  FIXED BIN(31),
         2 KEYFB    CHAR(18);
   DCL GU_FUNC   CHAR(4) STATIC INIT('GU  ');
   DCL GHU_FUNC  CHAR(4) STATIC INIT('GHU ');
   DCL GN_FUNC   CHAR(4) STATIC INIT('GN  ');
   DCL GNP_FUNC  CHAR(4) STATIC INIT('GNP ');
   DCL ISRT_FUNC CHAR(4) STATIC INIT('ISRT');
   DCL REPL_FUNC CHAR(4) STATIC INIT('REPL');
   DCL DLET_FUNC CHAR(4) STATIC INIT('DLET');
   DCL DREI FIXED BIN(31) STATIC INIT(3);
   DCL VIER FIXED BIN(31) STATIC INIT(4);
   DCL FUENF FIXED BIN(31) STATIC INIT(5);
   DCL 1 KUNDE_SSA STATIC,
         2 SEGNAME CHAR(8) INIT('KUNDE   '),
         2 *       CHAR(1) INIT('('),
         2 FELD    CHAR(8) INIT('KDNR    '),
         2 OP      CHAR(2) INIT(' ='),
         2 WERT    CHAR(8),
         2 *       CHAR(1) INIT(')');
   DCL KUNDE_U CHAR(9) STATIC INIT('KUNDE    ');
   DCL KONTO_U CHAR(9) STATIC INIT('KONTO    ');
   DCL 1 KUNDE_SEG,
         2 KDNR CHAR(8),
         2 NAME CHAR(40),
         2 REST CHAR(72);
   DCL KONTO_AREA CHAR(60);
   DCL 1 KONTO_SEG BASED(ADDR(KONTO_AREA)),
         2 KTONR CHAR(10),
         2 SALDO FIXED DEC(11,2),
         2 REST  CHAR(44);
   ERG = '';
   WERT = '00000002';
   CALL PLITDLI(VIER, GU_FUNC, DBPCB, KUNDE_SEG, KUNDE_SSA);
   ERG = ERG || DBPCB.STATUS || SUBSTR(NAME, 1, 4) || '/';
   CALL PLITDLI(VIER, GNP_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || SUBSTR(KTONR, 1, 2) || '/';
   CALL PLITDLI(VIER, GNP_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || '/';
   CALL PLITDLI(VIER, GU_FUNC, DBPCB, KUNDE_SEG, KUNDE_U);
   ERG = ERG || DBPCB.STATUS || SUBSTR(NAME, 1, 4) || '/';
   CALL PLITDLI(VIER, GN_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || SUBSTR(KTONR, 1, 2) || '/';
   CALL PLITDLI(VIER, GN_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || SUBSTR(KTONR, 1, 2) || '/';
   CALL PLITDLI(VIER, GN_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || SUBSTR(KTONR, 1, 2) || '/';
   CALL PLITDLI(VIER, GN_FUNC, DBPCB, KONTO_AREA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || '/';
   CALL PLITDLI(VIER, ISRT_FUNC, DBPCB, KUNDE_SEG, KUNDE_U);
   ERG = ERG || DBPCB.STATUS || '/';
   KDNR = '00000003';
   NAME = 'CARL';
   CALL PLITDLI(VIER, ISRT_FUNC, DBPCB, KUNDE_SEG, KUNDE_U);
   ERG = ERG || DBPCB.STATUS || '/';
   CALL PLITDLI(DREI, REPL_FUNC, DBPCB, KUNDE_SEG);
   ERG = ERG || DBPCB.STATUS || '/';
   WERT = '00000001';
   CALL PLITDLI(FUENF, GHU_FUNC, DBPCB, KONTO_AREA, KUNDE_SSA, KONTO_U);
   KONTO_SEG.SALDO = KONTO_SEG.SALDO + 5;
   CALL PLITDLI(DREI, REPL_FUNC, DBPCB, KONTO_AREA);
   ERG = ERG || DBPCB.STATUS || '/';
   CALL PLITDLI(FUENF, GHU_FUNC, DBPCB, KONTO_AREA, KUNDE_SSA, KONTO_U);
   KONTO_SEG.KTONR = 'K8';
   CALL PLITDLI(DREI, REPL_FUNC, DBPCB, KONTO_AREA);
   ERG = ERG || DBPCB.STATUS || '/';
   WERT = '00000002';
   CALL PLITDLI(VIER, GHU_FUNC, DBPCB, KUNDE_SEG, KUNDE_SSA);
   CALL PLITDLI(DREI, DLET_FUNC, DBPCB, KUNDE_SEG);
   ERG = ERG || DBPCB.STATUS || '/';
   CALL PLITDLI(VIER, GU_FUNC, DBPCB, KUNDE_SEG, KUNDE_SSA);
   ERG = ERG || DBPCB.STATUS || '/';
   WERT = '00000003';
   KONTO_SEG.KTONR = 'K9';
   CALL PLITDLI(FUENF, ISRT_FUNC, DBPCB, KONTO_AREA, KUNDE_SSA, KONTO_U);
   ERG = ERG || DBPCB.STATUS || DBPCB.SEGLEVEL || DBPCB.SEGNAME;
 END ZZP00020;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00020"] });
  assert.deepEqual(summary.programs.map((p) => [p.member, p.todos]), [["ZZP00020", []]]);

  const ddl = readFileSync(join(out, "ims-db2.sql"), "utf-8");
  assert.match(ddl, /-- The segment KUNDE, the root, 120 bytes: the fields of KUNDE_SEG in ZZP00020, which 6 DL\/I calls use\./);
  assert.match(ddl, /CREATE TABLE ZZDBD20\.KUNDE \(\n  IMS_ID BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,\n  IMS_PARENT BIGINT,\n  KDNR CHAR\(8\) NOT NULL,\n  NAME CHAR\(40\),\n  REST CHAR\(72\),\n  PRIMARY KEY \(IMS_ID\),\n  UNIQUE \(KDNR\)\n\);/);
  assert.match(ddl, /-- The segment KONTO under KUNDE, 60 bytes: the fields of KONTO_SEG in ZZP00020/);
  assert.match(ddl, /  SALDO DECIMAL\(11,2\),/);
  assert.match(ddl, /  FOREIGN KEY \(IMS_PARENT\) REFERENCES ZZDBD20\.KUNDE \(IMS_ID\) ON DELETE CASCADE,\n  UNIQUE \(IMS_PARENT, KTONR\)/);
  assert.match(ddl, /-- The segment NOTIZ under KUNDE, 20 bytes: its DBD fields, FILLERs between them\.\nCREATE TABLE ZZDBD20\.NOTIZ \(\n  IMS_ID BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,\n  IMS_PARENT BIGINT NOT NULL,\n  TEXT CHAR\(20\),/);

  const code = readFileSync(join(out, "programs/ZZP00020.js"), "utf-8");
  assert.match(code, /import \{ ZZDBD20 \} from "\.\.\/databases\.js";/);
  assert.match(code, /let DBPCB = DBPCB_PTR \?\? /);
  assert.match(code, /await dli\("GU", DBPCB, KUNDE_SEG, KUNDE_SEG_FIELDS, \[KUNDE_SSA\], ZZDBD20\);/);
  assert.match(code, /await dli\("GNP", DBPCB, new Ref\(\(\) => KONTO_AREA, \(v\) => \{ KONTO_AREA = v; \}\), null, \[KONTO_U\], ZZDBD20\);/);

  // The runtime on SQLite, its tables from the generated sqlite.sql.
  const sqliteDdl = readFileSync(join(out, "sqlite.sql"), "utf-8");
  assert.match(sqliteDdl, /CREATE TABLE IF NOT EXISTS "ZZDBD20\.KONTO" \(\n  IMS_ID INTEGER PRIMARY KEY AUTOINCREMENT,\n  IMS_PARENT INTEGER NOT NULL REFERENCES "ZZDBD20\.KUNDE" \(IMS_ID\) ON DELETE CASCADE,/);
  const file = join(mkdtempSync(join(tmpdir(), "pli-sqlite-")), "data.db");
  const store = new DatabaseSync(file);
  store.exec(sqliteDdl);
  store.exec(`INSERT INTO "ZZDBD20.KUNDE" (IMS_PARENT, KDNR, NAME, REST) VALUES (NULL, '00000001', 'ANNA', ''), (NULL, '00000002', 'BERT', '')`);
  store.exec(`INSERT INTO "ZZDBD20.KONTO" (IMS_PARENT, KTONR, SALDO, REST) VALUES (2, 'K3        ', 30, ''), (1, 'K2        ', 20, ''), (1, 'K1        ', 10, '')`);
  process.env.SQLITE = file;
  const runtime = await import(pathToFileURL(join(out, "runtime.js")).href);
  const { ZZP00020 } = await import(pathToFileURL(join(out, "programs/ZZP00020.js")).href);
  const { ERG } = await ZZP00020(null, null, "");
  delete process.env.SQLITE;
  assert.equal(ERG, "  BERT/  K3/GE/  ANNA/  K1/  K2/  K3/GB/II/  /DJ/  /DA/  /GE/  02KONTO   ");
  assert.deepEqual(
    store.prepare(`SELECT k.KDNR, o.KTONR, o.SALDO FROM "ZZDBD20.KONTO" o JOIN "ZZDBD20.KUNDE" k ON k.IMS_ID = o.IMS_PARENT ORDER BY k.KDNR, o.KTONR`).all().map((r) => Object.values(r)),
    [
      ["00000001", "K1        ", 15],
      ["00000001", "K2        ", 20],
      ["00000003", "K9        ", 15],
    ],
  );
  assert.deepEqual(store.prepare(`SELECT KDNR, trim(NAME) FROM "ZZDBD20.KUNDE" ORDER BY KDNR`).all().map((r) => Object.values(r)), [["00000001", "ANNA"], ["00000003", "CARL"]]);
  await assert.rejects(runtime.dli("GU", {}, new runtime.Ref(() => "", () => {}), null, ["KUNDX    "], (await import(pathToFileURL(join(out, "databases.js")).href)).ZZDBD20), /PLG076E/);
});

test("FIXED DEC with decimals stays exact: large sums, comparisons and text of computed values", async () => {
  const root = mkdtempSync(join(tmpdir(), "pli-src-"));
  mkdirSync(join(root, "SRC"));
  writeFileSync(
    join(root, "SRC/ZZP00021"),
    ` ZZP00021: PROC(ERG);
   DCL ERG CHAR(80) VAR;
   DCL (A, B, S) FIXED DEC(15,2);
   DCL (X, Y) FIXED DEC(5,2);
   DCL N FIXED DEC(7);
   DCL P PIC'(12)9V.99';
   A = 46646266303.59;
   B = 95347227243.27;
   S = A + B;
   P = S;
   X = 1.10;
   Y = 2.20;
   N = 1234567;
   N = N * 3 + 1;
   ERG = S || '/';
   IF X + Y = 3.30 THEN ERG = ERG || 'GLEICH/';
   ERG = ERG || (X + Y) || '/' || N || '/' || P;
 END ZZP00021;
`,
  );
  const out = mkdtempSync(join(tmpdir(), "pli-js-"));
  const summary = generateJs(await indexed(root), root, indexer, out, { ...TEMPLATES, paths: ["SRC/ZZP00021"] });
  assert.deepEqual(summary.programs.map((p) => [p.member, p.todos]), [["ZZP00021", []]]);
  const code = readFileSync(join(out, "programs/ZZP00021.js"), "utf-8");
  assert.match(code, /N = dec\(\(N \* 3\) \+ 1, 7, 0\);/);
  assert.match(code, /if \(num\(X \+ Y\) === 3\.3\)/);
  const { ZZP00021 } = await import(pathToFileURL(join(out, "programs/ZZP00021.js")).href);
  assert.deepEqual(await ZZP00021(""), { ERG: "141993493546.86/GLEICH/3.3/3703702/141993493546.86" });
});
