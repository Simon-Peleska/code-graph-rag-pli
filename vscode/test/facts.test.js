// The facts the indexer reads for reconstructing what programs do, on
// test/facts: a small IMS application written like the real thing.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { sync } from "../src/indexer.js";
import { indexed, indexer } from "./indexed.js";

const root = join(import.meta.dirname, "facts");
const db = await indexed(root);

/** @param {string} sql @param {...any} params */
const rows = (sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row }));

test("declarations are read with their structure, type, storage and scope", () => {
  assert.deepEqual(
    rows(
      `SELECT v.qualified, v.level, v.type, v.size, v.storage, v.base, f.path
       FROM variables v JOIN files f ON f.id = v.file WHERE f.member = 'KDC00001' ORDER BY v.id`,
    ),
    [
      { qualified: "KUNDE_SEG", level: 1, type: "STRUCTURE", size: null, storage: "BASED", base: "KUNDE_PTR", path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.KDNR", level: 2, type: "CHAR", size: "8", storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.KDTYP", level: 2, type: "CHAR", size: "1", storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.ADRESSE", level: 2, type: "STRUCTURE", size: null, storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.ADRESSE.ORT", level: 3, type: "CHAR", size: "30", storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.ADRESSE.PLZ", level: 3, type: "PIC", size: "99999", storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.KREDIT", level: 2, type: "FIXED DEC", size: "11,2", storage: null, base: null, path: "INCLUDE/KDC00001" },
      { qualified: "KUNDE_SEG.*", level: 2, type: "CHAR", size: "10", storage: null, base: null, path: "INCLUDE/KDC00001" },
    ],
  );
});

test("an include member's declarations belong to no procedure", () => {
  assert.deepEqual(rows(`SELECT count(*) AS n FROM variables v JOIN files f ON f.id = v.file WHERE f.member = 'KDC00001' AND v.scope IS NOT NULL`), [{ n: 0 }]);
});

test("constants, initial values, LIKE and parameters", () => {
  const of = (/** @type {string} */ name) =>
    rows(`SELECT s.name AS scope, v.type, v.storage, v.init, v.like, v.external, v.parameter FROM variables v JOIN symbols s ON s.id = v.scope JOIN files f ON f.id = v.file
         WHERE f.member = 'KDP00001' AND v.qualified = ?`, name);
  assert.deepEqual(of("GU_FUNC"), [{ scope: "KDP00001", type: "CHAR", storage: "STATIC", init: "'GU  '", like: null, external: 0, parameter: null }]);
  assert.deepEqual(of("MAX_KREDIT"), [{ scope: "KDP00001", type: "FIXED DEC", storage: "CONSTANT", init: "50000", like: null, external: 0, parameter: null }]);
  assert.deepEqual(of("KUNDE_SSA.SEGNAME"), [{ scope: "KDP00001", type: "CHAR", storage: null, init: "'KUNDE   '", like: null, external: 0, parameter: null }]);
  assert.deepEqual(of("PLITDLI"), [{ scope: "KDP00001", type: "ENTRY", storage: null, init: null, like: null, external: 1, parameter: null }]);
  assert.deepEqual(of("K2"), [{ scope: "KDP00001", type: "STRUCTURE", storage: null, init: null, like: "KUNDE_SEG", external: 0, parameter: null }]);
  assert.deepEqual(of("DBPCB_PTR"), [{ scope: "KDP00001", type: "POINTER", storage: "PARAMETER", init: null, like: null, external: 0, parameter: 2 }]);
  assert.deepEqual(of("K"), [{ scope: "PRUEFEN", type: "STRUCTURE", storage: "PARAMETER", init: null, like: "KUNDE_SEG", external: 0, parameter: 1 }]);
  assert.deepEqual(rows(`SELECT dims, init FROM variables WHERE name = 'TAGE'`), [{ dims: "12", init: "31,28,31,30,31,30,31,31,30,31,30,31" }]);
});

test("factored declarations give each name its own and the shared attributes", () => {
  assert.deepEqual(
    rows(`SELECT v.name, v.type, v.size, v.dims, v.storage, v.attributes FROM variables v JOIN files f ON f.id = v.file
          WHERE f.member = 'KDP00001' AND v.name IN ('ZINS', 'RATE', 'ANZ', 'VON', 'BIS') ORDER BY v.id`),
    [
      { name: "ZINS", type: "FIXED DEC", size: "5,2", dims: null, storage: "STATIC", attributes: "FIXED DEC(5,2) STATIC" },
      { name: "RATE", type: "FIXED DEC", size: "5,2", dims: null, storage: "STATIC", attributes: "FIXED DEC(5,2) STATIC" },
      { name: "ANZ", type: "FIXED BIN", size: "31", dims: "3", storage: "STATIC", attributes: "(3) FIXED BIN(31) STATIC" },
      { name: "VON", type: "CHAR", size: "8", dims: null, storage: null, attributes: "CHAR(8)" },
      { name: "BIS", type: "CHAR", size: "8", dims: null, storage: null, attributes: "CHAR(8)" },
    ],
  );
});

test("a procedure keeps its OPTIONS and RETURNS", () => {
  assert.deepEqual(rows(`SELECT s.name, s.detail FROM symbols s JOIN files f ON f.id = s.file WHERE f.member = 'KDP00001' ORDER BY s.line`), [
    { name: "KDP00001", detail: "OPTIONS(MAIN)" },
    { name: "PRUEFEN", detail: "RETURNS(BIT(1))" },
  ]);
});

test("the graph page marks the OPTIONS(MAIN) procedure", () => {
  const procedures = /** @type {any} */ (new Graph(db, root).pageDetails("SRC/KDP00001")).procedures;
  assert.deepEqual(procedures.map((/** @type {any} */ n) => [n.name, n.mods]).sort(), [["KDP00001", ["MAIN"]], ["PRUEFEN", undefined]]);
});

test("JCL steps run programs under a PSB", () => {
  assert.deepEqual(rows(`SELECT j.name AS job, s.name, s.program, s.procedure, s.psb, s.parm FROM steps s JOIN symbols j ON j.id = s.job ORDER BY s.id`), [
    { job: "KDJOB01", name: "PRUEF", program: "KDP00001", procedure: null, psb: "KDPSB01", parm: "BMP,KDP00001,KDPSB01" },
    { job: "KDJOB02", name: "DRUCK", program: "KDDRUCK", procedure: null, psb: null, parm: null },
    { job: "KDJOB02", name: "BATCH", program: "KDP00001", procedure: "DLIBATCH", psb: "KDPSB02", parm: null },
    { job: "KDJOB03", name: "AUSK", program: "KDP00005", procedure: null, psb: "KDPSB01", parm: "BMP,KDP00005,KDPSB01" },
    { job: "KDJOB04", name: "DB2", program: "IKJEFT01", procedure: null, psb: null, parm: null },
    { job: "KDJOB05", name: "LISTE", program: "KDP00014", procedure: null, psb: null, parm: null },
    { job: "KDJOB06", name: "MAHN", program: "KDP00017", procedure: null, psb: null, parm: null },
    { job: "KDJOB07", name: "DRUCK", program: "KDDRUCK", procedure: null, psb: null, parm: null },
  ]);
  assert.deepEqual(rows(`SELECT r.name, l.target_symbol IS NOT NULL AS linked FROM refs r JOIN files f ON f.id = r.file LEFT JOIN links l ON l.ref = r.id WHERE r.kind = 'program' AND f.language = 'jcl' ORDER BY r.id`), [
    { name: "KDP00001", linked: 1 },
    { name: "KDDRUCK", linked: 1 },
    { name: "KDP00001", linked: 1 },
    { name: "KDP00005", linked: 1 },
    { name: "IKJEFT01", linked: 0 },
    { name: "KDP00005", linked: 1 },
    { name: "KDP00014", linked: 1 },
    { name: "KDP00017", linked: 1 },
    { name: "KDDRUCK", linked: 1 },
  ]);
  assert.deepEqual(rows(`SELECT r.name FROM refs r JOIN files f ON f.id = r.file WHERE r.kind = 'psb' AND f.language = 'jcl' ORDER BY r.id`), [
    { name: "KDPSB01" },
    { name: "KDPSB02" },
    { name: "KDPSB01" },
  ]);
});

