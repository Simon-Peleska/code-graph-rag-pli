import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { openGraph, sync } from "../src/indexer.js";
import { indexer } from "./indexed.js";

const fixture = join(import.meta.dirname, "fixture");
const facts = join(import.meta.dirname, "facts");
const graphs = mkdtempSync(join(tmpdir(), "pli-graph-"));
for (const root of [fixture, facts]) {
  const db = openGraph(join(graphs, `${basename(root)}.sqlite`));
  await sync(db, root, indexer);
  db.close();
}

/** Runs the server over stdio with these requests and gives back its replies by id. @param {object[]} requests */
function serve(requests, root = fixture) {
  const input = requests.map((request, i) => JSON.stringify({ jsonrpc: "2.0", id: i + 1, ...request })).join("\n");
  const graphFile = join(graphs, `${basename(root)}.sqlite`);
  const output = execFileSync(process.execPath, [join(import.meta.dirname, "../src/mcp.js"), graphFile, root], { input, stdio: ["pipe", "pipe", "ignore"] });
  return output.toString().trim().split("\n").map((line) => JSON.parse(line));
}

/** @param {string} name @param {object} args */
const tool = (name, args) => ({ method: "tools/call", params: { name, arguments: args } });

test("the server introduces itself and lists its tools", () => {
  const [hello, list] = serve([{ method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }, { method: "tools/list" }]);
  assert.equal(hello.result.protocolVersion, "2025-06-18");
  assert.equal(hello.result.serverInfo.name, "pli-graph");
  assert.deepEqual(
    list.result.tools.map((/** @type {any} */ t) => t.name),
    ["find_definition", "find_references", "dependencies", "dependents", "dataset", "program_files", "table_columns", "psb", "screen", "dli", "field", "lineage", "text", "get_source", "query_graph"],
  );
});

test("the tools answer from the graph", () => {
  const replies = serve([
    tool("find_definition", { name: "helper" }),
    tool("find_references", { name: "helper" }),
    tool("dependencies", { path: "shop/main.pli" }),
    tool("dependents", { path: "shop/helper.pli" }),
    tool("get_source", { name: "inner" }),
    tool("query_graph", { sql: "SELECT count(*) AS n FROM files WHERE path = 'shop/main.pli'" }),
  ]);
  const [definition, references, dependencies, dependents, source, query] = replies.map((r) => r.result.content[0].text);
  assert.match(definition, /^procedure HELPER: shop\/helper\.pli:1-/);
  assert.match(references, /call from \S+: shop\/main\.pli:3/);
  assert.match(dependencies, /shop\/helper\.pli:1/);
  assert.match(dependents, /shop\/main\.pli/);
  assert.match(source, /^procedure INNER, shop\/helper\.pli:\n\s+2    inner: proc;/);
  assert.deepEqual(JSON.parse(query), [{ n: 1 }]);
});

