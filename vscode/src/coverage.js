// How much of the code the graph understood: what the grammars could not
// read, which names resolve to nothing, which facts came out incomplete.
// The first part has only counts and line shapes (keywords kept, names,
// numbers and strings masked), so it can leave the company; the second has
// names and paths to fix things with.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The keywords of the grammars, from the quoted words of their highlights
 * queries in `dir`: the only words a line shape keeps.
 * @param {string} dir
 * @returns {Set<string>}
 */
export function keywordsIn(dir) {
  const keywords = new Set();
  for (const name of readdirSync(dir).filter((name) => name.endsWith("-highlights.scm"))) {
    for (const [, word] of readFileSync(join(dir, name), "utf-8").matchAll(/"([A-Za-z][\w-]*)"/g)) {
      keywords.add(word.toUpperCase());
    }
  }
  return keywords;
}

/**
 * A line with only its keywords and punctuation left.
 * `IF KD_TYP = 'G' THEN CALL X1(3);` → `IF x = '…' THEN CALL x(9);`
 * @param {string} line
 * @param {Set<string>} keywords
 */
export function shape(line, keywords) {
  return line
    .slice(0, 72)
    .replace(/\/\*.*?(\*\/|$)/g, "/*…*/")
    .replace(/'(?:[^']|'')*'?|"[^"]*"?/g, "'…'")
    .replace(/[A-Za-z_@#$][\w@#$-]*/g, (word) => (keywords.has(word.toUpperCase()) ? word.toUpperCase() : "x"))
    .replace(/\d+/g, "9")
    .replace(/\s+/g, " ")
    .trim();
}

// What a reference kind's unresolved names usually are, when that is no fault.
const EXPECTED = {
  screen: "string literals tried as screen names: most are other text",
  psb: "missing when the PSB gens are not in the folder",
  program: "system and vendor programs (IEBGENER, DFSRRC00, ...) are not in the repository",
};

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root the folder the paths are relative to
 * @param {Set<string>} keywords see keywordsIn
 * @returns {string} Markdown
 */
export function coverageReport(db, root, keywords) {
  /** @param {string} sql @param {...any} params @returns {any[]} */
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  /** @param {number} part @param {number} whole */
  const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)} %` : "-");
  /** @param {string[]} head @param {unknown[][]} rows */
  const table = (head, rows) =>
    rows.length
      ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replaceAll("|", "\\|")).join(" | ")} |`)].join("\n")
      : "(none)";
  const pathOf = new Map(all("SELECT id, path FROM files").map((row) => [row.id, row.path]));
  /** @param {{ file: number, line: number }} row */
  const at = (row) => `${pathOf.get(row.file)}:${row.line}`;

  const share = [];
  const mine = [];

  const indexerVersion = all("SELECT value FROM meta WHERE name = 'indexer_version'")[0]?.value;
  share.push(`# PL/I Graph coverage\n\nMade ${new Date().toISOString().slice(0, 16).replace("T", " ")}, indexer version ${indexerVersion}.`);
  share.push(
    "## Part 1: counts and shapes\n\nNo names, paths or code: a line shape keeps the grammars' keywords and turns every other word into `x`, every number into `9` and every string into `'…'`.",
  );

  const languages = all(
    `SELECT language, count(*) AS files, total(size) AS bytes, total(syntax_errors > 0) AS broken, total(syntax_errors) AS errors,
            total(failure IS NOT NULL) AS failed
     FROM files GROUP BY language ORDER BY files DESC`,
  );
  share.push(
    "### Files\n\n" +
      table(
        ["language", "files", "MB", "files with syntax errors", "syntax errors", "failed to read"],
        languages.map((l) => [l.language, l.files, (l.bytes / 1e6).toFixed(1), `${l.broken} (${percent(l.broken, l.files)})`, l.errors, l.failed]),
      ),
  );

  // The first line the grammar could not read, of up to 3000 files.
  const broken = all("SELECT id AS file, path, language, syntax_errors AS errors, error_line AS line FROM files WHERE syntax_errors > 0 ORDER BY syntax_errors DESC");
  /** @type {Map<string, { language: string, count: number, example: string }>} */
  const shapes = new Map();
  for (const file of broken.slice(0, 3000)) {
    let line;
    try {
      line = readFileSync(join(root, file.path), "utf-8").split("\n")[file.line - 1] ?? "";
    } catch {
      continue;
    }
    const key = `${file.language}\t${shape(line, keywords)}`;
    const known = shapes.get(key);
    if (known) known.count++;
    else shapes.set(key, { language: file.language, count: 1, example: `${file.path}:${file.line}` });
  }
  const commonShapes = [...shapes].sort((a, b) => b[1].count - a[1].count).slice(0, 40);
  share.push(
    `### Lines the grammars could not read\n\nThe first one of each file, by shape${broken.length > 3000 ? ` (of the 3000 files with the most errors)` : ""}.\n\n` +
      table(["language", "files", "shape"], commonShapes.map(([key, s]) => [s.language, s.count, `\`${key.split("\t")[1]}\``])),
  );

  const failures = all("SELECT failure FROM files WHERE failure IS NOT NULL");
  /** @type {Map<string, number>} */
  const failureKinds = new Map();
  for (const { failure } of failures) {
    const first = String(failure).split("\n")[0].replaceAll(root, "<root>").replace(/'[^']*'|"[^"]*"/g, "'…'").replace(/\d+/g, "9");
    failureKinds.set(first, (failureKinds.get(first) ?? 0) + 1);
  }
  share.push(
    "### Files the indexer failed on (PLG022E)\n\n" +
      table(["files", "error"], [...failureKinds].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([text, count]) => [count, `\`${text}\``])),
  );

  const refTotals = all("SELECT kind, count(*) AS n FROM refs GROUP BY kind ORDER BY n DESC");
  const unresolved = all(
    `SELECT r.kind, r.name, count(*) AS n, r.file, r.line, min(r.id)
     FROM refs r WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.ref = r.id)
     GROUP BY r.kind, r.name ORDER BY n DESC`,
  );
  share.push(
    "### References\n\nA reference is resolved when the definition it names is in the graph.\n\n" +
      table(
        ["kind", "references", "unresolved", "distinct unresolved names", "note"],
        refTotals.map((t) => {
          const names = unresolved.filter((u) => u.kind === t.kind);
          const count = names.reduce((sum, u) => sum + u.n, 0);
          return [t.kind, t.n, `${count} (${percent(count, t.n)})`, names.length, EXPECTED[/** @type {keyof EXPECTED} */ (t.kind)] ?? ""];
        }),
      ),
  );

  const accesses = all("SELECT mode, count(*) AS n, total(variable IS NULL) AS unresolved FROM accesses GROUP BY mode ORDER BY n DESC");
  share.push(
    "### Field accesses\n\nResolved when the field is found among the declarations in scope, includes and `LIKE` counted.\n\n" +
      table(["mode", "accesses", "unresolved"], accesses.map((a) => [a.mode, a.n, `${a.unresolved} (${percent(a.unresolved, a.n)})`])),
  );

  const statements = all("SELECT kind, count(*) AS n FROM statements GROUP BY kind ORDER BY n DESC");
  share.push("### Statements by kind\n\n" + table(["kind", "statements"], statements.map((s) => [s.kind, s.n])));

  const variables = all("SELECT count(*) AS n, total(type IS NULL) AS untyped FROM variables")[0];
  const untypedShapes = new Map();
  for (const { attributes } of all("SELECT attributes FROM variables WHERE type IS NULL AND level <= 1 AND attributes != '' LIMIT 20000")) {
    const key = shape(attributes, keywords);
    untypedShapes.set(key, (untypedShapes.get(key) ?? 0) + 1);
  }
  share.push(
    `### Declarations\n\n${variables.n} variables and fields, ${variables.untyped} (${percent(variables.untyped, variables.n)}) without a type (structures have none). Attributes of the untyped ones that are no structure, by shape:\n\n` +
      table(["variables", "attributes"], [...untypedShapes].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([text, count]) => [count, `\`${text}\``])),
  );

  const dli = all(
    `SELECT entry, count(*) AS n, total(function IS NULL) AS no_function, total(segment IS NULL) AS no_segment, total(pcb_parameter IS NULL) AS no_pcb
     FROM dli_calls GROUP BY entry`,
  );
  share.push(
    "### DL/I calls\n\n" +
      table(
        ["entry", "calls", "function unknown", "segment unknown", "PCB unknown"],
        dli.map((d) => [d.entry, d.n, `${d.no_function} (${percent(d.no_function, d.n)})`, `${d.no_segment} (${percent(d.no_segment, d.n)})`, `${d.no_pcb} (${percent(d.no_pcb, d.n)})`]),
      ),
  );

  const sql = all(
    `SELECT usage, count(*) AS n, total(table_name IS NULL) AS no_table, total(column_name IS NULL AND expression IS NULL) AS no_column,
            total(expression IS NOT NULL) AS expressions, total(host IS NOT NULL) AS host
     FROM sql_columns GROUP BY usage ORDER BY n DESC`,
  );
  share.push(
    "### Embedded SQL columns\n\n" +
      table(["usage", "columns", "table unknown", "column unknown", "expressions (COUNT(*), ...)", "with host variable"], sql.map((s) => [s.usage, s.n, s.no_table, s.no_column, s.expressions, s.host])),
  );

  const steps = all("SELECT count(*) AS n, total(program IS NULL AND procedure IS NULL) AS runs_nothing, total(psb IS NOT NULL) AS psb FROM steps")[0];
  const dds = all("SELECT count(*) AS n, total(dsn IS NULL) AS no_dsn FROM dds")[0];
  const io = all("SELECT count(*) AS n, total(record IS NULL AND operation IN ('read', 'write', 'rewrite', 'locate')) AS no_record FROM file_io")[0];
  const mfs = all("SELECT count(*) AS n, total(kind = 'dfld') AS dflds, total(kind = 'dfld' AND label IS NULL AND literal IS NULL) AS unlabeled FROM mfs_fields")[0];
  const pcbs = all("SELECT count(*) AS n, total(dbd IS NULL AND type = 'DB') AS no_dbd FROM pcbs")[0];
  share.push(
    "### Other facts\n\n" +
      table(
        ["fact", "rows", "incomplete"],
        [
          ["JCL steps", steps.n, `${steps.runs_nothing} run no known program or procedure; ${steps.psb} name a PSB`],
          ["JCL DDs", dds.n, `${dds.no_dsn} without a dataset (SYSOUT, DUMMY, in-stream, ...)`],
          ["PL/I record I/O", io.n, `${io.no_record} reads and writes without a record`],
          ["MFS fields", mfs.n, `${mfs.unlabeled} of ${mfs.dflds} DFLDs without a label or literal`],
          ["PSB PCBs", pcbs.n, `${pcbs.no_dbd} DB PCBs without a DBD`],
        ],
      ),
  );

  mine.push("## Part 2: names and places\n\nFor fixing things at work: this part has names and paths from the code.");

  mine.push(
    "### Files with the most syntax errors\n\n" + table(["errors", "first at"], broken.slice(0, 30).map((f) => [f.errors, `${f.path}:${f.line}`])),
  );
  mine.push(
    "### Lines the grammars could not read, by shape, with an example\n\n" +
      table(["files", "shape", "example"], commonShapes.map(([key, s]) => [s.count, `\`${key.split("\t")[1]}\``, s.example])),
  );
  const failedFiles = all("SELECT path, failure FROM files WHERE failure IS NOT NULL LIMIT 30");
  mine.push("### Files the indexer failed on\n\n" + table(["file", "error"], failedFiles.map((f) => [f.path, String(f.failure).split("\n")[0]])));

  for (const { kind } of refTotals) {
    const names = unresolved.filter((u) => u.kind === kind && kind !== "screen").slice(0, 30);
    if (names.length) {
      mine.push(`### Unresolved ${kind} references, most frequent\n\n` + table(["name", "references", "example"], names.map((u) => [u.name, u.n, at(u)])));
    }
  }

  const unresolvedFields = all(
    `SELECT a.name, count(*) AS n, s.file, s.line, min(a.id)
     FROM accesses a JOIN statements s ON s.id = a.statement
     WHERE a.variable IS NULL GROUP BY a.name ORDER BY n DESC LIMIT 40`,
  );
  mine.push("### Unresolved field accesses, most frequent\n\n" + table(["name", "accesses", "example"], unresolvedFields.map((u) => [u.name, u.n, at(u)])));

  const vagueDli = all("SELECT file, line, entry, arguments FROM dli_calls WHERE function IS NULL OR segment IS NULL LIMIT 30");
  mine.push("### DL/I calls with an unknown function or segment\n\n" + table(["call", "arguments", "at"], vagueDli.map((d) => [d.entry, d.arguments, at(d)])));

  return [...share, ...mine].join("\n\n") + "\n";
}
