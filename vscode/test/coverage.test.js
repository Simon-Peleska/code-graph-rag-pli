import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { coverageReport, keywordsIn, shape } from "../src/coverage.js";
import { indexed } from "./indexed.js";

const grammars = join(import.meta.dirname, "..", "grammars");
const keywords = keywordsIn(grammars);
const root = mkdtempSync(join(tmpdir(), "pli-coverage-"));
writeFileSync(
  join(root, "KDPRUEF.pli"),
  [
    "KDPRUEF: PROC OPTIONS(MAIN);",
    "  DCL KD_TYP CHAR(1);",
    "  IF KD_TYP = 'G' THEN CALL KDNIRGENDS;",
    "  KD_RABATT = 3;",
    "  ) KD_TYP KDGEHEIM ; ;",
    "END KDPRUEF;",
    "",
  ].join("\n"),
);
const db = await indexed(root);
const report = coverageReport(db, root, keywords);
const [shared, names] = report.split("## Part 2");

test("a line shape keeps keywords and masks names, numbers, strings and comments", () => {
  assert.equal(shape("  IF KD_TYP = 'G' THEN CALL X1(3); /* geheim */", keywords), "IF x = '…' THEN CALL x(9); /*…*/");
});

test("the coverage report counts what could not be read or resolved", () => {
  assert.match(shared, /\| pli \| 1 \| 0\.0 \| 1 \(100\.0 %\) \|/);
  assert.match(shared, /\| pli \| 1 \| `\) x x ; ;` \|/);
  assert.match(shared, /\| call \| 1 \| 1 \(100\.0 %\) \| 1 \|/);
  assert.match(shared, /\| write \| 1 \| 0 \(0\.0 %\) \| 1 \(100\.0 %\) \|/);
});

test("the shareable part has no names or paths, the second part has them", () => {
  for (const secret of ["KDPRUEF", "KD_TYP", "KD_RABATT", "KDNIRGENDS", "KDGEHEIM", "'G'"]) {
    assert.ok(!shared.includes(secret), `${secret} is not in part 1`);
  }
  assert.match(names, /\| KDNIRGENDS \| 1 \| KDPRUEF\.pli:3 \|/);
  assert.match(names, /\| KD_RABATT \| FIXED BIN\(15\) \| 1 \| KDPRUEF\.pli:4 \|/);
  assert.match(names, /KDPRUEF\.pli:5/);
});

test("the graph page's worker makes the coverage report", async () => {
  const worker = new Worker(join(import.meta.dirname, "..", "src", "graphpage.js"), { workerData: { graph: db.location(), root, grammars } });
  try {
    const answer = await new Promise((resolve) => {
      worker.on("message", resolve);
      worker.postMessage({ id: 1, what: "coverage", args: [] });
    });
    assert.match(answer.result, /^# PL\/I Graph coverage/);
  } finally {
    await worker.terminate();
  }
});