test("dataset tells who writes and who reads a dataset", () => {
  const [found, none] = serve([tool("dataset", { dsn: "prod.kd.auszug" }), tool("dataset", { dsn: "NIX" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "PROD.KD.AUSZUG(+1) DISP=NEW,CATLG,DELETE as AUSZUG in KDJOB01 step PRUEF running KDP00001: JCL/KDJOB01:5",
      "PROD.KD.AUSZUG(0) DISP=SHR as AUSZUG in KDJOB02 step DRUCK running KDDRUCK: JCL/KDJOB02:3",
    ].join("\n"),
  );
  assert.equal(none.result.content[0].text, "No DD statement names NIX.");
});

test("program_files maps a program's files to its datasets", () => {
  const [found] = serve([tool("program_files", { program: "kddruck" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "AUSZUG: OPEN, READ, CLOSE record SATZ",
      "  KDJOB02 step DRUCK: PROD.KD.AUSZUG(0) DISP=SHR, JCL/KDJOB02:3",
      "LISTE: OPEN, PUT, CLOSE",
      "  KDJOB02 step DRUCK: no dataset, JCL/KDJOB02:4",
      "ARCHIV (DD ARCH): OPEN, WRITE, CLOSE record SATZ",
      "  in no JCL step running the program",
    ].join("\n"),
  );
});

test("table_columns lists who reads and writes each column", () => {
  const [found] = serve([tool("table_columns", { table: "buchung" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "BUCHNR INTEGER NOT NULL key 1",
      "  INSERT insert NEXT VALUE FOR BUCHSEQ in KDP00004: SRC/KDP00004:11",
      "  DECLARE C1 select in KDP00004: SRC/KDP00004:14",
      "  DECLARE C1 order in KDP00004: SRC/KDP00004:15",
      "  FETCH C1 select into :ANZAHL in KDP00004: SRC/KDP00004:17",
      "KDNR CHAR(8) NOT NULL",
      "  INSERT insert with :KD_NR in KDP00004: SRC/KDP00004:11",
      "  DECLARE C1 where B.KDNR = K.KDNR in KDP00004: SRC/KDP00004:15",
      "BETRAG DECIMAL(11,2) NOT NULL",
      "  INSERT insert with :KD.SALDO in KDP00004: SRC/KDP00004:11",
      "  DECLARE C1 select in KDP00004: SRC/KDP00004:14",
      "  FETCH C1 select into :KD.SALDO in KDP00004: SRC/KDP00004:17",
    ].join("\n"),
  );
});

test("psb shows a PSB's PCBs and segments, also by transaction code", () => {
  const [byPsb, byTransaction] = serve([tool("psb", { name: "kdpsb01" }), tool("psb", { name: "KD01" })], facts);
  assert.equal(
    byPsb.result.content[0].text,
    [
      "PSB KDPSB01 (LANG=PLI,PSBNAME=KDPSB01,CMPAT=YES): IMS/KDPSB01:8",
      "  PCB 1 TP ALTPCB",
      "  PCB 2 DB KDPCB1 DBD KDDBD01 PROCOPT=A",
      "    KUNDE 120 bytes key KDNR",
      "    KONTO under KUNDE PROCOPT=G 60 bytes key KTONR",
      "used by job KDJOB01: JCL/KDJOB01:2",
      "used by job KDJOB03: JCL/KDJOB03:2",
    ].join("\n"),
  );
  assert.equal(
    byTransaction.result.content[0].text,
    ["No PSB gen defines KDP00001.", "used by transaction KD01: IMS/KDSYSDEF:5", "used by transaction KD02: IMS/KDSYSDEF:6", "used by transaction KD03: IMS/KDSYSDEF:6"].join("\n"),
  );
});

test("screen shows a format's fields with labels and its messages' layout", () => {
  const [found] = serve([tool("screen", { name: "kdf001o" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "FMT KDF001: MFS/KDF00001:1",
      "  'KUNDENAUSKUNFT' at 1,30",
      "  'KUNDENNR:' at 3,2",
      "  KDNR at 3,20 length 8 label 'KUNDENNR:' ATTR=(NUM)",
      "  'NAME:' at 4,2",
      "  NAME at 4,20 length 40 label 'NAME:' ATTR=(PROT)",
      "  'SALDO' at 5,2",
      "  SALDO at 5,20 length 12 label 'SALDO' ATTR=(PROT,HI)",
      "  MELDUNG at 24,2 length 79",
      "MSG KDF001I: MFS/KDF00001:14",
      "  segment 1 offset 0 length 8 'KD01    '",
      "  segment 1 offset 8 length 8 KDNR label 'KUNDENNR:'",
      "MSG KDF001O: MFS/KDF00001:19",
      "  segment 1 offset 0 length 8 KDNR label 'KUNDENNR:'",
      "  segment 1 offset 10 length 40 NAME label 'NAME:'",
      "  segment 1 offset 50 length 12 SALDO label 'SALDO'",
      "  segment 1 offset 62 length 79 MELDUNG default 'BITTE KUNDENNR EINGEBEN'",
      "named as KDF001O in SRC/KDP00005:28",
    ].join("\n"),
  );
});

test("dli matches a program's DL/I calls to the PCBs of its PSB", () => {
  const [found, none] = serve([tool("dli", { program: "kdp00005" }), tool("dli", { program: "kdp00001" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "PSB KDPSB01 as KDJOB03 step AUSK",
      "  GU on IOPCB = I/O PCB I/O area MSG in KDP00005: SRC/KDP00005:31",
      "  GU KUNDE on DBPCB = PCB 2 DB KDPCB1 DBD KDDBD01 PROCOPT=A I/O area SEG in KDP00005: SRC/KDP00005:33",
      "  GNP KONTO on DBPCB = PCB 2 DB KDPCB1 DBD KDDBD01 PROCOPT=A I/O area SEG in KDP00005: SRC/KDP00005:34",
      "  REPL on DBPCB = PCB 2 DB KDPCB1 DBD KDDBD01 PROCOPT=A I/O area SEG in KDP00005: SRC/KDP00005:35",
      "  ISRT on ALTPCB = PCB 1 TP ALTPCB I/O area MSG in KDP00005: SRC/KDP00005:36",
      "  ISRT MOD KDF001O on IOPCB = I/O PCB I/O area MSG in KDP00005: SRC/KDP00005:37",
    ].join("\n"),
  );
  assert.equal(none.result.content[0].text, "kdp00001 makes no DL/I calls of its own.");
});

test("field shows where a field is set, passed and compared, and under which conditions", () => {
  const [rc, saldo, none] = serve([tool("field", { name: "rc" }), tool("field", { name: "saldo" }), tool("field", { name: "nix" })], facts);
  assert.equal(
    rc.result.content[0].text,
    [
      "sets RC = 8 in KDP00006: SRC/KDP00006:9 when ON ENDFILE(KUNDIN)",
      "sets RC = 4 in KDP00006: SRC/KDP00006:13 when NOT (KD.TYP = 'G'); SALDO > LIMIT & TYP ^= 'P'",
      "sets RC = 1 in KDP00006: SRC/KDP00006:17 when TYP = 'A', 'B'",
      "sets RC = 2 in KDP00006: SRC/KDP00006:19 when TYP = 'C'",
      "passes RC to PRUEFEN in KDP00006: SRC/KDP00006:20 when TYP = 'C'",
      "compares RC = 0 in KDP00006: SRC/KDP00006:24",
      "compares RC > 4 in KDP00006: SRC/KDP00006:28",
    ].join("\n"),
  );
  assert.equal(
    saldo.result.content[0].text,
    [
      "compares SALDO > LIMIT in KDP00006: SRC/KDP00006:13 when NOT (KD.TYP = 'G')",
      "sets SALDO by an assignment in KDP00006: SRC/KDP00006:25 when DO I = 1 TO 10 WHILE (RC = 0)",
    ].join("\n"),
  );
  assert.equal(none.result.content[0].text, "No statement sets, passes or compares nix.");
});

test("lineage follows a field through moves and calls", () => {
  const [kdnr, nr, kredit, ort, none] = serve(
    [tool("lineage", { name: "msg.kdnr" }), tool("lineage", { name: "nr" }), tool("lineage", { name: "kunde_seg.kredit" }), tool("lineage", { name: "ort" }), tool("lineage", { name: "nix" })],
    facts,
  );
  const text = (/** @type {any} */ reply) => reply.result.content[0].text;
  assert.equal(
    text(kdnr),
    ["MSG.KDNR of KDP00007: SRC/KDP00007:6", "  from KUNDE_SEG.KDNR in KDP00007: SRC/KDP00007:11", "  to BUCHEN parameter NR in KDP00007: SRC/KDP00007:16"].join("\n"),
  );
  assert.equal(
    text(nr),
    ["NR parameter 1 of BUCHEN: SRC/KDP00007:19", "  from MSG.KDNR passed in KDP00007: SRC/KDP00007:16", "  to TEXT (MSG.TEXT) in BUCHEN: SRC/KDP00007:22"].join("\n"),
  );
  assert.equal(
    text(kredit),
    [
      "KUNDE_SEG.KREDIT: INCLUDE/KDC00001:8",
      "  as ALT.KREDIT from KREDIT (KUNDE_SEG.KREDIT) in KDP00007: SRC/KDP00007:14",
      "  to ALT.KREDIT (KUNDE_SEG.KREDIT) in KDP00007: SRC/KDP00007:14",
      "  to BUCHEN parameter BETRAG in KDP00007: SRC/KDP00007:16",
    ].join("\n"),
  );
  assert.equal(text(ort), ["KUNDE_SEG.ADRESSE.ORT: INCLUDE/KDC00001:6", "  from 'BERLIN' in KDP00007: SRC/KDP00007:12"].join("\n"));
  assert.equal(text(none), "No variable nix is declared.");
});

test("text finds a word in comments and literals", () => {
  const [found, none] = serve([tool("text", { text: "gesperrt" }), tool("text", { text: "nix" })], facts);
  assert.equal(
    found.result.content[0].text,
    [
      "variable SPERRE.KZ: SRC/KDP00009:9: S = GESPERRT, F = FREI",
      "procedure KDP00009: SRC/KDP00009:5: KDP00009: SPERRPRUEFUNG PRUEFT, OB EIN KUNDE GESPERRT IST",
      "'KDE001 KUNDE IST GESPERRT' assigned to MELDUNG in KDP00009: SRC/KDP00009:14",
      "'GESPERRT:' passed to KDFEHL in KDP00009: SRC/KDP00009:15",
    ].join("\n"),
  );
  assert.equal(none.result.content[0].text, "No comment or literal contains nix.");
});

test("the graph cannot be changed and failures carry their code", () => {
  const [write, unknown] = serve([tool("query_graph", { sql: "DELETE FROM files" }), { method: "nope" }]);
  assert.equal(write.result.isError, true);
  assert.match(write.result.content[0].text, /^\[PLG020E\] query_graph failed/);
  assert.equal(unknown.error.code, -32601);
});
