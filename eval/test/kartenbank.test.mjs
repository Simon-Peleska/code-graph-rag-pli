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
  const broken = join(mkdtempSync(join(tmpdir(), "kb-broken-")), "app.py");
  writeFileSync(broken, "raise SystemExit('kaputt')\n");
  const r = check(broken);
  assert.equal(r.passed, 0);
  assert.match(r.steps.POST.errors[0], /^CHK001E .*kaputt/s);
});

test("an app that exits silently is reported with its exit status", () => {
  const silent = join(mkdtempSync(join(tmpdir(), "kb-silent-")), "app.py");
  writeFileSync(silent, "import sys\nsys.exit(1)\n");
  const r = check(silent);
  assert.match(r.steps.POST.errors[0], /^CHK001E case01\/POST crashed: exit status 1, nothing on stderr$/);
});

test("return code 4 is a warning, as on z/OS, and 8 a failure", () => {
  const app = (/** @type {number} */ code) => {
    const path = join(mkdtempSync(join(tmpdir(), "kb-rc-")), "app.py");
    writeFileSync(path, `import os, shutil, sys\nshutil.copytree(os.path.join(os.path.dirname(sys.argv[2]), "out"), sys.argv[3], dirs_exist_ok=True)\nsys.exit(${code})\n`);
    return path;
  };
  assert.equal(check(app(4)).passed, 24);
  const failed = check(app(8));
  assert.equal(failed.passed, 0);
  assert.match(failed.steps.POST.errors[0], /^CHK001E case01\/POST crashed: exit status 8, nothing on stderr$/);
});
