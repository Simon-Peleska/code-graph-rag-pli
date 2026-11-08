import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, progressLine } from "../src/progress.ts";

test("cgr's progress lines are read, anything else is not", () => {
  assert.deepEqual(progressLine('CGR_PROGRESS {"phase": "calls", "done": 5, "total": 10}'), {
    phase: "calls",
    done: 5,
    total: 10,
  });
  assert.equal(progressLine("2026-11-08 | INFO | --- Pass 3 ---"), undefined);
  assert.equal(progressLine("CGR_PROGRESS not json"), undefined);
  assert.equal(progressLine('CGR_PROGRESS {"phase": "calls"}'), undefined);
});

test("the phases add up to one bar from 0 to 100", () => {
  const at = (phase: string, done: number, total: number) => describe({ phase, done, total });
  assert.deepEqual(at("parse", 0, 20000), { percent: 0, message: "Parsing: 0 of 20,000 files" });
  assert.equal(at("parse", 20000, 20000)?.percent, at("clear", 0, 20000)?.percent);
  assert.equal(at("clear", 20000, 20000)?.percent, at("definitions", 0, 20000)?.percent);
  assert.equal(at("clear", 5000, 20000)?.message, "Removing old entries: 5,000 of 20,000 files");
  assert.equal(at("definitions", 20000, 20000)?.percent, at("link", 0, 1)?.percent);
  assert.equal(at("link", 1, 1)?.percent, at("calls", 0, 20000)?.percent);
  assert.equal(at("link", 0, 1)?.message, "Linking definitions");
  assert.equal(at("calls", 20000, 20000)?.percent, at("write", 0, 1)?.percent);
  assert.deepEqual(at("write", 1, 1), { percent: 100, message: "Writing the graph" });
  assert.equal(at("calls", 0, 0)?.percent, at("calls", 0, 1)?.percent);
  assert.equal(at("done", 1, 1), undefined);
});