test("DD statements name their dataset, generation and disposition", () => {
  assert.deepEqual(rows(`SELECT s.name AS step, d.name, d.dsn, d.member, d.disp, d.attributes FROM dds d JOIN steps s ON s.id = d.step WHERE s.name = 'PRUEF' ORDER BY d.id`), [
    { step: "PRUEF", name: "STEPLIB", dsn: "IMS.SDFSRESL", member: null, disp: "SHR", attributes: "DSN=IMS.SDFSRESL,DISP=SHR" },
    { step: "PRUEF", name: "STEPLIB", dsn: "PROD.KD.LOAD", member: null, disp: "SHR", attributes: "DSN=PROD.KD.LOAD,DISP=SHR" },
    {
      step: "PRUEF",
      name: "AUSZUG",
      dsn: "PROD.KD.AUSZUG",
      member: "+1",
      disp: "NEW,CATLG,DELETE",
      attributes: "DSN=PROD.KD.AUSZUG(+1),DISP=(NEW,CATLG,DELETE),SPACE=(CYL,(5,5)),DCB=(RECFM=FB,LRECL=200)",
    },
    { step: "PRUEF", name: "SYSPRINT", dsn: null, member: null, disp: null, attributes: "SYSOUT=*" },
  ]);
});

test("a dataset's users show which job writes it and which reads it", () => {
  const users = new Graph(db, root).datasetUsers("PROD.KD.AUS%").map((u) => [u.job, u.step, u.program, u.dd, u.member, u.disp]);
  assert.deepEqual(users, [
    ["KDJOB01", "PRUEF", "KDP00001", "AUSZUG", "+1", "NEW,CATLG,DELETE"],
    ["KDJOB02", "DRUCK", "KDDRUCK", "AUSZUG", "0", "SHR"],
  ]);
});

test("record and stream I/O name the file, record and key", () => {
  assert.deepEqual(
    rows(`SELECT io.operation, io.name, io.record, io.key, io.title, io.line FROM file_io io JOIN files f ON f.id = io.file WHERE f.member = 'KDDRUCK' ORDER BY io.id`),
    [
      { operation: "OPEN", name: "AUSZUG", record: null, key: null, title: null, line: 8 },
      { operation: "OPEN", name: "LISTE", record: null, key: null, title: null, line: 8 },
      { operation: "OPEN", name: "ARCHIV", record: null, key: null, title: "ARCH", line: 8 },
      { operation: "READ", name: "AUSZUG", record: "SATZ", key: null, title: null, line: 9 },
      { operation: "PUT", name: "LISTE", record: null, key: null, title: null, line: 11 },
      { operation: "WRITE", name: "ARCHIV", record: "SATZ", key: null, title: null, line: 12 },
      { operation: "READ", name: "AUSZUG", record: "SATZ", key: null, title: null, line: 13 },
      { operation: "CLOSE", name: "AUSZUG", record: null, key: null, title: null, line: 15 },
      { operation: "CLOSE", name: "LISTE", record: null, key: null, title: null, line: 15 },
      { operation: "CLOSE", name: "ARCHIV", record: null, key: null, title: null, line: 15 },
    ],
  );
});

test("REWRITE with KEY, LOCATE with SET, DELETE, UNLOCK, FLUSH, and PUT without FILE", () => {
  assert.deepEqual(rows(`SELECT operation, name, record, key FROM file_io io JOIN files f ON f.id = io.file WHERE f.member = 'KDP00003' ORDER BY io.id`), [
    { operation: "REWRITE", name: "KUNDEN", record: "K", key: "K.KDNR" },
    { operation: "LOCATE", name: "AUSG", record: "A_SATZ", key: null },
    { operation: "DELETE", name: "KUNDEN", record: null, key: "K.KDNR" },
    { operation: "UNLOCK", name: "KUNDEN", record: null, key: "K.KDNR" },
    { operation: "FLUSH", name: "AUSG", record: null, key: null },
    { operation: "PUT", name: "SYSPRINT", record: null, key: null },
  ]);
  const accesses = rows(
    `SELECT s.line, s.kind, a.name, a.mode FROM statements s LEFT JOIN accesses a ON a.statement = s.id JOIN files f ON f.id = s.file
     WHERE f.member = 'KDP00003' AND s.line >= 7 ORDER BY s.id, a.id`,
  ).map((a) => [a.line, a.kind, a.name ?? "-", a.mode ?? "-"].join(" "));
  assert.deepEqual(accesses, [
    "7 locate A_SATZ write", "7 locate AP write", "8 delay - -", "9 delete K.KDNR read", "10 unlock K.KDNR read",
    "11 flush - -", "12 flush - -", "13 on - -", "13 stop - -", "14 put - -",
  ]);
  const on = rows(`SELECT s.detail FROM statements s JOIN files f ON f.id = s.file WHERE f.member = 'KDP00003' AND s.kind = 'on'`);
  assert.deepEqual(on, [{ detail: "ENDFILE(KUNDEN), KEY(KUNDEN)" }]);
});

test("a program's files go to the datasets of the steps running it", () => {
  const files = new Graph(db, root).programFiles("KDDRUCK");
  assert.deepEqual(
    files.map((f) => [f.name, f.dd, f.operations.join(","), f.records.join(","), f.dds.map((d) => `${d.job}.${d.step} ${d.dsn ?? "-"}(${d.member ?? ""}) ${d.disp ?? "-"}`)]),
    [
      ["AUSZUG", "AUSZUG", "OPEN,READ,CLOSE", "SATZ", ["KDJOB02.DRUCK PROD.KD.AUSZUG(0) SHR", "KDJOB07.DRUCK PROD.KD.MAHNUNG(0) SHR"]],
      ["LISTE", "LISTE", "OPEN,PUT,CLOSE", "", ["KDJOB02.DRUCK -() -", "KDJOB07.DRUCK -() -"]],
      ["ARCHIV", "ARCH", "OPEN,WRITE,CLOSE", "SATZ", []],
    ],
  );
});

test("a batch chain orders the jobs by the datasets they pass on, with the records written and read", () => {
  const graph = new Graph(db, root);
  const side = (/** @type {any} */ s) =>
    `${s.job}.${s.step} ${s.program} ${s.dd}${s.generation ? `(${s.generation})` : ""} ${s.disp}${s.operations.length ? ` ${s.operations.join(",")}` : ""}${s.records.map((/** @type {any} */ r) => ` ${r.name} [${r.fields.join("; ")}] ${r.path}:${r.line}`).join("")}`;
  const chain = graph.batchChain("");
  assert.deepEqual(chain.jobs.map((j) => `${j.job} ${j.path}:${j.line}${j.after.length ? ` after ${j.after.join(",")}` : ""}`), [
    "KDJOB01 JCL/KDJOB01:1",
    "KDJOB02 JCL/KDJOB02:1 after KDJOB01",
    "KDJOB05 JCL/KDJOB05:1",
    "KDJOB06 JCL/KDJOB06:1 after KDJOB05",
    "KDJOB07 JCL/KDJOB07:1 after KDJOB06",
  ]);
  assert.deepEqual(
    chain.datasets.map((d) => [d.dsn, d.writers.map(side), d.readers.map(side)]),
    [
      ["PROD.KD.AUSZUG", ["KDJOB01.PRUEF KDP00001 AUSZUG(+1) NEW,CATLG,DELETE"], ["KDJOB02.DRUCK KDDRUCK AUSZUG(0) SHR READ SATZ [1 SATZ; 2 KDNR CHAR(8); 2 BETRAG FIXED DEC(11,2)] SRC/KDDRUCK:5"]],
      ["PROD.KD.SALDEN", ["KDJOB05.LISTE KDP00014 LISTE NEW,CATLG WRITE ZEILE [1 ZEILE; 2 KDNR CHAR(8); 2 SALDO PIC '(9)9V99-'] SRC/KDP00014:4"], ["KDJOB06.MAHN KDP00017 SALDEN SHR READ SALDEN_SATZ [1 SALDEN_SATZ; 2 KDNR CHAR(8); 2 SALDO PIC '(9)9V99-'] INCLUDE/KDC00004:3"]],
      ["PROD.KD.MAHNUNG", ["KDJOB06.MAHN KDP00017 MAHNUNG(+1) NEW,CATLG,DELETE WRITE MAHN_SATZ [1 MAHN_SATZ; 2 KDNR CHAR(8); 2 MSTUFE FIXED BIN(15)] SRC/KDP00017:6"], ["KDJOB07.DRUCK KDDRUCK AUSZUG(0) SHR READ SATZ [1 SATZ; 2 KDNR CHAR(8); 2 BETRAG FIXED DEC(11,2)] SRC/KDDRUCK:5"]],
    ],
  );
  assert.equal(chain.truncated, false);
  for (const path of ["JCL/KDJOB06", "SRC/KDP00017"]) {
    const around = graph.batchChain(path);
    assert.deepEqual(around.jobs.map((j) => j.job), ["KDJOB05", "KDJOB06", "KDJOB07"], path);
    assert.deepEqual(around.datasets.map((d) => d.dsn), ["PROD.KD.SALDEN", "PROD.KD.MAHNUNG"], path);
  }
  assert.deepEqual(graph.batchChain("SRC/KDP00016").datasets, []);
});

