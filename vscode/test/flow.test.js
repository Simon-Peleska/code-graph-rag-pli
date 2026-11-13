// The flow page: a procedure's statements in order, with
// the calls it makes expanded into the callee's lane as deep as asked.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Graph } from "../src/graph.js";
import { indexed } from "./indexed.js";

/** @typedef {import("../src/graph.js").FlowStep} FlowStep */

const folder = join(import.meta.dirname, "flow");
const graph = new Graph(await indexed(folder), folder);

/** @param {NonNullable<ReturnType<Graph["pageFlow"]>>} flow */
function outline(flow) {
  /** @type {string[]} */
  const lines = [];
  /** @param {FlowStep[]} steps @param {string} indent */
  const walk = (steps, indent) => {
    for (const step of steps) {
      lines.push(`${indent}${flow.lanes[step.lane].name}: ${step.kind} ${step.text}${step.call && step.call !== "expanded" ? ` (${step.call})` : ""}${step.access ? ` {${step.access}}` : ""}`);
      for (const branch of step.branches ?? []) {
        lines.push(`${indent}  [${branch.guard}]`);
        walk(branch.steps, `${indent}    `);
      }
      walk(step.steps ?? [], `${indent}  `);
    }
  };
  walk(flow.steps, "");
  return lines;
}

test("a procedure's flow holds its statements in order, its includes and the calls one level down", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/FLOWMAIN:FLOWMAIN:1", 1));
  assert.deepEqual(flow.lanes.map((l) => `${l.kind} ${l.name} ${l.path}`), [
    "procedure FLOWMAIN SRC/FLOWMAIN",
    "include FLOWDCL COPY/FLOWDCL",
    "procedure STEP1 SRC/STEP1",
    "procedure STEP2 SRC/STEP2",
  ]);
  assert.deepEqual(outline(flow), [
    "FLOWDCL: include %INCLUDE FLOWDCL",
    "  FLOWDCL: declare DCL RC FIXED BIN(31);",
    "  FLOWDCL: declare DCL (I, K, KZ, A, B) CHAR(1);",
    "FLOWMAIN: call CALL STEP1;",
    "  STEP1: call CALL STEP2; (cut)",
    "  STEP1: return RETURN;",
    "FLOWMAIN: if IF RC > 0",
    "  [true]",
    "    FLOWMAIN: put PUT SKIP LIST('FEHLER');",
    "  [false]",
    "    FLOWMAIN: call CALL STEP2;",
    "      STEP2: if IF A = B",
    "        [true]",
    "          STEP2: return RETURN;",
    "        [false]",
    "      STEP2: call CALL STEP1; (cut)",
    "FLOWMAIN: loop DO I = 1 TO 10",
    "  FLOWMAIN: if IF K = 'X'",
    "    [true]",
    "      FLOWMAIN: leave LEAVE;",
    "    [false]",
    "  FLOWMAIN: call CALL NOWHERE; (missing)",
    "FLOWMAIN: select SELECT (KZ);",
    "  ['A']",
    "    FLOWMAIN: call CALL STEP2;",
    "      STEP2: if IF A = B",
    "        [true]",
    "          STEP2: return RETURN;",
    "        [false]",
    "      STEP2: call CALL STEP1; (cut)",
    "  [otherwise]",
    "    FLOWMAIN: assignment RC = 4;",
    "FLOWMAIN: stop STOP;",
  ]);
});

test("depth 0 cuts every call, and a call back into a procedure on the way is not expanded again", () => {
  const flat = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/STEP1:STEP1:1", 0));
  assert.deepEqual(outline(flat), ["STEP1: call CALL STEP2; (cut)", "STEP1: return RETURN;"]);
  assert.deepEqual(flat.lanes.map((l) => l.name), ["STEP1"]);
  const deep = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/STEP1:STEP1:1", 5));
  assert.deepEqual(outline(deep), [
    "STEP1: call CALL STEP2;",
    "  STEP2: if IF A = B",
    "    [true]",
    "      STEP2: return RETURN;",
    "    [false]",
    "  STEP2: call CALL STEP1; (recursive)",
    "STEP1: return RETURN;",
  ]);
});

