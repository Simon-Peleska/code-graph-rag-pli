// Does the harness help a local model understand legacy PL/I? Two arms
// document the Kartenbank batch with the same model:
//   raw      the model reads every PL/I member, copybook and JCL as they are
//   harness  the model reads the harness's checked explanations of every
//            procedure, the record layouts and the JCL
// Each arm's docs then go, alone, to the model to build app.js, which runs
// against the cases (check.mjs). A judge model scores the docs against the
// gold rules (REGELN.md).
//
//   node compare.mjs [--model gemma4:26b] [--judge gemma4:31b] [--url http://localhost:11434] [--arms raw,harness]
//
// Every stage writes its file under results/<model>/<arm>/ and is skipped when the
// file exists, so a run can be stopped and resumed; delete a file to redo it.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check } from "./check.mjs";
import { calls, client, constants, explain, layout } from "../vscode/src/harness.js";
import { indexed } from "../vscode/test/indexed.js";

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const url = option("url", "http://localhost:11434");
const model = option("model", "gemma4:26b");
const judgeModel = option("judge", "gemma4:31b");
const arms = option("arms", "raw,harness").split(",");

const here = import.meta.dirname;
const root = join(here, "kartenbank/repo");
const results = join(here, "results", model.replace(/[:/]/g, "-"));
const started = Date.now();
const log = (text) => console.log(`[${((Date.now() - started) / 60000).toFixed(1).padStart(5)} min] ${text}`);
// About 3 characters a token for this code and German text, plus room for the answer.
const contextFor = (chars, answer) => Math.min(131072, Math.ceil((chars / 3 + answer) / 4096) * 4096);

const DOCS = `You document a legacy PL/I batch system for a team that will rebuild it in JavaScript without ever seeing the source.
Write Markdown. For each job step that runs in production:
- the program, its input and output files (DD names), and every record layout with exact positions, lengths and formats (sign, implied decimal point, padding);
- the processing in order, and every business rule exactly: conditions and their order, codes, message texts, constants, calculations, rounding, sort orders;
- every output record: when it is written and the value of each field.
Say which programs, jobs and code are dead, not scheduled, or only write to the log, so nobody rebuilds them.
Only write what the material shows; say so where it is unclear.`;

const APP = `Write app.js from the documentation below. Node.js 24, an ES module using only Node's standard library, run as:
    node app.js STEP IN_DIR OUT_DIR
STEP is POST (program KBP00001), INTEREST (KBP00002) or STATEMENT (KBP00003) of job KBJ00001.
Each input file is IN_DIR/<DD name> (for example IN_DIR/ACCTFILE): one record per line, trailing blanks removed, so pad a line to its record length.
Write each output file as OUT_DIR/<DD name>, one record per line: POST writes ACCTOUT, TCATOUT, TRANOUT and REJECTS; INTEREST writes ACCTOUT and TRANOUT; STATEMENT writes ACCTOUT and STMTFILE. SYSPRINT is not needed.
Answer with the complete program in one \`\`\`javascript block.`;

const JUDGE = `You grade documentation of a batch system against the gold list of its rules, written by an expert.
For every rule id in the gold list (P-.., I-.., S-.., D-..) say whether the documentation states it:
- correct: stated completely and exactly (conditions, codes, constants, rounding as in the gold rule)
- partial: there, but vague, incomplete or with a minor error
- wrong: the documentation says something that contradicts it
- missing: not there
Then rate how understandable the documentation is for a developer who has never seen the system, 1 (useless) to 5 (clear and complete), and say why in two sentences.`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    rules: { type: "array", items: { type: "object", properties: { id: { type: "string" }, verdict: { type: "string", enum: ["correct", "partial", "wrong", "missing"] }, note: { type: "string" } }, required: ["id", "verdict", "note"] } },
    understandability: { type: "integer" },
    why: { type: "string" },
  },
  required: ["rules", "understandability", "why"],
};

const read = (path) => readFileSync(path, "latin1");
const files = (folder) => readdirSync(join(root, folder)).sort().map((name) => ({ name: `${folder}/${name}`, text: read(join(root, folder, name)) }));
const javascript = (reply) => (/```(?:javascript|js|mjs)\n([^]*?)```/.exec(reply) ?? /```\n([^]*?)```/.exec(reply))?.[1] ?? reply;
const timed = async (label, work) => {
  const at = Date.now();
  const value = await work();
  log(`${label}: ${((Date.now() - at) / 1000).toFixed(0)} s`);
  return value;
};

const db = await indexed(root);
const gold = read(join(here, "kartenbank/reference/REGELN.md"));
const goldIds = [...gold.matchAll(/^(?:\| |- )([PISD]-\d\d)/gm)].map((m) => m[1]);
log(`model ${model}, judge ${judgeModel}, arms ${arms.join(", ")}, ${goldIds.length} gold rules`);

