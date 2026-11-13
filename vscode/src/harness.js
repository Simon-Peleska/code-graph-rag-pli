// The analysis harness: explains every PL/I procedure with a language
// model, bottom-up over the call graph. Each procedure gets a context pack
// (its source with line numbers plus the facts the graph knows for certain),
// the model answers in a fixed JSON shape, and every line, field and value
// the answer names is checked against the graph before it is kept.
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blankMargins, bytes } from "./source.js";

export const PROMPT_VERSION = 1;

export const INSTRUCTIONS = `You explain one procedure of a legacy PL/I batch system to a domain expert who will rebuild it.
Answer with JSON only, in this shape:
{"summary": "...", "inputs": ["..."], "outputs": ["..."], "rules": [{"text": "...", "lines": [123], "fields": ["NAME"], "values": ["'Y'", "25.00"]}]}
- summary: what the procedure does for the business, in 1-3 plain sentences, not a retelling of the code.
- inputs/outputs: files, records, fields and parameters it reads and changes.
- rules: every business rule: a check, a calculation, a code and its meaning, an ordering, a limit. Be exact: operators, constants, rounding, which record field (with its positions when the layout is given).
- lines: the source line numbers the rule is in. fields: the declared names it uses. values: the literal constants it uses, as written in the code.
- Say so in a rule when code is dead, never runs, or only writes to the log. Do not invent anything the source and facts do not show.`;

/** The JSON schema the model's answer must follow. */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    inputs: { type: "array", items: { type: "string" } },
    outputs: { type: "array", items: { type: "string" } },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          lines: { type: "array", items: { type: "integer" } },
          fields: { type: "array", items: { type: "string" } },
          values: { type: "array", items: { type: "string" } },
        },
        required: ["text", "lines", "fields", "values"],
      },
    },
  },
  required: ["summary", "inputs", "outputs", "rules"],
};

/**
 * @typedef {object} Unit a procedure explained on its own; its ENTRY points belong to it
 * @property {number} id
 * @property {string} name
 * @property {string} path
 * @property {string} member
 * @property {number} file
 * @property {number | null} parent
 * @property {number} line
 * @property {number} end_line
 * @property {string | null} comment
 *
 * @typedef {object} Rule
 * @property {string} text
 * @property {number[]} lines
 * @property {string[]} fields
 * @property {string[]} values
 *
 * @typedef {object} Answer
 * @property {string} summary
 * @property {string[]} inputs
 * @property {string[]} outputs
 * @property {Rule[]} rules
 *
 * @typedef {(messages: { role: string, content: string }[]) => Promise<string>} Ask
 */

/**
 * Every procedure that is not an ENTRY point, callees before their callers,
 * so a caller's pack can carry its callees' summaries.
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {Unit[]}
 */
export function units(db) {
  const all = /** @type {Unit[]} */ (/** @type {unknown} */ (db.prepare(
    `SELECT s.id, s.name, s.file, s.parent, s.line, s.end_line, s.comment, f.path, f.member
     FROM symbols s JOIN files f ON f.id = s.file
     WHERE s.kind = 'procedure' AND (s.detail IS NULL OR s.detail NOT LIKE 'ENTRY%')
     ORDER BY f.path, s.line`).all()));
  const byId = new Map(all.map((u) => [u.id, u]));
  const entryOwner = new Map(/** @type {[number, number][]} */ (db.prepare(
    "SELECT id, parent FROM symbols WHERE kind = 'procedure' AND detail LIKE 'ENTRY%'").all().map((r) => [r.id, r.parent])));
  /** @param {number} id */
  const unitOf = (id) => entryOwner.get(id) ?? id;
  /** @type {Map<number, Set<number>>} */
  const callees = new Map();
  for (const row of db.prepare(
    `SELECT r.caller, l.target_symbol FROM refs r JOIN links l ON l.ref = r.id
     WHERE r.kind IN ('call', 'invoke', 'fetch') AND r.caller IS NOT NULL AND l.target_symbol IS NOT NULL`).all()) {
    const from = unitOf(Number(row.caller));
    const to = unitOf(Number(row.target_symbol));
    if (from === to || !byId.has(to)) continue;
    const set = callees.get(from) ?? new Set();
    set.add(to);
    callees.set(from, set);
  }
  /** @type {Unit[]} */
  const order = [];
  const seen = new Set();
  /** @param {Unit} unit */
  const visit = (unit) => {
    if (seen.has(unit.id)) return;
    seen.add(unit.id);
    for (const id of callees.get(unit.id) ?? []) visit(/** @type {Unit} */ (byId.get(id)));
    // Nested procedures before the procedure they sit in, which shows only their summary.
    for (const child of all) if (child.parent === unit.id) visit(child);
    order.push(unit);
  };
  for (const unit of all) visit(unit);
  return order;
}