test("a flow of an unknown procedure is null", () => {
  assert.equal(graph.pageFlow("SRC/FLOWMAIN:NOPE:1", 1), null);
});

test("a call's text is its source statement over several lines, without comments", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/NESTED:OUTER:2", 0));
  assert.deepEqual(outline(flow), ["OUTER: call CALL INNER(1,\n           2); (cut)"]);
});

test("a statement over several lines leaves out the sequence numbers in columns 73-80", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/NUMBERED:NUMBERED:1", 0));
  assert.deepEqual(outline(flow), ["NUMBERED: exec EXEC SQL UPDATE PROD.KUNDE\n         SET ID = ID WHERE ID = :K;"]);
});

test("a declaration keeps its lines and their indentation, without comments and blank lines", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageFlow"]>>} */ (graph.pageFlow("SRC/DCLS:DCLS:1", 0));
  assert.deepEqual(outline(flow), ["DCLS: declare DCL 1 KUNDE,\n      2 NAME   CHAR(20),\n      2 SALDO  FIXED DEC(9,2);"]);
});

test("the flow button draws the procedure at the cursor, else the file's main one", () => {
  assert.equal(graph.flowProcedure("SRC/NESTED", 6), "SRC/NESTED:INNER:5");
  assert.equal(graph.flowProcedure("SRC/NESTED", 3), "SRC/NESTED:OUTER:2");
  assert.equal(graph.flowProcedure("SRC/NESTED", 1), "SRC/NESTED:OUTER:2");
  assert.equal(graph.flowProcedure("COPY/FLOWDCL", 1), undefined);
});

test("a variable's data flow shows where it, its structure or a field of it is set or passed, under which conditions", () => {
  const id = /** @type {string} */ (graph.variableAt("SRC/KDSET", 14, "RC"));
  assert.equal(id, "SRC/KDSET:KD.RC:4");
  assert.equal(graph.variableAt("SRC/KDSET", 4, "RC"), id);
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow(id));
  assert.deepEqual(flow.lanes.map((l) => l.name), ["KDSET", "FEHLER", "CHECK"]);
  assert.deepEqual(outline(flow), [
    "KDSET: select Data flow of KD.RC",
    "  [KDSET]",
    "    KDSET: assignment KD.RC = 0; {write}",
    "    KDSET: if IF KD.TYP = 'G'",
    "      [true]",
    "        KDSET: assignment RC = 4; {write}",
    "      [false]",
    "    KDSET: select SELECT (KD.TYP);",
    "      ['A']",
    "        KDSET: assignment KD.RC = 8; {write}",
    "      [otherwise]",
    "        KDSET: call CALL FEHLER(KD); {arg}",
    "          FEHLER: if IF K.T = 'X'",
    "            [true]",
    "              FEHLER: assignment K.R = 12; {write}",
    "            [false]",
    "    KDSET: on ON ERROR",
    "      KDSET: assignment KD.RC = 16; {write}",
    "  [CHECK]",
    "    CHECK: if IF X = 'C'",
    "      [true]",
    "        CHECK: assignment KD = ''; {write}",
    "      [false]",
  ]);
});

test("a data flow has no lane for an include whose code does nothing to the variable", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("COPY/FLOWDCL:RC:1"));
  assert.deepEqual(flow.lanes.map((l) => l.name), ["FLOWMAIN"]);
  assert.deepEqual(outline(flow).slice(0, 2), ["FLOWMAIN: if IF RC > 0 {compare}", "  [true]"]);
});