test("hotspots rank the fields and columns used by the most programs, with the transactions reaching them", () => {
  const graph = new Graph(db, root);
  const field = (/** @type {any} */ f) =>
    `${f.qualified} ${f.path}:${f.line} uses ${f.uses} r${f.reads} w${f.writes} p${f.passes} t${f.tests} in ${f.procedures} procedures, ${f.programs} programs${f.transactions.length ? ` ${f.transactions.join(",")}` : ""}${f.comment ? ` -- ${f.comment}` : ""}`;
  const column = (/** @type {any} */ c) =>
    `${c.table}.${c.column} ${c.type} ${c.path}:${c.line} uses ${c.uses} r${c.reads} w${c.writes} t${c.tests} in ${c.procedures} procedures, ${c.programs} programs ${c.transactions.join(",")}`;
  const all = graph.hotspots("");
  assert.deepEqual(all.fields.slice(0, 3).map(field), [
    "KUNDE_SEG.KDTYP INCLUDE/KDC00001:4 uses 4 r4 w0 p0 t3 in 3 procedures, 3 programs -- KUNDENTYP: P ODER G",
    "KUNDE_SEG.KREDIT INCLUDE/KDC00001:8 uses 4 r2 w1 p1 t1 in 2 procedures, 2 programs",
    "AUSGABE.MELDUNG SRC/KDP00011:23 uses 5 r0 w5 p0 t0 in 2 procedures, 1 programs KD06",
  ]);
  assert.deepEqual(all.columns.slice(0, 2).map(column), [
    "KUNDE.KDNR CHAR(8) INCLUDE/KDT00001:2 uses 7 r2 w0 t5 in 3 procedures, 3 programs KD05,KD07",
    "KUNDE.SALDO DECIMAL(11,2) INCLUDE/KDT00001:4 uses 6 r6 w2 t0 in 3 procedures, 3 programs KD05,KD07",
  ]);
  assert.equal(all.truncated, false);
  const one = graph.hotspots("SRC/KDP00013");
  assert.equal(one.fields.length, 14);
  assert.deepEqual(one.fields[0] && field(one.fields[0]), "KD_NR SRC/KDP00013:23 uses 3 r2 w1 p0 t0 in 1 procedures, 1 programs KD07");
  assert.deepEqual(one.columns.map((/** @type {any} */ c) => `${c.table}.${c.column}`), ["KUNDE.KDNR", "KUNDE.SALDO"]);
});

test("CREATE TABLE gives each column its type, NOT NULL and key position", () => {
  assert.deepEqual(rows(`SELECT table_name, name, type, not_null, key, position FROM columns ORDER BY id`), [
    { table_name: "KUNDE", name: "KDNR", type: "CHAR(8)", not_null: 1, key: 1, position: 1 },
    { table_name: "KUNDE", name: "NAME", type: "VARCHAR(40)", not_null: 1, key: null, position: 2 },
    { table_name: "KUNDE", name: "SALDO", type: "DECIMAL(11,2)", not_null: 0, key: null, position: 3 },
    { table_name: "KUNDE", name: "TYP", type: "CHAR(1)", not_null: 1, key: null, position: 4 },
    { table_name: "BUCHUNG", name: "BUCHNR", type: "INTEGER", not_null: 1, key: 1, position: 1 },
    { table_name: "BUCHUNG", name: "KDNR", type: "CHAR(8)", not_null: 1, key: null, position: 2 },
    { table_name: "BUCHUNG", name: "BETRAG", type: "DECIMAL(11,2)", not_null: 1, key: null, position: 3 },
  ]);
});

test("embedded SQL pairs columns with host variables, through cursors too", () => {
  const sql = rows(
    `SELECT c.operation, c.cursor, c.table_name AS tab, c.column_name AS col, c.usage, c.host, c.expression, c.line
     FROM sql_columns c JOIN files f ON f.id = c.file WHERE f.member = 'KDP00004' ORDER BY c.id`,
  ).map((r) => Object.values(r).join(" | "));
  assert.deepEqual(sql, [
    "SELECT |  | KUNDE | NAME | select | KD.NAME |  | 6",
    "SELECT |  | KUNDE | SALDO | select | KD.SALDO |  | 6",
    "SELECT |  | KUNDE | KDNR | where | KD_NR | KDNR = :KD_NR | 7",
    "SELECT |  | KUNDE | TYP | where |  | TYP = 'G' | 7",
    "SELECT |  | KUNDE |  | select | ANZAHL | COUNT(*) | 8",
    "UPDATE |  | KUNDE | SALDO | set | KD.SALDO | SALDO + :KD.SALDO | 9",
    "UPDATE |  | KUNDE | SALDO | read |  |  | 9",
    "UPDATE |  | KUNDE | KDNR | where | KD_NR | KDNR = :KD_NR | 10",
    "INSERT |  | BUCHUNG | BUCHNR | insert |  | NEXT VALUE FOR BUCHSEQ | 11",
    "INSERT |  | BUCHUNG | KDNR | insert | KD_NR |  | 11",
    "INSERT |  | BUCHUNG | BETRAG | insert | KD.SALDO |  | 11",
    "DECLARE | C1 | BUCHUNG | BUCHNR | select |  |  | 14",
    "DECLARE | C1 | BUCHUNG | BETRAG | select |  |  | 14",
    "DECLARE | C1 | BUCHUNG | KDNR | where |  | B.KDNR = K.KDNR | 15",
    "DECLARE | C1 | KUNDE | KDNR | where |  | B.KDNR = K.KDNR | 15",
    "DECLARE | C1 | KUNDE | TYP | where |  | K.TYP = 'G' | 15",
    "DECLARE | C1 | BUCHUNG | BUCHNR | order |  |  | 15",
    "FETCH | C1 | BUCHUNG | BUCHNR | select | ANZAHL |  | 17",
    "FETCH | C1 | BUCHUNG | BETRAG | select | KD.SALDO |  | 17",
  ]);
});

test("IMS gens are read whatever their member is named", () => {
  assert.deepEqual(rows(`SELECT path, language FROM files WHERE path LIKE 'IMS/%' ORDER BY path`), [
    { path: "IMS/KDDBD01", language: "hlasm" },
    { path: "IMS/KDDRUCK", language: "hlasm" },
    { path: "IMS/KDPSB01", language: "hlasm" },
    { path: "IMS/KDPSB05", language: "hlasm" },
    { path: "IMS/KDSYSDEF", language: "hlasm" },
  ]);
});

test("a PSB gen gives the PSB, its PCBs in order and their sensitive segments", () => {
  assert.deepEqual(
    rows(`SELECT s.name AS psb, p.position, p.type, p.name, p.dbd, p.procopt FROM pcbs p JOIN symbols s ON s.id = p.psb ORDER BY p.id`),
    [
      { psb: "KDDRUCK", position: 1, type: "GSAM", name: null, dbd: "KDGSAM1", procopt: "LS" },
      { psb: "KDPSB01", position: 1, type: "TP", name: "ALTPCB", dbd: null, procopt: null },
      { psb: "KDPSB01", position: 2, type: "DB", name: "KDPCB1", dbd: "KDDBD01", procopt: "A" },
      { psb: "KDP00005", position: 1, type: "TP", name: "ALTPCB", dbd: null, procopt: null },
      { psb: "KDP00005", position: 2, type: "DB", name: null, dbd: "KDDBD01", procopt: "A" },
    ],
  );
  assert.deepEqual(rows(`SELECT g.name, g.parent, g.procopt, p.name AS pcb FROM sensegs g JOIN pcbs p ON p.id = g.pcb ORDER BY g.id`), [
    { name: "KUNDE", parent: null, procopt: null, pcb: "KDPCB1" },
    { name: "KONTO", parent: "KUNDE", procopt: "G", pcb: "KDPCB1" },
    { name: "KUNDE", parent: null, procopt: null, pcb: null },
    { name: "KONTO", parent: "KUNDE", procopt: null, pcb: null },
  ]);
  assert.deepEqual(
    rows(`SELECT r.name, t.kind FROM refs r JOIN symbols c ON c.id = r.caller LEFT JOIN links l ON l.ref = r.id LEFT JOIN symbols t ON t.id = l.target_symbol WHERE r.kind = 'dbd' ORDER BY r.id`),
    [
      { name: "KDGSAM1", kind: null },
      { name: "KDDBD01", kind: "dbd" },
      { name: "KDDBD01", kind: "dbd" },
    ],
  );
});