/**
 * The line ranges of a unit's own code: its lines without its nested
 * procedures, which are explained on their own.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {Unit} unit
 */
function ownRanges(db, unit) {
  const nested = /** @type {{ name: string, line: number, end_line: number }[]} */ (/** @type {unknown} */ (db.prepare(
    `SELECT name, line, end_line FROM symbols
     WHERE parent = ? AND kind = 'procedure' AND (detail IS NULL OR detail NOT LIKE 'ENTRY%') ORDER BY line`).all(unit.id)));
  return { nested, own: (/** @type {number} */ line) => line >= unit.line && line <= unit.end_line && !nested.some((n) => line >= n.line && line <= n.end_line) };
}

/** A source line without the sequence number of fixed format (columns 73-80). @param {string} line */
const code = (line) => (line.length > 72 && /^\s*\d*\s*$/.test(line.slice(72)) ? line.slice(0, 72) : line).trimEnd();

/**
 * The positions of each field of a level-1 structure as it lies in a record,
 * when every field's length is known and nothing repeats.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {number} structure
 * @returns {string | undefined}
 */
export function layout(db, structure) {
  const rows = /** @type {{ id: number, parent: number | null, level: number, name: string, type: string | null, size: string | null, dims: string | null, attributes: string, comment: string | null }[]} */ (
    /** @type {unknown} */ (db.prepare(
      `WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT v.id FROM variables v JOIN tree ON v.parent = tree.id)
       SELECT v.id, v.parent, v.level, v.name, v.type, v.size, v.dims, v.attributes, v.comment
       FROM variables v JOIN tree ON tree.id = v.id ORDER BY v.line`).all(structure)));
  let at = 1;
  const lines = [];
  for (const row of rows.slice(1)) {
    if (row.dims) return undefined;
    if (row.type === "STRUCTURE") continue;
    const length = bytes(row);
    if (!length) return undefined;
    lines.push(`  ${String(at).padStart(4)}-${String(at + length - 1).padEnd(4)} ${row.name.padEnd(14)} ${row.attributes}${row.comment ? `  /* ${row.comment} */` : ""}`);
    at += length;
  }
  return lines.length ? `${rows[0].name} (record length ${at - 1}):\n${lines.join("\n")}` : undefined;
}

/**
 * Everything the model gets for one procedure: its source with line
 * numbers, the declarations of what it touches, record layouts, files and
 * their JCL datasets, decisions, and the summaries of what it calls.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {Unit} unit
 * @param {Map<number, Answer>} summaries
 * @returns {string}
 */
