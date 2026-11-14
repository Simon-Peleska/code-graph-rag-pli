// Translates PL/I programs to JavaScript with the graph's facts: the type of
// every variable, which variable each name means, the DL/I calls, and the
// IMS transactions with their MFS screens. What it cannot translate it marks
// with a TODO comment, or a todo() call that fails when the program gets there.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mfsFields, mfsFormats } from "./mfs.js";
import { PLI_BUILTINS, blankMargins, bytes, ddlTables } from "./source.js";

/** @typedef {import("web-tree-sitter").Node} Node */
/**
 * @typedef {object} Variable a row of the graph's variables
 * @property {number} id
 * @property {number} file
 * @property {number | null} scope
 * @property {number | null} parent
 * @property {string} name
 * @property {string} qualified
 * @property {string | null} type
 * @property {string | null} size
 * @property {string | null} dims
 * @property {string | null} storage
 * @property {string | null} base
 * @property {string | null} init
 * @property {string | null} like
 * @property {number} external 1 when EXTERNAL: one variable for all programs, in the runtime's EXTERNAL
 * @property {number | null} parameter
 * @property {string} attributes
 * @property {string | null} comment
 * @property {number} line
 */
/**
 * @typedef {"char" | "varchar" | "bits" | "dec" | "pic" | "bin" | "float" | "bit" | "pointer" | "structure" | "literal" | "string" | "number" | "unknown"} Kind
 * @typedef {{ code: string, kind: Kind, v?: Variable, text?: string }} Expr
 * @typedef {{ line: number, scopes: number[], loops: string[], changed: string[], gotos: Map<string, string>, units: boolean, start?: string }} At loops: "loop", "dispatch", "group", or the JS label of a DO group a LEAVE ends; changed: the parameters the procedure returns; gotos: the dispatcher of each label in this function; units: the procedure keeps ON units; start: where the procedure's statements start, an ENTRY's name
 * @typedef {{ line: number, why: string }} Todo
 */

/** Declarations that are not data. */
const NOT_DATA = new Set(["ENTRY", "BUILTIN", "CONDITION", "LABEL", "FORMAT", "GENERIC"]);
/** Nodes that run nothing themselves, or whose contents are counted instead. */
const UNCOUNTED = new Set([
  "comment", "declare_statement", "format_statement", "end_statement", "null_statement", "entry_statement", "labeled_statement", "preprocessor_include",
]);
/** An SQL DECLARE CURSOR without its EXEC SQL: the cursor's name and its SELECT. */
const DECLARE_CURSOR = /^DECLARE\s+(\S+)\s+.*?CURSOR\s+(?:WITH\s+HOLD\s+)?FOR\s+(.*?)\s*;?\s*$/is;

/** A PL/I name as a JavaScript one: #, @ and § (national characters) are no JavaScript. @param {string} name */
const js = (name) => name.toUpperCase().replace(/#/g, "_H").replace(/@/g, "_A").replace(/§/g, "_P");

/** @param {Variable} v @returns {Kind} */
function kindOf(v) {
  switch (v.type) {
    case "CHAR":
      return "char";
    case "VARCHAR":
      return "varchar";
    case "PIC":
      return /^[9VZSB.,\-+/()\d]*$/i.test(v.size ?? "") && /[9Z]/i.test(v.size ?? "") ? "pic" : "char";
    case "FIXED DEC":
      return "dec";
    case "FIXED BIN":
      return "bin";
    case "FLOAT DEC":
    case "FLOAT BIN":
      return "float";
    case "BIT":
      return v.size === "1" ? "bit" : "bits";
    case "POINTER":
    case "OFFSET":
      return "pointer";
    case "STRUCTURE":
      return "structure";
    default:
      return "unknown";
  }
}

/** The length of a CHAR, or of a non-numeric PIC. @param {Variable} v */
const charLength = (v) => (v.type === "PIC" ? (bytes(v) ?? 0) : Number(v.size) || 0);

/** A numeric PIC's digits and decimals, as FIXED DEC(p,q). @param {string} picture */
function picDigits(picture) {
  const chars = picture.toUpperCase().replace(/\((\d+)\)(.)/g, (_, n, c) => c.repeat(Number(n)));
  const v = chars.indexOf("V");
  return [chars.replace(/[^9Z]/g, "").length, v < 0 ? 0 : chars.slice(v + 1).replace(/[^9Z]/g, "").length];
}

/** @param {Variable} v */
function jsdocType(v) {
  const kind = kindOf(v);
  if (kind === "char" || kind === "varchar" || kind === "bits") return "string";
  if (kind === "bit") return "boolean";
  if (kind === "pointer") return "any";
  if (kind === "structure") return "object";
  return kind === "unknown" ? "any" : "number";
}

/** A file PUT and GET write and read as text: STREAM or PRINT. @param {Variable} v */
const isStream = (v) => /\b(STREAM|PRINT)\b/i.test(v.attributes);

/** How many characters a field takes in a record: a number its digits, a sign and a point. @param {Variable} v */
function textWidth(v) {
  const [p, q] = (v.size ?? "").split(",").map(Number);
  switch (kindOf(v)) {
    case "dec":
      return (p || 5) + (q ? 2 : 1);
    case "bin":
      return Math.ceil((p || 15) * Math.log10(2)) + 1;
    case "float":
      return 24;
    case "bit":
      return 1;
    default:
      return bytes(v);
  }
}

/** The value of a variable PL/I leaves uninitialized. @param {Variable} v */
function blank(v) {
  switch (kindOf(v)) {
    case "char":
      return `char("", ${charLength(v)})`;
    case "varchar":
      return `""`;
    case "bits":
      return JSON.stringify("0".repeat(Number(v.size) || 1));
    case "bit":
      return "false";
    case "pointer":
    case "unknown":
      return "null";
    default:
      return "0";
  }
}

/**
 * `expr` converted to the type of `v`, as PL/I's assignment does.
 * @param {Variable} v
 * @param {Expr} expr
 */
function convert(v, expr) {
  const kind = kindOf(v);
  const same = expr.v && expr.v.type === v.type && expr.v.size === v.size;
  // A CHAR may hold an overlay's fields as an object, which char() copies.
  if (same && kind !== "char") return expr.code;
  switch (kind) {
    case "char": {
      const n = charLength(v);
      if (expr.kind === "literal" && expr.text !== undefined && expr.text.length === n) return expr.code;
      return `char(${expr.kind === "pic" && expr.v ? `toPic(${expr.code}, ${JSON.stringify(expr.v.size)})` : expr.code}, ${n})`;
    }
    case "varchar":
      return `varchar(${expr.code}, ${Number(v.size)})`;
    case "dec": {
      const [p, q = "0"] = (v.size ?? "5").split(",");
      return `dec(${expr.code}, ${Number(p)}, ${Number(q)})`;
    }
    case "pic": {
      const [p, q] = picDigits(v.size ?? "");
      return `dec(${expr.code}, ${p}, ${q})`;
    }
    case "bin":
      return expr.kind === "bin" || (expr.kind === "number" && /^-?\d+$/.test(expr.code)) ? expr.code : `bin(${expr.code})`;
    case "bit":
      return expr.kind === "bit" ? expr.code : `Boolean(${expr.code})`;
    default:
      return expr.code;
  }
}

/** The lower bound and length of each dimension, null when not constant. @param {string} dims */
function bounds(dims) {
  return dims.split(",").map((d) => {
    const [lower, upper] = d.includes(":") ? d.split(":").map(Number) : [1, Number(d)];
    return Number.isInteger(lower) && Number.isInteger(upper) ? { lower, length: upper - lower + 1 } : null;
  });
}

/**
 * The items of an INIT: values with their repeat factors.
 * @param {string} init
 * @returns {{ count: number, value: string }[]}
 */
function initItems(init) {
  /** @type {string[]} */
  const items = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < init.length; i++) {
    const c = init[i];
    if (c === "'") quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    else if (!quoted && depth === 0 && c === ",") {
      items.push(init.slice(start, i));
      start = i + 1;
    }
  }
  items.push(init.slice(start));
  return items.map((item) => {
    const repeated = /^\s*\((\d+)\)\s*(.*)$/s.exec(item);
    return repeated ? { count: Number(repeated[1]), value: repeated[2].trim() } : { count: 1, value: item.trim() };
  });
}

/**
 * A constant as written in an INIT or VALUE, as an expression; null when it
 * is not one.
 * @param {string} text
 * @returns {Expr | null}
 */
function constant(text) {
  const bit = /^'([01]*)'B$/i.exec(text);
  if (bit) return bit[1].length === 1 ? { code: String(bit[1] === "1"), kind: "bit" } : { code: JSON.stringify(bit[1]), kind: "bits" };
  const string = /^'((?:[^']|'')*)'$/s.exec(text);
  if (string) {
    const value = string[1].replace(/''/g, "'");
    return { code: JSON.stringify(value), kind: "literal", text: value };
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?$/i.test(text)) return { code: String(Number(text)), kind: "number" };
  return null;
}

/**
 * Where an SQL statement's host variables are: each `:name`, with its
 * indicator variable, outside string literals.
 * @param {string} text
 */
function hostVariables(text) {
  /** @type {{ name: string, indicator: string | null, index: number, length: number }[]} */
  const found = [];
  const pattern = /'(?:[^']|'')*'|:\s*([A-Z_#@$][\w#@$]*(?:\.[A-Z_#@$][\w#@$]*)*)(?:\s*(?:INDICATOR\s*)?:\s*([A-Z_#@$][\w#@$]*))?/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) found.push({ name: match[1].toUpperCase(), indicator: match[2]?.toUpperCase() ?? null, index: match.index, length: match[0].length });
  }
  return found;
}

/**
 * Translates one PL/I program to an ES module.
 * @param {import("node:sqlite").DatabaseSync} db the graph
 * @param {string} root
 * @param {{ pli: import("web-tree-sitter").Parser }} indexer
 * @param {string} path relative to root
 * @returns {{ code: string, statements: number, todos: Todo[], calls: string[], includes: Map<string, Map<string, string>> }} calls: the paths of the programs it calls; includes: the factories of each include's initial values, by member and variable
 */
