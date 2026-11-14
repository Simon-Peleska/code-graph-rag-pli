import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { check } from "../check.mjs";

const reference = join(import.meta.dirname, "../kartenbank/reference/app.py");

test("the reference passes every case", () => {
  const r = check(reference);
  assert.equal(r.passed, r.cases, JSON.stringify(r.steps, null, 1));
  assert.equal(r.cases, 24);
});

test("an app that forgets the cash advance fee fails POST only", () => {
  const mutant = join(mkdtempSync(join(tmpdir(), "kb-mutant-")), "app.py");
  writeFileSync(mutant, readFileSync(reference, "utf8").replace('if type_code == "04":\n                fee', 'if False:\n                fee'));
  const r = check(mutant);
  assert.ok(r.steps.POST.passed < r.steps.POST.cases);
  assert.equal(r.steps.INTEREST.passed, r.steps.INTEREST.cases);
  assert.match(r.steps.POST.errors[0], /^CHK002E/);
});

test("an app that crashes is reported with its traceback", () => {
  const broken = join(mkdtempSync(join(tmpdir(), "kb-broken-")), "app.js");
  writeFileSync(broken, "throw new Error('kaputt');\n");
  const r = check(broken);
  assert.equal(r.passed, 0);
  assert.match(r.steps.POST.errors[0], /^CHK001E .*kaputt/s);
});

test("an app that exits silently is reported with its exit status", () => {
  const silent = join(mkdtempSync(join(tmpdir(), "kb-silent-")), "app.js");
  writeFileSync(silent, "process.exit(1);\n");
  const r = check(silent);
  assert.match(r.steps.POST.errors[0], /^CHK001E case01\/POST crashed: exit status 1, nothing on stderr$/);
});

test("return code 4 is a warning, as on z/OS, and 8 a failure", () => {
  const app = (/** @type {number} */ code) => {
    const path = join(mkdtempSync(join(tmpdir(), "kb-rc-")), "app.js");
    writeFileSync(path, `const { cpSync } = require("node:fs");\nconst { dirname, join } = require("node:path");\ncpSync(join(dirname(process.argv[3]), "out"), process.argv[4], { recursive: true });\nprocess.exit(${code});\n`);
    return path;
  };
  assert.equal(check(app(4)).passed, 24);
  const failed = check(app(8));
  assert.equal(failed.passed, 0);
  assert.match(failed.steps.POST.errors[0], /^CHK001E case01\/POST crashed: exit status 8, nothing on stderr$/);
});