/** The material the docs are written from. */
async function material(arm) {
  if (arm === "raw") {
    return [...files("JCL"), ...files("PLI"), ...files("INCLUDE")].map((f) => `# ${f.name}\n${f.text}`).join("\n\n");
  }
  const explained = await explain(db, root, {
    ask: client({ url, model, contextTokens: 24576 }), model, cache: join(here, "results", "cache"), log,
  });
  const parts = ["# Jobs (JCL as written)", ...files("JCL").map((f) => `## ${f.name}\n${f.text}`)];
  const structures = db.prepare(
    `SELECT v.id, v.name, f.member FROM variables v JOIN files f ON f.id = v.file
     WHERE v.level = 1 AND v.type = 'STRUCTURE' AND f.path LIKE 'INCLUDE/%' ORDER BY f.member, v.line`).all();
  parts.push("# Record layouts of the copybooks (positions from 1)",
    ...structures.map((s) => layout(db, Number(s.id)) && `${s.member}: ${layout(db, Number(s.id))}`).filter(Boolean));
  parts.push("# Named constants (initialized, never assigned)\n" + constants(db).join("\n"));
  // Which JCL steps reach each procedure, through calls from the program the step runs.
  const owner = new Map(db.prepare("SELECT id, parent FROM symbols WHERE detail LIKE 'ENTRY%'").all().map((r) => [Number(r.id), Number(r.parent)]));
  const unitOf = (id) => owner.get(id) ?? id;
  const callees = new Map();
  for (const r of db.prepare(
    `SELECT r.caller, l.target_symbol FROM refs r JOIN links l ON l.ref = r.id
     WHERE r.kind IN ('call', 'invoke', 'fetch') AND r.caller IS NOT NULL AND l.target_symbol IS NOT NULL`).all()) {
    const from = unitOf(Number(r.caller));
    callees.set(from, [...(callees.get(from) ?? []), unitOf(Number(r.target_symbol))]);
  }
  const reachedBy = new Map();
  for (const step of db.prepare(
    `SELECT j.name AS job, st.name AS step, s.id FROM steps st JOIN symbols j ON j.id = st.job
     JOIN symbols s ON s.name = st.program AND s.kind = 'procedure' AND s.parent IS NULL`).all()) {
    const label = `job ${step.job} ${step.step}`;
    const todo = [Number(step.id)];
    while (todo.length) {
      const id = todo.pop();
      if (reachedBy.get(id)?.includes(label)) continue;
      reachedBy.set(id, [...(reachedBy.get(id) ?? []), label]);
      todo.push(...(callees.get(id) ?? []));
    }
  }
  parts.push("# Procedures, callees before their callers (explained one at a time; claims checked against the code)");
  for (const { unit, answer, errors } of explained) {
    const runs = reachedBy.get(unit.id);
    const head = `## ${unit.name} in ${unit.member}, lines ${unit.line}-${unit.end_line}\n${runs ? `Runs in: ${runs.join(", ")}` : "Runs in: no JCL step reaches it (never called)"}`;
    if (!answer) { parts.push(`${head}\nNot explained: ${errors[0]}`); continue; }
    const called = calls(db, root, unit);
    parts.push([head, answer.summary,
      `Inputs: ${answer.inputs.join("; ") || "-"}`, `Outputs: ${answer.outputs.join("; ") || "-"}`,
      ...answer.rules.map((r) => `- ${r.text} (lines ${r.lines.join(", ")}${r.fields.length ? `; fields ${r.fields.join(", ")}` : ""}${r.values.length ? `; values ${r.values.join(", ")}` : ""})`),
      ...(called.length ? ["Calls as written:", ...called] : []),
      ...(errors.length ? [`Not backed by the code, treat with care: ${errors.join("; ")}`] : [])].join("\n"));
  }
  return parts.join("\n\n");
}