export function pack(db, root, unit, summaries) {
  const { nested, own } = ownRanges(db, unit);
  const ids = [unit.id, ...db.prepare("SELECT id FROM symbols WHERE parent = ? AND detail LIKE 'ENTRY%'").all(unit.id).map((r) => Number(r.id))];
  const callers = `(${ids.join(",")})`;
  const parts = [];

  const parent = unit.parent === null ? undefined : /** @type {{ name: string } | undefined} */ (db.prepare("SELECT name FROM symbols WHERE id = ?").get(unit.parent));
  parts.push(`# Procedure ${unit.name} in member ${unit.member}, lines ${unit.line}-${unit.end_line}${parent ? `, nested in ${parent.name}` : ""}`);
  if (unit.comment) parts.push(`Comment before it: ${unit.comment}`);

  const source = blankMargins(readFileSync(join(root, unit.path), "latin1"), "pli").split(/\r?\n/);
  const listing = [];
  for (let line = unit.line; line <= unit.end_line; line++) {
    const inside = nested.find((n) => n.line === line);
    if (inside) listing.push(`      (nested procedure ${inside.name}, lines ${inside.line}-${inside.end_line}: see called procedures)`);
    if (own(line)) listing.push(`${String(line).padStart(5)}  ${code(source[line - 1] ?? "")}`);
  }
  parts.push("## Source\n" + listing.join("\n"));

  const used = /** @type {{ id: number, parent: number | null, qualified: string, attributes: string, init: string | null, storage: string | null, base: string | null, external: number, comment: string | null, member: string, line: number, modes: string }[]} */ (
    /** @type {unknown} */ (db.prepare(
      `SELECT v.id, v.parent, v.qualified, v.attributes, v.init, v.storage, v.base, v.external, v.comment, f.member, v.line,
              group_concat(DISTINCT a.mode) AS modes
       FROM accesses a JOIN statements s ON s.id = a.statement JOIN variables v ON v.id = a.variable JOIN files f ON f.id = v.file
       WHERE s.caller IN ${callers} GROUP BY v.id ORDER BY v.qualified`).all()));
  if (used.length) {
    parts.push("## Declarations of the data it uses\n" + used.map((v) => {
      const extra = [v.init && !v.attributes.includes("INIT") ? `INIT(${v.init})` : "", v.external && !v.attributes.includes("EXTERNAL") ? "EXTERNAL" : "", v.storage === "DEFINED" ? `DEFINED(${v.base})` : ""].filter(Boolean);
      return `- ${v.qualified}: ${[v.attributes, ...extra].join(" ")}${v.comment ? `  /* ${v.comment.slice(0, 160)} */` : ""} [${v.modes}; ${v.member}:${v.line}]`;
    }).join("\n"));
    const parentOf = db.prepare("SELECT parent FROM variables WHERE id = ?");
    const tops = new Set();
    for (const v of used) {
      let top = v.id;
      for (let up = v.parent; up !== null; up = /** @type {{ parent: number | null }} */ (parentOf.get(up)).parent) top = up;
      tops.add(top);
    }
    const layouts = [...tops].map((top) => layout(db, top)).filter(Boolean);
    if (layouts.length) parts.push("## Record layouts (positions from 1, as in SUBSTR)\n" + layouts.join("\n\n"));
  }

  const io = db.prepare(`SELECT operation, name, record, key, line FROM file_io WHERE caller IN ${callers} ORDER BY line`).all();
  if (io.length) {
    const program = unit.parent === null ? unit.member : /** @type {{ member: string }} */ (db.prepare("SELECT member FROM files WHERE id = ?").get(unit.file)).member;
    const dds = db.prepare(
      `SELECT j.name AS job, st.name AS step, d.name, d.dsn, d.disp FROM dds d JOIN steps st ON st.id = d.step LEFT JOIN symbols j ON j.id = st.job
       WHERE st.program = ? ORDER BY j.name, st.line, d.line`).all(program);
    parts.push("## File I/O\n" + io.map((r) => `- line ${r.line}: ${r.operation} ${r.name}${r.record ? ` record ${r.record}` : ""}${r.key ? ` key ${r.key}` : ""}`).join("\n")
      + (dds.length ? `\nJCL running ${program}:\n` + dds.map((d) => `- job ${d.job} step ${d.step}: DD ${d.name} DSN=${d.dsn ?? ""} DISP=${d.disp ?? ""}`).join("\n") : ""));
  }

  const decisions = db.prepare(
    `SELECT s.line, c.left, c.operator, c.right FROM comparisons c JOIN statements s ON s.id = c.statement
     WHERE s.caller IN ${callers} ORDER BY s.line`).all();
  if (decisions.length) parts.push("## Comparisons\n" + decisions.map((c) => `- line ${c.line}: ${c.left} ${c.operator} ${c.right}`).join("\n"));

  const calls = /** @type {{ name: string, line: number, target: number | null, owner: number | null, member: string | null }[]} */ (/** @type {unknown} */ (db.prepare(
    `SELECT r.name, MIN(r.line) AS line, l.target_symbol AS target, t.parent AS owner, tf.member
     FROM refs r LEFT JOIN links l ON l.ref = r.id LEFT JOIN symbols t ON t.id = l.target_symbol LEFT JOIN files tf ON tf.id = t.file
     WHERE r.caller IN ${callers} AND r.kind IN ('call', 'invoke', 'fetch') AND (r.kind <> 'invoke' OR l.target_symbol IS NOT NULL)
     GROUP BY r.name ORDER BY line`).all()));
  if (calls.length) {
    parts.push("## Called procedures\n" + calls.map((c) => {
      const answer = c.target === null ? undefined : summaries.get(c.target) ?? (c.owner === null ? undefined : summaries.get(c.owner));
      if (c.target === null) return `- ${c.name} (line ${c.line}): external, source not available`;
      return `- ${c.name} in ${c.member} (line ${c.line}): ${answer ? answer.summary : "not explained yet"}`;
    }).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * The named constants: variables with an INIT value that no statement writes.
 * An explanation of the code that uses them names them, not their values.
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {string[]}
 */
export function constants(db) {
  return db.prepare(
    `SELECT v.qualified, v.init, f.member FROM variables v JOIN files f ON f.id = v.file
     WHERE v.init IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accesses a WHERE a.variable = v.id AND a.mode = 'write')
     ORDER BY f.member, v.line`).all().map((c) => `- ${c.qualified} = ${c.init} (${c.member})`);
}

/**
 * A unit's calls as the source writes them, with their arguments: a callee is
 * explained with its parameters, so the literals a caller passes would be lost.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {Unit} unit
 * @returns {string[]}
 */
export function calls(db, root, unit) {
  const source = blankMargins(readFileSync(join(root, unit.path), "latin1"), "pli").split(/\r?\n/);
  const rows = db.prepare(
    `SELECT r.line,
       (SELECT s.line FROM statements s WHERE s.caller = r.caller AND s.line <= r.line AND s.end_line >= r.line ORDER BY s.end_line - s.line, s.id DESC LIMIT 1) AS from_line,
       (SELECT s.end_line FROM statements s WHERE s.caller = r.caller AND s.line <= r.line AND s.end_line >= r.line ORDER BY s.end_line - s.line, s.id DESC LIMIT 1) AS to_line
     FROM refs r LEFT JOIN links l ON l.ref = r.id
     WHERE (r.caller = ? OR r.caller IN (SELECT id FROM symbols WHERE parent = ? AND detail LIKE 'ENTRY%'))
       AND r.kind IN ('call', 'invoke', 'fetch') AND (r.kind <> 'invoke' OR l.target_symbol IS NOT NULL)
     ORDER BY r.line`).all(unit.id, unit.id);
  const seen = new Set();
  const found = [];
  for (const r of rows) {
    const from = Number(r.from_line ?? r.line), to = Number(r.to_line ?? r.line);
    if (seen.has(from)) continue;
    seen.add(from);
    const text = source.slice(from - 1, to).map((l) => code(l).replace(/^[-+0 ]/, " ").trim()).join(" ").replace(/\s+/g, " ");
    found.push(`- line ${from}: ${text}`);
  }
  return found;
}

/** A value as the code would write it, for comparing. @param {string} value */
const normal = (value) => value.trim().replace(/^'(.*)'$/s, "$1").toUpperCase();
/** @param {string} value */
const number = (value) => {
  const match = /^[+-]?\d+(\.\d+)?%?$/.exec(value.trim().replace(/^'(.*)'$/s, "$1").replace(",", "."));
  return match ? Number(match[0].replace("%", "")) : undefined;
};

/**
 * What in an answer the graph does not back: lines outside the procedure,
 * fields declared nowhere, constants that are not in its code or in the
 * declarations of what it uses. An empty list means it checks out.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {Unit} unit
 * @param {Answer} answer
 * @returns {string[]}
 */
export function verify(db, root, unit, answer) {
  const errors = [];
  const source = blankMargins(readFileSync(join(root, unit.path), "latin1"), "pli").split(/\r?\n/);
  const text = source.slice(unit.line - 1, unit.end_line).map((l) => code(l).replace(/\/\*.*?\*\//g, "")).join("\n").toUpperCase();
  const inits = db.prepare(
    `SELECT DISTINCT v.init FROM accesses a JOIN statements s ON s.id = a.statement JOIN variables v ON v.id = a.variable
     WHERE s.file = ? AND s.line BETWEEN ? AND ? AND v.init IS NOT NULL`).all(unit.file, unit.line, unit.end_line).map((r) => String(r.init).toUpperCase());
  const known = text + "\n" + inits.join("\n");
  const numbers = new Set([...known.matchAll(/(?<![A-Z0-9_#@$])\d+(\.\d+)?/g)].map((m) => Number(m[0])));
  const field = db.prepare("SELECT 1 FROM variables WHERE name = ? OR qualified = ? UNION SELECT 1 FROM file_io WHERE name = ? LIMIT 1");
  for (const [i, rule] of answer.rules.entries()) {
    const at = `rule ${i + 1}`;
    for (const line of rule.lines) if (line < unit.line || line > unit.end_line) errors.push(`${at}: line ${line} is not in ${unit.name} (lines ${unit.line}-${unit.end_line})`);
    for (const name of rule.fields) {
      const bare = name.trim().toUpperCase().replace(/\(.*$/, "");
      if (!field.get(bare.split(".").at(-1) ?? bare, bare, bare)) errors.push(`${at}: field ${name} is not declared anywhere`);
    }
    for (const value of rule.values) {
      const n = number(value);
      if (n !== undefined ? numbers.has(n) : known.includes(normal(value))) continue;
      errors.push(`${at}: value ${value} is not in the code of ${unit.name} or the declarations it uses`);
    }
  }
  return errors;
}

/**
 * A client for a chat model that answers in JSON (or free text without a
 * schema): Ollama's own API, or any
 * OpenAI-compatible endpoint (vLLM, llama.cpp, an on-premises gateway).
 * @param {{ url: string, model: string, api?: "ollama" | "openai", contextTokens?: number, maxTokens?: number, key?: string, schema?: object | null }} options
 * @returns {Ask}
 */
export function client({ url, model, api = "ollama", contextTokens = 16384, maxTokens = 8192, key, schema = ANSWER_SCHEMA }) {
  return async (messages) => {
    const ollama = api === "ollama";
    // node:http, not fetch: fetch gives up after 5 minutes without headers, and a
    // CPU model reading a long prompt sends none until it has read it all.
    const target = new URL(ollama ? `${url}/api/chat` : `${url}/chat/completions`);
    const body = JSON.stringify(ollama
      ? { model, messages, stream: true, think: false, ...(schema ? { format: schema } : {}), options: { temperature: 0, num_ctx: contextTokens, num_predict: maxTokens } }
      : { model, messages, stream: true, temperature: 0, max_tokens: maxTokens, ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema } } } : {}) });
    /** @type {import("node:http").IncomingMessage} */
    const response = await new Promise((resolve, reject) => {
      const request = (target.protocol === "https:" ? https : http).request(target, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      }, resolve);
      request.on("error", (error) => reject(new Error(`PLG032E The model at ${url} is not reachable: ${error.message || error}`)));
      request.end(body);
    });
    response.setEncoding("utf8");
    if (response.statusCode !== 200) {
      let said = "";
      for await (const chunk of response) said += chunk;
      throw new Error(`PLG030E The model at ${url} answered ${response.statusCode}: ${said.slice(0, 500)}`);
    }
    let text = "";
    let rest = "";
    for await (const chunk of response) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const data = ollama ? line.trim() : line.replace(/^data: /, "").trim();
        if (!data || data === "[DONE]" || data.startsWith(":")) continue;
        const part = JSON.parse(data);
        if (part.error) throw new Error(`PLG030E The model at ${url} answered: ${JSON.stringify(part.error).slice(0, 500)}`);
        text += (ollama ? part.message?.content : part.choices?.[0]?.delta?.content) ?? "";
      }
    }
    return text;
  };
}

/**
 * The model's answer as an Answer, or an error naming what is wrong.
 * @param {string} reply
 * @returns {Answer}
 */
function parse(reply) {
  let value;
  try {
    value = JSON.parse(reply.replace(/^```(json)?\s*|\s*```\s*$/g, ""));
  } catch (error) {
    throw new Error(`PLG031E The answer is not JSON: ${/** @type {Error} */ (error).message}: ${reply.slice(0, 200)}`);
  }
  if (typeof value?.summary !== "string" || !Array.isArray(value.rules)) throw new Error(`PLG031E The answer lacks summary or rules: ${reply.slice(0, 200)}`);
  return {
    summary: value.summary,
    inputs: Array.isArray(value.inputs) ? value.inputs.map(String) : [],
    outputs: Array.isArray(value.outputs) ? value.outputs.map(String) : [],
    rules: value.rules.map((/** @type {any} */ r) => ({
      text: String(r?.text ?? ""),
      lines: Array.isArray(r?.lines) ? r.lines.map(Number).filter(Number.isFinite) : [],
      fields: Array.isArray(r?.fields) ? r.fields.map(String) : [],
      values: Array.isArray(r?.values) ? r.values.map(String) : [],
    })),
  };
}

/**
 * @typedef {object} Explained
 * @property {Unit} unit
 * @property {Answer | null} answer
 * @property {string[]} errors what verify still found after the retry, or why there is no answer
 * @property {number} attempts model calls made (0 when cached)
 * @property {number} seconds
 */

/**
 * Explains every procedure bottom-up. A procedure is asked once; when the
 * check finds problems it is asked once more with them. Answers are stored
 * under the hash of their pack, prompt version and model, so an unchanged
 * procedure is never asked again.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {{ ask: Ask, model: string, cache: string, only?: (unit: Unit) => boolean, log?: (line: string) => void }} options
 * @returns {Promise<Explained[]>}
 */
export async function explain(db, root, { ask, model, cache, only = () => true, log = () => {} }) {
  mkdirSync(cache, { recursive: true });
  /** @type {Map<number, Answer>} */
  const summaries = new Map();
  /** @type {Explained[]} */
  const results = [];
  for (const unit of units(db)) {
    if (!only(unit)) continue;
    const context = pack(db, root, unit, summaries);
    const hash = createHash("sha256").update(`${PROMPT_VERSION}\n${model}\n${INSTRUCTIONS}\n${context}`).digest("hex").slice(0, 24);
    const stored = join(cache, `${hash}.json`);
    const started = Date.now();
    /** @type {Explained} */
    let result;
    if (existsSync(stored)) {
      const saved = JSON.parse(readFileSync(stored, "utf8"));
      result = { unit, answer: saved.answer, errors: saved.errors, attempts: 0, seconds: 0 };
    } else {
      const messages = [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: context }];
      result = { unit, answer: null, errors: [], attempts: 0, seconds: 0 };
      for (let attempt = 1; attempt <= 2; attempt++) {
        result.attempts = attempt;
        try {
          const reply = await ask(messages);
          result.answer = parse(reply);
          result.errors = verify(db, root, unit, result.answer);
          if (!result.errors.length) break;
          messages.push({ role: "assistant", content: reply }, { role: "user", content: `These claims are not backed by the source; fix or drop them and answer again in full:\n${result.errors.join("\n")}` });
        } catch (error) {
          result.errors = [/** @type {Error} */ (error).message];
          log(`${unit.name}: ${result.errors[0]}`);
          if (/PLG03[02]E/.test(result.errors[0])) break;
        }
      }
      result.seconds = Math.round((Date.now() - started) / 100) / 10;
      if (result.answer) writeFileSync(stored, JSON.stringify({ unit: unit.name, member: unit.member, answer: result.answer, errors: result.errors, attempts: result.attempts, seconds: result.seconds }, null, 2));
    }
    if (result.answer) summaries.set(unit.id, result.answer);
    log(`${unit.member} ${unit.name}: ${result.answer ? result.answer.rules.length : 0} rules, ${result.errors.length} unbacked, ${result.attempts} calls, ${result.seconds}s`);
    results.push(result);
  }
  return results;
}
