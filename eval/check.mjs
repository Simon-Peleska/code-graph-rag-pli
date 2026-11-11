// Score a rebuilt Kartenbank application against the generated cases.
//   node check.mjs <app.py> [cases_dir]   -> prints the score as JSON
// A case step passes when every output file matches line by line
// (trailing blanks ignored). Lines are scored too, for partial credit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lines = (path) =>
  existsSync(path) ? readFileSync(path, "utf8").split("\n").map((l) => l.trimEnd()).filter((l) => l !== "") : null;

export function check(app, casesDir = join(import.meta.dirname, "kartenbank/cases"), timeout = 60_000) {
  const steps = {};
  for (const name of readdirSync(casesDir).sort()) {
    for (const step of readdirSync(join(casesDir, name)).sort()) {
      const out = mkdtempSync(join(tmpdir(), "kb-check-"));
      const expected = join(casesDir, name, step, "out");
      const s = (steps[step] ??= { cases: 0, passed: 0, lines: 0, matched: 0, errors: [] });
      s.cases++;
      let crashed = null;
      let failure = null;
      try {
        execFileSync("python3", [app, step, join(casesDir, name, step, "in"), out], { timeout, stdio: "pipe" });
      } catch (e) {
        // Return code 4 is a warning, as on z/OS: KBP00001 ends with it when it rejected a transaction.
        if (e.status !== 4) failure = e;
      }
      if (failure) {
        const said = failure.stderr?.toString().trim();
        const how = failure.signal ? `killed by ${failure.signal}${failure.signal === "SIGTERM" ? ` (over ${timeout / 1000} s)` : ""}` : `exit status ${failure.status}`;
        crashed = said ? said.split("\n").slice(-6).join("\n") : `${how}, nothing on stderr`;
        s.errors.push(`CHK001E ${name}/${step} crashed: ${crashed}`);
      }
      let ok = !crashed;
      for (const file of readdirSync(expected)) {
        const want = lines(join(expected, file));
        const got = lines(join(out, file)) ?? [];
        s.lines += want.length;
        want.forEach((l, i) => (s.matched += got[i] === l ? 1 : 0));
        if (got.length !== want.length || want.some((l, i) => got[i] !== l)) {
          ok = false;
          if (!crashed) {
            const i = want.findIndex((l, i) => got[i] !== l);
            s.errors.push(`CHK002E ${name}/${step}/${file} line ${i + 1}: want ${JSON.stringify(want[i])} got ${JSON.stringify(got[i])}`);
          }
        }
      }
      if (ok) s.passed++;
    }
  }
  const all = Object.values(steps);
  return {
    passed: all.reduce((n, s) => n + s.passed, 0),
    cases: all.reduce((n, s) => n + s.cases, 0),
    lineScore: all.reduce((n, s) => n + s.matched, 0) / all.reduce((n, s) => n + s.lines, 0),
    steps,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = check(process.argv[2], process.argv[3]);
  for (const s of Object.values(result.steps)) s.errors = s.errors.slice(0, 5);
  console.log(JSON.stringify(result, null, 2));
}