test("a DBD gen gives its segment hierarchy and fields", () => {
  assert.deepEqual(rows(`SELECT d.name AS dbd, g.name, g.parent, g.bytes, g.position FROM segments g JOIN symbols d ON d.id = g.dbd ORDER BY g.id`), [
    { dbd: "KDDBD01", name: "KUNDE", parent: null, bytes: 120, position: 1 },
    { dbd: "KDDBD01", name: "KONTO", parent: "KUNDE", bytes: 60, position: 2 },
  ]);
  assert.deepEqual(rows(`SELECT g.name AS segment, f.name, f.sequence, f.start, f.bytes, f.type FROM segment_fields f JOIN segments g ON g.id = f.segment ORDER BY f.id`), [
    { segment: "KUNDE", name: "KDNR", sequence: "U", start: 1, bytes: 8, type: "C" },
    { segment: "KUNDE", name: "NAME", sequence: null, start: 9, bytes: 40, type: "C" },
    { segment: "KONTO", name: "KTONR", sequence: "U", start: 1, bytes: 10, type: "C" },
    { segment: "KONTO", name: "SALDO", sequence: null, start: 11, bytes: 6, type: "P" },
  ]);
});

test("the IMS system definition maps transactions to their PSB and program", () => {
  assert.deepEqual(
    rows(
      `SELECT t.name AS tran, t.detail, r.kind, r.name, tf.path FROM symbols t JOIN refs r ON r.caller = t.id
       LEFT JOIN links l ON l.ref = r.id LEFT JOIN files tf ON tf.id = l.target_file WHERE t.kind = 'transaction' ORDER BY r.id`,
    ),
    [
      { tran: "KD01", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=KD01,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "psb", name: "KDP00001", path: null },
      { tran: "KD01", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=KD01,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "program", name: "KDP00001", path: "SRC/KDP00001" },
      { tran: "KD02", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=(KD02,KD03)", kind: "psb", name: "KDP00001", path: null },
      { tran: "KD02", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=(KD02,KD03)", kind: "program", name: "KDP00001", path: "SRC/KDP00001" },
      { tran: "KD03", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=(KD02,KD03)", kind: "psb", name: "KDP00001", path: null },
      { tran: "KD03", detail: "PSB=KDP00001,PGMTYPE=TP,CODE=(KD02,KD03)", kind: "program", name: "KDP00001", path: "SRC/KDP00001" },
      { tran: "KD05", detail: "PSB=KDP00005,PGMTYPE=TP,CODE=KD05,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "psb", name: "KDP00005", path: "IMS/KDPSB05" },
      { tran: "KD05", detail: "PSB=KDP00005,PGMTYPE=TP,CODE=KD05,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "program", name: "KDP00005", path: "SRC/KDP00005" },
      { tran: "KD06", detail: "PSB=KDP00011,PGMTYPE=TP,CODE=KD06,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "psb", name: "KDP00011", path: null },
      { tran: "KD06", detail: "PSB=KDP00011,PGMTYPE=TP,CODE=KD06,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "program", name: "KDP00011", path: "SRC/KDP00011" },
      { tran: "KD07", detail: "PSB=KDP00013,PGMTYPE=TP,CODE=KD07,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "psb", name: "KDP00013", path: null },
      { tran: "KD07", detail: "PSB=KDP00013,PGMTYPE=TP,CODE=KD07,MSGTYPE=(SNGLSEG,RESPONSE)", kind: "program", name: "KDP00013", path: "SRC/KDP00013" },
    ],
  );
});

test("a program named like a PSB gen links to the program, a PSB to the gen", () => {
  assert.deepEqual(
    rows(
      `SELECT r.kind, r.name, tf.path FROM refs r JOIN files f ON f.id = r.file JOIN links l ON l.ref = r.id JOIN files tf ON tf.id = l.target_file
       WHERE f.language = 'jcl' AND r.kind IN ('program', 'psb') ORDER BY r.id`,
    ),
    [
      { kind: "program", name: "KDP00001", path: "SRC/KDP00001" },
      { kind: "psb", name: "KDPSB01", path: "IMS/KDPSB01" },
      { kind: "program", name: "KDDRUCK", path: "SRC/KDDRUCK" },
      { kind: "program", name: "KDP00001", path: "SRC/KDP00001" },
      { kind: "program", name: "KDP00005", path: "SRC/KDP00005" },
      { kind: "psb", name: "KDPSB01", path: "IMS/KDPSB01" },
      { kind: "program", name: "KDP00005", path: "SRC/KDP00005" },
      { kind: "program", name: "KDP00014", path: "SRC/KDP00014" },
      { kind: "program", name: "KDP00017", path: "SRC/KDP00017" },
      { kind: "program", name: "KDDRUCK", path: "SRC/KDDRUCK" },
    ],
  );
});

test("DL/I calls name their function, PCB parameter and SSA segments, also from an include", () => {
  assert.deepEqual(
    rows(`SELECT d.entry, d.function, d.pcb, d.pcb_parameter, d.io_area, d.segment, d.path, d.arguments, d.line FROM dli_calls d ORDER BY d.id`),
    [
      { entry: "PLITDLI", function: "GU", pcb: "IOPCB", pcb_parameter: 1, io_area: "MSG", segment: null, path: null, arguments: "DREI, GU_FUNC, IOPCB, MSG", line: 31 },
      { entry: "PLITDLI", function: "GU", pcb: "DBPCB", pcb_parameter: 3, io_area: "SEG", segment: "KUNDE", path: "KUNDE", arguments: "VIER, GU_FUNC, DBPCB, SEG, KUNDE_SSA", line: 33 },
      { entry: "PLITDLI", function: "GNP", pcb: "DBPCB", pcb_parameter: 3, io_area: "SEG", segment: "KONTO", path: "KONTO", arguments: "VIER, GNP_FUNC, DBPCB, SEG, KONTO_SSA", line: 34 },
      { entry: "CEETDLI", function: "REPL", pcb: "DBPCB", pcb_parameter: 3, io_area: "SEG", segment: null, path: null, arguments: "'REPL', DBPCB, SEG", line: 35 },
      { entry: "PLITDLI", function: "ISRT", pcb: "ALTPCB", pcb_parameter: 2, io_area: "MSG", segment: null, path: null, arguments: "DREI, ISRT_FUNC, ALTPCB, MSG", line: 36 },
      { entry: "PLITDLI", function: "ISRT", pcb: "IOPCB", pcb_parameter: 1, io_area: "MSG", segment: "KDF001O", path: "KDF001O", arguments: "VIER, ISRT_FUNC, IOPCB, MSG, MODNAME", line: 37 },
      { entry: "CEETDLI", function: "DLET", pcb: "DBPCB", pcb_parameter: 3, io_area: "SEG", segment: null, path: null, arguments: "'DLET', DBPCB, SEG", line: 38 },
      { entry: "PLITDLI", function: "GU", pcb: "DBPCB", pcb_parameter: 2, io_area: "SEG", segment: "KUNDE", path: "KUNDE", arguments: "VIER, GU_FUNC, DBPCB, SEG, KUNDE_SSA", line: 6 },
      { entry: "PLITDLI", function: "GU", pcb: "IOPCB", pcb_parameter: 1, io_area: "EINGABE", segment: null, path: null, arguments: "DREI, GU_FUNC, IOPCB, EINGABE", line: 25 },
      { entry: "PLITDLI", function: "ISRT", pcb: "IOPCB", pcb_parameter: 1, io_area: "AUSGABE", segment: null, path: null, arguments: "DREI, ISRT_FUNC, IOPCB, AUSGABE", line: 38 },
      { entry: "PLITDLI", function: "GU", pcb: "IOPCB", pcb_parameter: 1, io_area: "EINGABE", segment: null, path: null, arguments: "DREI, GU_FUNC, IOPCB, EINGABE", line: 26 },
      { entry: "PLITDLI", function: "ISRT", pcb: "IOPCB", pcb_parameter: 1, io_area: "AUSGABE", segment: null, path: null, arguments: "DREI, ISRT_FUNC, IOPCB, AUSGABE", line: 36 },
    ],
  );
});

test("MFS fields carry their position, label and place in the message", () => {
  assert.deepEqual(
    rows(
      `SELECT s.name AS screen, m.kind, m.name, m.dfld, m.row, m.col, m.length, m.segment, m.offset, m.label, m.literal, m.line
       FROM mfs_fields m JOIN symbols s ON s.id = m.screen JOIN files f ON f.id = m.file WHERE f.path = 'MFS/KDF00001' ORDER BY m.id`,
    ),
    [
      { screen: "KDF001", kind: "DFLD", name: null, dfld: null, row: 1, col: 30, length: 14, segment: null, offset: null, label: null, literal: "KUNDENAUSKUNFT", line: 5 },
      { screen: "KDF001", kind: "DFLD", name: null, dfld: null, row: 3, col: 2, length: 9, segment: null, offset: null, label: null, literal: "KUNDENNR:", line: 6 },
      { screen: "KDF001", kind: "DFLD", name: "KDNR", dfld: null, row: 3, col: 20, length: 8, segment: null, offset: null, label: "KUNDENNR:", literal: null, line: 7 },
      { screen: "KDF001", kind: "DFLD", name: null, dfld: null, row: 4, col: 2, length: 5, segment: null, offset: null, label: null, literal: "NAME:", line: 8 },
      { screen: "KDF001", kind: "DFLD", name: "NAME", dfld: null, row: 4, col: 20, length: 40, segment: null, offset: null, label: "NAME:", literal: null, line: 9 },
      { screen: "KDF001", kind: "DFLD", name: null, dfld: null, row: 5, col: 2, length: 5, segment: null, offset: null, label: null, literal: "SALDO", line: 10 },
      { screen: "KDF001", kind: "DFLD", name: "SALDO", dfld: null, row: 5, col: 20, length: 12, segment: null, offset: null, label: "SALDO", literal: null, line: 11 },
      { screen: "KDF001", kind: "DFLD", name: "MELDUNG", dfld: null, row: 24, col: 2, length: 79, segment: null, offset: null, label: null, literal: null, line: 12 },
      { screen: "KDF001I", kind: "MFLD", name: null, dfld: null, row: null, col: null, length: 8, segment: 1, offset: 0, label: null, literal: "KD01    ", line: 16 },
      { screen: "KDF001I", kind: "MFLD", name: null, dfld: "KDNR", row: null, col: null, length: 8, segment: 1, offset: 8, label: null, literal: null, line: 17 },
      { screen: "KDF001O", kind: "MFLD", name: null, dfld: "KDNR", row: null, col: null, length: 8, segment: 1, offset: 0, label: null, literal: null, line: 21 },
      { screen: "KDF001O", kind: "MFLD", name: null, dfld: "NAME", row: null, col: null, length: 40, segment: 1, offset: 10, label: null, literal: null, line: 22 },
      { screen: "KDF001O", kind: "MFLD", name: null, dfld: "SALDO", row: null, col: null, length: 12, segment: 1, offset: 50, label: null, literal: null, line: 23 },
      { screen: "KDF001O", kind: "MFLD", name: null, dfld: "MELDUNG", row: null, col: null, length: 79, segment: 1, offset: 62, label: null, literal: "BITTE KUNDENNR EINGEBEN", line: 24 },
    ],
  );
});

test("statements form a tree of IFs, SELECTs and DOs, with their conditions", () => {
  const statements = rows(
    `SELECT s.line, s.kind, p.line || ' ' || p.kind AS parent, s.branch, s.label, s.detail
     FROM statements s LEFT JOIN statements p ON p.id = s.parent JOIN files f ON f.id = s.file WHERE f.path = 'SRC/KDP00006' ORDER BY s.id`,
  ).map((s) => [s.line, s.kind, s.parent, s.branch, s.label, s.detail].map((v) => v ?? "-").join(" | "));
  assert.deepEqual(statements, [
    "2 | declare | - | - | - | -",
    "6 | declare | - | - | - | -",
    "7 | declare | - | - | - | -",
    "8 | declare | - | - | - | -",
    "9 | on | - | - | - | ENDFILE(KUNDIN)",
    "9 | assignment | 9 on | - | - | -",
    "10 | if | - | - | - | KD.TYP = 'G'",
    "11 | assignment | 10 if | then | - | -",
    "12 | do | 10 if | else | - | -",
    "13 | if | 12 do | - | - | SALDO > LIMIT & TYP ^= 'P'",
    "13 | assignment | 13 if | then | - | -",
    "14 | assignment | 12 do | - | - | -",
    "16 | select | - | - | - | TYP",
    "17 | when | 16 select | - | - | 'A', 'B'",
    "17 | assignment | 17 when | - | - | -",
    "18 | when | 16 select | - | - | 'C'",
    "18 | do | 18 when | - | - | -",
    "19 | assignment | 18 do | - | - | -",
    "20 | call | 18 do | - | - | PRUEFEN",
    "22 | otherwise | 16 select | - | - | -",
    "22 | signal | 22 otherwise | - | - | ERROR",
    "24 | do | - | - | - | I = 1 TO 10 WHILE (RC = 0)",
    "25 | assignment | 24 do | - | - | -",
    "27 | if | - | - | - | SQLCODE = 100",
    "27 | goto | 27 if | then | - | ENDE",
    "28 | if | - | - | - | RC > 4",
    "28 | return | 28 if | then | - | RC",
    "30 | return | - | - | ENDE | 0",
  ]);
});

test("statements read and write fields, and compare them", () => {
  const accesses = rows(
    `SELECT s.line, a.name, a.mode, a.value FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file
     WHERE f.path IN ('SRC/KDP00006', 'SRC/KDDRUCK') ORDER BY a.id`,
  ).map((a) => [a.line, a.name, a.mode, a.value].map((v) => v ?? "-").join(" "));
  assert.deepEqual(accesses, [
    "7 ENDE write '1'B",
    "9 SATZ write -",
    "10 ENDE read -",
    "11 KDNR read -",
    "11 BETRAG read -",
    "12 SATZ read -",
    "13 SATZ write -",
    "9 RC write 8",
    "10 KD.TYP read -",
    "11 MELDUNG write 'GESCHAEFTSKUNDE'",
    "13 SALDO read -",
    "13 LIMIT read -",
    "13 TYP read -",
    "13 RC write 4",
    "14 MELDUNG write 'PRIVATKUNDE'",
    "16 TYP read -",
    "17 RC write 1",
    "19 RC write 2",
    "20 KD arg -",
    "20 RC arg -",
    "24 I write -",
    "24 RC read -",
    "25 SALDO write -",
    "25 SALDO read -",
    "25 I read -",
    "27 SQLCODE read -",
    "28 RC read -",
    "28 RC read -",
  ]);
  const comparisons = rows(
    `SELECT s.line, c.left, c.operator, c.right FROM comparisons c JOIN statements s ON s.id = c.statement JOIN files f ON f.id = s.file
     WHERE f.path = 'SRC/KDP00006' ORDER BY c.id`,
  ).map((c) => `${c.line} ${c.left} ${c.operator} ${c.right}`);
  assert.deepEqual(comparisons, [
    "10 KD.TYP = 'G'",
    "13 SALDO > LIMIT",
    "13 TYP ^= 'P'",
    "17 TYP = 'A'",
    "17 TYP = 'B'",
    "18 TYP = 'C'",
    "24 RC = 0",
    "27 SQLCODE = 100",
    "28 RC > 4",
  ]);
});

test("accesses resolve to the variable they name, by scope, include, qualification and LIKE", () => {
  assert.deepEqual(
    rows(
      `SELECT s.line, a.name, a.mode, a.position, vf.path || ':' || v.line AS variable, v.qualified, t.qualified AS through
       FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file
       LEFT JOIN variables v ON v.id = a.variable LEFT JOIN files vf ON vf.id = v.file LEFT JOIN variables t ON t.id = a.through
       WHERE f.path = 'SRC/KDP00007' ORDER BY a.id`,
    ),
    [
      { line: 11, name: "MSG.KDNR", mode: "write", position: null, variable: "SRC/KDP00007:6", qualified: "MSG.KDNR", through: null },
      { line: 11, name: "KUNDE_SEG.KDNR", mode: "read", position: null, variable: "INCLUDE/KDC00001:3", qualified: "KUNDE_SEG.KDNR", through: null },
      { line: 12, name: "ORT", mode: "write", position: null, variable: "INCLUDE/KDC00001:6", qualified: "KUNDE_SEG.ADRESSE.ORT", through: null },
      { line: 13, name: "KUNDE_SEG.PLZ", mode: "write", position: null, variable: "INCLUDE/KDC00001:7", qualified: "KUNDE_SEG.ADRESSE.PLZ", through: null },
      { line: 14, name: "ALT.KREDIT", mode: "write", position: null, variable: "INCLUDE/KDC00001:8", qualified: "KUNDE_SEG.KREDIT", through: "ALT" },
      { line: 14, name: "KREDIT", mode: "read", position: null, variable: "INCLUDE/KDC00001:8", qualified: "KUNDE_SEG.KREDIT", through: null },
      { line: 15, name: "TYP", mode: "write", position: null, variable: "SRC/KDP00007:10", qualified: "TYP", through: null },
      { line: 15, name: "KDTYP", mode: "read", position: null, variable: "INCLUDE/KDC00001:4", qualified: "KUNDE_SEG.KDTYP", through: null },
      { line: 16, name: "MSG.KDNR", mode: "arg", position: 1, variable: "SRC/KDP00007:6", qualified: "MSG.KDNR", through: null },
      { line: 16, name: "KREDIT", mode: "arg", position: 2, variable: "INCLUDE/KDC00001:8", qualified: "KUNDE_SEG.KREDIT", through: null },
      { line: 17, name: "TYP", mode: "arg", position: 1, variable: "SRC/KDP00007:10", qualified: "TYP", through: null },
      { line: 17, name: "BETRAG", mode: "arg", position: 2, variable: "SRC/KDP00007:9", qualified: "BETRAG", through: null },
      { line: 21, name: "BETRAG", mode: "write", position: null, variable: "SRC/KDP00007:20", qualified: "BETRAG", through: null },
      { line: 21, name: "BETRAG", mode: "read", position: null, variable: "SRC/KDP00007:20", qualified: "BETRAG", through: null },
      { line: 22, name: "TEXT", mode: "write", position: null, variable: "SRC/KDP00007:7", qualified: "MSG.TEXT", through: null },
      { line: 22, name: "NR", mode: "read", position: null, variable: "SRC/KDP00007:19", qualified: "NR", through: null },
    ],
  );
});

test("comments describe procedures and declarations, literals are kept with their statement", () => {
  assert.deepEqual(rows(`SELECT name, comment, line FROM symbols WHERE comment IS NOT NULL ORDER BY id`), [
    { name: "KDP00009", comment: "KDP00009: SPERRPRUEFUNG\nPRUEFT, OB EIN KUNDE GESPERRT IST", line: 5 },
    { name: "PROTO", comment: "PROTOKOLL", line: 19 },
    { name: "KDP00010", comment: "KDP00010: MONATSABSCHLUSS MIT ALTLASTEN", line: 2 },
    { name: "KDP00011", comment: "KDP00011: KUNDE ANLEGEN", line: 2 },
    { name: "KDP00013", comment: "KDP00013: SALDO BUCHEN", line: 2 },
    { name: "KDP00014", comment: "KDP00014: SALDENLISTE", line: 2 },
    { name: "KDP00015", comment: "KDP00015: KREDITRAHMEN PRUEFEN", line: 2 },
    { name: "KDP00016", comment: "KDP00016: KUNDENTYP EINSTUFEN", line: 2 },
    { name: "KDP00017", comment: "KDP00017: MAHNLAUF", line: 2 },
  ]);
  assert.deepEqual(
    rows(`SELECT v.qualified, v.comment FROM variables v JOIN files f ON f.id = v.file WHERE v.comment IS NOT NULL AND f.path IN ('SRC/KDP00009', 'INCLUDE/KDC00001') ORDER BY v.id`),
    [
      { qualified: "KUNDE_SEG", comment: "KUNDENSATZ: das Segment KUNDE der Datenbank KDDB" },
      { qualified: "KUNDE_SEG.KDTYP", comment: "KUNDENTYP: P ODER G" },
      { qualified: "KDNR", comment: "KUNDENNUMMER" },
      { qualified: "SPERRE", comment: "SPERRVERMERK DES KUNDEN" },
      { qualified: "SPERRE.KZ", comment: "S = GESPERRT, F = FREI" },
    ],
  );
  assert.deepEqual(
    rows(`SELECT s.kind, s.line, l.text FROM literals l JOIN statements s ON s.id = l.statement JOIN files f ON f.id = s.file WHERE f.path IN ('SRC/KDP00009', 'SRC/KDDRUCK') ORDER BY l.id`),
    [
      { kind: "open", line: 8, text: "ARCH" },
      { kind: "if", line: 13, text: "S" },
      { kind: "assignment", line: 14, text: "KDE001 KUNDE IST GESPERRT" },
      { kind: "call", line: 15, text: "KDE001" },
      { kind: "call", line: 15, text: "GESPERRT:" },
      { kind: "put", line: 17, text: "KUNDE 'FREI'" },
      { kind: "display", line: 20, text: "KDP00009 ENDE" },
    ],
  );
});

const graph = new Graph(db, root);
/** @param {{ path: string, line: number, col?: number, endCol?: number }[]} sites */
const spans = (sites) => sites.map((s) => `${s.path}:${s.line}:${s.col}-${s.endCol}`).sort();

test("every relation goes from the name to the name, both ways", () => {
  /** @type {[string, number, string, string[], string[]][]} where, the name, its definitions, its references */
  const cases = [
    ["SRC/KDP00001", 14, "PRUEFEN", ["SRC/KDP00001:15:1-8"], ["SRC/KDP00001:14:8-15"]],
    ["SRC/KDP00004", 8, "KUNDE", ["INCLUDE/KDT00001:1:18-23"], ["SRC/KDP00004:14:64-69", "SRC/KDP00004:7:22-27", "SRC/KDP00004:8:51-56", "SRC/KDP00004:9:24-29", "SRC/KDP00013:30:26-31", "SRC/KDP00013:31:47-52", "SRC/KDP00014:10:63-68"]],
    ["MFS/KDF00001", 19, "KDF001O", ["MFS/KDF00001:19:0-7"], ["MFS/KDF00001:14:50-57", "SRC/KDP00005:28:36-43"]],
    ["MFS/KDF00001", 1, "KDF001", ["MFS/KDF00001:1:0-6"], ["MFS/KDF00001:14:31-37", "MFS/KDF00001:19:32-38"]],
    ["IMS/KDPSB01", 6, "KUNDE", ["IMS/KDDBD01:3:20-25"], ["IMS/KDPSB01:6:21-26", "IMS/KDPSB05:4:21-26"]],
    ["IMS/KDPSB01", 4, "KDDBD01", ["IMS/KDDBD01:1:20-27"], ["IMS/KDPSB01:4:31-38", "IMS/KDPSB05:3:31-38"]],
    ["IMS/KDSYSDEF", 4, "KDP00001", ["SRC/KDP00001:1:1-9"], ["IMS/KDSYSDEF:4:21-29", "JCL/KDJOB01:2:39-47", "JCL/KDJOB02:5:29-37"]],
    ["SRC/KDP00004", 17, "C1", ["SRC/KDP00004:13:20-22"], ["SRC/KDP00004:13:20-22", "SRC/KDP00004:16:17-19", "SRC/KDP00004:17:18-20", "SRC/KDP00004:18:18-20"]],
    ["JCL/KDJOB02", 3, "AUSZUG", ["JCL/KDJOB01:5:18-32"], ["JCL/KDJOB01:5:18-32", "JCL/KDJOB02:3:18-32"]],
  ];
  for (const [path, line, word, definitions, references] of cases) {
    const [first] = definitions;
    const [definedIn, definedAt] = [first.split(":")[0], Number(first.split(":")[1])];
    assert.deepEqual(spans(graph.definitions(path, line, word, false)), definitions, `definition of ${word} at ${path}:${line}`);
    assert.deepEqual(spans(graph.references(path, line, word, false)), references, `references of ${word} at ${path}:${line}`);
    // From the definition, the same references.
    assert.deepEqual(spans(graph.references(definedIn, definedAt, word, false)), references, `references of ${word} at its definition`);
  }
});

test("dead code: branches under constant conditions, procedures nothing live calls, variables nothing reads", () => {
  /** @param {number} line @param {string} kind @param {string} condition @param {string} why @param {string} branch @param {number} to */
  const never = (line, kind, condition, why, branch, to) => ({ path: "SRC/KDP00010", line, procedure: "KDP00010", kind, condition, always: false, why, branch, from: line, to });
  assert.deepEqual(graph.deadCode("SRC/KDP00010"), {
    conditions: [
      never(12, "if", "TESTMODUS", "TESTMODUS is always '0'B", "then", 12),
      never(13, "if", "VERSION = 'V1'", "VERSION is always 'V2'", "then", 16),
      never(19, "when", "'V0', 'V1'", "VERSION is always 'V2'", "body", 19),
      never(23, "if", "1 = 0", "it compares constants", "then", 23),
    ],
    // ALTDRUCK is called only in a branch that never runs, HILFE only by a dead procedure.
    procedures: [
      { name: "TESTDRUCK", path: "SRC/KDP00010", line: 24, end: 26, callers: ["KDP00010"] },
      { name: "ALTDRUCK", path: "SRC/KDP00010", line: 27, end: 29, callers: ["KDP00010"] },
      { name: "HILFE", path: "SRC/KDP00010", line: 30, end: 32, callers: ["TESTDRUCK"] },
    ],
    // I is the loop's control, which the loop tests.
    variables: [
      { name: "ALTFELD", path: "SRC/KDP00010", line: 5, procedure: "KDP00010", written: false },
      { name: "ZAEHLER", path: "SRC/KDP00010", line: 6, procedure: "KDP00010", written: true },
      { name: "PUFFER", path: "SRC/KDP00010", line: 8, procedure: "KDP00010", written: false },
    ],
  });
  const all = graph.deadCode("");
  // Programs no job, transaction or caller runs.
  assert.deepEqual(
    all.procedures.map((p) => p.name),
    ["KDP00003", "KDP00006", "PROTO", "TESTDRUCK", "ALTDRUCK", "HILFE"],
  );
});

test("a column's path: from the screen field into the column, and on to the reply and the batch list", () => {
  const path = graph.columnPath("PROD.KUNDE", "SALDO");
  assert.deepEqual(path.defined, { type: "DECIMAL(11,2)", path: "INCLUDE/KDT00001", line: 4 });
  const ends = (/** @type {{ kind: string, text: string, path: string, line: number, via: string[] }[]} */ list) => list.map((e) => `${e.kind} ${e.text} @${e.path}:${e.line} via ${e.via.join(" > ")}`);
  assert.deepEqual(
    path.writes.map((w) => ({ at: `${w.path}:${w.line}`, operation: w.operation, host: w.host, guards: w.guards, from: ends(w.from) })),
    [
      // The FETCH into KD.SALDO comes after the UPDATE, so it is not where the value comes from.
      { at: "SRC/KDP00004:9", operation: "UPDATE", host: "KD.SALDO", guards: [], from: ["column SELECT KUNDE.SALDO @SRC/KDP00004:6 via KD.SALDO"] },
      {
        at: "SRC/KDP00013:30",
        operation: "UPDATE",
        host: "BUCHUNG",
        guards: ["BUCHUNG > 0"],
        from: ["screen KDF003I field BETRAG 'BETRAG:' @MFS/KDF00003:18 via EINGABE.BETRAG > BUCHUNG"],
      },
    ],
  );
  assert.deepEqual(
    path.reads.map((r) => ({ at: `${r.path}:${r.line}`, operation: r.operation, host: r.host, guards: r.guards, to: ends(r.to) })),
    [
      {
        at: "SRC/KDP00004:6",
        operation: "SELECT",
        host: "KD.SALDO",
        guards: [],
        to: ["column UPDATE KUNDE.SALDO @SRC/KDP00004:9 via KD.SALDO", "column INSERT BUCHUNG.BETRAG @SRC/KDP00004:11 via KD.SALDO"],
      },
      {
        at: "SRC/KDP00013:31",
        operation: "SELECT",
        host: "NEU",
        guards: ["BUCHUNG > 0"],
        to: ["screen ISRT of AUSGABE to the I/O PCB: the reply to the screen @SRC/KDP00013:36 via NEU > AUSGABE.SALDO"],
      },
      {
        at: "SRC/KDP00014:14",
        operation: "FETCH",
        host: "BETRAG",
        guards: ["DO WHILE (^ENDE)"],
        to: ["file WRITE FILE(LISTE) FROM(ZEILE) to PROD.KD.SALDEN @SRC/KDP00014:19 via BETRAG > ZEILE.SALDO"],
      },
    ],
  );
  assert.deepEqual(path.keys, []);
  assert.deepEqual(
    graph.columnPath("KUNDE", "KDNR").keys.map((k) => `${k.path}:${k.line} ${k.operation} ${k.host}`),
    ["SRC/KDP00004:7 SELECT KD_NR", "SRC/KDP00004:10 UPDATE KD_NR", "SRC/KDP00004:15 DECLARE null", "SRC/KDP00013:30 UPDATE KD_NR", "SRC/KDP00013:31 SELECT KD_NR"],
  );
  assert.equal(path.truncated, false);
});

test("messages and codes: each value set or passed on, with the conditions it is produced under", () => {
  const rules = (/** @type {string} */ path) =>
    graph.messages(path).rules.flatMap((r) =>
      r.ways.map((w) => `${r.target} ${r.value}${r.constant ? ` (${r.constant})` : ""} when ${w.conditions.join("; ") || "always"} @${w.places.map((p) => `${p.path}:${p.line}`).join(", ")}`),
    );
  assert.deepEqual(rules("SRC/KDP00013"), [
    "AUSGABE.MELDUNG 'GEBUCHT' when BUCHUNG > 0 @SRC/KDP00013:33",
    // A message from a STATIC INIT nothing changes counts as its text.
    "AUSGABE.MELDUNG 'KD201 BETRAG FEHLT' (KD201) when NOT (BUCHUNG > 0) @SRC/KDP00013:35",
  ]);
  assert.deepEqual(rules("SRC/KDP00006"), [
    "MELDUNG 'GESCHAEFTSKUNDE' when KD.TYP = 'G' @SRC/KDP00006:11",
    "MELDUNG 'PRIVATKUNDE' when NOT (KD.TYP = 'G') @SRC/KDP00006:14",
    "RC 1 when TYP = 'A', 'B' @SRC/KDP00006:17",
    "RC 2 when TYP = 'C' @SRC/KDP00006:19",
    "RC 4 when NOT (KD.TYP = 'G'); SALDO > LIMIT & TYP ^= 'P' @SRC/KDP00006:13",
    "RC 8 when ON ENDFILE(KUNDIN) @SRC/KDP00006:9",
  ]);
  // What is passed to a CALL, printed or displayed; DL/I calls are no messages.
  assert.deepEqual(rules("SRC/KDP00009"), [
    "CALL KDFEHL 'KDE001', 'GESPERRT:' when KZ = 'S' @SRC/KDP00009:15",
    "DISPLAY 'KDP00009 ENDE' when always @SRC/KDP00009:20",
    "MELDUNG 'KDE001 KUNDE IST GESPERRT' when KZ = 'S' @SRC/KDP00009:14",
    "PUT 'KUNDE ''FREI''' when NOT (KZ = 'S') @SRC/KDP00009:17",
  ]);
  assert.deepEqual(rules("SRC/KDP00005"), []);
  // The workspace keeps the fields set to two values or more, and what is passed on;
  // a rule found in more places comes first.
  const all = graph.messages("");
  assert.equal(all.truncated, false);
  assert.deepEqual(all.rules.slice(0, 2).map((r) => `${r.target} ${r.value} ${r.count}`), ["PUT 'ALT' 2", "STUFE 0 2"]);
  assert.ok(all.rules.some((r) => r.target === "AUSGABE.MELDUNG" && r.value === "'KD104 KUNDENNR NICHT NUMERISCH'"));
  assert.ok(!all.rules.some((r) => r.target.startsWith("CALL CEETDLI")));
});

test("decision table: every value a code field is compared to, in every program, with what follows", () => {
  const graph = new Graph(db, root);
  const said = (/** @type {{ text: string, guards: string[], count: number }[]} */ list) => list.map((o) => [...o.guards, o.text].join(" > ") + (o.count > 1 ? ` x${o.count}` : ""));
  const table = (/** @type {string} */ path, /** @type {string} */ name) =>
    graph.decisionTable(path, name)?.rows.map((r) => ({
      value: `${r.operator} ${r.value}${r.constant ? ` (${r.constant.name}: ${r.constant.comment})` : ""}`.trim(),
      at: r.places.map((p) => `${p.path}:${p.line}`),
      then: said(r.then),
      else: said(r.else),
    }));
  // A field of an include is tested in each program that includes it; the
  // programs disagree on 'G', only one knows 'X', and constants count as their value.
  assert.deepEqual(graph.decisionTable("INCLUDE/KDC00001", "KDTYP")?.variable.comment, "KUNDENTYP: P ODER G");
  assert.deepEqual(table("INCLUDE/KDC00001", "KDTYP"), [
    {
      value: "= 'G' (KDTYP_GEWERBE: GEWERBEKUNDE)",
      at: ["SRC/KDP00015:9", "SRC/KDP00016:8"],
      then: ["STUFE = 0;", "STUFE = 4;"],
      else: ["IF KDTYP = KDTYP_PRIVAT [true] > IF KREDIT > 10000 [true] > MELDUNG = 'KD301 KREDIT ZU HOCH';", "IF KDTYP = KDTYP_PRIVAT [false] > STUFE = 8;"],
    },
    { value: "= 'P' (KDTYP_PRIVAT: PRIVATKUNDE)", at: ["SRC/KDP00015:10", "SRC/KDP00016:9"], then: ["IF KREDIT > 10000 [true] > MELDUNG = 'KD301 KREDIT ZU HOCH';", "STUFE = 0;"], else: ["STUFE = 8;"] },
    { value: "= 'X'", at: ["SRC/KDP00016:9"], then: ["STUFE = 0;"], else: [] },
    { value: "OTHERWISE", at: ["SRC/KDP00016:10"], then: ["STUFE = 8;"], else: [] },
  ]);
  // ^= 'P' is the Else of = 'P'; a condition testing more than the field gives what follows when it is true, under it.
  assert.deepEqual(table("SRC/KDP00006", "KD.TYP"), [
    { value: "= 'A'", at: ["SRC/KDP00006:17"], then: ["RC = 1;"], else: [] },
    { value: "= 'B'", at: ["SRC/KDP00006:17"], then: ["RC = 1;"], else: [] },
    { value: "= 'C'", at: ["SRC/KDP00006:18"], then: ["CALL PRUEFEN(KD, RC);", "RC = 2;"], else: [] },
    { value: "= 'G'", at: ["SRC/KDP00006:10"], then: ["MELDUNG = 'GESCHAEFTSKUNDE';"], else: ["MELDUNG = 'PRIVATKUNDE';", "IF SALDO > LIMIT & TYP ^= 'P' [true] > RC = 4;"] },
    { value: "= 'P'", at: ["SRC/KDP00006:13"], then: [], else: ["IF SALDO > LIMIT & TYP ^= 'P' > RC = 4;"] },
    { value: "OTHERWISE", at: ["SRC/KDP00006:22"], then: ["SIGNAL ERROR;"], else: [] },
  ]);
  assert.equal(graph.decisionTable("SRC/KDP00006", "NIX"), null);
});

test("what a declaration leaves out gets PL/I's defaults, and an undeclared name an implicit declaration", async () => {
  const folder = mkdtempSync(join(tmpdir(), "pli-defaults-"));
  writeFileSync(
    join(folder, "TYPP01"),
    [
      " TYPP01: PROC(P1, P2, NP) OPTIONS(MAIN);",
      "   DCL P1 CHAR(10), P2;",
      "   %INCLUDE TYPC01;",
      "   DCL 1 S1, 2 F1 CHAR(4), 2 F2 BIT;",
      "   DCL 1 S2 LIKE S1;",
      "   DCL (R FIXED BIN, T FIXED DEC, U FLOAT, V BIN, W DEC(7), G FLOAT BIN, NX, AX) STATIC;",
      "   DCL B_SATZ CHAR(8) BASED(AP);",
      "   DCL SUBSTR BUILTIN;",
      "   I = 1; ZAHL = 2;",
      "   IF SQLCODE = 100 THEN S2 = S1;",
      "   ALLOCATE B_SATZ SET(AP);",
      "   ZAHL = SUBSTR(F1, 1, 1);",
      " INNEN: PROC;",
      "   I = 2;",
      " END INNEN;",
      " END TYPP01;",
      "",
    ].join("\n"),
  );
  writeFileSync(join(folder, "TYPC01"), " DCL KONST CHAR(2) INIT('AB');\n");
  const db = await indexed(folder);
  /** @param {string} sql */
  const rows = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));
  const of = () => rows(`SELECT v.name, v.type, v.size, v.dims, v.storage, s.name AS scope, v.line FROM variables v LEFT JOIN symbols s ON s.id = v.scope WHERE v.level = 1 ORDER BY v.storage IS 'IMPLICIT', v.line, v.name`);
  const declared = [
    { name: "KONST", type: "CHAR", size: "2", dims: null, storage: null, scope: null, line: 1 },
    { name: "NP", type: "FIXED BIN", size: "15", dims: null, storage: "PARAMETER", scope: "TYPP01", line: 1 },
    { name: "P1", type: "CHAR", size: "10", dims: null, storage: "PARAMETER", scope: "TYPP01", line: 2 },
    { name: "P2", type: "FLOAT DEC", size: "6", dims: null, storage: "PARAMETER", scope: "TYPP01", line: 2 },
    { name: "S1", type: "STRUCTURE", size: null, dims: null, storage: null, scope: "TYPP01", line: 4 },
    { name: "S2", type: "STRUCTURE", size: null, dims: null, storage: null, scope: "TYPP01", line: 5 },
    { name: "AX", type: "FLOAT DEC", size: "6", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "G", type: "FLOAT BIN", size: "21", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "NX", type: "FIXED BIN", size: "15", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "R", type: "FIXED BIN", size: "15", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "T", type: "FIXED DEC", size: "5", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "U", type: "FLOAT DEC", size: "6", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "V", type: "FLOAT BIN", size: "21", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "W", type: "FLOAT DEC", size: "7", dims: null, storage: "STATIC", scope: "TYPP01", line: 6 },
    { name: "B_SATZ", type: "CHAR", size: "8", dims: null, storage: "BASED", scope: "TYPP01", line: 7 },
    { name: "SUBSTR", type: "BUILTIN", size: null, dims: null, storage: null, scope: "TYPP01", line: 8 },
  ];
  assert.deepEqual(of(), [
    ...declared,
    { name: "I", type: "FIXED BIN", size: "15", dims: null, storage: "IMPLICIT", scope: "TYPP01", line: 9 },
    { name: "ZAHL", type: "FLOAT DEC", size: "6", dims: null, storage: "IMPLICIT", scope: "TYPP01", line: 9 },
    { name: "SQLCODE", type: "FIXED BIN", size: "31", dims: null, storage: "IMPLICIT", scope: "TYPP01", line: 10 },
    { name: "AP", type: "POINTER", size: null, dims: null, storage: "IMPLICIT", scope: "TYPP01", line: 11 },
  ]);
  assert.deepEqual(rows(`SELECT type, size FROM variables WHERE qualified = 'S1.F2'`), [{ type: "BIT", size: "1" }]);
  assert.deepEqual(rows(`SELECT count(*) AS n FROM accesses WHERE variable IS NULL`), [{ n: 0 }]);
  // INNEN's I is the main procedure's: one implicit declaration for both.
  assert.deepEqual(rows(`SELECT count(DISTINCT variable) AS n, count(*) AS uses FROM accesses WHERE name = 'I'`), [{ n: 1, uses: 2 }]);

  // Once the include declares ZAHL, it is no longer implicit.
  writeFileSync(join(folder, "TYPC01"), " DCL KONST CHAR(2) INIT('AB');\n DCL ZAHL FIXED DEC(5);\n");
  await sync(db, folder, indexer);
  assert.deepEqual(rows(`SELECT name FROM variables WHERE storage = 'IMPLICIT' ORDER BY id`), [{ name: "I" }, { name: "SQLCODE" }, { name: "AP" }]);
  assert.deepEqual(rows(`SELECT count(*) AS n FROM accesses a JOIN variables v ON v.id = a.variable WHERE a.name = 'ZAHL' AND v.type = 'FIXED DEC'`), [{ n: 2 }]);
});

test("a ß before a name does not shift its column", async () => {
  const folder = mkdtempSync(join(tmpdir(), "pli-sharp-s-"));
  // ß uppercases to SS, one character more.
  writeFileSync(join(folder, "STRASSE"), " STRASSE: PROC;\n   EXEC SQL SELECT 'STRAßE' INTO :A FROM PROD.ORT;\n END STRASSE;\n");
  const refs = (await indexed(folder)).prepare("SELECT name, line, col, end_col AS endCol FROM refs WHERE kind = 'table'").all();
  assert.deepEqual(refs.map((r) => ({ ...r })), [{ name: "ORT", line: 2, col: 46, endCol: 49 }]);
});