test("a variable's data flow marks where it is compared and what that leads to, and a name that is no variable has none", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow(/** @type {string} */ (graph.variableAt("SRC/KDSET", 19, "X"))));
  assert.deepEqual(outline(flow), [
    "KDSET: select Data flow of X",
    "  [KDSET]",
    "    KDSET: if IF KD.TYP = 'G'",
    "      [true]",
    "        KDSET: assignment X = 'A'; {write}",
    "      [false]",
    "        KDSET: assignment X = 'B'; {write}",
    "    KDSET: select SELECT (KD.TYP);",
    "      ['B']",
    "        KDSET: assignment X = 'C'; {write}",
    "    KDSET: loop DO WHILE (X = 'A') {compare}",
    "      KDSET: assignment X = 'B'; {write}",
    "  [CHECK]",
    "    CHECK: if IF X = 'C' {compare}",
    "      [true]",
    "        CHECK: assignment KD = ''; {outcome}",
    "      [false]",
  ]);
  assert.equal(graph.variableAt("SRC/KDSET", 22, "CHECK"), undefined);
  assert.equal(graph.pageDataFlow("SRC/KDSET:NOPE:1"), null);
});

test("a data flow follows a structure passed to a CALL into the field of the parameter in the same place", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow(/** @type {string} */ (graph.variableAt("SRC/KDSET", 3, "TYP"))));
  assert.deepEqual(outline(flow), [
    "KDSET: select Data flow of KD.TYP",
    "  [KDSET]",
    "    KDSET: if IF KD.TYP = 'G' {compare}",
    "      [true]",
    "        KDSET: assignment X = 'A'; {outcome}",
    "        KDSET: assignment RC = 4; {outcome}",
    "      [false]",
    "        KDSET: assignment X = 'B'; {outcome}",
    "    KDSET: select SELECT (KD.TYP); {compare}",
    "      ['A']",
    "        KDSET: assignment KD.RC = 8; {outcome}",
    "      ['B']",
    "        KDSET: assignment X = 'C'; {outcome}",
    "      [otherwise]",
    "        KDSET: call CALL FEHLER(KD); {arg}",
    "          FEHLER: if IF K.T = 'X' {compare}",
    "            [true]",
    "              FEHLER: assignment K.R = 12; {outcome}",
    "            [false]",
    "          FEHLER: assignment K.T = 'F'; {write}",
    "  [CHECK]",
    "    CHECK: if IF X = 'C'",
    "      [true]",
    "        CHECK: assignment KD = ''; {write}",
    "      [false]",
  ]);
  // A test in a called procedure holds only on the way the call is made.
  assert.deepEqual(flow.rules.map((r) => `${r.procedure}:${r.line} ${r.when.map((path) => path.join(" → ")).join(" | ")}`), [
    "KDSET:7 ",
    "KDSET:14 ",
    "KDSET:15 ",
    "FEHLER:28 SELECT (KD.TYP) OTHERWISE → KDSET: CALL FEHLER(KD);",
  ]);
});

test("a variable's rules are what each comparison of it leads to", () => {
  const rules = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDRUL:KD.TYP:3"));
  const outcome = (/** @type {{ text: string, guards: string[] }} */ o) => [...o.guards, o.text].join(" → ");
  assert.deepEqual(
    rules.rules.map((r) => ({ test: `${r.procedure}:${r.line} ${r.field} ${r.operator} ${r.values.join(", ")}`, condition: r.condition, then: r.then.map(outcome), else: r.else.map(outcome) })),
    [
      { test: "KDRUL:6 KD.TYP = 'G'", condition: "IF KD.TYP = 'G'", then: ["RC = 4;", "IF RC > 0 [true] → MSG = 'GESCHAEFTSKUNDE';"], else: ["RC = 0;"] },
      { test: "KDRUL:13 KD.TYP = 'A', 'B'", condition: "WHEN ('A', 'B')", then: ["CALL SPERRE;"], else: [] },
      { test: "KDRUL:16 KD.TYP ^= 'X'", condition: "IF 'X' ^= KD.TYP", then: ["RETURN;"], else: [] },
      { test: "KDRUL:17 SUBSTR(KD.TYP, 1, 1) = 'Q'", condition: "IF SUBSTR(KD.TYP, 1, 1) = 'Q'", then: ["MSG = 'QUELLE';"], else: [] },
      { test: "KDRUL:21 KD.TYP = 'Q'", condition: "IF KD.TYP = 'Q'", then: ["RC = RC + 1;"], else: [] },
    ],
  );
  assert.deepEqual(rules.rules.map((r) => r.when.map((path) => path.join(" → "))), [[], [], [], [], ["IF MSG = 'QUELLE' [true] → DO WHILE (RC < 3)"]]);
  assert.equal(graph.pageDataFlow("SRC/KDRUL:NOPE:1"), null);
});

