import assert from "node:assert/strict";
import { test } from "node:test";
import { describe } from "../src/progress.js";

test("the phases add up to one bar from 0 to 100", () => {
  assert.deepEqual(describe({ phase: "parse", done: 0, total: 20000 }), {
    percent: 0,
    message: "Reading files: 0 of 20,000",
  });
  assert.equal(describe({ phase: "parse", done: 20000, total: 20000 }).percent, describe({ phase: "link", done: 0, total: 5 }).percent);
  assert.deepEqual(describe({ phase: "link", done: 5, total: 5 }), { percent: 100, message: "Linking references" });
  assert.equal(describe({ phase: "link", done: 0, total: 0 }).percent, 85);
});
