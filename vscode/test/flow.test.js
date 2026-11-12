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
      lines.push(`${indent}${flow.lanes[step.lane].name}: ${step.kind} ${step.text}${step.call && step.call !== "expanded" ? ` (${step.call})` : ""}`);
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