const report = [];
for (const arm of arms) {
  const dir = join(results, arm);
  mkdirSync(dir, { recursive: true });
  const at = (name) => join(dir, name);
  const times = existsSync(at("times.json")) ? JSON.parse(read(at("times.json"))) : {};
  const stage = async (name, file, work) => {
    if (existsSync(at(file))) return read(at(file));
    const t = Date.now();
    const text = await timed(`${arm} ${name}`, work);
    times[name] = Math.round((Date.now() - t) / 1000);
    writeFileSync(at("times.json"), JSON.stringify(times, null, 2));
    writeFileSync(at(file), text);
    return text;
  };

  const context = await stage("material", "context.md", () => material(arm));
  log(`${arm}: material ${context.length} characters`);

  const docs = await stage("docs", "docs.md", () =>
    client({ url, model, schema: null, contextTokens: contextFor(context.length, 12000), maxTokens: 12000 })(
      [{ role: "system", content: DOCS }, { role: "user", content: context }]));

  const appMessages = [{ role: "system", content: "You write JavaScript programs from documentation." }, { role: "user", content: `${APP}\n\n# Documentation\n\n${docs}` }];
  const appClient = client({ url, model, schema: null, contextTokens: contextFor(docs.length, 16000), maxTokens: 14000 });
  const first = await stage("app", "app.first.js", async () => javascript(await appClient(appMessages)));
  let score = existsSync(at("check.first.json")) ? JSON.parse(read(at("check.first.json"))) : check(at("app.first.js"));
  writeFileSync(at("check.first.json"), JSON.stringify(score, null, 2));
  const crash = Object.values(score.steps).flatMap((s) => s.errors).find((e) => e.startsWith("CHK001E"));

  if (crash) {
    log(`${arm}: app crashed, one repair round`);
    const repairClient = client({ url, model, schema: null, contextTokens: contextFor(docs.length + first.length + crash.length, 16000), maxTokens: 14000 });
    await stage("repair", "app.js", async () => javascript(await repairClient([...appMessages,
      { role: "assistant", content: "```javascript\n" + first + "```" },
      { role: "user", content: `It crashed:\n${crash}\nAnswer with the complete fixed program in one \`\`\`javascript block.` }])));
    score = check(at("app.js"));
  } else if (!existsSync(at("app.js"))) {
    writeFileSync(at("app.js"), first);
  }
  writeFileSync(at("check.json"), JSON.stringify(score, null, 2));
  log(`${arm}: ${score.passed}/${score.cases} case steps pass, ${(score.lineScore * 100).toFixed(1)} % of lines`);

  const judged = JSON.parse(await stage("judge", "judge.json", () =>
    client({ url, model: judgeModel, schema: JUDGE_SCHEMA, contextTokens: contextFor(gold.length + docs.length, 6000), maxTokens: 6000 })(
      [{ role: "system", content: JUDGE }, { role: "user", content: `# Gold rules\n\n${gold}\n\n# Documentation\n\n${docs}` }])));
  const verdicts = Object.fromEntries(goldIds.map((id) => [id, judged.rules.find((r) => r.id === id)?.verdict ?? "missing"]));
  const count = (v) => Object.values(verdicts).filter((x) => x === v).length;
  report.push({ arm, score, verdicts, count, judged, times, context: context.length, docs: docs.length, repaired: Boolean(crash) });
}

const perStep = (s) => Object.entries(s.steps).map(([step, x]) => `${step} ${x.passed}/${x.cases}`).join(", ");
const lines = [
  `# Kartenbank: ${arms.join(" vs ")}`, "",
  `Model ${model} (docs and app), judge ${judgeModel}, ${new Date().toISOString().slice(0, 16)}.`, "",
  `| | ${report.map((r) => r.arm).join(" | ")} |`, `|---|${report.map(() => "---").join("|")}|`,
  `| material (characters) | ${report.map((r) => r.context).join(" | ")} |`,
  `| docs (characters) | ${report.map((r) => r.docs).join(" | ")} |`,
  `| app: case steps passed | ${report.map((r) => `${r.score.passed}/${r.score.cases} (${perStep(r.score)})`).join(" | ")} |`,
  `| app: output lines right | ${report.map((r) => `${(r.score.lineScore * 100).toFixed(1)} %`).join(" | ")} |`,
  `| app needed the repair round | ${report.map((r) => (r.repaired ? "yes" : "no")).join(" | ")} |`,
  ...["correct", "partial", "wrong", "missing"].map((v) => `| gold rules ${v} | ${report.map((r) => `${r.count(v)}/${goldIds.length}`).join(" | ")} |`),
  `| understandability (1-5) | ${report.map((r) => r.judged.understandability).join(" | ")} |`,
  `| minutes (material, docs, app, judge) | ${report.map((r) => ["material", "docs", "app", "judge"].map((k) => ((r.times[k] ?? 0) / 60).toFixed(0)).join(", ")).join(" | ")} |`,
  "", "## Rule by rule", "", `| rule | ${report.map((r) => r.arm).join(" | ")} |`, `|---|${report.map(() => "---").join("|")}|`,
  ...goldIds.map((id) => `| ${id} | ${report.map((r) => r.verdicts[id]).join(" | ")} |`),
  "", "## The judge on understandability", "", ...report.map((r) => `- ${r.arm}: ${r.judged.why}`),
  "", "## First failures of each app", "",
  ...report.flatMap((r) => [`### ${r.arm}`, "", ...Object.values(r.score.steps).flatMap((s) => s.errors.slice(0, 2)).map((e) => `- \`${e.replace(/\n/g, " ").slice(0, 300)}\``), ""]),
];
writeFileSync(join(results, "report.md"), lines.join("\n"));
log(`report in ${join(results, "report.md")}`);