test("an EXEC SQL sets its INTO host variables and reads the others, a WHERE use is a rule, and rules follow calls", () => {
  const exec = graph.all(
    `SELECT a.name, a.mode FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file WHERE f.path = 'SRC/KDSQL' AND s.kind = 'exec' ORDER BY a.name`,
  );
  assert.deepEqual(exec.map((a) => `${a.name} ${a.mode}`), ["CNT write", "CNT_IND write", "KEY read"]);
  const count = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDSQL:CNT:3"));
  assert.deepEqual(outline(count).map((l) => l.split("\n")[0]), ["KDSQL: exec EXEC SQL SELECT COUNT(*) INTO :CNT :CNT_IND"]);
  assert.equal(count.steps[0].access, "write");
  const key = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDSQL:KEY:2"));
  assert.deepEqual(
    key.rules.map((r) => `${r.procedure}:${r.line} ${r.condition} → ${r.then.map((o) => o.text.split("\n")[0]).join(" ")}`),
    ["KDSQL:5 SELECT KUNDE WHERE ID = :KEY → EXEC SQL SELECT COUNT(*) INTO :CNT :CNT_IND", "PRUEF:9 IF SUBSTR(K, 1, 1) = 'X' → K = 'Y';"],
  );
  assert.deepEqual(key.steps.map((s) => s.access), ["compare", "arg"]);
  assert.deepEqual(key.rules.map((r) => r.when), [[], [["KDSQL: CALL PRUEF(KEY);"]]]);
});

test("a data flow follows copies, a function's arguments into its parameters, and what a function returns", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDMOV:EIN:2"));
  assert.deepEqual(flow.lanes.map((l) => l.name), ["KDMOV", "PRUEF", "HOLE"]);
  assert.deepEqual(outline(flow), [
    "KDMOV: select Data flow of EIN",
    "  [KDMOV]",
    "    KDMOV: assignment ZWI = EIN; {write}",
    "    KDMOV: if IF ZWI = 'A' {compare}",
    "      [true]",
    "        KDMOV: assignment AUS = PRUEF(ZWI); {write}",
    "      [false]",
    "    KDMOV: assignment ERG = HOLE(); {write}",
    "    KDMOV: if IF ERG = 'J' {compare}",
    "      [true]",
    "        KDMOV: assignment MSG = 'ABGELEHNT'; {outcome}",
    "      [false]",
    "        KDMOV: assignment MSG = 'OK'; {outcome}",
    "  [PRUEF]",
    "    PRUEF: if IF P = 'A' {compare}",
    "      [true]",
    "        PRUEF: return RETURN('J'); {outcome}",
    "      [false]",
    "  [HOLE]",
    "    HOLE: return RETURN(ZWI); {read}",
  ]);
  assert.deepEqual(flow.sets.map((s) => `${s.line} ${s.text} when ${s.when.map((path) => path.join(" → ")).join(" | ")}`), [
    "7 ZWI = EIN; when ",
    "8 AUS = PRUEF(ZWI); when KDMOV: ZWI = EIN; → IF ZWI = 'A' [true]",
    "9 ERG = HOLE(); when KDMOV: ZWI = EIN;",
  ]);
  assert.deepEqual(
    flow.rules.map((r) => `${r.procedure}:${r.line} ${r.condition} when ${r.when.map((path) => path.join(" → ")).join(" | ")}`),
    [
      "KDMOV:8 IF ZWI = 'A' when KDMOV: ZWI = EIN;",
      "KDMOV:10 IF ERG = 'J' when KDMOV: ZWI = EIN; → KDMOV: ERG = HOLE();",
      "PRUEF:14 IF P = 'A' when KDMOV: ZWI = EIN; → IF ZWI = 'A' [true] → KDMOV: AUS = PRUEF(ZWI);",
    ],
  );
});