function programToJs(db, root, indexer, path) {
  const file = /** @type {{ id: number, member: string } | undefined} */ (db.prepare(`SELECT id, member FROM files WHERE path = ?`).get(path));
  if (!file) throw new Error(`[PLG053E] ${path} is not in the graph; index it first`);
  const tree = indexer.pli.parse(blankMargins(readFileSync(join(root, path), "utf-8"), "pli"));
  if (!tree) throw new Error(`[PLG054E] ${path} could not be parsed`);

  const included = /** @type {{ id: number }[]} */ (
    db
      .prepare(
        `WITH RECURSIVE inc(id) AS (
           SELECT l.target_file FROM refs r JOIN links l ON l.ref = r.id WHERE r.file = ? AND r.kind = 'include'
           UNION SELECT l.target_file FROM inc JOIN refs r ON r.file = inc.id AND r.kind = 'include' JOIN links l ON l.ref = r.id)
         SELECT id FROM inc`,
      )
      .all(file.id)
  ).map((row) => row.id);
  const variables = /** @type {Variable[]} */ (
    db
      .prepare(
        `SELECT id, file, scope, parent, name, qualified, type, size, dims, storage, base, init, like, external, parameter, attributes, comment, line
         FROM variables WHERE file IN (SELECT value FROM json_each(?)) ORDER BY file = ?, line, id`,
      )
      .all(JSON.stringify([file.id, ...included]), file.id)
  );
  const byId = new Map(variables.map((v) => [v.id, v]));
  /** @type {Map<number, Variable[]>} */
  const children = new Map();
  /** @type {Map<string, Variable[]>} by each tail of the qualified name */
  const byName = new Map();
  /** @param {Variable} v */
  const add = (v) => {
    if (v.parent !== null) children.set(v.parent, [...(children.get(v.parent) ?? []), v]);
    const parts = v.qualified.toUpperCase().split(".");
    for (let i = 0; i < parts.length; i++) {
      const tail = parts.slice(i).join(".");
      byName.set(tail, [...(byName.get(tail) ?? []), v]);
    }
  };
  for (const v of variables) add(v);
  // The graph has no fields for a LIKE structure: its accesses name the
  // template's field, `through` the structure. Here it gets its own copies.
  /** @type {Map<string, Variable>} the copy of each template field, by `${LIKE structure}:${template field}` */
  const copies = new Map();
  let copyId = -1;
  for (const v of variables) {
    if (!v.like) continue;
    const candidates = byName.get(v.like.toUpperCase()) ?? [];
    const template = candidates.find((c) => c.scope === v.scope) ?? candidates.find((c) => c.scope === null) ?? candidates[0];
    if (!template) continue;
    /** @param {Variable} from @param {Variable} to */
    const copy = (from, to) => {
      for (const field of children.get(from.id) ?? []) {
        const twin = { ...field, id: copyId--, scope: v.scope, parent: to.id, qualified: `${to.qualified}.${field.name}`, storage: v.storage, line: v.line };
        byId.set(twin.id, twin);
        add(twin);
        copies.set(`${v.id}:${field.id}`, twin);
        copy(field, twin);
      }
    };
    copy(template, v);
  }
  /** @type {Map<number, string>} the property name of each field; FILLER1... for `*` */
  const keys = new Map();
  for (const fields of children.values()) {
    let fillers = 0;
    for (const v of fields) keys.set(v.id, v.name === "*" ? `FILLER${++fillers}` : js(v.name));
  }
  /** @type {Map<string, number>} */
  const accessed = new Map();
  for (const row of /** @type {{ line: number, name: string, variable: number, through: number | null }[]} */ (
    db
      .prepare(`SELECT s.line, a.name, a.variable, a.through FROM accesses a JOIN statements s ON s.id = a.statement WHERE s.file = ? AND a.variable IS NOT NULL`)
      .all(file.id)
  )) {
    const copy = row.through === null ? undefined : copies.get(`${row.through}:${row.variable}`);
    accessed.set(`${row.line}:${row.name.toUpperCase()}`, copy?.id ?? row.variable);
  }
  const procedures = /** @type {{ id: number, name: string, line: number }[]} */ (
    db.prepare(`SELECT id, name, line FROM symbols WHERE file = ? AND kind = 'procedure'`).all(file.id)
  );
  const procedureNames = new Set(procedures.map((p) => p.name.toUpperCase()));
  const dliCalls = /** @type {{ line: number, entry: string, function: string | null, pcb: string | null, pcb_parameter: number | null, io_area: string | null, segment: string | null, path: string | null }[]} */ (
    db.prepare(`SELECT line, entry, function, pcb, pcb_parameter, io_area, segment, path FROM dli_calls WHERE file = ?`).all(file.id)
  );
  const dli = new Map(dliCalls.map((row) => [row.line, row]));
  // A PCB parameter is the PSB's PCB at its position, after the I/O PCB unless
  // the program runs as DLI batch without CMPAT=YES (as programDli in graph.js);
  // else the DBD having the segments the calls on the PCB name.
  const psbs = /** @type {{ id: number, detail: string | null, batch: number }[]} */ (
    db
      .prepare(
        `SELECT p.id, p.detail, r.batch FROM (
           SELECT name, 0 AS batch FROM symbols WHERE kind = 'psb' AND name = ?
           UNION ALL SELECT psb, parm LIKE 'DLI,%' FROM steps WHERE program = ? AND psb IS NOT NULL) r
         JOIN symbols p ON p.id = (SELECT min(id) FROM symbols WHERE kind = 'psb' AND name = r.name)`,
      )
      .all(file.member, file.member)
  );
  const pcbAt = db.prepare(`SELECT type, dbd FROM pcbs WHERE psb = ? AND position = ?`);
  const dbdOfSegment = db.prepare(`SELECT y.name FROM segments s JOIN symbols y ON y.id = s.dbd WHERE s.name = ? ORDER BY y.name LIMIT 1`);
  /** @type {Map<string, string>} the DBD of each DB PCB, by its name */
  const pcbDbds = new Map();
  for (const d of dliCalls) {
    if (!d.pcb || pcbDbds.has(d.pcb.toUpperCase())) continue;
    let dbd = null;
    let known = false;
    for (const psb of psbs) {
      if (!d.pcb_parameter) break;
      const ioPcb = !psb.batch || /\bCMPAT=YES\b/i.test(psb.detail ?? "");
      const pcb = /** @type {{ type: string, dbd: string | null } | undefined} */ (pcbAt.get(psb.id, d.pcb_parameter - (ioPcb ? 1 : 0)));
      if (pcb?.type === "DB" && pcb.dbd) dbd = pcb.dbd;
      known = pcb !== undefined || (ioPcb && d.pcb_parameter === 1);
      if (known) break;
    }
    if (!known) {
      const same = dliCalls.filter((c) => c.pcb?.toUpperCase() === d.pcb?.toUpperCase());
      const segments = same.flatMap((c) => [c.segment, ...(c.path ?? "").split(/[^A-Z0-9#@$]+/i)]).filter(Boolean);
      for (const segment of segments) {
        dbd = /** @type {{ name: string } | undefined} */ (dbdOfSegment.get(segment))?.name ?? null;
        if (dbd) break;
      }
    }
    if (dbd) pcbDbds.set(d.pcb.toUpperCase(), dbd);
  }
  /** @type {Set<string>} the DBDs the program's calls use */
  const dbdsUsed = new Set();
  // PL/I passes arguments by reference: a procedure returns the scalar
  // parameters it changes, and its callers assign them back. An ENTRY's
  // parameter is a copy of its procedure's variable, which is the one written.
  const changedParameters = db.prepare(
    `SELECT v.name, v.parameter FROM variables v
     WHERE v.scope = ? AND v.parameter IS NOT NULL AND v.parent IS NULL AND v.dims IS NULL AND v.type IS NOT 'STRUCTURE'
       AND (EXISTS (SELECT 1 FROM accesses a WHERE a.variable = v.id AND a.mode = 'write')
         OR EXISTS (SELECT 1 FROM symbols e JOIN variables w ON w.scope = e.parent AND w.name = v.name AND w.parent IS NULL JOIN accesses a ON a.variable = w.id
                    WHERE e.id = v.scope AND e.detail LIKE 'ENTRY%' AND a.mode = 'write'))
     ORDER BY v.parameter`,
  );
  /** @param {number} procedure */
  const changedBy = (procedure) => /** @type {{ name: string, parameter: number }[]} */ (changedParameters.all(procedure));
  const externalCalls = new Map(
    /** @type {{ line: number, id: number, name: string, path: string, member: string }[]} */ (
      db
        .prepare(
          `SELECT r.line, s.id, s.name, f.path, f.member FROM refs r JOIN links l ON l.ref = r.id JOIN symbols s ON s.id = l.target_symbol JOIN files f ON f.id = l.target_file
           WHERE r.file = ? AND r.kind IN ('call', 'invoke') AND s.kind = 'procedure' AND f.id <> r.file`,
        )
        .all(file.id)
    ).map((row) => [`${row.line}:${row.name.toUpperCase()}`, row]),
  );
  /** @type {Map<string, string>} the procedures of other programs called, by the module they are in */
  const imports = new Map();
  /** @type {Set<string>} the files of the programs called */
  const calls = new Set();
  /** @type {Map<string, Map<string, string>>} each include's factories of initial values, by its member and the variable */
  const includes = new Map();
  const includeMembers = new Map(
    /** @type {{ id: number, member: string }[]} */ (db.prepare(`SELECT id, member FROM files WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(included))).map((f) => [
      f.id,
      f.member,
    ]),
  );
  /** @type {Set<string>} the variables ALLOCATE makes */
  const allocated = new Set(
    tree.rootNode
      .descendantsOfType("allocate_item")
      .map((item) => item?.namedChildren.find((c) => c?.type === "reference")?.text.replace(/\s+/g, "").toUpperCase() ?? ""),
  );
  /** @type {Set<number>} the scalars that are overlays, their value in the field `$` */
  const overlaidScalars = new Set();

  /** @type {string[]} */
  const lines = [];
  /** @type {Todo[]} */
  const todos = [];
  let statements = 0;
  /** @type {Set<number>} the statements with a TODO, not counted as translated */
  const failed = new Set();
  let groups = 0;
  /** @type {Map<string, string>} module constants: the message layouts */
  const layouts = new Map();
  /** @type {string[]} the module variables: the procedures' STATIC ones */
  const statics = [];
  /** @type {Map<string, string>} each cursor's SELECT */
  const cursors = new Map();
  const usesSql = /EXEC\s+SQL/i.test(tree.rootNode.text);
  const gotoTargets = new Set(tree.rootNode.descendantsOfType("goto_statement").map((g) => g?.childForFieldName("label")?.text.toUpperCase() ?? ""));
  for (const entry of tree.rootNode.descendantsOfType("entry_statement")) {
    for (const prefix of entry?.parent?.namedChildren.filter((c) => c?.type === "statement_prefix") ?? []) gotoTargets.add(prefix?.childForFieldName("label")?.text.toUpperCase() ?? "");
  }
  const labels = new Set(tree.rootNode.descendantsOfType("statement_prefix").map((p) => p?.childForFieldName("label")?.text.toUpperCase() ?? ""));
  let dispatchers = 0;
  /** @type {Map<string, Node>} the FORMAT statements by their labels */
  const formats = new Map();
  for (const labeled of tree.rootNode.descendantsOfType("labeled_statement")) {
    const format = labeled?.namedChildren.find((c) => c?.type === "format_statement");
    for (const prefix of format ? (labeled?.namedChildren.filter((c) => c?.type === "statement_prefix") ?? []) : []) {
      formats.set(prefix?.childForFieldName("label")?.text.toUpperCase() ?? "", /** @type {Node} */ (format));
    }
  }
  const FILE_CONDITIONS = new Set(["ENDFILE", "KEY", "UNDEFINEDFILE", "ENDPAGE", "TRANSMIT", "RECORD", "NAME", "PENDING"]);
  /** A procedure with ON or REVERT statements of its own keeps ON units, other than the files'. @param {Node} node */
  const keepsUnits = (node) => {
    /** @param {Node} n @returns {boolean} */
    const walk = (n) =>
      n.namedChildren.some((c) => {
        if (!c || c.type === "procedure_statement") return false;
        if (c.type === "revert_statement") return true;
        if (c.type === "on_statement") {
          const condition = c.namedChildren.find((x) => x?.type === "condition_spec")?.namedChildren.find((x) => x?.type === "condition_name")?.text.toUpperCase() ?? "";
          if (!FILE_CONDITIONS.has(condition)) return true;
        }
        return walk(c);
      });
    return walk(/** @type {Node} */ (node.childForFieldName("body") ?? node));
  };

  /** @param {number} depth @param {string} text */
  const emit = (depth, text) => lines.push(text ? "  ".repeat(depth) + text : "");
  /** @param {Node} node */
  const lineOf = (node) => node.startPosition.row + 1;

  /** @param {Node} node @param {number} depth @param {string} why */
  const todoStatement = (node, depth, why) => {
    todos.push({ line: lineOf(node), why });
    failed.add(node.id);
    emit(depth, `// TODO: ${why}, line ${lineOf(node)}:`);
    for (const line of node.text.split("\n")) emit(depth, `//   ${line.trim()}`);
  };
  /** @param {Node} node @param {string} why @param {At} at @returns {Expr} */
  const todoExpr = (node, why, at) => {
    todos.push({ line: at.line, why });
    return { code: `todo(${JSON.stringify(`${why}: ${node.text.replace(/\s+/g, " ")}`)})`, kind: "unknown" };
  };

  /**
   * The variable a name means: the one the graph resolved at this line,
   * else the innermost declared in scope.
   * @param {string} name upper case, qualified as written
   * @param {At} at
   */
  const variableAt = (name, at) => {
    const id = accessed.get(`${at.line}:${name}`);
    if (id !== undefined && byId.has(id)) return byId.get(id);
    const candidates = byName.get(name) ?? [];
    for (const scope of at.scopes) {
      const found = candidates.find((v) => v.scope === scope);
      if (found) return found;
    }
    return candidates.find((v) => v.scope === null);
  };

  /**
   * The JavaScript path of a variable, its subscripts placed on the
   * dimensioned levels from the outermost on.
   * @param {Variable} v
   * @param {Node[]} subscripts
   * @param {Node} node
   * @param {At} at
   * @returns {Expr}
   */
  const pathOf = (v, subscripts, node, at) => {
    /** @type {Variable[]} */
    const chain = [];
    for (let x = /** @type {Variable | undefined} */ (v); x; x = x.parent === null ? undefined : byId.get(x.parent)) chain.unshift(x);
    const rest = subscripts.map((s) => expr(s, at));
    let code = "";
    for (const [i, x] of chain.entries()) {
      code += i === 0 ? (x.external ? "EXTERNAL." : "") + js(x.name) + (overlaidScalars.has(x.id) ? ".$" : "") : `.${keys.get(x.id)}`;
      for (const bound of x.dims ? bounds(x.dims) : []) {
        const s = rest.shift();
        if (!s) break;
        const lower = bound?.lower ?? 1;
        code += `[${/^-?\d+$/.test(s.code) ? Number(s.code) - lower : lower === 0 ? s.code : `${s.code} - ${lower}`}]`;
      }
    }
    if (rest.length) return todoExpr(node, "more subscripts than dimensions", at);
    return { code, kind: kindOf(v), v };
  };

  /** A string from any expression, a numeric PIC in its characters. @param {Expr} e */
  const asString = (e) => (e.kind === "pic" && e.v ? `toPic(${e.code}, ${JSON.stringify(e.v.size)})` : e.code);

  /**
   * @param {string} name
   * @param {Node[]} argNodes
   * @param {Node} node
   * @param {At} at
   * @returns {Expr}
   */
  const builtin = (name, argNodes, node, at) => {
    const args = argNodes.map((a) => expr(a, at));
    const codes = args.map((a) => a.code);
    switch (name) {
      case "SUBSTR":
        return { code: `substr(${[asString(args[0]), ...codes.slice(1)].join(", ")})`, kind: "string" };
      case "LENGTH":
        if (args[0]?.v && args[0].kind === "char") return { code: String(charLength(args[0].v)), kind: "number" };
        return { code: `${asString(args[0])}.length`, kind: "number" };
      case "INDEX":
        return { code: `(${asString(args[0])}.indexOf(${codes[1]}) + 1)`, kind: "number" };
      case "VERIFY":
        return { code: `verify(${asString(args[0])}, ${codes[1]})`, kind: "number" };
      case "TRIM":
        if (args.length !== 1) break;
        return { code: `${asString(args[0])}.trim()`, kind: "string" };
      case "MOD":
        return { code: `mod(${codes.join(", ")})`, kind: "number" };
      case "MAX":
      case "MIN":
      case "ABS":
      case "TRUNC":
      case "FLOOR":
      case "CEIL":
      case "SIGN":
        return { code: `Math.${name.toLowerCase()}(${codes.join(", ")})`, kind: "number" };
      case "ROUND":
        return { code: `round(${codes.join(", ")})`, kind: "number" };
      case "REPEAT":
        return { code: `${asString(args[0])}.repeat(${codes[1]} + 1)`, kind: "string" };
      case "COPY":
        return { code: `${asString(args[0])}.repeat(${codes[1]})`, kind: "string" };
      case "HIGH":
        return { code: `"\\xff".repeat(${codes[0]})`, kind: "string" };
      case "LOW":
        return { code: `"\\0".repeat(${codes[0]})`, kind: "string" };
      case "NULL":
      case "SYSNULL":
        return { code: "null", kind: "pointer" };
      case "ADDR":
        if (args[0]?.v && args[0].kind !== "structure") return { code: `new Ref(() => ${codes[0]}, (v) => { ${codes[0]} = v; })`, kind: "pointer" };
        return { code: codes[0], kind: "pointer" };
      case "DATE":
      case "TIME":
      case "DATETIME":
        if (args.length) break;
        return { code: `${name.toLowerCase()}()`, kind: "string" };
      case "DEC":
      case "DECIMAL":
      case "FIXED":
        return { code: `dec(${codes.join(", ")})`, kind: "number" };
      case "BIN":
      case "BINARY":
        return { code: `bin(${codes[0]})`, kind: "number" };
      case "CHAR":
      case "CHARACTER":
        return { code: args.length === 2 ? `char(${asString(args[0])}, ${codes[1]})` : `String(${asString(args[0])})`, kind: "string" };
      case "ONCODE":
        return { code: "oncode()", kind: "number" };
      case "DIM":
      case "HBOUND":
      case "LBOUND": {
        if (args.length > 1 && codes[1] !== "1") break;
        // A field of an array of structures has its first dimension from the outermost dimensioned level.
        let array = args[0]?.v;
        for (let x = array; x; x = x.parent === null ? undefined : byId.get(x.parent)) if (x.dims) array = x;
        if (!array?.dims) break;
        const lower = bounds(array.dims)[0]?.lower ?? 1;
        if (name === "LBOUND") return { code: String(lower), kind: "number" };
        const length = `${pathOf(array, [], argNodes[0], at).code}.length`;
        return { code: name === "DIM" || lower === 1 ? length : `(${length} + ${lower - 1})`, kind: "number" };
      }
      case "TRANSLATE":
        if (args.length !== 3) break;
        return { code: `translate(${asString(args[0])}, ${asString(args[1])}, ${asString(args[2])})`, kind: "string" };
      case "SUM":
        return { code: `sum(${codes[0]})`, kind: "number" };
      case "DIVIDE":
        if (args.length < 3) break;
        return { code: `dec(${codes[0]} / ${codes[1]}, ${codes.slice(2).join(", ")})`, kind: "number" };
      case "STRING": {
        if (args[0]?.kind !== "structure") break;
        const record = recordArea(argNodes[0], at);
        if (typeof record === "string") return todoExpr(node, record, at);
        return { code: `encode(${record.area.code}, ${record.layout})`, kind: "string" };
      }
    }
    return todoExpr(node, `the built-in ${name}`, at);
  };

  /** @param {Node} node @param {At} at @returns {Expr} */
  const reference = (node, at) => {
    const named = node.namedChildren.filter((c) => c !== null);
    const builtinName = named.find((c) => c.type === "builtin_name");
    const names = named.filter((c) => c.type === "identifier").map((c) => c.text.toUpperCase());
    const args = named.flatMap((c) => (c.type === "argument" && c.namedChildren[0] ? [c.namedChildren[0]] : []));
    if (builtinName) return builtin(builtinName.text.toUpperCase(), args, node, at);
    if (node.text.includes("->")) return todoExpr(node, "a pointer-qualified reference", at);
    const v = variableAt(names.join("."), at);
    if (v?.type === "BUILTIN") return builtin(names[0], args, node, at);
    if (v && v.type === "ENTRY") {
      const external = externalCalls.get(`${at.line}:${names[0]}`);
      if (!external) return todoExpr(node, `${names[0]} is an external entry not in the graph`, at);
      imports.set(js(external.name), external.member);
      calls.add(external.path);
      return { code: `(await ${js(external.name)}(${args.map((a) => expr(a, at).code).join(", ")}))`, kind: "unknown" };
    }
    if (v) return pathOf(v, args, node, at);
    if (names.length === 1 && procedureNames.has(names[0])) {
      return { code: `(await ${js(names[0])}(${args.map((a) => expr(a, at).code).join(", ")}))`, kind: "unknown" };
    }
    if (names.length === 1 && PLI_BUILTINS.includes(names[0])) return builtin(names[0], args, node, at);
    return todoExpr(node, `${names.join(".")} is not declared`, at);
  };

  /** @param {Node} node @param {At} at @returns {Expr} */
  const expr = (node, at) => {
    switch (node.type) {
      case "number": {
        const value = constant(node.text);
        return value ?? todoExpr(node, "a number JavaScript does not have", at);
      }
      case "string_literal":
      case "bit_literal":
        return constant(node.text) ?? todoExpr(node, "a literal JavaScript does not have", at);
      case "parenthesized_expression": {
        const inner = expr(/** @type {Node} */ (node.namedChildren[0]), at);
        return { ...inner, code: `(${inner.code})` };
      }
      case "reference":
        return reference(node, at);
      case "unary_expression": {
        const operator = node.childForFieldName("operator")?.text ?? "";
        const operandNode = /** @type {Node} */ (node.childForFieldName("operand"));
        const operand = expr(operandNode, at);
        const code = operandNode.type === "binary_expression" ? `(${operand.code})` : operand.code;
        if (operator === "^" || operator === "¬") return { code: `!${code}`, kind: "bit" };
        return { code: `${operator}${code}`, kind: "number" };
      }
      case "binary_expression": {
        const leftNode = /** @type {Node} */ (node.childForFieldName("left"));
        const rightNode = /** @type {Node} */ (node.childForFieldName("right"));
        // & | and ** have no operator field: the operator is the token between.
        let operator = node.childForFieldName("operator")?.text;
        for (let i = 0; operator === undefined && i < node.childCount; i++) {
          const child = node.child(i);
          if (child && !child.isNamed && child.startIndex >= leftNode.endIndex && child.endIndex <= rightNode.startIndex) operator = child.text;
        }
        let left = expr(leftNode, at);
        let right = expr(rightNode, at);
        const wrap = (/** @type {Node} */ n, /** @type {Expr} */ e) => (n.type === "binary_expression" ? `(${e.code})` : e.code);
        // Arithmetic compared or made text is cleaned of floating point noise; assigned, dec() does it.
        const computed = (/** @type {Node} */ n, /** @type {Expr} */ e) =>
          e.kind === "number" && (n.type === "binary_expression" || n.type === "parenthesized_expression") ? { ...e, code: `num(${e.code.replace(/^\((.*)\)$/s, "$1")})` } : e;
        const comparisons = /** @type {Record<string, string>} */ ({ "=": "===", "^=": "!==", "¬=": "!==", "<>": "!==", "<": "<", ">": ">", "<=": "<=", ">=": ">=", "^<": ">=", "¬<": ">=", "^>": "<=", "¬>": "<=" });
        if (operator !== undefined && operator in comparisons) {
          // PL/I pads the shorter string with blanks to compare.
          /** @param {Expr} literal @param {Expr} other */
          const pad = (literal, other) =>
            literal.kind === "literal" && other.v && other.kind === "char" && literal.text !== undefined && literal.text.length < charLength(other.v)
              ? { ...literal, code: JSON.stringify(literal.text.padEnd(charLength(other.v))) }
              : literal;
          left = computed(leftNode, pad(left, right));
          right = computed(rightNode, pad(right, left));
          return { code: `${left.code} ${comparisons[operator]} ${right.code}`, kind: "bit" };
        }
        if (operator === "&" || operator === "|") return { code: `${wrap(leftNode, left)} ${operator}${operator} ${wrap(rightNode, right)}`, kind: "bit" };
        if (operator === "||" || operator === "!!") return { code: `${asString(computed(leftNode, left))} + ${asString(computed(rightNode, right))}`, kind: "string" };
        if (operator && ["+", "-", "*", "/", "**"].includes(operator)) return { code: `${wrap(leftNode, left)} ${operator} ${wrap(rightNode, right)}`, kind: "number" };
        return todoExpr(node, `the operator ${operator}`, at);
      }
      default:
        return todoExpr(node, `a ${node.type.replace(/_/g, " ")}`, at);
    }
  };

  /**
   * The initial value of a variable and its fields, with their JSDoc unless
   * `bare`. In an array of structures `element` names the element's index:
   * a field's INIT gives each element its own value.
   * @param {Variable} v @param {number} depth @param {At} at @param {boolean} [bare] @param {string} [element] @returns {string}
   */
  const initial = (v, depth, at, bare = false, element = undefined) => {
    if (v.like && !children.has(v.id)) {
      todos.push({ line: v.line, why: `LIKE ${v.like}, which is not declared` });
      return `todo(${JSON.stringify(`LIKE ${v.like} is not declared`)})`;
    }
    const dims = v.dims ? bounds(v.dims) : [];
    if (dims.some((d) => d === null)) {
      todos.push({ line: v.line, why: `${v.qualified} has bounds that are not constants` });
      return `todo(${JSON.stringify(`the bounds of ${v.qualified}`)})`;
    }
    const lengths = dims.map((d) => /** @type {{ length: number }} */ (d).length);
    let value;
    if (kindOf(v) === "structure") {
      const index = lengths.length && !element ? `i${depth}` : lengths.length ? undefined : element;
      const inner = [];
      for (const field of children.get(v.id) ?? []) {
        if (NOT_DATA.has(field.type ?? "")) continue;
        if (!bare) inner.push(`${"  ".repeat(depth + 1)}/** ${field.type === "STRUCTURE" ? "" : `@type {${jsdocType(field)}} `}${field.attributes}${field.comment ? ` ${field.comment}` : ""} */`);
        inner.push(`${"  ".repeat(depth + 1)}${keys.get(field.id)}: ${initial(field, depth + 1, at, bare, index)},`);
      }
      value = `{\n${inner.join("\n")}\n${"  ".repeat(depth)}}`;
      const used = index && inner.some((l) => l.includes(`[${index}]`));
      return lengths.length ? `array(${JSON.stringify(lengths)}, (${used ? index : ""}) => (${value}))` : value;
    }
    const items = v.init === null ? [] : initItems(v.init);
    /** @type {[number, string][]} */
    const values = [];
    for (const item of items) {
      if (item.value === "*") break;
      const value = constant(item.value);
      if (!value) {
        todos.push({ line: v.line, why: `the INIT of ${v.qualified}` });
        values.push([item.count, `todo(${JSON.stringify(`INIT ${item.value}`)})`]);
        break;
      }
      values.push([item.count, convert(v, value)]);
    }
    const count = values.reduce((n, [c]) => n + c, 0);
    if (!lengths.length && element && count > 1) {
      const each = values.flatMap(([c, value]) => Array(c).fill(value));
      return `[${each.join(", ")}][${element}] ?? ${blank(v)}`;
    }
    if (!lengths.length) return values[0]?.[1] ?? blank(v);
    return `array(${JSON.stringify(lengths)}, () => ${blank(v)}${values.length ? `, [${values.map(([count, value]) => `[${count}, ${value}]`).join(", ")}]` : ""})`;
  };

  /** @param {Variable} v @returns {boolean} */
  const likesNothing = (v) => !v.like && (children.get(v.id) ?? []).every(likesNothing);
  /**
   * The initial value of a variable; for one of an include, a call of its
   * factory in the include's module. A LIKE depends on the program, so it
   * stays here.
   * @param {Variable} v @param {number} depth @param {At} at
   */
  const initialOf = (v, depth, at) => {
    const member = includeMembers.get(v.file);
    if (!member || v.parent !== null || !likesNothing(v)) return initial(v, depth, at);
    const factories = includes.get(member) ?? new Map();
    includes.set(member, factories);
    const doc = [v.attributes, v.comment].filter(Boolean).join(" ");
    const value = initial(v, 0, at);
    factories.set(
      js(v.name),
      `/** ${kindOf(v) === "structure" ? "" : `@returns {${jsdocType(v)}} `}${doc} */\nexport const ${js(v.name)} = () => ${value.startsWith("{") ? `(${value})` : value};`,
    );
    return `${js(member)}.${js(v.name)}()`;
  };

  /**
   * A DEFINED or BASED variable as a view: the variable under it (a
   * structure itself, a Ref for anything else, or the pointer), its fields
   * and its POSITION. Null when it cannot be one.
   * @param {Variable} v
   * @param {At} at
   */
  const overlayOf = (v, at) => {
    const text = (v.base ?? "").replace(/\s+/g, "");
    const addr = /^ADDR\((.+)\)$/i.exec(text)?.[1];
    const under = variableAt((addr ?? text).toUpperCase(), at);
    if (!under || under.dims) return null;
    const code = pathOf(under, [], tree.rootNode, at).code;
    const pointer = v.storage === "BASED" && !addr;
    if (pointer && kindOf(under) !== "pointer") return null;
    const base = pointer || kindOf(under) === "structure" ? `() => ${code}` : `() => new Ref(() => ${code}, (v) => { ${code} = v; })`;
    /** @type {string[]} */
    let layout;
    try {
      layout = layoutOf(v, "overlay");
    } catch {
      return null;
    }
    const position = /\bPOS(?:ITION)?\s*\(\s*(\d+)\s*\)/i.exec(v.attributes)?.[1];
    return { base, layout, offset: position ? Number(position) - 1 : 0 };
  };

  /** @param {Variable} v @param {number} depth @param {At} at @param {Map<string, Variable>} parameters */
  const declare =(v, depth, at, parameters) => {
    if (NOT_DATA.has(v.type ?? "")) return;
    if (v.type === "FILE") {
      const mode = /\b(INPUT|OUTPUT|UPDATE)\b/i.exec(v.attributes)?.[1].toUpperCase();
      emit(depth, `/** ${v.attributes} */`);
      if (isStream(v)) return emit(depth, `const ${js(v.name)} = new StreamFile(${JSON.stringify(v.name.toUpperCase())}, { mode: ${mode ? JSON.stringify(mode) : "null"} });`);
      emit(depth, `const ${js(v.name)} = new RecordFile(${JSON.stringify(v.name.toUpperCase())}, { keyed: ${/\bKEYED\b/i.test(v.attributes)}, mode: ${mode ? JSON.stringify(mode) : "null"} });`);
      return;
    }
    const doc = [v.storage === "IMPLICIT" ? "implicitly declared" : v.attributes, v.comment].filter(Boolean).join(" ");
    if (kindOf(v) !== "structure") emit(depth, `/** @type {${jsdocType(v)}} ${doc} */`);
    else if (doc) emit(depth, `/** ${doc} */`);
    const base = v.storage === "BASED" && v.base ? parameters.get(v.base.toUpperCase()) : undefined;
    if (base && pcbDbds.has(v.name.toUpperCase())) {
      emit(depth, `let ${js(v.name)} = ${js(base.name)} ?? ${initialOf(v, depth, at)};`);
      return;
    }
    if (base) {
      emit(depth, `let ${js(v.name)} = ${js(base.name)};`);
      return;
    }
    if ((v.storage === "BASED" && !allocated.has(v.name.toUpperCase())) || v.storage === "DEFINED") {
      const view = overlayOf(v, at);
      if (view) {
        if (!v.dims && kindOf(v) !== "structure") overlaidScalars.add(v.id);
        emit(depth, `const ${js(v.name)} = overlay(${view.base}, [\n${view.layout.map((f) => `${"  ".repeat(depth + 1)}${f},`).join("\n")}\n${"  ".repeat(depth)}]${view.offset ? `, ${view.offset}` : ""});`);
        return;
      }
      todos.push({ line: v.line, why: `${v.storage} ${v.name}` });
      emit(depth, `// TODO: ${v.name} is ${v.storage} ${v.base ?? ""}: here its own storage, not an overlay, line ${v.line}`);
    }
    if (v.external) return emit(depth, `EXTERNAL.${js(v.name)} ??= ${initialOf(v, depth, at)};`);
    emit(depth, `${v.storage === "CONSTANT" ? "const" : "let"} ${js(v.name)} = ${initialOf(v, depth, at)};`);
  };

  /**
   * The layout of a message's I/O area, its fields after LL and ZZ; of a
   * record, its numbers as wide as their digits; or of an overlay, a scalar
   * one as the field `$`.
   * @param {Variable} area
   * @param {"message" | "record" | "overlay"} [mode]
   */
  const layoutOf = (area, mode = "message") => {
    /** @type {string[]} */
    const fields = [];
    /** @param {Variable} field @param {(string | number)[]} path */
    const place = (field, path) => {
      const dims = field.dims ? bounds(field.dims) : [];
      if (dims.length > 1 || dims.some((d) => d === null)) throw new Error(`${field.qualified} has bounds a layout cannot take`);
      const paths = dims.length ? Array.from({ length: /** @type {{ length: number }} */ (dims[0]).length }, (_, i) => [...path, i]) : [path];
      for (const at of paths) {
        if (kindOf(field) === "structure") {
          for (const child of children.get(field.id) ?? []) place(child, [...at, /** @type {string} */ (keys.get(child.id))]);
          continue;
        }
        const length = mode === "record" ? textWidth(field) : bytes(field);
        if (!length) throw new Error(`the length of ${field.qualified} is not known`);
        const kind = kindOf(field) === "pic" ? "PIC" : ["char", "varchar", "bits"].includes(kindOf(field)) ? "CHAR" : mode !== "message" && kindOf(field) === "bit" ? "BIT" : "NUMBER";
        fields.push(JSON.stringify([at, kind, field.size ?? "", length]));
      }
    };
    if (kindOf(area) !== "structure") place(area, area.dims ? [] : ["$"]);
    else for (const child of children.get(area.id) ?? []) place(child, [/** @type {string} */ (keys.get(child.id))]);
    if (mode !== "message") return fields;
    const header = (children.get(area.id) ?? []).slice(0, 2).filter((f) => f.type === "FIXED BIN").length;
    return fields.slice(header);
  };

  const LAYOUT_KINDS = {
    record: { suffix: "RECORD", where: "a record" },
    overlay: { suffix: "FIELDS", where: "a segment" },
    message: { suffix: "LAYOUT", where: "a message, after LL and ZZ" },
  };
  /**
   * The name of the module constant holding a structure's layout, written once.
   * @param {Variable} area @param {"message" | "record" | "overlay"} mode
   * @returns {{ name: string } | string} the reason when it has no layout
   */
  const layoutConstant = (area, mode) => {
    const { suffix, where } = LAYOUT_KINDS[mode];
    const name = `${js(area.qualified.replace(/\./g, "_"))}_${suffix}`;
    if (layouts.has(name)) return { name };
    try {
      const fields = layoutOf(area, mode).map((f) => `  ${f},`).join("\n");
      layouts.set(name, `/** Where the fields of ${area.qualified} lie in ${where}. @type {import("../runtime.js").Layout} */\nconst ${name} = [\n${fields}\n];`);
      return { name };
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  /** The record file a reference means, null when it is no declared record file. @param {Node | null | undefined} node @param {At} at */
  const recordFile = (node, at) => {
    const v = node && variableAt(node.text.replace(/\s+/g, "").toUpperCase(), at);
    return v && v.type === "FILE" && !isStream(v) ? v : null;
  };

  /**
   * A declared file, or SYSPRINT and SYSIN undeclared, as code; null when
   * the reference is no file.
   * @param {Node | null | undefined} node
   * @param {At} at
   * @returns {{ code: string, record: boolean } | null}
   */
  const fileAt = (node, at) => {
    if (!node) return null;
    const name = node.text.replace(/\s+/g, "").toUpperCase();
    const v = variableAt(name, at);
    if (v?.type === "FILE") return { code: js(v.name), record: !isStream(v) };
    return name === "SYSPRINT" || name === "SYSIN" ? { code: `standardFiles.${name}`, record: false } : null;
  };

  /**
   * A format list as FormatItems, repeat factors expanded; the reason when
   * it cannot be one.
   * @param {Node} list a format_list, or a format_item with a factor
   * @returns {string[] | string}
   */
  const formatOf = (list) => {
    /** @type {string[]} */
    const items = [];
    for (const item of list.namedChildren) {
      if (item?.type !== "format_item") continue;
      const factor = item.childForFieldName("factor");
      if (factor) {
        if (!/^\d+$/.test(factor.text)) return `the repeat factor ${factor.text}`;
        const inner = formatOf(item);
        if (typeof inner === "string") return inner;
        for (let i = 0; i < Number(factor.text); i++) items.push(...inner);
        continue;
      }
      const code = item.namedChildren.find((c) => c?.type === "identifier")?.text.toUpperCase();
      if (code === "R") {
        const label = item.namedChildren.find((c) => c?.type === "argument_list")?.namedChildren[0]?.text.toUpperCase() ?? "";
        const remote = formats.get(label)?.namedChildren.find((c) => c?.type === "format_list");
        if (!remote || remote === list) return `the format item ${item.text}, which is no FORMAT statement`;
        const inner = formatOf(remote);
        if (typeof inner === "string") return inner;
        items.push(...inner);
        continue;
      }
      if (!code) return `the format item ${item.text}`;
      const pic = item.namedChildren.find((c) => c?.type === "string_literal");
      const args = item.namedChildren.find((c) => c?.type === "argument_list")?.namedChildren.filter((c) => c?.type === "argument").map((c) => c?.text ?? "") ?? [];
      if (args.some((a) => !/^\d+$/.test(a))) return `the format item ${item.text} with a computed width`;
      items.push(JSON.stringify([code, ...(pic ? [pic.text.slice(1, -1).replace(/''/g, "'")] : args.map(Number))]));
    }
    return items;
  };

  /**
   * GET DATA: each `NAME=value` read goes to the variable of its name, by
   * its qualified name or, when only one has it, its own; an array element
   * by its subscripts. Without a list every variable in scope may be named.
   * @param {Node} node @param {Node[]} items @param {string} source @param {string} controlArg
   * @param {number} depth @param {At} at
   */
  const getData = (node, items, source, controlArg, depth, at) => {
    /** @type {Variable[]} */
    let roots;
    if (items.length) {
      const targets = items.map((c) => (c.type === "reference" && !c.namedChildren.some((a) => a?.type === "argument") ? expr(c, at).v : undefined));
      if (targets.some((v) => !v)) return todoStatement(node, depth, "GET DATA into something that is no variable");
      roots = /** @type {Variable[]} */ (targets);
    } else {
      roots = [...at.scopes, null].flatMap((scope) => variables.filter((v) => v.scope === scope && v.parent === null));
    }
    /** @type {{ v: Variable, code: string }[]} */
    const leaves = [];
    /** @param {Variable} v @param {string} code @returns {boolean} */
    const add = (v, code) => {
      if (kindOf(v) === "structure") return !v.dims && fieldsOf(v).every((f) => add(f, `${code}.${keys.get(f.id)}`));
      if (["unknown", "pointer"].includes(kindOf(v))) return true;
      const dims = v.dims ? bounds(v.dims) : [];
      if (dims.some((d) => d === null)) return false;
      leaves.push({ v, code: code + dims.map((d, k) => `[subscripts[${k}] - ${d?.lower}]`).join("") });
      return true;
    };
    for (const v of roots) {
      if (!add(v, pathOf(v, [], node, at).code) && items.length) return todoStatement(node, depth, `GET DATA of ${v.qualified}, an array of structures or with bounds that are not constants`);
    }
    /** @type {Map<string, number>} */
    const owners = new Map();
    for (const { v } of leaves) owners.set(v.name.toUpperCase(), (owners.get(v.name.toUpperCase()) ?? 0) + 1);
    emit(depth, "{");
    emit(depth + 1, `const items = await ${source}.getData(${controlArg.slice(2)});`);
    emit(depth + 1, "for (const { name, subscripts, value } of items ?? []) {");
    emit(depth + 2, "switch (name) {");
    const seen = new Set();
    for (const { v, code } of leaves) {
      const names = [v.qualified.toUpperCase(), ...(owners.get(v.name.toUpperCase()) === 1 ? [v.name.toUpperCase()] : [])].filter((n) => !seen.has(n));
      if (!names.length) continue;
      for (const name of names) {
        seen.add(name);
        emit(depth + 3, `case ${JSON.stringify(name)}:`);
      }
      emit(depth + 4, `${code} = ${convert(v, { code: "value", kind: "unknown" })};`);
      emit(depth + 4, "break;");
    }
    emit(depth + 3, "default:");
    emit(depth + 4, "throw new Error(`[PLG073E] GET DATA read ${name}, which is not in its data list`);");
    emit(depth + 2, "}");
    emit(depth + 1, "}");
    emit(depth, "}");
  };

  /**
   * PUT and GET: to and from a stream file, SYSPRINT and SYSIN, or a string.
   * @param {Node} node
   * @param {number} depth
   * @param {At} at
   */
  const streamIo = (node, depth, at) => {
    const verb = node.type === "put_statement" ? "PUT" : "GET";
    if (node.namedChildren.some((c) => c?.type === "ERROR")) return todoStatement(node, depth, `${verb} the parser does not read`);
    /** @type {Node | null} */
    let fileNode = null;
    /** @type {Node | null} */
    let stringNode = null;
    /** @type {string[]} */
    const control = [];
    for (const option of node.namedChildren) {
      if (option?.type !== "io_option") continue;
      const word = option.child(0)?.text.toUpperCase();
      const value = option.namedChildren[0];
      if (word === "FILE" && value) fileNode = value;
      else if (word === "STRING" && value) stringNode = value;
      else if (word === "SKIP" || word === "LINE") control.push(`${word.toLowerCase()}: ${value ? expr(value, at).code : 1}`);
      else if (word === "PAGE") control.push("page: true");
      else return todoStatement(node, depth, `${verb} with ${option.text}`);
    }
    const controlArg = control.length ? `, { ${control.join(", ")} }` : "";
    const file = fileNode ? fileAt(fileNode, at) : { code: `standardFiles.${verb === "PUT" ? "SYSPRINT" : "SYSIN"}`, record: false };
    if (!file || file.record) return todoStatement(node, depth, `${verb} on a file that is no stream file`);
    const string = stringNode ? expr(stringNode, at) : null;
    if (string && !string.v && verb === "PUT") return todoStatement(node, depth, `PUT STRING on ${stringNode?.text}, no variable`);

    const spec = node.namedChildren.find((c) => c?.type === "data_spec");
    if (!spec) {
      if (verb === "GET" || string) return todoStatement(node, depth, `${verb} without data`);
      return emit(depth, `${file.code}.control(${controlArg.slice(2)});`);
    }
    const kind = spec.children.find((c) => c !== null && ["list", "edit", "data"].includes(c.type))?.type ?? "list";
    const itemNodes = spec.namedChildren.filter((c) => c?.type === "data_list_item").map((c) => /** @type {Node} */ (c));
    const repeated = itemNodes.some((c) => c.namedChildren[0]?.type === "data_list_item");
    const items = itemNodes.map((c) => /** @type {Node} */ (c.namedChildren[0]));
    const formatNode = spec.namedChildren.find((c) => c?.type === "format_list");
    const format = kind === "edit" && formatNode ? formatOf(formatNode) : [];
    if (typeof format === "string") return todoStatement(node, depth, format);
    const formatArg = `[${format.join(", ")}]`;
    /**
     * Each data item through `leaf`, a repeated one inside its loop; false
     * when `leaf` refuses an item or a loop cannot be one.
     * @param {Node[]} list data_list_items @param {number} d @param {(item: Node, d: number) => boolean} leaf
     * @returns {boolean}
     */
    const eachItem = (list, d, leaf) => {
      for (const item of list) {
        const first = /** @type {Node} */ (item.namedChildren[0]);
        if (first.type !== "data_list_item") {
          if (!leaf(first, d)) return false;
          continue;
        }
        const control = item.childForFieldName("control");
        const header = control && forOf(control, item, at);
        if (!header) return false;
        emit(d, header);
        if (!eachItem(/** @type {Node[]} */ (item.namedChildren.filter((c) => c?.type === "data_list_item")), d + 1, leaf)) return false;
        emit(d, "}");
      }
      return true;
    };
    const mark = lines.length;

    if (verb === "PUT") {
      if (kind === "data" && (repeated || items.some((c) => c.type !== "reference"))) return todoStatement(node, depth, "PUT DATA of an expression or a repeated item");
      let d = depth;
      let values = repeated ? "values" : `[${items.map((c) => expr(c, at).code).join(", ")}]`;
      if (repeated) {
        emit(depth, "{");
        emit(depth + 1, "const values = [];");
        d = depth + 1;
        const pushed = eachItem(itemNodes, d, (item, itemDepth) => {
          emit(itemDepth, `values.push(${expr(item, at).code});`);
          return true;
        });
        if (!pushed) {
          lines.length = mark;
          return todoStatement(node, depth, "PUT of a repeated item with a range that waits on something");
        }
      }
      const call =
        kind === "edit"
          ? `edit(${values}, ${formatArg}${controlArg})`
          : kind === "data"
            ? `data([${items.map((c) => `[${JSON.stringify(c.text.replace(/\s+/g, "").toUpperCase())}, ${expr(c, at).code}]`).join(", ")}]${controlArg})`
            : `list(${values}${controlArg})`;
      if (!string?.v) emit(d, `${file.code}.${call};`);
      else emit(d, `${string.code} = ${convert(string.v, { code: `new Stream().${call}.text()`, kind: "char" })};`);
      if (repeated) emit(depth, "}");
      return;
    }

    const source = string ? `new Stream(${asString(string)})` : file.code;
    if (kind === "data") return getData(node, items, source, controlArg, depth, at);
    /** @param {Node} item */
    const scalar = (item) => {
      const t = expr(item, at);
      return t.v && t.kind !== "structure" ? { ...t, v: t.v } : null;
    };
    if (repeated) {
      emit(depth, "{");
      emit(depth + 1, "let count = 0;");
      let ok = eachItem(itemNodes, depth + 1, (item, d) => {
        if (!scalar(item)) return false;
        emit(d, "count++;");
        return true;
      });
      emit(depth + 1, `const values = await ${source}.${kind === "edit" ? `getEdit(count, ${formatArg}` : "getList(count"}${controlArg});`);
      emit(depth + 1, "if (values) {");
      emit(depth + 2, "let k = 0;");
      ok &&= eachItem(itemNodes, depth + 2, (item, d) => {
        const t = /** @type {Expr & { v: Variable }} */ (scalar(item));
        emit(d, `${t.code} = ${convert(t.v, { code: "values[k++]", kind: "unknown" })};`);
        return true;
      });
      emit(depth + 1, "}");
      emit(depth, "}");
      if (ok) return;
      lines.length = mark;
      return todoStatement(node, depth, "GET of a repeated item into something that is no scalar variable, or with a range that waits on something");
    }
    const targets = items.map((c) => expr(c, at));
    if (targets.some((t) => !t.v || t.kind === "structure")) return todoStatement(node, depth, "GET into something that is no scalar variable");
    emit(depth, "{");
    emit(depth + 1, `const values = await ${source}.${kind === "edit" ? `getEdit(${targets.length}, ${formatArg}` : `getList(${targets.length}`}${controlArg});`);
    emit(depth + 1, "if (values) {");
    targets.forEach((t, i) => emit(depth + 2, `${t.code} = ${convert(/** @type {Variable} */ (t.v), { code: `values[${i}]`, kind: "unknown" })};`));
    emit(depth + 1, "}");
    return emit(depth, "}");
  };

  /**
   * The area a record is read into or written from, and its layout: a
   * structure's is a module constant, a whole CHAR has none.
   * @param {Node} node
   * @param {At} at
   * @returns {{ area: Expr, layout: string } | string} the reason when it cannot be one
   */
  const recordArea = (node, at) => {
    const area = expr(node, at);
    if (!area.v) return `the record area ${node.text} is not a variable`;
    if (area.kind === "char" || area.kind === "varchar") return { area, layout: "null" };
    if (area.kind !== "structure") return `the record area ${node.text} is neither a structure nor CHAR`;
    const layout = layoutConstant(area.v, "record");
    return typeof layout === "string" ? layout : { area, layout: layout.name };
  };

  /** A key as the text a keyed file holds. @param {Node} node @param {At} at */
  const keyOf = (node, at) => {
    const key = expr(node, at);
    return ["char", "varchar", "literal", "string", "pic"].includes(key.kind) ? asString(key) : `String(${key.code})`;
  };

  /**
   * READ, WRITE, REWRITE and DELETE on a record file.
   * @param {Node} node
   * @param {number} depth
   * @param {At} at
   */
  const recordIo = (node, depth, at) => {
    const verb = node.type.replace(/_statement$/, "").toUpperCase();
    const file = recordFile(node.childForFieldName("file"), at);
    if (!file) return todoStatement(node, depth, `${verb} on a file that is no declared record file`);
    /** @type {Record<string, Node>} */
    const options = {};
    for (const option of node.namedChildren) {
      if (option?.type !== "read_option" && option?.type !== "write_option") continue;
      const value = option.namedChildren[0];
      if (value) options[option.child(0)?.text.toUpperCase() ?? ""] = value;
    }
    const keyNode = options.KEY ?? options.KEYFROM ?? node.childForFieldName("key");
    const key = keyNode ? `, ${keyOf(keyNode, at)}` : "";
    const unknown = Object.keys(options).find((o) => !["INTO", "FROM", "KEY", "KEYFROM", "KEYTO"].includes(o));
    if (unknown) return todoStatement(node, depth, `${verb} with ${unknown}`);
    const name = js(file.name);
    if (verb === "DELETE") return emit(depth, `await ${name}.delete(${key.slice(2)});`);
    const areaNode = verb === "READ" ? options.INTO : options.FROM;
    if (!areaNode) return todoStatement(node, depth, `${verb} without ${verb === "READ" ? "INTO" : "FROM"}`);
    const record = recordArea(areaNode, at);
    if (typeof record === "string") return todoStatement(node, depth, record);
    const { area, layout } = record;
    if (verb !== "READ") return emit(depth, `await ${name}.${verb.toLowerCase()}(${area.code}, ${layout}${key});`);
    const read = `await ${name}.read(${layout === "null" ? "null" : area.code}, ${layout}${key})`;
    const keyTo = options.KEYTO && expr(options.KEYTO, at);
    if (keyTo && !keyTo.v) return todoStatement(node, depth, `KEYTO ${options.KEYTO.text}, which is not a variable`);
    if (layout === "null" && keyTo) return todoStatement(node, depth, "READ INTO a CHAR with KEYTO");
    if (layout === "null") return emit(depth, `${area.code} = ${convert(/** @type {Variable} */ (area.v), { code: `(${read})?.text ?? ${area.code}`, kind: "string" })};`);
    if (keyTo) return emit(depth, `${keyTo.code} = ${convert(/** @type {Variable} */ (keyTo.v), { code: `(${read})?.key ?? ${keyTo.code}`, kind: "string" })};`);
    emit(depth, `${read};`);
  };

  /** @param {Node} node a call_statement @param {number} depth @param {At} at */
  const call = (node, depth, at) => {
    const entry = node.childForFieldName("entry");
    const name = entry?.namedChildren.find((c) => c?.type === "identifier")?.text.toUpperCase() ?? "";
    const args = node.namedChildren.find((c) => c?.type === "argument_list")?.namedChildren.filter((c) => c?.type === "argument") ?? [];
    const d = dli.get(at.line);
    if (d) {
      const fn = d.function?.trim();
      const dbd = d.pcb ? pcbDbds.get(d.pcb.toUpperCase()) : undefined;
      if (dbd) {
        if (d.entry.toUpperCase() === "AIBTDLI") return todoStatement(node, depth, `the AIBTDLI call ${fn ?? ""}`);
        if (!fn) return todoStatement(node, depth, "a DL/I call whose function is not known");
        const [pcbArg, areaArg, ...ssaArgs] = args.slice(d.entry.toUpperCase() === "PLITDLI" ? 2 : 1).map((a) => /** @type {Node} */ (/** @type {Node} */ (a).namedChildren[0]));
        const pcb = pcbArg && expr(pcbArg, at);
        const area = areaArg && expr(areaArg, at);
        if (!pcb || !area?.v) return todoStatement(node, depth, `the DL/I call ${fn} without a PCB and an I/O area variable`);
        let areaCode = area.code;
        let layout = "null";
        if (kindOf(area.v) === "structure") {
          const fields = layoutConstant(area.v, "overlay");
          if (typeof fields === "string") return todoStatement(node, depth, fields);
          layout = fields.name;
        } else areaCode = `new Ref(() => ${area.code}, (v) => { ${area.code} = v; })`;
        const ssas = ssaArgs.map((a) => expr(a, at).code);
        dbdsUsed.add(dbd);
        return emit(depth, `await dli(${JSON.stringify(fn)}, ${pcb.code}, ${areaCode}, ${layout}, [${ssas.join(", ")}], ${js(dbd)});`);
      }
      if (d.pcb_parameter === 1 && (fn === "GU" || fn === "ISRT") && d.io_area && d.pcb) {
        const area = variableAt(d.io_area.toUpperCase(), at);
        const pcb = variableAt(d.pcb.toUpperCase(), at);
        if (!area || !pcb || kindOf(area) !== "structure") return todoStatement(node, depth, `the I/O area ${d.io_area} is not a structure`);
        const layout = layoutConstant(area, "message");
        if (typeof layout === "string") return todoStatement(node, depth, layout);
        return emit(depth, `await ims.${fn.toLowerCase()}(${pathOf(pcb, [], node, at).code}, ${pathOf(area, [], node, at).code}, ${layout.name});`);
      }
      if (d.pcb_parameter === 1 && fn === "GN") {
        const pcb = d.pcb ? variableAt(d.pcb.toUpperCase(), at) : undefined;
        if (pcb) return emit(depth, `${pathOf(pcb, [], node, at).code}.STATUS = "QD"; // GN: the messages here have one segment`);
      }
      return todoStatement(node, depth, d.pcb_parameter === 1 ? `the DL/I call ${fn ?? ""} on the I/O PCB` : `the IMS database call ${fn ?? ""}`);
    }
    const argNodes = args.map((a) => /** @type {Node} */ (/** @type {Node} */ (a).namedChildren[0]));
    const internal = procedures.find((p) => p.name.toUpperCase() === name);
    if (internal) return emit(depth, invoke(name, internal.id, argNodes, at));
    const external = externalCalls.get(`${at.line}:${name}`);
    if (external) {
      imports.set(js(external.name), external.member);
      calls.add(external.path);
      return emit(depth, invoke(external.name, external.id, argNodes, at));
    }
    if (name === "PLIRETC" && argNodes.length === 1) return emit(depth, `setReturnCode(${expr(argNodes[0], at).code});`);
    todoStatement(node, depth, `CALL ${name}, a program not in the graph`);
  };

  /**
   * A CALL, the parameters the procedure changes assigned back to the
   * variables passed for them.
   * @param {string} name
   * @param {number} procedure
   * @param {Node[]} argNodes
   * @param {At} at
   */
  const invoke = (name, procedure, argNodes, at) => {
    const args = argNodes.map((a) => expr(a, at));
    const call = `await ${js(name)}(${args.map((a) => a.code).join(", ")})`;
    const back = changedBy(procedure)
      .map((p) => ({ key: js(p.name), arg: args[p.parameter - 1] }))
      .filter((p) => p.arg?.v && p.arg.kind !== "structure");
    return back.length ? `({ ${back.map((p) => `${p.key}: ${p.arg.code}`).join(", ")} } = ${call});` : `${call};`;
  };

  /** @param {Node} node an exec_statement @param {number} depth @param {At} at */
  const execSql = (node, depth, at) => {
    const text = node.text
      .replace(/^EXEC\s+SQL\s+/i, "")
      .replace(/\s*;\s*$/, "")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    const verb = text.split(/\s+/)[0].toUpperCase();
    const sqlcode = variableAt("SQLCODE", at);
    const sqlcodeCode = sqlcode ? pathOf(sqlcode, [], node, at).code : "SQLCODE";
    /** @param {string} name */
    const host = (name) => {
      const v = variableAt(name, at);
      return v ? pathOf(v, [], node, at) : todoExpr(node, `the host variable ${name} is not declared`, at);
    };
    /** @param {string} sqlText */
    const withParams = (sqlText) => {
      const found = hostVariables(sqlText);
      let out = sqlText;
      for (const h of [...found].reverse()) out = out.slice(0, h.index) + "?" + out.slice(h.index + h.length);
      return `${JSON.stringify(out)}, [${found.map((h) => host(h.name).code).join(", ")}]`;
    };
    /** @param {string} targets @param {string} row */
    const assignInto = (targets, row) => {
      for (const [i, h] of hostVariables(targets).entries()) {
        const target = host(h.name);
        emit(depth + 2, `${target.code} = ${target.v ? convert(target.v, { code: `${row}[${i}]`, kind: "unknown" }) : `${row}[${i}]`};`);
        if (h.indicator) emit(depth + 2, `${host(h.indicator).code} = ${row}[${i}] === null ? -1 : 0;`);
      }
    };
    if (verb === "INCLUDE" || (verb === "DECLARE" && /\bTABLE\b/i.test(text)) || /^(BEGIN|END)\s+DECLARE\b/i.test(text)) return emit(depth, `// EXEC SQL ${text}`);
    const cursor = DECLARE_CURSOR.exec(text);
    if (cursor) return emit(depth, `// EXEC SQL DECLARE ${cursor[1].toUpperCase()} CURSOR: run at its OPEN`);
    const open = /^OPEN\s+(\S+)$/i.exec(text);
    if (open) {
      const select = cursors.get(open[1].toUpperCase());
      if (!select) return todoStatement(node, depth, `the cursor ${open[1]} is not declared`);
      emit(depth, `CURSORS.${js(open[1])} = await openCursor(${withParams(select)});`);
      return emit(depth, `${sqlcodeCode} = CURSORS.${js(open[1])}.sqlcode;`);
    }
    const fetch = /^FETCH\s+(?:NEXT\s+)?(?:FROM\s+)?(\S+)\s+INTO\s+(.*)$/is.exec(text);
    if (fetch) {
      emit(depth, "{");
      emit(depth + 1, `const result = fetchCursor(CURSORS.${js(fetch[1])});`);
      emit(depth + 1, `${sqlcodeCode} = result.sqlcode;`);
      emit(depth + 1, "if (result.row) {");
      assignInto(fetch[2], "result.row");
      emit(depth + 1, "}");
      return emit(depth, "}");
    }
    const close = /^CLOSE\s+(\S+)$/i.exec(text);
    if (close) {
      emit(depth, `delete CURSORS.${js(close[1])};`);
      return emit(depth, `${sqlcodeCode} = 0;`);
    }
    if (verb === "WHENEVER" || verb === "PREPARE" || verb === "EXECUTE" || verb === "DESCRIBE" || verb === "DECLARE") {
      return todoStatement(node, depth, `EXEC SQL ${verb}`);
    }
    const selectInto = /^(SELECT\b.*?)\bINTO\b(.*?)\b(FROM\b.*)$/is.exec(text);
    emit(depth, "{");
    emit(depth + 1, `const result = await sql(${withParams(selectInto ? `${selectInto[1]}${selectInto[3]}` : text)});`);
    emit(depth + 1, `${sqlcodeCode} = result.sqlcode;`);
    if (selectInto) {
      emit(depth + 1, "if (result.rows.length) {");
      assignInto(selectInto[2], "result.rows[0]");
      emit(depth + 1, "}");
    }
    emit(depth, "}");
  };

  /** The labels of a statement, also those on the END closing a group: a GOTO there ends the pass. @param {Node} node */
  const labelsOf = (node) =>
    node.type === "labeled_statement" || node.type === "end_statement"
      ? node.namedChildren.filter((c) => c?.type === "statement_prefix").map((c) => c?.childForFieldName("label")?.text.toUpperCase() ?? "")
      : [];

  /**
   * Statements in order. When a GOTO goes to one of them, they run in a
   * dispatcher: a loop around a switch with a case per label, which a GOTO
   * in the same function enters with `continue`, and one from an ON unit or
   * an internal procedure by throwing GoTo.
   * @param {(Node | null)[]} nodes @param {number} depth @param {At} at
   */
  const statementList = (nodes, depth, at) => {
    const targets = nodes.flatMap((n) => (n ? labelsOf(n).filter((l) => gotoTargets.has(l)) : []));
    const start = at.start ?? '""';
    at = { ...at, start: undefined };
    if (!targets.length) {
      for (const node of nodes) if (node && node.type !== "end_statement") statement(node, depth, at);
      return;
    }
    const name = `goto${++dispatchers}`;
    const inner = { ...at, loops: [...at.loops, /** @type {"dispatch"} */ ("dispatch")], gotos: new Map([...at.gotos, ...targets.map((l) => /** @type {[string, string]} */ ([l, name]))]) };
    emit(depth, `let ${name} = ${start};`);
    emit(depth, `${name}: for (;;) {`);
    emit(depth + 1, "try {");
    emit(depth + 2, `switch (${name}) {`);
    emit(depth + 3, `case "":`);
    for (const node of nodes) {
      if (!node) continue;
      for (const label of labelsOf(node).filter((l) => gotoTargets.has(l))) emit(depth + 3, `case ${JSON.stringify(label)}:`);
      if (node.type !== "end_statement") statement(node, depth + 4, inner);
    }
    emit(depth + 2, "}");
    emit(depth + 1, "} catch (error) {");
    emit(depth + 2, `${name} = await landing(error, [${targets.map((l) => JSON.stringify(l)).join(", ")}]);`);
    emit(depth + 2, `continue ${name};`);
    emit(depth + 1, "}");
    emit(depth + 1, "break;");
    emit(depth, "}");
  };

  /** The statements of a DO group, or the one statement. @param {Node} node @param {number} depth @param {At} at */
  const body = (node, depth, at) => {
    if (node.type !== "do_statement" || node.namedChildren.some((c) => c?.type === "do_specification")) return statement(node, depth, at);
    const group = groupOf(node);
    if (group === "group") return statementList(node.namedChildren, depth, { ...at, loops: [...at.loops, group] });
    emit(depth, `${group}: {`);
    statementList(node.namedChildren, depth + 1, { ...at, loops: [...at.loops, group] });
    emit(depth, "}");
  };

  /**
   * A DO group's JS block label when an unlabeled LEAVE in it ends it, else
   * "group": PL/I's LEAVE ends the innermost DO, a loop or not.
   * @param {Node} node a do_statement
   */
  const groupOf = (node) => {
    /** @param {Node} n @returns {boolean} */
    const leaves = (n) =>
      n.namedChildren.some((c) => c !== null && c.type !== "do_statement" && ((c.type === "leave_statement" && !c.namedChildren.some((i) => i?.type === "identifier")) || leaves(c)));
    return leaves(node) ? `group${++groups}` : "group";
  };

  /** @param {Node} node a do_statement @param {number} depth @param {At} at @param {string | null} label */
  const doLoop = (node, depth, at, label) => {
    const spec = node.namedChildren.find((c) => c?.type === "do_specification");
    const inner = node.namedChildren.filter((c) => c !== null && c.type !== "do_specification");
    const prefix = label ? `${js(label)}: ` : "";
    /** @param {string} open @param {string} close @param {string} kind */
    const block = (open, close, kind) => {
      emit(depth, `${prefix}${open}`);
      statementList(inner, depth + 1, { ...at, loops: [...at.loops, kind] });
      emit(depth, close);
    };
    if (!spec && label) return block("{", "}", js(label));
    if (!spec) {
      const group = groupOf(node);
      return block(group === "group" ? "{" : `${group}: {`, "}", group);
    }
    const tokens = spec.children.filter((c) => c !== null);
    /** @param {string} word */
    const after = (word) => {
      const i = tokens.findIndex((c) => !c.isNamed && c.type === word);
      return i < 0 ? undefined : tokens.slice(i + 1).find((c) => c.isNamed);
    };
    if (tokens.some((c) => c.type === "forever")) return block("for (;;) {", "}", "loop");
    const control = spec.childForFieldName("control");
    if (!control) {
      const whileNode = after("while");
      const untilNode = after("until");
      const w = whileNode && expr(whileNode, at).code;
      const u = untilNode && expr(untilNode, at).code;
      if (w && !u) return block(`while (${w}) {`, "}", "loop");
      // PL/I tests UNTIL after each pass: a continue (ITERATE) must get there too.
      if (u) {
        emit(depth, `${prefix}do {`);
        if (w) emit(depth + 1, `if (!(${w})) break;`);
        statementList(inner, depth + 1, { ...at, loops: [...at.loops, "loop"] });
        return emit(depth, `} while (!(${u}));`);
      }
      return todoStatement(node, depth, "a DO this generator does not know");
    }
    const header = forOf(control, spec, at);
    if (!header) return todoStatement(node, depth, "a DO with a range that waits on something");
    block(header, "}", "loop");
  };

  /**
   * The `for` of an iterative DO, or of a repeated data item: one range as
   * `for (V = from; V <= to; V += by)`, single values as `for (V of [...])`,
   * else a generator running the ranges one after the other (REPEAT, UNTIL,
   * several ranges); the loop variable is shared, so the body may change it.
   * @param {Node} control the loop variable
   * @param {Node} spec holding the do_specification_elements
   * @param {At} at
   * @returns {string | null} null when a range awaits, which a generator cannot
   */
  const forOf = (control, spec, at) => {
    const variable = expr(control, at).code;
    /** @param {Node} element @param {string} word */
    const after = (element, word) => {
      const i = element.children.findIndex((c) => c?.type === word);
      const n = i < 0 ? null : element.child(i + 2);
      return n ? expr(n, at).code : null;
    };
    /** @param {string} field @param {Node} element */
    const field = (field, element) => {
      const n = element.childForFieldName(field);
      return n ? expr(n, at).code : null;
    };
    const ranges = spec.namedChildren
      .filter((c) => c?.type === "do_specification_element")
      .map((e) => {
        const element = /** @type {Node} */ (e);
        return { from: field("from", element) ?? "", to: field("to", element), by: field("by", element) ?? "1", repeat: field("repeat", element), w: after(element, "while"), u: after(element, "until") };
      });
    /** @param {typeof ranges[number]} r */
    const test = (r) =>
      /^\d/.test(r.by) ? `${variable} <= ${r.to}` : /^-\d/.test(r.by) ? `${variable} >= ${r.to}` : `(${r.by} >= 0 ? ${variable} <= ${r.to} : ${variable} >= ${r.to})`;
    if (ranges.length > 1 && ranges.every((r) => !r.to && !r.repeat && !r.w && !r.u)) return `for (${variable} of [${ranges.map((r) => r.from).join(", ")}]) {`;
    const [one] = ranges;
    if (ranges.length === 1 && one.to && !one.u) return `for (${variable} = ${one.from}; ${test(one)}${one.w ? ` && (${one.w})` : ""}; ${variable} += ${one.by}) {`;
    const loops = ranges.map((r) => {
      const conditions = [r.to && test(r), r.w && `(${r.w})`].filter(Boolean).join(" && ");
      const next = r.repeat ? `${variable} = ${r.repeat}` : r.to ? `${variable} += ${r.by}` : null;
      if (!next) return `${variable} = ${r.from}; if (${conditions || "true"}) yield;`;
      return `for (${variable} = ${r.from}; ${conditions}; ${next}) { yield;${r.u ? ` if (${r.u}) break;` : ""} }`;
    });
    if (loops.some((l) => l.includes("await"))) return null;
    return `for (const _ of (function* () { ${loops.join(" ")} })()) {`;
  };

  /** @param {Node} node a select_statement @param {number} depth @param {At} at */
  const select = (node, depth, at) => {
    const named = /** @type {Node[]} */ (node.namedChildren.filter((c) => c !== null));
    const subjectNode = named.find((c) => c.type !== "when_clause" && c.type !== "otherwise_clause" && c.type !== "end_statement" && c.type !== "comment");
    const subject = subjectNode && expr(subjectNode, at);
    let first = true;
    for (const clause of named) {
      if (clause.type === "when_clause") {
        const parts = /** @type {Node[]} */ (clause.namedChildren.filter((c) => c !== null && c.type !== "comment"));
        const action = /** @type {Node} */ (parts.pop());
        const tests = parts.map((p) => {
          const value = expr(p, at);
          if (!subject) return value.code;
          const padded = value.kind === "literal" && subject.v && subject.kind === "char" && value.text !== undefined ? JSON.stringify(value.text.padEnd(charLength(subject.v))) : value.code;
          return `${subject.code} === ${padded}`;
        });
        emit(depth, `${first ? "if" : "} else if"} (${tests.join(" || ")}) {`);
        body(action, depth + 1, at);
        first = false;
      } else if (clause.type === "otherwise_clause") {
        const action = clause.namedChildren.find((c) => c !== null && c.type !== "comment");
        emit(depth, first ? "{" : "} else {");
        if (action) body(action, depth + 1, at);
        emit(depth, "}");
        return;
      }
    }
    if (first) return emit(depth, `noWhen(${JSON.stringify(`${path}:${at.line}`)});`);
    emit(depth, "} else {");
    emit(depth + 1, `noWhen(${JSON.stringify(`${path}:${at.line}`)});`);
    emit(depth, "}");
  };

  /** The data fields of a structure. @param {Variable} v */
  const fieldsOf = (v) => (children.get(v.id) ?? []).filter((f) => !NOT_DATA.has(f.type ?? ""));
  /** Names, types and dimensions of a variable and its fields. @param {Variable} v @returns {string} */
  const shapeOf = (v) => `${v.name}:${v.type}:${v.size}:${v.dims}(${fieldsOf(v).map(shapeOf).join(",")})`;

  /**
   * Assigns to every element and field of `t`: a loop per dimension, the
   * fields of a structure matched by position or, BY NAME, by name. The
   * source is a scalar or a structure for all elements, or an array of the
   * same shape. False when the shapes do not match.
   * @param {Variable} t @param {string} tCode
   * @param {Variable | null} s null when the value is a scalar @param {string} sCode @param {Expr} scalar
   * @param {boolean} byName @param {number} depth @param {number} level for the names of the loop counters
   * @returns {boolean}
   */
  const spread = (t, tCode, s, sCode, scalar, byName, depth, level) => {
    const tLengths = t.dims ? bounds(t.dims).map((b) => b?.length) : [];
    const sLengths = s?.dims ? bounds(s.dims).map((b) => b?.length) : [];
    if (s && sLengths.length && sLengths.join() !== tLengths.join()) return false;
    let d = depth;
    for (const _ of tLengths) {
      const i = `i${++level}`;
      emit(d++, `for (let ${i} = 0; ${i} < ${tCode}.length; ${i}++) {`);
      tCode += `[${i}]`;
      if (sLengths.length) sCode += `[${i}]`;
    }
    if (kindOf(t) === "structure") {
      const tFields = fieldsOf(t);
      const sFields = s && kindOf(s) === "structure" ? fieldsOf(s) : null;
      if (s && !sFields) return false;
      if (sFields && !byName && sFields.length !== tFields.length) return false;
      for (const [n, field] of tFields.entries()) {
        const source = !sFields ? null : byName ? sFields.find((f) => f.name.toUpperCase() === field.name.toUpperCase()) : sFields[n];
        if (sFields && !source) continue;
        if (byName && source && (kindOf(source) === "structure") !== (kindOf(field) === "structure")) continue;
        const sourceCode = source ? `${sCode}.${keys.get(source.id)}` : sCode;
        if (!spread(field, `${tCode}.${keys.get(field.id)}`, source ?? null, sourceCode, scalar, byName, d, level)) return false;
      }
    } else {
      if (s && kindOf(s) === "structure") return false;
      emit(d, `${tCode} = ${convert(t, s ? { code: sCode, kind: kindOf(s), v: s } : scalar)};`);
    }
    while (d > depth) emit(--d, "}");
    return true;
  };

  /** @param {Node} node an assignment_statement @param {number} depth @param {At} at */
  const assignment = (node, depth, at) => {
    const byName = node.children.some((c) => c?.type === "by");
    const valueNode = /** @type {Node} */ (node.childForFieldName("value"));
    const value = expr(valueNode, at);
    // A(I,*) is a cross-section: the path stops at I, the rest stays an array.
    const subscripted = (/** @type {Node} */ n) => {
      const subscripts = n.namedChildren.filter((c) => c?.type === "argument");
      return subscripts.length > 0 && subscripts.every((c) => c?.namedChildren.length);
    };
    for (const targetNode of node.childrenForFieldName("target")) {
      if (!targetNode) continue;
      const pseudo = targetNode.namedChildren.find((c) => c?.type === "builtin_name")?.text.toUpperCase();
      const structure = targetNode.namedChildren.find((c) => c?.type === "argument")?.namedChildren[0];
      if (pseudo === "STRING" && structure && expr(structure, at).kind === "structure") {
        // STRING(s) = x lays x over the structure's fields as a record.
        const record = recordArea(structure, at);
        if (typeof record === "string") return todoStatement(node, depth, record);
        emit(depth, `decode(${asString(value)}, ${record.area.code}, ${record.layout});`);
        continue;
      }
      const target = expr(targetNode, at);
      if (!target.v) return todoStatement(node, depth, `the target ${targetNode.text} is not a variable`);
      // A subscripted array of structures is one structure.
      const t = subscripted(targetNode) ? { ...target.v, dims: null } : target.v;
      if (!t.dims && target.kind !== "structure") {
        emit(depth, `${target.code} = ${convert(target.v, value)};`);
        continue;
      }
      const s = value.v && valueNode.type === "reference" ? (subscripted(valueNode) ? { ...value.v, dims: null } : value.v) : null;
      const source = s && (s.dims || kindOf(s) === "structure") ? s : null;
      if (source && !byName && kindOf(source) === "structure" && shapeOf(source) === shapeOf(t)) {
        emit(depth, `Object.assign(${target.code}, structuredClone(${value.code}));`);
        continue;
      }
      const mark = lines.length;
      const once = !source && value.kind !== "literal" && !/^-?[\d.]+$/.test(value.code);
      if (once) {
        emit(depth, "{");
        emit(depth + 1, `const value = ${value.code};`);
      }
      const scalar = once ? { ...value, code: "value" } : value;
      if (!spread(t, target.code, source, value.code, scalar, byName, once ? depth + 1 : depth, 0)) {
        lines.length = mark;
        return todoStatement(node, depth, `${targetNode.text} and ${valueNode.text} have different shapes`);
      }
      if (once) emit(depth, "}");
    }
  };

  /**
   * A procedure as an async function: the main one exported, internal ones
   * nested, each with its declarations at the top.
   * @param {Node} node a procedure_statement
   * @param {string} name
   * @param {number} line
   * @param {number} depth
   * @param {At} at
   */
  const procedure = (node, name, line, depth, at) => {
    const symbol =
      procedures.find((p) => p.name.toUpperCase() === name && p.line === line) ?? procedures.find((p) => p.name.toUpperCase() === name);
    if (!symbol) return todoStatement(node, depth, `the procedure ${name} is not in the graph`);
    const block = node.childForFieldName("body");
    /** @param {Node | null | undefined} n */
    const parametersOf = (n) =>
      n?.namedChildren
        .find((c) => c?.type === "parameter_list")
        ?.namedChildren.filter((c) => c?.type === "identifier")
        .map((c) => /** @type {Node} */ (c).text.toUpperCase()) ?? [];
    const heading = node.namedChildren.find((c) => c?.type === "procedure_heading");
    const parameters = parametersOf(heading);
    // An ENTRY statement starts the procedure's body at itself: the body is
    // one function the main procedure and each entry call with where to start.
    const entries = (block?.namedChildren ?? []).flatMap((c) => {
      const entry = c?.type === "labeled_statement" ? c.namedChildren.find((e) => e?.type === "entry_statement") : undefined;
      const label = c && labelsOf(c)[0];
      const id = procedures.find((p) => p.name.toUpperCase() === label && p.line === lineOf(c))?.id;
      return entry && label && id ? [{ name: label, id, parameters: parametersOf(entry) }] : [];
    });
    const changed = [...new Set([symbol.id, ...entries.map((e) => e.id)].flatMap((id) => changedBy(id).map((p) => js(p.name))))];
    /** @type {At} */
    const scope = { ...at, scopes: [symbol.id, ...at.scopes], loops: [], changed, gotos: new Map(), units: keepsUnits(node) };
    const own = variables.filter((v) => v.scope === symbol.id && v.parent === null);
    /** @type {Map<string, Variable>} */
    const params = new Map(
      variables.filter((v) => v.parameter !== null && v.parent === null && (v.scope === symbol.id || entries.some((e) => e.id === v.scope))).map((v) => [v.name.toUpperCase(), v]),
    );
    const allParameters = [...new Set([...parameters, ...entries.flatMap((e) => e.parameters)])];
    const comment = /** @type {{ comment: string | null }} */ (db.prepare(`SELECT comment FROM symbols WHERE id = ?`).get(symbol.id)).comment;
    /** @param {string[]} names */
    const jsdocParams = (names) => {
      for (const p of names) {
        const v = params.get(p);
        emit(depth, ` * @param {${v ? jsdocType(v) : "any"}} ${js(p)}${v ? ` ${v.attributes}` : ""}`);
      }
    };
    const exported = depth === 0 ? "export " : "";
    const guarded = depth === 0 && !/\bRECURSIVE\b/i.test(heading?.text ?? "");
    if (entries.length) {
      // The guard is on the entry point: real programs call their own ENTRY
      // while they run, but not the one they are in.
      for (const [entry, names] of [[name, parameters], ...entries.map((e) => [e.name, e.parameters])]) {
        const list = /** @type {string[]} */ (names).map(js).join(", ");
        emit(depth, `/** ${entry === name ? (comment ?? name).split("\n").map((t) => t.trim()).join(" ") : `ENTRY of ${name}`}`);
        jsdocParams(/** @type {string[]} */ (names));
        emit(depth, " */");
        emit(depth, `${exported}async function ${js(/** @type {string} */ (entry))}(${list}) {`);
        const run = `return await ${js(name)}$(${JSON.stringify(entry === name ? "" : entry)}, { ${list} });`;
        if (guarded) {
          emit(depth + 1, `begin(${JSON.stringify(entry)});`);
          emit(depth + 1, "try {");
          emit(depth + 2, run);
          emit(depth + 1, "} finally {");
          emit(depth + 2, `end(${JSON.stringify(entry)});`);
          emit(depth + 1, "}");
        } else emit(depth + 1, run);
        emit(depth, "}");
      }
      emit(depth, `/** ${name} and its entries, from the statement of the one called */`);
      emit(depth, `async function ${js(name)}$(entry, { ${allParameters.map(js).join(", ")} }) {`);
    } else {
      emit(depth, "/**");
      for (const text of (comment ?? name).split("\n")) emit(depth, ` * ${text.trim()}`);
      jsdocParams(parameters);
      emit(depth, " */");
      emit(depth, `${exported}async function ${js(name)}(${parameters.map(js).join(", ")}) {`);
    }
    if (changed.length && heading && /\bRETURNS\b/i.test(heading.text)) {
      todos.push({ line, why: `${name} returns a value and changes its parameters ${changed.join(", ")}` });
      emit(depth + 1, `// TODO: ${name} returns a value, so the changes to ${changed.join(", ")} do not reach the caller.`);
      scope.changed = [];
    }
    const declarations = [
      ...(depth === 0 ? variables.filter((v) => v.file !== file.id && v.parent === null) : []),
      ...own.filter((v) => v.parameter === null && !allParameters.includes(v.name.toUpperCase())),
    ];
    for (const v of declarations) {
      if (v.storage !== "STATIC" || v.external) {
        declare(v, depth + 1, scope, params);
        continue;
      }
      // STATIC keeps its value from one call to the next: a module variable.
      const mark = lines.length;
      declare(v, 0, scope, params);
      statics.push(...lines.splice(mark));
    }
    if (depth === 0 && usesSql && !variableAt("SQLCODE", scope)) emit(depth + 1, "let SQLCODE = 0;");
    if (depth === 0 && cursors.size) emit(depth + 1, "/** @type {Record<string, { sqlcode: number, rows: unknown[][], next: number }>} */\n" + "  ".repeat(depth + 1) + "const CURSORS = {};");
    if (entries.length) scope.start = "entry";
    const inside = guarded && !entries.length;
    const wrapped = scope.units || inside;
    const inner = wrapped ? depth + 2 : depth + 1;
    if (inside) emit(depth + 1, `begin(${JSON.stringify(name)});`);
    if (scope.units) emit(depth + 1, "const units = enter();");
    if (wrapped) emit(depth + 1, "try {");
    statementList(block?.namedChildren ?? [], inner, scope);
    if (scope.changed.length) emit(inner, `return { ${scope.changed.join(", ")} };`);
    if (scope.units) {
      emit(depth + 1, "} catch (error) {");
      emit(depth + 2, "throw await failed(error);");
    }
    if (wrapped) {
      emit(depth + 1, "} finally {");
      if (scope.units) emit(depth + 2, "leave(units);");
      if (inside) emit(depth + 2, `end(${JSON.stringify(name)});`);
      emit(depth + 1, "}");
    }
    emit(depth, "}");
  };

  /** A statement, counted as translated unless it got a TODO. @param {Node} node @param {number} depth @param {At} outer */
  const statement = (node, depth, outer) => {
    translate(node, depth, outer);
    const counted = node.type === "labeled_statement" ? node.namedChildren.find((c) => c?.type === "do_statement") : UNCOUNTED.has(node.type) ? null : node;
    if (counted && !failed.has(counted.id)) statements++;
  };

  /** @param {Node} node @param {number} depth @param {At} outer */
  const translate = (node, depth, outer) => {
    const at = { ...outer, line: lineOf(node) };
    switch (node.type) {
      case "comment":
        for (const line of node.text.replace(/^\/\*\s?|\s*\*\/$/g, "").split("\n")) emit(depth, `// ${line.trim()}`);
        return;
      case "declare_statement":
      case "format_statement":
      case "end_statement":
      case "null_statement":
      case "entry_statement":
        return;
      case "labeled_statement": {
        const labels = labelsOf(node);
        const inner = node.namedChildren.find((c) => c !== null && c.type !== "statement_prefix");
        if (!inner) return;
        if (inner.type === "procedure_statement") return procedure(inner, labels[0], at.line, depth, at);
        if (inner.type === "package_statement" && depth === 0) {
          // A package's procedures are the module's, its variables module variables.
          const symbol = /** @type {{ id: number } | undefined} */ (db.prepare(`SELECT id FROM symbols WHERE file = ? AND kind = 'package' AND line = ?`).get(file.id, at.line));
          if (!symbol) return todoStatement(node, depth, `the package ${labels[0]} is not in the graph`);
          const scope = { ...at, scopes: [symbol.id, ...at.scopes] };
          for (const v of variables.filter((v) => v.scope === symbol.id && v.parent === null)) declare(v, 0, scope, new Map());
          emit(0, "");
          return statementList(inner.childForFieldName("body")?.namedChildren ?? [], 0, scope);
        }
        if (inner.type === "do_statement") return doLoop(inner, depth, at, labels[labels.length - 1]);
        emit(depth, `// ${labels.join(": ")}:`);
        return statement(inner, depth, at);
      }
      case "preprocessor_include":
        return emit(depth, `// ${node.text.trim().replace(/;$/, "")}: its declarations are at the top, from includes/`);
      case "allocate_statement": {
        for (const item of node.namedChildren.filter((c) => c?.type === "allocate_item")) {
          const [allocatedNode, setNode] = /** @type {Node[]} */ (item?.namedChildren.filter((c) => c?.type === "reference") ?? []);
          const v = allocatedNode && variableAt(allocatedNode.text.replace(/\s+/g, "").toUpperCase(), at);
          if (!v) return todoStatement(node, depth, `ALLOCATE of ${allocatedNode?.text}, which is not declared`);
          emit(depth, `${js(v.name)} = ${initial(v, depth, at, true)};`);
          const base = v.base ? variableAt(v.base.toUpperCase(), at) : undefined;
          const pointer = setNode ? expr(setNode, at).code : base ? pathOf(base, [], node, at).code : undefined;
          if (pointer) emit(depth, `${pointer} = ${js(v.name)};`);
        }
        return;
      }
      case "free_statement":
      case "fetch_statement":
      case "release_statement":
        return emit(depth, `// ${node.text.trim().replace(/;$/, "")}: JavaScript loads and frees by itself`);
      case "assignment_statement":
        return assignment(node, depth, at);
      case "if_statement": {
        emit(depth, `if (${expr(/** @type {Node} */ (node.childForFieldName("condition")), at).code}) {`);
        body(/** @type {Node} */ (node.childForFieldName("consequence")), depth + 1, at);
        const alternative = node.childForFieldName("alternative");
        if (alternative) {
          emit(depth, "} else {");
          body(alternative, depth + 1, at);
        }
        return emit(depth, "}");
      }
      case "do_statement":
        return doLoop(node, depth, at, null);
      case "select_statement":
        return select(node, depth, at);
      case "leave_statement":
      case "iterate_statement": {
        const label = node.namedChildren.find((c) => c?.type === "identifier")?.text;
        const innermost = at.loops[at.loops.length - 1];
        const leave = node.type === "leave_statement";
        if (!label && innermost !== "loop" && (!leave || innermost === undefined || innermost === "group" || innermost === "dispatch")) {
          return todoStatement(node, depth, `${leave ? "LEAVE" : "ITERATE"} of a DO group that is no loop`);
        }
        const target = label ? js(label) : innermost === "loop" ? "" : innermost;
        return emit(depth, `${leave ? "break" : "continue"}${target ? ` ${target}` : ""};`);
      }
      case "return_statement": {
        const value = node.namedChildren.find((c) => c !== null && c.type !== "comment");
        if (value) return emit(depth, `return ${expr(value, at).code};`);
        return emit(depth, at.changed.length ? `return { ${at.changed.join(", ")} };` : "return;");
      }
      case "call_statement":
        return call(node, depth, at);
      case "exec_statement":
        if (node.childForFieldName("language")?.text.toUpperCase() !== "SQL") return todoStatement(node, depth, "EXEC other than SQL");
        return execSql(node, depth, at);
      case "put_statement":
      case "get_statement":
        return streamIo(node, depth, at);
      case "display_statement": {
        const value = node.namedChildren.find((c) => c !== null && c.type !== "comment");
        if (!value || /\bREPLY\b/i.test(node.text)) return todoStatement(node, depth, "DISPLAY with REPLY");
        return emit(depth, `console.log(${asString(expr(value, at))});`);
      }
      case "goto_statement": {
        const label = node.childForFieldName("label")?.text.toUpperCase() ?? "";
        if (!labels.has(label)) return todoStatement(node, depth, `GOTO ${label}, which is no label`);
        const dispatcher = at.gotos.get(label);
        if (!dispatcher) return emit(depth, `throw new GoTo(${JSON.stringify(label)});`);
        emit(depth, "{");
        emit(depth + 1, `${dispatcher} = ${JSON.stringify(label)};`);
        emit(depth + 1, `continue ${dispatcher};`);
        return emit(depth, "}");
      }
      case "on_statement":
      case "signal_statement":
      case "revert_statement": {
        const spec = node.namedChildren.find((c) => c?.type === "condition_spec");
        const condition = spec?.namedChildren.find((c) => c?.type === "condition_name")?.text.toUpperCase() ?? "";
        const reference = spec?.namedChildren.find((c) => c?.type === "reference");
        const unit = node.namedChildren.find((c) => c !== null && c !== spec && c.type !== "comment");
        const inner = { ...at, loops: [], changed: [], gotos: new Map() };
        /** @param {Node} unit */
        const unitBody = (unit) => (unit.type === "begin_statement" ? statementList(unit.childForFieldName("body")?.namedChildren ?? [], depth + 1, inner) : body(unit, depth + 1, inner));
        if (FILE_CONDITIONS.has(condition)) {
          // An ON unit of a record file is a handler on it. Unlike PL/I's, it
          // stays when the procedure that set it returns.
          const file = fileAt(reference, at);
          if (node.type !== "on_statement" || !file || !unit || (condition !== "ENDFILE" && !(condition === "KEY" && file.record))) {
            return todoStatement(node, depth, `${node.type === "on_statement" ? "an ON unit" : node.type === "signal_statement" ? "SIGNAL" : "REVERT"} of ${condition}`);
          }
          emit(depth, `${file.code}.on${condition === "KEY" ? "Key" : "Endfile"} = async () => {`);
          unitBody(unit);
          return emit(depth, "};");
        }
        const name = JSON.stringify(condition === "CONDITION" ? `CONDITION:${reference?.text.toUpperCase()}` : condition);
        if (node.type === "signal_statement") return emit(depth, `await signal(${name});`);
        if (node.type === "revert_statement") return emit(depth, `units.delete(${name});`);
        if (node.children.some((c) => c?.type === "system")) return emit(depth, `units.set(${name}, null);`);
        if (!unit) return todoStatement(node, depth, "an ON unit without a statement");
        emit(depth, `units.set(${name}, async () => {`);
        unitBody(unit);
        return emit(depth, "});");
      }
      case "stop_statement":
        return emit(depth, "throw new Stop();");
      case "begin_statement":
        emit(depth, "{");
        statementList(node.childForFieldName("body")?.namedChildren ?? [], depth + 1, { ...at, loops: [...at.loops, "group"] });
        return emit(depth, "}");
      case "read_statement":
      case "write_statement":
      case "rewrite_statement":
      case "delete_statement":
        return recordIo(node, depth, at);
      case "open_statement": {
        const specs = node.namedChildren.filter((c) => c?.type === "open_file_spec");
        const files = specs.map((spec) => fileAt(spec?.childForFieldName("file"), at));
        if (files.every((f) => !f)) return todoStatement(node, depth, "OPEN of files that are not declared");
        if (files.some((f) => !f)) todoStatement(node, depth, "OPEN of the files that are not declared");
        specs.forEach((spec, i) => {
          if (!files[i]) return;
          const options = [];
          for (const option of spec?.namedChildren.filter((c) => c?.type === "file_option") ?? []) {
            const word = option?.child(0)?.text.toUpperCase();
            const value = option?.namedChildren[0];
            if (word === "INPUT" || word === "OUTPUT" || word === "UPDATE") options.push(`mode: "${word}"`);
            else if (word === "TITLE" && value) options.push(`title: ${asString(expr(value, at))}`);
          }
          emit(depth, `${files[i]?.code}.open(${options.length ? `{ ${options.join(", ")} }` : ""});`);
        });
        return;
      }
      case "close_statement": {
        const files = node.namedChildren.filter((c) => c?.type === "reference").map((c) => fileAt(c, at));
        if (files.every((f) => !f)) return todoStatement(node, depth, "CLOSE of files that are not declared");
        if (files.some((f) => !f)) todoStatement(node, depth, "CLOSE of the files that are not declared");
        for (const f of files) if (f) emit(depth, `${f.code}.close();`);
        return;
      }
      default:
        return todoStatement(node, depth, `the ${node.type.replace(/_statement$/, "").replace(/_/g, " ").toUpperCase()} statement`);
    }
  };

  for (const node of tree.rootNode.descendantsOfType("exec_statement")) {
    const cursor = node && DECLARE_CURSOR.exec(node.text.replace(/^EXEC\s+SQL\s+/i, ""));
    if (cursor) cursors.set(cursor[1].toUpperCase(), cursor[2].replace(/\s*\n\s*/g, " "));
  }
  /** @type {At} */
  const top = { line: 1, scopes: [], loops: [], changed: [], gotos: new Map(), units: false };
  for (const node of tree.rootNode.namedChildren) {
    if (!node || node.type === "comment") continue;
    statement(node, 0, top);
  }

  const header = [
    `// ${file.member}, translated from ${path} by PL/I Graph. TODO marks what is not translated.`,
    RUNTIME_IMPORT,
    ...[...includes.keys()].map((member) => `import * as ${js(member)} from "../includes/${member}.js";`),
    ...[...imports].map(([name, member]) => `import { ${name} } from "./${member}.js";`),
    ...(dbdsUsed.size ? [`import { ${[...dbdsUsed].map(js).sort().join(", ")} } from "../databases.js";`] : []),
    "",
    ...[...layouts.values()].flatMap((layout) => [layout, ""]),
    ...(statics.length ? [...statics, ""] : []),
  ];
  return { code: [...header, ...lines, ""].join("\n"), statements, todos, calls: [...calls], includes };
}

const RUNTIME_IMPORT = `import { array, begin, bin, char, date, datetime, dec, decode, dli, encode, end, enter, EXTERNAL, failed, fetchCursor, GoTo, ims, landing, leave, mod, noWhen, num, oncode, openCursor, overlay, RecordFile, Ref, round, setReturnCode, signal, sql, standardFiles, Stop, Stream, StreamFile, substr, sum, time, todo, toPic, translate, varchar, verify } from "../runtime.js";`;

/**
 * A JCL job as a module that runs its steps with runJob: each DD as a Dd,
 * each PL/I program the generated one. A step running a JCL procedure runs
 * the procedure's steps, the step's DDs replacing theirs by name (a new one
 * goes to the first). IKJEFT01 runs the program of `RUN PROGRAM` in SYSTSIN.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {number} jobId the job's symbol
 * @param {(member: string) => string | undefined} pathOfMember the PL/I file of a program
 * @returns {{ name: string, path: string, code: string, todos: Todo[], programs: string[] }} programs: the PL/I files it runs
 */
function jobToJs(db, root, jobId, pathOfMember) {
  const job = /** @type {{ name: string, path: string, line: number }} */ (
    db.prepare(`SELECT s.name, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.id = ?`).get(jobId)
  );
  /** @type {Todo[]} */
  const todos = [];
  /** @type {Map<string, string>} the PL/I file of each program it runs */
  const programs = new Map();
  /** @type {Map<string, string[]>} */
  const texts = new Map();
  /** @param {string} path */
  const linesOf = (path) => {
    if (!texts.has(path)) texts.set(path, readFileSync(join(root, path), "utf-8").split(/\r?\n/));
    return /** @type {string[]} */ (texts.get(path));
  };
  /** The parts of `text` between commas outside parentheses and quotes. @param {string} text */
  const splitTop = (text) => {
    const parts = [];
    let depth = 0;
    let quoted = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "'") quoted = !quoted;
      else if (quoted) continue;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  };
  /** The operands of the statement at `line` of `path`, continuation lines joined. @param {string} path @param {number} line */
  const operandsAt = (path, line) => {
    const lines = linesOf(path);
    /** @param {string} text up to the first blank outside quotes */
    const field = (text) => {
      let quoted = false;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "'") quoted = !quoted;
        else if (text[i] === " " && !quoted) return text.slice(0, i);
      }
      return text;
    };
    let operands = field(/^\/\/\S*\s+\S+\s*(.*)$/.exec((lines[line - 1] ?? "").slice(0, 72))?.[1] ?? "");
    for (let i = line; operands.endsWith(",") && i < lines.length && /^\/\/\s/.test(lines[i]); i++) operands += field(lines[i].slice(2, 72).trimStart());
    return operands;
  };
  /**
   * The COND of a JOB or EXEC (`key` "COND" or "COND.procstep"): undefined
   * without one, a string when it cannot be read.
   * @param {string} operands @param {string} key
   * @returns {{ tests: (string | number)[][], even?: true, only?: true } | string | undefined}
   */
  const condOf = (operands, key) => {
    const operand = splitTop(operands).find((p) => p.toUpperCase().startsWith(`${key}=`));
    if (!operand) return undefined;
    const value = operand.slice(key.length + 1).toUpperCase();
    const parts = value.startsWith("(") && value.endsWith(")") ? splitTop(value.slice(1, -1)) : [value];
    const items = /^\d/.test(parts[0]) ? [value] : parts;
    /** @type {{ tests: (string | number)[][], even?: true, only?: true }} */
    const cond = { tests: [] };
    for (const item of items) {
      if (item === "EVEN") cond.even = true;
      else if (item === "ONLY") cond.only = true;
      else {
        const test = /^\((\d+),(GT|GE|EQ|LT|LE|NE)(?:,([A-Z0-9@#$]+(?:\.[A-Z0-9@#$]+)?))?\)$/.exec(item);
        if (!test) return `${key}=${value}`;
        cond.tests.push(test[3] ? [Number(test[1]), test[2], test[3]] : [Number(test[1]), test[2]]);
      }
    }
    return cond;
  };
  /**
   * A JCL IF condition as JavaScript over runJob's state `s`; null when it
   * cannot be read. AND and OR go left to right, as JCL has them.
   * @param {string} text between IF and THEN
   * @param {string} prefix put before step names: `PSTEP.` in a procedure
   * @returns {{ code: string, abend: boolean } | null} abend: it tests an ABEND
   */
  const ifOf = (text, prefix) => {
    /** @type {string[]} */
    const tokens = [];
    const pattern = /\s*(¬=|\^=|>=|<=|[()><=¬^&|]|[A-Z0-9@#$.]+)/giy;
    let end = 0;
    for (let m; (m = pattern.exec(text)); end = pattern.lastIndex) tokens.push(m[1].toUpperCase());
    if (text.slice(end).trim()) return null;
    /** @type {Record<string, string>} */
    const OPS = { GT: ">", ">": ">", GE: ">=", ">=": ">=", LT: "<", "<": "<", LE: "<=", "<=": "<=", EQ: "===", "=": "===", NE: "!==", "¬=": "!==", "^=": "!==" };
    let i = 0;
    let abend = false;
    /** @returns {string | null} */
    const term = () => {
      const t = tokens[i++] ?? "";
      if (/^\d+$/.test(t)) return t;
      if (t === "TRUE" || t === "FALSE") return t.toLowerCase();
      const m = /^(?:(.+)\.)?(RC|ABEND|RUN)$/.exec(t);
      if (!m || (m[2] === "RUN" && !m[1])) return null;
      if (m[2] === "ABEND") abend = true;
      return `s.${{ RC: "rc", ABEND: "abend", RUN: "ran" }[m[2]]}(${m[1] ? JSON.stringify(prefix + m[1]) : ""})`;
    };
    /** @returns {string | null} */
    const unary = () => {
      const t = tokens[i];
      if (t === "NOT" || t === "¬" || t === "^") {
        i++;
        const operand = unary();
        return operand && `!${operand}`;
      }
      if (t === "(") {
        i++;
        const inner = logical();
        return inner && tokens[i++] === ")" ? `(${inner})` : null;
      }
      const left = term();
      const op = OPS[tokens[i]];
      if (!left || !op) return left;
      i++;
      const right = term();
      return right && `${left} ${op} ${right}`;
    };
    /** @returns {string | null} */
    const logical = () => {
      let code = unary();
      while (code && ["AND", "&", "OR", "|"].includes(tokens[i])) {
        const word = tokens[i++];
        const op = word === "AND" || word === "&" ? "&&" : "||";
        const right = unary();
        code = right && `(${code} ${op} ${right})`;
      }
      return code;
    };
    const code = logical();
    return code && i === tokens.length ? { code, abend } : null;
  };
  /**
   * The IFs each EXEC line is under, from the line after `from` (a JOB or
   * PROC) to the next JOB, PROC or PEND.
   * @param {string} path @param {number} from @param {string} prefix see ifOf
   * @returns {Map<number, { when: string, afterAbend: boolean }>}
   */
  const guardsOf = (path, from, prefix) => {
    const guards = new Map();
    const lines = linesOf(path);
    /** @type {{ code: string, abend: boolean, otherwise: boolean }[]} */
    const open = [];
    for (let i = from; i < lines.length; i++) {
      if (lines[i].startsWith("//*")) continue;
      const m = /^\/\/(\S*)\s+(IF|ELSE|ENDIF|EXEC|JOB|PROC|PEND)\b(.*)$/i.exec(lines[i].slice(0, 72));
      if (!m) continue;
      const op = m[2].toUpperCase();
      if (op === "JOB" || (prefix && (op === "PROC" || op === "PEND"))) break;
      // A job skips the procedures it defines in-stream.
      if (op === "PROC") while (i + 1 < lines.length && !/^\/\/\S*\s+PEND\b/i.test(lines[i])) i++;
      if (op === "PROC" || op === "PEND") continue;
      if (op === "IF") {
        let text = m[3];
        for (let j = i + 1; !/\bTHEN\b/i.test(text) && j < lines.length && /^\/\/\s/.test(lines[j]); j++) text += ` ${lines[j].slice(2, 72)}`;
        const condition = /^(.*?)\bTHEN\b/is.exec(text);
        const parsed = condition && ifOf(condition[1], prefix);
        if (!parsed) todos.push({ line: i + 1, why: `the IF${text.replace(/\s+/g, " ")}: a condition the generator does not read, so it counts as true` });
        open.push({ ...(parsed ?? { code: "true", abend: false }), otherwise: false });
      } else if (op === "ELSE" && open.length) open[open.length - 1].otherwise = true;
      else if (op === "ENDIF") open.pop();
      else if (op === "EXEC" && open.length) {
        guards.set(i + 1, { when: open.map((o) => (o.otherwise ? `!(${o.code})` : o.code)).join(" && "), afterAbend: open.some((o) => o.abend) });
      }
    }
    return guards;
  };
  const guards = guardsOf(job.path, job.line, "");
  /** @typedef {{ id: number, name: string | null, program: string | null, procedure: string | null, parm: string | null, line: number, path: string }} StepRow */
  /** @typedef {{ name: string, dsn: string | null, member: string | null, disp: string | null, attributes: string, line: number, path: string }} DdRow */
  /** @param {number} owner @returns {StepRow[]} */
  const stepsOf = (owner) =>
    /** @type {StepRow[]} */ (db.prepare(`SELECT s.id, s.name, s.program, s.procedure, s.parm, s.line, f.path FROM steps s JOIN files f ON f.id = s.file WHERE s.job = ? ORDER BY s.line`).all(owner));
  /** @param {number} step @returns {DdRow[]} */
  const ddsOf = (step) =>
    /** @type {DdRow[]} */ (db.prepare(`SELECT d.name, d.dsn, d.member, d.disp, d.attributes, d.line, f.path FROM dds d JOIN files f ON f.id = d.file WHERE d.step = ? ORDER BY d.line`).all(step));
  /** The lines after a `DD *` or `DD DATA`, up to `/*` or the DLM (or the next `//` for `*`). @param {DdRow} dd */
  const inStream = (dd) => {
    const lines = linesOf(dd.path);
    const data = /^DATA\b/i.test(dd.attributes);
    const delimiter = /\bDLM=(?:'([^']{2})'|(\S{2}))/i.exec(dd.attributes);
    const end = delimiter ? (delimiter[1] ?? delimiter[2]) : "/*";
    const out = [];
    for (let i = dd.line; i < lines.length; i++) {
      if (lines[i].startsWith(end) || (!data && lines[i].startsWith("//"))) break;
      out.push(`${lines[i]}\n`);
    }
    return out.join("");
  };
  /**
   * `text` with each symbolic parameter `&NAME` replaced by its value; a
   * period right after the name ends it and goes. A TODO for a name
   * without a value, which stays.
   * @param {string} text @param {Map<string, string>} values @param {number} line @param {string} where
   */
  const resolve = (text, values, line, where) =>
    text.replace(/(?<!&)&(?!&)([A-Z@#$][A-Z0-9@#$]{0,7})\.?/gi, (whole, name) => {
      const value = values.get(name.toUpperCase());
      if (value !== undefined) return value;
      todos.push({ line, why: `${where}: the symbolic parameter &${name.toUpperCase()} has no value` });
      return whole;
    });
  /** The KEY=value operands of `operands`, quotes taken off a value. @param {string} operands */
  const keywords = (operands) =>
    splitTop(operands).flatMap((p) => {
      const m = /^([A-Z@#$][A-Z0-9@#$]*)=(.*)$/is.exec(p);
      return m ? [/** @type {[string, string]} */ ([m[1].toUpperCase(), m[2].replace(/^'(.*)'$/s, "$1").replace(/''/g, "'")])] : [];
    });
  /** @type {{ line: number, name: string, value: string }[]} the SETs of the job's file, in order */
  const sets = linesOf(job.path).flatMap((l, i) =>
    /^\/\/\S*\s+SET\s/i.test(l) ? keywords(operandsAt(job.path, i + 1)).map(([name, value]) => ({ line: i + 1, name, value })) : [],
  );
  /** @param {number} line @returns {Map<string, string>} the values the SETs before `line` give */
  const setBefore = (line) => new Map(sets.filter((s) => s.line < line).map((s) => [s.name, s.value]));
  const EXEC_KEYWORDS = new Set(["PGM", "PROC", "PARM", "PARMDD", "COND", "REGION", "REGIONX", "TIME", "ACCT", "ADDRSPC", "DPRTY", "PERFORM", "RD", "DYNAMNBR", "CCSID", "MEMLIMIT"]);

  /** @param {DdRow} dd @param {string} where @param {Map<string, string>} values */
  const ddOf = (dd, where, values) => {
    if (/^DUMMY\b/i.test(dd.attributes) || dd.dsn === "NULLFILE") return { dummy: true };
    const sysout = /\bSYSOUT=\(?([A-Z0-9*$#@]?)/i.exec(dd.attributes);
    if (sysout) return { sysout: sysout[1].toUpperCase() };
    if (/^(\*|DATA\b)/i.test(dd.attributes)) return { data: inStream(dd) };
    if (!dd.dsn) {
      todos.push({ line: dd.line, why: `the DD ${dd.name} of ${where}: neither a dataset, SYSOUT, in-stream data nor DUMMY` });
      return { dummy: true };
    }
    const at = `the DD ${dd.name} of ${where}`;
    const dsn = resolve(dd.dsn, values, dd.line, at);
    const member = dd.member === null ? null : resolve(dd.member, values, dd.line, at);
    const disp = dd.disp && resolve(dd.disp, values, dd.line, at);
    const generation = member !== null && /^[+-]?\d+$/.test(member) ? Number(member) : undefined;
    return {
      dsn,
      ...(generation !== undefined ? { generation } : member !== null ? { member } : {}),
      ...(disp ? { disp } : {}),
    };
  };
  /** @param {DdRow[]} rows @param {string} where @param {Map<string, string>} values @returns {Map<string, object>} the first DD of each name: a concatenation reads its first dataset */
  const ddMap = (rows, where, values) => {
    /** @type {Map<string, object>} */
    const map = new Map();
    for (const dd of rows) if (!map.has(dd.name)) map.set(dd.name, ddOf(dd, where, values));
    return map;
  };

  /**
   * The COND of a step, or a TODO and none when it cannot be read.
   * @param {ReturnType<typeof condOf>} cond @param {number} line @param {string} where
   */
  const readable = (cond, line, where) => {
    if (typeof cond !== "string") return cond;
    todos.push({ line, why: `the step ${where}: ${cond}, a COND the generator does not read` });
    return undefined;
  };
  /** @type {{ step: string, program: string, parm: string | null, dds: Map<string, object>, line: number, cond?: object, when?: string, afterAbend?: boolean, procedure?: string, procedureWhen?: string }[]} */
  const steps = [];
  for (const step of stepsOf(jobId)) {
    const name = step.name ?? `STEP${steps.length + 1}`;
    const values = setBefore(step.line);
    const own = ddMap(ddsOf(step.id), name, values);
    const operands = operandsAt(step.path, step.line);
    const guard = guards.get(step.line);
    const outer = { ...guard, cond: readable(condOf(operands, "COND"), step.line, name) };
    if (step.program || !step.procedure) {
      let program = step.program ?? "";
      let parm = step.parm && resolve(step.parm, values, step.line, `the PARM of ${name}`);
      if (program === "IKJEFT01") {
        const systsin = ddsOf(step.id).find((d) => d.name === "SYSTSIN");
        const run = systsin && /\bRUN\s+PROG(?:RAM)?\s*\(\s*([A-Z@#$][A-Z0-9@#$]{0,7})\s*\)(?:.*?\bPARMS\s*\(\s*'([^']*)'\s*\))?/is.exec(inStream(systsin));
        if (run) {
          program = run[1].toUpperCase();
          parm = run[2] ?? null;
        }
      }
      steps.push({ step: name, program, parm, dds: own, line: step.line, ...outer });
      continue;
    }
    const procedure = /** @type {{ id: number, path: string, line: number } | undefined} */ (
      db.prepare(`SELECT s.id, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.kind = 'proc' AND s.name = ? ORDER BY s.id LIMIT 1`).get(step.procedure)
    );
    if (!procedure) {
      todos.push({ line: step.line, why: `the step ${name}: the JCL procedure ${step.procedure} is not in the graph` });
      continue;
    }
    const inner = stepsOf(procedure.id);
    const innerGuards = guardsOf(procedure.path, procedure.line, `${name}.`);
    const symbols = new Map([
      ...keywords(operandsAt(procedure.path, procedure.line)),
      ...values,
      ...keywords(operands).filter(([key]) => !EXEC_KEYWORDS.has(key)),
    ]);
    inner.forEach((p, i) => {
      const where = `${name}.${p.name ?? `STEP${i + 1}`}`;
      const dds = ddMap(ddsOf(p.id), where, symbols);
      for (const [dd, value] of own) if (dds.has(dd) || i === 0) dds.set(dd, value);
      const procCond = readable(condOf(operandsAt(p.path, p.line), "COND"), p.line, where);
      const cond = readable(condOf(operands, `COND.${p.name}`), step.line, where) ?? outer.cond ?? (procCond && { ...procCond, tests: procCond.tests.map(([code, op, step]) => [code, op, ...(step === undefined ? [] : [String(step).includes(".") ? step : `${name}.${step}`])]) });
      const parm = p.parm && resolve(p.parm, symbols, p.line, `the PARM of ${where}`);
      const guard = innerGuards.get(p.line);
      const afterAbend = outer.afterAbend || guard?.afterAbend || undefined;
      steps.push({ step: where, program: p.program ?? "", parm, dds, line: step.line, cond, when: guard?.when, afterAbend, procedure: name, procedureWhen: outer.when });
    });
  }

  const lines = [`// ${job.name}, the job in ${job.path}, generated by PL/I Graph: \`node jobs/${job.name}.js\` runs its steps.`];
  lines.push(`import { pathToFileURL } from "node:url";`, `import { runJob } from "../runtime.js";`);
  for (const step of steps) {
    const path = pathOfMember(step.program);
    if (path) programs.set(step.program, path);
    else if (step.program !== "IEFBR14") todos.push({ line: step.line, why: `the step ${step.step}: ${step.program || "its program"} is no PL/I program in the graph` });
  }
  for (const member of programs.keys()) lines.push(`import { ${js(member)} } from "../programs/${member}.js";`);
  const jobCond = readable(condOf(operandsAt(job.path, job.line), "COND"), job.line, job.name);
  lines.push("", `/** Runs ${job.name}'s steps in order. @returns {Promise<number>} the highest return code */`, `export async function ${js(job.name)}() {`, `  return runJob(${JSON.stringify(job.name)}, [`);
  for (const step of steps) {
    lines.push(`    {`);
    lines.push(`      step: ${JSON.stringify(step.step)},`);
    lines.push(`      program: ${JSON.stringify(step.program)},`);
    lines.push(`      run: ${programs.has(step.program) ? js(step.program) : "null"},`);
    lines.push(`      parm: ${JSON.stringify(step.parm)},`);
    if (step.cond) lines.push(`      cond: ${JSON.stringify(step.cond)},`);
    if (step.when) lines.push(`      when: (s) => ${step.when},`);
    if (step.afterAbend) lines.push(`      afterAbend: true,`);
    if (step.procedureWhen) lines.push(`      procedure: ${JSON.stringify(step.procedure)},`, `      procedureWhen: (s) => ${step.procedureWhen},`);
    lines.push(`      dds: {`);
    for (const [name, dd] of step.dds) lines.push(`        ${JSON.stringify(name)}: ${JSON.stringify(dd)},`);
    lines.push(`      },`, `    },`);
  }
  lines.push(jobCond ? `  ], ${JSON.stringify(jobCond.tests)});` : `  ]);`, `}`, "");
  for (const todo of todos) lines.push(`// TODO: ${todo.why}, line ${todo.line}`);
  lines.push(`if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await ${js(job.name)}();`, "");
  return { name: job.name, path: job.path, code: lines.join("\n"), todos, programs: [...programs.values()] };
}

/**
 * The IMS databases as Db2 tables, one to one: a table DBD.SEGMENT each
 * segment, a row each segment occurrence with IMS_ID, IMS_PARENT (the
 * parent's IMS_ID, deleted with it) and a column each field. The fields are
 * those of the PL/I structure most DL/I calls read the segment into or
 * write it from (also one BASED or DEFINED on a CHAR I/O area) when every
 * DBD field is one of them, named as in the DBD; else the DBD fields with
 * FILLERs between them. Twins come in the order of their sequence field,
 * then of IMS_ID.
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {{ ddl: string, databases: import("./jsruntime/runtime.js").Dbd[] }}
 */
function imsDatabases(db) {
  const dbds = /** @type {{ id: number, name: string }[]} */ (db.prepare(`SELECT min(id) AS id, name FROM symbols WHERE kind = 'dbd' GROUP BY name ORDER BY name`).all());
  const segmentsOf = db.prepare(`SELECT id, name, parent, bytes, position FROM segments WHERE dbd = ? ORDER BY position`);
  const fieldsOf = db.prepare(`SELECT name, sequence, start, bytes, type FROM segment_fields WHERE segment = ? ORDER BY start, id`);
  const childrenOf = db.prepare(`SELECT * FROM variables WHERE parent = ? ORDER BY line, id`);
  const areasOf = db.prepare(
    `WITH calls AS (SELECT file, line, upper(io_area) AS area FROM dli_calls WHERE segment = ? AND io_area IS NOT NULL),
     areas AS (
       SELECT a.variable AS id FROM calls c JOIN statements s ON s.file = c.file AND s.line = c.line JOIN accesses a ON a.statement = s.id AND upper(a.name) = c.area
       UNION ALL
       SELECT v.id FROM calls c JOIN variables v ON v.base IS NOT NULL AND upper(replace(v.base, ' ', '')) IN ('ADDR(' || c.area || ')', c.area)
         AND (v.file = c.file OR v.file IN (SELECT l.target_file FROM refs r JOIN links l ON l.ref = r.id WHERE r.file = c.file AND r.kind = 'include')))
     SELECT v.id, v.qualified, f.member, count(*) AS uses FROM areas a JOIN variables v ON v.id = a.id AND v.parent IS NULL AND v.type = 'STRUCTURE' JOIN files f ON f.id = v.file
     GROUP BY v.id ORDER BY uses DESC, v.id`,
  );
  /** @typedef {{ name: string, start: number, bytes: number, kind: "CHAR" | "DECIMAL" | "INTEGER" | "FLOAT" | "BIT", size: string }} Field */
  /** The scalar fields of a structure, by where they lie; null when one has no length, or bounds that are not one constant. @param {number} id */
  const fieldsOfStructure = (id) => {
    /** @type {Field[]} */
    const fields = [];
    let start = 0;
    /** @param {Variable} v @param {string} name @returns {boolean} */
    const walk = (v, name) => {
      const dims = v.dims ? bounds(v.dims) : [];
      if (dims.length > 1 || dims.some((d) => d === null)) return false;
      const count = dims.length ? /** @type {{ length: number }} */ (dims[0]).length : 1;
      for (let i = 1; i <= count; i++) {
        const named = dims.length ? `${name}_${i}` : name;
        if (kindOf(v) === "structure") {
          for (const child of /** @type {Variable[]} */ (childrenOf.all(v.id))) if (!walk(child, child.name === "*" ? "FILLER" : js(child.name))) return false;
          continue;
        }
        const length = bytes(v);
        if (!length) return false;
        const [p, q = "0"] = (v.size ?? "").split(",");
        const kind = kindOf(v);
        if (kind === "dec") fields.push({ name: named, start, bytes: length, kind: "DECIMAL", size: `${Number(p) || 5},${Number(q)}` });
        else if (kind === "pic") fields.push({ name: named, start, bytes: length, kind: "DECIMAL", size: picDigits(v.size ?? "").join(",") });
        else if (kind === "bin") fields.push({ name: named, start, bytes: length, kind: "INTEGER", size: String(length) });
        else if (kind === "float") fields.push({ name: named, start, bytes: length, kind: "FLOAT", size: "" });
        else if (kind === "bit") fields.push({ name: named, start, bytes: length, kind: "BIT", size: "1" });
        else fields.push({ name: named, start, bytes: length, kind: "CHAR", size: String(length) });
        start += length;
      }
      return true;
    };
    for (const child of /** @type {Variable[]} */ (childrenOf.all(id))) if (!walk(child, child.name === "*" ? "FILLER" : js(child.name))) return null;
    return fields;
  };

  const ddl = ["-- The IMS databases as Db2 tables, generated by PL/I Graph: a table DBD.SEGMENT each segment, IMS_PARENT the parent's IMS_ID.", ""];
  /** @type {import("./jsruntime/runtime.js").Dbd[]} */
  const databases = [];
  for (const dbd of dbds) {
    const segments = /** @type {{ id: number, name: string, parent: string | null, bytes: number | null, position: number }[]} */ (segmentsOf.all(dbd.id));
    /** @type {import("./jsruntime/runtime.js").Dbd} */
    const database = { name: dbd.name, segments: {} };
    for (const segment of segments) {
      const dbdFields = /** @type {{ name: string, sequence: string | null, start: number | null, bytes: number | null, type: string | null }[]} */ (fieldsOf.all(segment.id)).filter(
        (f) => f.start !== null && f.bytes !== null,
      );
      /** @param {{ start: number | null, bytes: number | null }} f @param {Field} c */
      const isOn = (f, c) => c.start === Number(f.start) - 1 && c.bytes === f.bytes;
      let source = "its DBD fields, FILLERs between them";
      /** @type {Field[] | null} */
      let fields = null;
      for (const area of /** @type {{ id: number, qualified: string, member: string, uses: number }[]} */ (areasOf.all(segment.name))) {
        const candidate = fieldsOfStructure(area.id);
        if (!candidate?.length) continue;
        const end = candidate[candidate.length - 1].start + candidate[candidate.length - 1].bytes;
        if (segment.bytes !== null && end > segment.bytes) continue;
        if (!dbdFields.every((f) => candidate.some((c) => isOn(f, c)))) continue;
        fields = candidate;
        source = `the fields of ${area.qualified} in ${area.member}, which ${area.uses} DL/I call${area.uses === 1 ? "" : "s"} use${area.uses === 1 ? "s" : ""}`;
        break;
      }
      if (!fields) {
        fields = [];
        for (const f of dbdFields) {
          const start = Number(f.start) - 1;
          const length = Number(f.bytes);
          const end = fields.length ? fields[fields.length - 1].start + fields[fields.length - 1].bytes : 0;
          if (start < end) continue;
          if (start > end) fields.push({ name: "FILLER", start: end, bytes: start - end, kind: "CHAR", size: String(start - end) });
          const type = (f.type ?? "C").toUpperCase();
          if (type === "P") fields.push({ name: f.name, start, bytes: length, kind: "DECIMAL", size: `${2 * length - 1},0` });
          else if (type === "Z") fields.push({ name: f.name, start, bytes: length, kind: "DECIMAL", size: `${length},0` });
          else if (type === "F" || type === "H") fields.push({ name: f.name, start, bytes: length, kind: "INTEGER", size: String(length) });
          else fields.push({ name: f.name, start, bytes: length, kind: "CHAR", size: String(length) });
        }
      }
      const end = fields.length ? fields[fields.length - 1].start + fields[fields.length - 1].bytes : 0;
      if (segment.bytes !== null && end < segment.bytes) fields.push({ name: "FILLER", start: end, bytes: segment.bytes - end, kind: "CHAR", size: String(segment.bytes - end) });
      /** @type {Record<string, string>} */
      const byDbdField = {};
      const used = new Set(["IMS_ID", "IMS_PARENT"]);
      for (const c of fields) {
        const named = dbdFields.find((f) => isOn(f, c))?.name ?? c.name;
        let name = js(named);
        for (let n = 2; used.has(name); n++) name = `${js(named)}_${n}`;
        used.add(name);
        c.name = name;
      }
      for (const f of dbdFields) {
        const c = fields.find((c) => isOn(f, c));
        if (c) byDbdField[f.name.toUpperCase()] = c.name;
      }
      const sequence = dbdFields.find((f) => f.sequence !== null);
      const key = sequence ? (byDbdField[sequence.name.toUpperCase()] ?? null) : null;
      const unique = sequence?.sequence?.toUpperCase() !== "M";
      database.segments[segment.name] = {
        parent: segment.parent,
        position: segment.position,
        key,
        unique,
        columns: fields.map((c) => [c.name, c.start, c.bytes, c.kind, c.size]),
        fields: byDbdField,
      };
      const table = `${dbd.name}.${segment.name}`;
      /** @param {Field} c */
      const type = (c) =>
        c.kind === "DECIMAL" ? `DECIMAL(${c.size})` : c.kind === "INTEGER" ? (c.bytes <= 2 ? "SMALLINT" : "INTEGER") : c.kind === "FLOAT" ? "DOUBLE" : c.kind === "BIT" ? "SMALLINT" : c.bytes > 255 ? `VARCHAR(${c.bytes})` : `CHAR(${c.bytes})`;
      ddl.push(
        `-- The segment ${segment.name}${segment.parent ? ` under ${segment.parent}` : ", the root"}${segment.bytes ? `, ${segment.bytes} bytes` : ""}: ${source}.`,
        `CREATE TABLE ${table} (`,
        `  IMS_ID BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY,`,
        `  IMS_PARENT BIGINT${segment.parent ? " NOT NULL" : ""},`,
        ...fields.map((c) => `  ${c.name} ${type(c)}${c.name === key ? " NOT NULL" : ""},`),
        `  PRIMARY KEY (IMS_ID)${segment.parent || (key && unique) ? "," : ""}`,
        ...(segment.parent ? [`  FOREIGN KEY (IMS_PARENT) REFERENCES ${dbd.name}.${segment.parent} (IMS_ID) ON DELETE CASCADE${key && unique ? "," : ""}`] : []),
        ...(key && unique ? [`  UNIQUE (${segment.parent ? "IMS_PARENT, " : ""}${key})`] : []),
        `);`,
        `CREATE INDEX ${table}_ORDER ON ${table} (IMS_PARENT${key ? `, ${key}` : ""}, IMS_ID);`,
        "",
      );
    }
    databases.push(database);
  }
  return { ddl: ddl.join("\n"), databases };
}

/**
 * The tables for SQLite (runtime.js with SQLITE set): the Db2 tables of the
 * DDL in the graph and the IMS databases' tables, each SCHEMA.NAME as the
 * table "SCHEMA.NAME", since SQLite has no schemas.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {import("./jsruntime/runtime.js").Dbd[]} databases
 */
function sqliteDdl(db, root, databases) {
  const lines = ["-- The tables for SQLite, generated by PL/I Graph: runtime.js makes them when SQLITE names a database without them.", ""];
  const tables = /** @type {{ id: number, name: string, qualifier: string | null, path: string }[]} */ (
    db
      .prepare(
        `SELECT min(s.id) AS id, s.name, s.qualifier, f.path FROM symbols s JOIN files f ON f.id = s.file
         WHERE s.kind = 'table' AND EXISTS (SELECT 1 FROM columns c WHERE c.table_symbol = s.id) GROUP BY s.qualifier, s.name ORDER BY s.qualifier, s.name`,
      )
      .all()
  );
  const columnsOf = db.prepare(`SELECT name, type, not_null, key FROM columns WHERE table_symbol = ? ORDER BY position`);
  for (const table of tables) {
    const columns = /** @type {{ name: string, type: string, not_null: number, key: number | null }[]} */ (columnsOf.all(table.id));
    const key = columns.filter((c) => c.key !== null).sort((a, b) => Number(a.key) - Number(b.key));
    // The graph has no defaults: they are in the column's text in the DDL.
    const qualified = `${table.qualifier ? `${table.qualifier}.` : ""}${table.name}`;
    const attributes = new Map(
      (ddlTables(readFileSync(join(root, table.path), "utf-8")).find((t) => t.qualified === qualified.toUpperCase())?.columns ?? []).map((c) => [c.name, c.attributes]),
    );
    /** @param {{ name: string, type: string }} c */
    const defaultOf = (c) => {
      const text = attributes.get(c.name) ?? "";
      const given = /\bDEFAULT\s+('(?:[^']|'')*'|[+-]?[\d.]+|NULL)/i.exec(text)?.[1];
      if (given) return ` DEFAULT ${given}`;
      if (!/\bDEFAULT\b/i.test(text)) return "";
      if (/^(DATE|TIME|TIMESTAMP)\b/i.test(c.type)) return ` DEFAULT CURRENT_${c.type.split(/\W/)[0].toUpperCase()}`;
      return /CHAR|CLOB|GRAPHIC|BINARY/i.test(c.type) ? " DEFAULT ''" : " DEFAULT 0";
    };
    // SQLite takes a type name with its length, not Db2's FOR BIT DATA, CCSID and the like after it.
    const type = (/** @type {string} */ t) => /^[A-Z ]*?(\([^)]*\))?(?=\s|$)/i.exec(t)?.[0].trim() || "TEXT";
    lines.push(
      `CREATE TABLE IF NOT EXISTS "${qualified}" (`,
      [...columns.map((c) => `  ${c.name} ${type(c.type)}${c.not_null ? " NOT NULL" : ""}${defaultOf(c)}`), ...(key.length ? [`  PRIMARY KEY (${key.map((c) => c.name).join(", ")})`] : [])].join(",\n"),
      ");",
      "",
    );
  }
  for (const dbd of databases) {
    for (const [name, segment] of Object.entries(dbd.segments)) {
      /** @param {import("./jsruntime/runtime.js").Column} c */
      const type = ([, , bytes, kind, size]) =>
        kind === "DECIMAL" ? `DECIMAL(${size})` : kind === "INTEGER" || kind === "BIT" ? "INTEGER" : kind === "FLOAT" ? "REAL" : `CHAR(${bytes})`;
      lines.push(
        `CREATE TABLE IF NOT EXISTS "${dbd.name}.${name}" (`,
        [
          "  IMS_ID INTEGER PRIMARY KEY AUTOINCREMENT",
          `  IMS_PARENT INTEGER${segment.parent ? ` NOT NULL REFERENCES "${dbd.name}.${segment.parent}" (IMS_ID) ON DELETE CASCADE` : ""}`,
          ...segment.columns.map((c) => `  ${c[0]} ${type(c)}${c[0] === segment.key ? " NOT NULL" : ""}`),
          ...(segment.key && segment.unique ? [`  UNIQUE (${segment.parent ? "IMS_PARENT, " : ""}${segment.key})`] : []),
        ].join(",\n"),
        ");",
        `CREATE INDEX IF NOT EXISTS "${dbd.name}.${name}_ORDER" ON "${dbd.name}.${name}" (IMS_PARENT${segment.key ? `, ${segment.key}` : ""}, IMS_ID);`,
        "",
      );
    }
  }
  return lines.join("\n");
}

/**
 * Generates a runnable JavaScript application from the graph: the program
 * of each IMS transaction (or the programs at `paths`), its MFS screens, the
 * runtime, and a server that runs a transaction from its input screen on
 * tn3270's terminal.
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} root
 * @param {{ pli: import("web-tree-sitter").Parser }} indexer
 * @param {string} outDir
 * @param {{ templates: string, tn3270?: string, paths?: string[], jobs?: string[] }} options templates: the folder of runtime.js,
 *   server.js and terminal.js; tn3270: the folder of tn3270's terminal modules, by default tn3270 in templates; jobs: JCL file paths
 */
export function generateJs(db, root, indexer, outDir, { templates, tn3270 = join(templates, "tn3270"), paths, jobs }) {
  const transactions = /** @type {{ code: string, program: string }[]} */ (
    db
      .prepare(`SELECT t.name AS code, r.name AS program FROM symbols t JOIN refs r ON r.caller = t.id AND r.kind = 'program' WHERE t.kind = 'transaction' ORDER BY t.name`)
      .all()
  );
  /** @param {string} member */
  const pathOfMember = (member) =>
    /** @type {{ path: string } | undefined} */ (db.prepare(`SELECT path FROM files WHERE member = ? AND language = 'pli' ORDER BY path LIMIT 1`).get(member))?.path;
  const jobIds = /** @type {{ id: number }[]} */ (
    jobs
      ? db.prepare(`SELECT s.id FROM symbols s JOIN files f ON f.id = s.file WHERE s.kind = 'job' AND f.path IN (SELECT value FROM json_each(?)) ORDER BY s.name`).all(JSON.stringify(jobs))
      : paths
        ? []
        : db.prepare(`SELECT id FROM symbols WHERE kind = 'job' ORDER BY name`).all()
  ).map((j) => jobToJs(db, root, j.id, pathOfMember));
  const batch = jobs ? jobIds : jobIds.filter((j) => j.programs.length);
  const transactionPaths = jobs ? [] : transactions.map((t) => pathOfMember(t.program)).filter((p) => p !== undefined);
  const programPaths = [...new Set([...(paths ?? transactionPaths), ...batch.flatMap((j) => j.programs)])];

  mkdirSync(join(outDir, "programs"), { recursive: true });
  mkdirSync(join(outDir, "screens"), { recursive: true });
  if (batch.length) mkdirSync(join(outDir, "jobs"), { recursive: true });
  for (const job of batch) writeFileSync(join(outDir, "jobs", `${job.name}.js`), job.code);
  /** @type {{ path: string, member: string, module: string, statements: number, todos: Todo[] }[]} */
  const programs = [];
  /** @type {Map<string, Map<string, string>>} the factories of each include, of all programs */
  const includeModules = new Map();
  const queue = [...programPaths];
  const done = new Set(queue);
  while (queue.length) {
    const path = /** @type {string} */ (queue.shift());
    const member = /** @type {{ member: string }} */ (db.prepare(`SELECT member FROM files WHERE path = ?`).get(path)).member;
    const { code, statements, todos, calls, includes } = programToJs(db, root, indexer, path);
    const module = `programs/${member}.js`;
    writeFileSync(join(outDir, module), code);
    for (const [include, factories] of includes) {
      const all = includeModules.get(include) ?? new Map();
      for (const [name, code] of factories) all.set(name, code);
      includeModules.set(include, all);
    }
    programs.push({ path, member, module, statements, todos });
    for (const called of calls) {
      if (done.has(called)) continue;
      done.add(called);
      queue.push(called);
    }
  }

  if (includeModules.size) mkdirSync(join(outDir, "includes"), { recursive: true });
  for (const [include, factories] of includeModules) {
    writeFileSync(
      join(outDir, "includes", `${include}.js`),
      [
        `// The declarations of the include ${include}, translated by PL/I Graph: each function returns a new variable with its initial value.`,
        RUNTIME_IMPORT,
        ...[...factories.values()].flatMap((code) => ["", code]),
        "",
      ].join("\n"),
    );
  }

  const ims = imsDatabases(db);
  writeFileSync(join(outDir, "ims-db2.sql"), ims.ddl);
  writeFileSync(join(outDir, "sqlite.sql"), sqliteDdl(db, root, ims.databases));
  writeFileSync(
    join(outDir, "databases.js"),
    [
      "// The IMS databases as the Db2 tables of ims-db2.sql, generated by PL/I Graph: dli in runtime.js runs DL/I calls on them.",
      ...ims.databases.flatMap((d) => ["", `/** @type {import("./runtime.js").Dbd} */`, `export const ${js(d.name)} = ${JSON.stringify(d, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.replace(/,\s+/g, ", ")}]`)};`]),
      "",
    ].join("\n"),
  );

  // The input message of a transaction starts with its code, an MFLD literal.
  const inputs = /** @type {{ message: string, path: string, literal: string }[]} */ (
    db
      .prepare(
        `SELECT m.name AS message, f.path, d.literal FROM mfs_fields d JOIN symbols m ON m.id = d.screen JOIN files f ON f.id = m.file
         WHERE d.kind = 'MFLD' AND d.literal IS NOT NULL AND m.kind = 'message' AND m.detail = 'INPUT' AND d.id = (SELECT min(id) FROM mfs_fields WHERE screen = m.id)`,
      )
      .all()
  );
  /** @type {Set<string>} */
  const screenFiles = new Set();
  const generated = [];
  for (const transaction of transactions) {
    const program = programs.find((p) => p.member === transaction.program);
    if (!program) continue;
    const input = inputs.find((i) => i.literal.trim().split(/\s+/)[0] === transaction.code);
    if (input) screenFiles.add(input.path);
    generated.push({ ...transaction, program, input });
  }

  /** @type {Map<string, string>} the module name of each MFS file */
  const screenModules = new Map();
  for (const path of screenFiles) {
    const text = readFileSync(join(root, path), "utf-8");
    const formats = mfsFormats(text);
    const fields = mfsFields(text);
    const messages = /** @type {{ name: string, detail: string | null, refs: string }[]} */ (
      db
        .prepare(
          `SELECT m.name, m.detail, json_group_array(r.name) AS refs FROM symbols m JOIN files f ON f.id = m.file LEFT JOIN refs r ON r.caller = m.id AND r.kind = 'screen'
           WHERE f.path = ? AND m.kind = 'message' GROUP BY m.id ORDER BY m.line`,
        )
        .all(path)
    );
    const formatNames = new Set(formats.map((f) => f.name));
    const messageNames = new Set(messages.map((m) => m.name));
    const module = /** @type {Record<string, unknown>} */ ({});
    for (const m of messages) {
      const refs = /** @type {(string | null)[]} */ (JSON.parse(m.refs));
      module[m.name] = {
        kind: m.detail,
        format: refs.find((r) => r !== null && formatNames.has(r)) ?? null,
        next: refs.find((r) => r !== null && messageNames.has(r) && r !== m.name) ?? null,
        fields: fields.filter((f) => f.kind === "MFLD" && f.screen === m.name).map((f) => ({ dfld: f.dfld, length: f.length, literal: f.literal })),
      };
    }
    const name = path.split("/").pop() ?? path;
    screenModules.set(path, name);
    writeFileSync(
      join(outDir, "screens", `${name}.js`),
      [
        `// The MFS formats and messages of ${path}, generated by PL/I Graph.`,
        "",
        `/** The formats: their literals and fields on the screen, 0-based. */`,
        `export const formats = ${JSON.stringify(Object.fromEntries(formats.map((f) => [f.name, f])), null, 2)};`,
        "",
        `/** The messages: their fields in order, each a DFLD or a literal. */`,
        `export const messages = ${JSON.stringify(module, null, 2)};`,
        "",
      ].join("\n"),
    );
  }

  writeFileSync(
    join(outDir, "transactions.js"),
    [
      "// The IMS transactions: the program each runs and its input screen, generated by PL/I Graph.",
      ...[...screenModules.values()].map((name) => `import * as ${js(name)} from "./screens/${name}.js";`),
      "",
      "export const transactions = {",
      ...generated.map(
        (t) =>
          `  ${t.code}: { program: () => import("./${t.program.module}"), entry: ${JSON.stringify(t.program.member)}, screens: ${
            t.input ? js(/** @type {string} */ (screenModules.get(t.input.path))) : "null"
          }, input: ${JSON.stringify(t.input?.message ?? null)} },`,
      ),
      "};",
      "",
    ].join("\n"),
  );
  for (const name of ["runtime.js", "server.js", "terminal.js"]) copyFileSync(join(templates, name), join(outDir, name));
  mkdirSync(join(outDir, "tn3270"), { recursive: true });
  for (const name of readdirSync(tn3270).filter((n) => n.endsWith(".js") || n.startsWith("LICENSE"))) copyFileSync(join(tn3270, name), join(outDir, "tn3270", name));
  writeFileSync(
    join(outDir, "package.json"),
    `${JSON.stringify({ name: "pli-generated", private: true, type: "module", scripts: { start: "node server.js" }, dependencies: { ibm_db: "^3.2.4" } }, null, 2)}\n`,
  );
  return { programs, transactions: generated.map((t) => t.code), jobs: batch.map((j) => ({ name: j.name, path: j.path, module: `jobs/${j.name}.js`, todos: j.todos })) };
}