test("a variable's sets are each statement that sets it with the conditions it is under", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDMOV:MSG:6"));
  assert.deepEqual(flow.sets.map((s) => `${s.procedure}:${s.line} ${s.text} when ${s.when.map((path) => path.join(" → ")).join(" | ")}`), [
    "KDMOV:10 MSG = 'ABGELEHNT'; when IF ERG = 'J' [true]",
    "KDMOV:11 MSG = 'OK'; when IF ERG = 'J' [false]",
  ]);
  const typ = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDRUL:KD.TYP:3"));
  assert.deepEqual(typ.sets.map((s) => `${s.procedure}:${s.line} ${s.text}`), ["KDRUL:18 KD.TYP = 'Z';"]);
});

test("a copy splits the flow: what it is copied to counts from the copy on, until something else overwrites it, and an EXEC SQL INTO copies its WHERE", () => {
  const flow = /** @type {NonNullable<ReturnType<Graph["pageDataFlow"]>>} */ (graph.pageDataFlow("SRC/KDSPLIT:KEY:2"));
  assert.deepEqual(
    flow.rules.map((r) => `${r.procedure}:${r.line} ${r.condition} when ${r.when.map((path) => path.join(" → ")).join(" | ")}`),
    [
      "KDSPLIT:6 SELECT PROD.AATB0301 WHERE ID = :KEY when ",
      "KDSPLIT:7 IF CNT = 0 when KDSPLIT: EXEC SQL SELECT COUNT(*) INTO :CNT FROM PROD.AATB0301 WHERE ID = :KEY;",
      "KDSPLIT:8 IF Y > 5 when KDSPLIT: EXEC SQL SELECT COUNT(*) INTO :CNT FROM PROD.AATB0301 WHERE ID = :KEY; → IF CNT = 0 [true] → KDSPLIT: Y = CNT + 1;",
      "KDSPLIT:11 IF KEY = ' ' when ",
    ],
  );
  assert.deepEqual(outline(flow), [
    "KDSPLIT: exec EXEC SQL SELECT COUNT(*) INTO :CNT FROM PROD.AATB0301 WHERE ID = :KEY; {compare}",
    "KDSPLIT: if IF CNT = 0 {compare}",
    "  [true]",
    "    KDSPLIT: assignment Y = CNT + 1; {write}",
    "  [false]",
    "KDSPLIT: if IF Y > 5 {compare}",
    "  [true]",
    "    KDSPLIT: call CALL SPERRE; {outcome}",
    "  [false]",
    "KDSPLIT: assignment Y = 0; {write}",
    "KDSPLIT: if IF KEY = ' ' {compare}",
    "  [true]",
    "    KDSPLIT: return RETURN; {outcome}",
    "  [false]",
  ]);
  /** @type {string[]} */
  const marked = [];
  const visit = (/** @type {import("../src/graph.js").FlowStep[]} */ steps) => {
    for (const step of steps) {
      if (step.names) marked.push(`${step.line} ${step.names.join(",")}`);
      visit(step.steps ?? []);
      for (const branch of step.branches ?? []) visit(branch.steps);
    }
  };
  visit(flow.steps);
  assert.deepEqual(marked, ["6 KEY,CNT", "7 CNT", "7 CNT,Y", "8 Y", "9 Y", "11 KEY"]);
});
