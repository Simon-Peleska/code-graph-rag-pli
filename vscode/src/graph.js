// Answers the editor's questions from the SQLite graph the indexer keeps
// (indexer.js). Knows nothing about VS Code, so tests can use it.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { MAIN_OPTIONS, blankMargins, bytes } from "./source.js";

/** @typedef {import("node:sqlite").DatabaseSync} DatabaseSync */
/** @typedef {import("node:sqlite").StatementSync} StatementSync */

/**
 * Lines from 1, columns from 0.
 * @typedef {object} Target
 * @property {string} path
 * @property {number} line
 * @property {number} [col]
 * @property {number} [endCol]
 */

/**
 * Where a reference is: lines from 1, columns from 0.
 * @typedef {object} Site
 * @property {string} path
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 */

/**
 * A procedure, program, table or screen and where it is defined.
 * @typedef {object} Definition
 * @property {string} name
 * @property {string} path
 * @property {number} line
 * @property {number} end
 */

/**
 * One row in the Dependencies or Dependents tree. `module` is the id of the
 * file the row expands into.
 * @typedef {object} TreeRow
 * @property {"file" | "include" | "call" | "table" | "includedBy" | "calledBy" | "unresolved"} kind
 * @property {string} label
 * @property {string} [detail] what a program does with a table: SELECT, UPDATE, ...
 * @property {number} [module]
 * @property {Target} [target]
 * @property {TreeRow} [parent]
 * @property {boolean} repeated
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {"module" | "external" | "class" | "function"} kind
 * @property {string} name
 * @property {string} [path]
 * @property {number} [line]
 * @property {number} [end]
 * @property {string[]} [unresolved]
 * @property {string[]} [mods] `MAIN` for an `OPTIONS(MAIN)` procedure
 */

/** @typedef {"down" | "up" | "both"} Direction which way the page walks: what a node uses, what uses it */
/**
 * A column of the flow dialog: the procedure shown, a procedure it calls or an include.
 * @typedef {object} FlowLane
 * @property {string} id the page id of a procedure, the path of an include
 * @property {"procedure" | "include"} kind
 * @property {string} name
 * @property {string} path
 * @property {number} line
 */
/**
 * A statement of the flow dialog. A call that is expanded holds the callee's
 * steps; an IF or a SELECT holds a branch per guard; a loop holds its body.
 * @typedef {object} FlowStep
 * @property {string} kind a statement's kind, "loop" for a DO with a loop spec, or "include"
 * @property {string} text
 * @property {number} lane
 * @property {string} path
 * @property {number} line
 * @property {"expanded" | "cut" | "recursive" | "external" | "missing"} [call]
 * @property {string} [access] in a data flow, what the statement does to the variable: write, arg, compare, read, or outcome of a comparison
 * @property {string[]} [names] in a data flow, the names in the text that hold the variable's value
 * @property {FlowStep[]} [steps]
 * @property {{ guard: string, steps: FlowStep[] }[]} [branches]
 */
/** @typedef {{ id: number, parent: number | null, kind: string, branch: string | null, detail: string | null, line: number, end_line: number, path: string }} FlowRow */
/**
 * A table, view or alias of the data model page. `distance` counts the
 * relations from the file's own ones; `foreign` marks a column of a foreign key.
 * @typedef {object} ModelEntity
 * @property {string} id
 * @property {"table" | "view" | "alias"} kind
 * @property {string} name
 * @property {string | null} qualifier
 * @property {string} path
 * @property {number} line
 * @property {number} distance
 * @property {{ name: string, type: string, notNull: boolean, key: number | null, foreign: boolean }[]} columns
 */
/**
 * `from` uses `to`: a foreign key on `columns`, a view's FROM, an alias's FOR.
 * @typedef {{ from: string, to: string, kind: "references" | "view" | "alias", columns: string[] }} ModelRelation
 */

/**
 * What the Show Graph page draws for one view: nodes, and edges by node id.
 * @typedef {object} PageGraph
 * @property {GraphNode[]} nodes
 * @property {[string, string, string][]} edges
 */

/**
 * @typedef {object} PageTotals
 * @property {number} version
 * @property {Map<number, string>} paths by file id
 * @property {Map<number, number>} procedures by file id
 * @property {[number, number, number][]} calls source file, target file, how many
 * @property {[number, number | null, string][]} includes file, included file or null, name
 * @property {Map<string, number[]>} unresolved name and the files referencing it
 * @property {number} linked
 */

/**
 * A file, or a definition in one, that a name means.
 * @typedef {object} Found
 * @property {number} file
 * @property {number | null} symbol null for the file itself
 * @property {string} path
 * @property {number} line where the name stands, from 1
 * @property {number} col from 0
 * @property {string | null} name the definition's, null for a file
 */

/**
 * @typedef {object} SymbolRow
 * @property {number} id
 * @property {number} file
 * @property {string} name
 * @property {string} path
 * @property {number} line
 * @property {number} end
 */

const SYMBOL = `s.id, s.file, s.name, f.path, s.line, s.end_line AS end`;
// References that can stay unresolved and still mean something is missing:
// a screen literal or a function call without its definition is common.
const MISSING = `('call', 'fetch', 'program', 'procedure')`;
// Steps a flow holds at most; calls past it are cut, whatever the depth.
const FLOW_LIMIT = 3000;

// Each variable in the JSON array `?` with the structures around it and the fields in it, as (root, id), and the accesses to them.
// Join `touching CROSS JOIN accesses`: CROSS keeps SQLite from scanning every access first, 150 times slower.
const FAMILIES = `roots(root) AS (SELECT value FROM json_each(?)),
  up(root, id) AS (SELECT root, root FROM roots UNION SELECT up.root, v.parent FROM variables v JOIN up ON v.id = up.id WHERE v.parent IS NOT NULL),
  down(root, id) AS (SELECT root, root FROM roots UNION SELECT down.root, v.id FROM variables v JOIN down ON v.parent = down.id),
  family(root, id) AS (SELECT root, id FROM up UNION SELECT root, id FROM down),
  touching(root, access) AS (SELECT family.root, a.id FROM family JOIN accesses a ON a.variable = family.id WHERE a.through IS NULL
    UNION SELECT family.root, a.id FROM family JOIN accesses a ON a.through = family.id)`;
// Tables, views and aliases the data model page draws at most.
const MODEL_LIMIT = 150;

/** @param {TreeRow} a @param {TreeRow} b */
const byLabel = (a, b) => a.label.localeCompare(b.label);
/** @param {string} path */
const fileName = (path) => basename(path);
/** @param {string} path @returns {GraphNode} */
const moduleNode = (path) => ({ id: path, kind: "module", name: fileName(path), path });
/** @param {SymbolRow & { kind: string, detail: string | null }} row @returns {GraphNode} */
const symbolNode = (row) => ({
  id: `${row.path}:${row.name}:${row.line}`,
  kind: row.kind === "package" ? "class" : "function",
  name: row.name,
  path: row.path,
  line: row.line,
  end: row.end,
  ...(MAIN_OPTIONS.test(row.detail ?? "") && { mods: ["MAIN"] }),
});

/** Edges between `s<symbol id>` and `f<file id>` keys, each once. */
class Edges {
  constructor() {
    /** @type {[string, string, string][]} */
    this.list = [];
    this.seen = new Set();
  }
  /** @param {string} source @param {string} type @param {string} target */
  add(source, type, target) {
    const key = `${source} ${type} ${target}`;
    if (source === target || this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push([source, type, target]);
  }
}

/**
 * @typedef {object} DeadCode
 * @property {{ path: string, line: number, procedure: string | null, kind: string, condition: string, always: boolean, why: string, branch: string, from: number, to: number }[]} conditions
 * @property {{ name: string, path: string, line: number, end: number, callers: string[] }[]} procedures
 * @property {{ name: string, path: string, line: number, procedure: string | null, written: boolean }[]} variables
 */

export class Graph {
  /**
   * @param {DatabaseSync} db
   * @param {string} root the folder the graph's paths are relative to
   */
  constructor(db, root) {
    this.db = db;
    /** @type {{ version: number | undefined, found: DeadCode } | undefined} */
    this.dead = undefined;
    this.project = basename(root);
    /** Reads a file of the project; the extension hands in the open editors' text. */
    /** @type {(path: string) => string | undefined} */
    this.read = (path) => {
      try {
        return readFileSync(join(root, path), "utf-8");
      } catch {
        return undefined;
      }
    };
    /** @type {Map<string, StatementSync>} */
    this.statements = new Map();
    /** @type {PageTotals | undefined} */
    this.totals = undefined;
  }

  /**
   * Bumped by every sync that changed something.
   * @param {DatabaseSync} db
   * @returns {number | undefined}
   */
  static version(db) {
    const row = /** @type {{ value: number } | undefined} */ (
      db.prepare(`SELECT value FROM meta WHERE name = 'graph_version'`).get()
    );
    return row?.value;
  }

  /**
   * @template T
   * @param {string} sql
   * @param {...(string | number | null)} params
   * @returns {T[]}
   */
  all(sql, ...params) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return /** @type {T[]} */ (statement.all(...params));
  }

  /**
   * @param {string} path
   * @returns {{ id: number, path: string, language: string } | undefined}
   */
  module(path) {
    return this.all(`SELECT id, path, language FROM files WHERE path = ?`, path)[0];
  }

  /**
   * The procedures, jobs, screens or tables a file defines, nested ones too.
   * @param {string} path
   * @returns {Definition[]}
   */
  blocks(path) {
    return this.all(`SELECT ${SYMBOL} FROM symbols s JOIN files f ON f.id = s.file WHERE f.path = ? ORDER BY s.id`, path);
  }

  /**
   * The programs, jobs and procedures, tables and screens of one language:
   * what files define at their top level, not the procedures nested inside.
   * @param {string} language
   * @returns {Definition[]}
   */
  topLevel(language) {
    return this.all(
      `SELECT ${SYMBOL} FROM symbols s JOIN files f ON f.id = s.file WHERE s.parent IS NULL AND f.language = ?`,
      language,
    );
  }

  /**
   * The files `path` includes (%INCLUDE, JCL INCLUDE, HLASM COPY) and the
   * line of each include.
   * @param {string} path
   * @returns {{ path: string, line: number }[]}
   */
  includedFiles(path) {
    return this.all(
      `SELECT tf.path, r.line FROM files f JOIN refs r ON r.file = f.id AND r.kind = 'include'
       JOIN links l ON l.ref = r.id JOIN files tf ON tf.id = l.target_file
       WHERE f.path = ? ORDER BY r.line`,
      path,
    );
  }

  /**
   * The files that include `path`.
   * @param {string} path
   * @returns {string[]}
   */
  includingFiles(path) {
    return this.all(
      `SELECT DISTINCT f.path FROM files tf JOIN links l ON l.target_file = tf.id AND l.target_symbol IS NULL
       JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file WHERE tf.path = ?`,
      path,
    ).map((/** @type {{ path: string }} */ row) => row.path);
  }

  /**
   * The Db2 tables and views `path` uses.
   * @param {string} path
   * @returns {Definition[]}
   */
  tablesOf(path) {
    return this.all(
      `SELECT DISTINCT ${SYMBOL} FROM files rf JOIN refs r ON r.file = rf.id AND r.kind = 'table'
       JOIN links l ON l.ref = r.id JOIN symbols s ON s.id = l.target_symbol JOIN files f ON f.id = s.file
       WHERE rf.path = ?`,
      path,
    );
  }

  /**
   * The files using the table or view `name` defined in `path`.
   * @param {string} path
   * @param {string} name
   * @returns {string[]}
   */
  tableUsers(path, name) {
    return this.all(
      `SELECT DISTINCT f.path FROM files tf JOIN symbols t ON t.file = tf.id
       JOIN links l ON l.target_symbol = t.id JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
       WHERE tf.path = ? AND t.name = ?`,
      path,
      name.toUpperCase(),
    ).map((/** @type {{ path: string }} */ row) => row.path);
  }

  /**
   * The innermost definition of the file whose lines hold `line`.
   * @param {string} path
   * @param {number} line
   * @returns {SymbolRow | undefined}
   */
  procedureAt(path, line) {
    return this.all(
      `SELECT ${SYMBOL} FROM symbols s JOIN files f ON f.id = s.file
       WHERE f.path = ? AND s.line <= ? AND ? <= s.end_line ORDER BY s.line DESC, s.id DESC LIMIT 1`,
      path,
      line,
      line,
    )[0];
  }

  /**
   * What `word` at `path`:`line` means. A definition of it on the line means
   * itself. The indexer resolved the references themselves, so those on the
   * line answer next, then those of the procedure around it, then the files
   * the file includes. Plain name matches are the fallback, unless `byName`
   * is false.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @param {boolean} byName
   * @returns {Found[]}
   */
  named(path, line, word, byName) {
    const name = word.toUpperCase();
    /** @type {Found[]} */
    const defined = this.all(
      `SELECT s.file, s.id AS symbol, f.path, s.name_line AS line, s.name_col AS col, s.name
       FROM symbols s JOIN files f ON f.id = s.file WHERE f.path = ? AND s.name_line = ? AND s.name = ?`,
      path,
      line,
      name,
    );
    if (defined.length > 0) {
      return defined;
    }
    const LINKED = `SELECT DISTINCT l.target_file AS file, l.target_symbol AS symbol, tf.path,
        coalesce(ts.name_line, 1) AS line, coalesce(ts.name_col, 0) AS col, ts.name
      FROM refs r JOIN links l ON l.ref = r.id JOIN files tf ON tf.id = l.target_file
      LEFT JOIN symbols ts ON ts.id = l.target_symbol`;
    /** @type {Found[]} */
    const onLine = this.all(
      `${LINKED} JOIN files f ON f.id = r.file WHERE f.path = ? AND r.line <= ? AND ? <= r.end_line AND r.name = ?`,
      path,
      line,
      line,
      name,
    );
    if (onLine.length > 0) {
      return onLine;
    }
    const here = this.procedureAt(path, line);
    /** @type {Found[]} */
    const called = here ? this.all(`${LINKED} WHERE r.caller = ? AND r.name = ? AND r.kind != 'include'`, here.id, name) : [];
    if (called.length > 0) {
      return called;
    }
    /** @type {Found[]} */
    const included = this.all(
      `${LINKED} JOIN files f ON f.id = r.file WHERE f.path = ? AND r.kind = 'include' AND tf.member = ?`,
      path,
      name,
    );
    if (included.length > 0 || !byName) {
      return included;
    }
    /** @type {Found[]} */
    const named = this.all(
      `SELECT s.file, s.id AS symbol, f.path, s.name_line AS line, s.name_col AS col, s.name FROM symbols s JOIN files f ON f.id = s.file WHERE s.name = ?`,
      name,
    );
    const sameFile = named.filter((found) => found.path === path);
    return sameFile.length > 0 ? sameFile : named;
  }

  /**
   * Where `word` at `path`:`line` is defined; an included file at its top.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @param {boolean} [byName]
   * @returns {Target[]}
   */
  definitions(path, line, word, byName = true) {
    const dataset = this.datasetAt(path, line, word);
    if (dataset) {
      // A dataset is defined where a job creates it; one nobody creates means itself.
      const created = this.datasetSites(dataset).filter((site) => /^(NEW|MOD)/.test(site.disp ?? ""));
      const here = this.datasetSites(dataset).filter((site) => site.path === path && site.line === line);
      return (created.length > 0 ? created : here).map(({ path, line, col, endCol }) => ({ path, line, col, endCol }));
    }
    const cursor = this.cursorSites(path, line, word);
    if (cursor.length > 0) {
      return cursor.filter((site) => site.detail === "DECLARE").map(({ path, line, col, endCol }) => ({ path, line, col, endCol }));
    }
    return this.named(path, line, word, byName).map((found) => ({
      path: found.path,
      line: found.line,
      col: found.col,
      endCol: found.col + (found.name?.length ?? 0),
    }));
  }

  /**
   * Every reference to what `word` at `path`:`line` means: the calls of a
   * procedure, the includes of a file, the uses of a table.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @param {boolean} [byName]
   * @returns {Site[]}
   */
  references(path, line, word, byName = true) {
    const dataset = this.datasetAt(path, line, word);
    if (dataset) {
      return this.datasetSites(dataset).map(({ path, line, col, endCol }) => ({ path, line, col, endLine: line, endCol }));
    }
    const cursor = this.cursorSites(path, line, word);
    if (cursor.length > 0) {
      return cursor.map(({ path, line, col, endCol }) => ({ path, line, col, endLine: line, endCol }));
    }
    /** @type {Map<string, Site>} */
    const sites = new Map();
    for (const found of this.named(path, line, word, byName)) {
      /** @type {Site[]} */
      const rows =
        found.symbol === null
          ? this.all(
              `SELECT f.path, r.line, r.col, r.end_line AS endLine, r.end_col AS endCol
               FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
               WHERE l.target_file = ? AND l.target_symbol IS NULL`,
              found.file,
            )
          : this.all(
              `SELECT f.path, r.line, r.col, r.end_line AS endLine, r.end_col AS endCol
               FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file WHERE l.target_symbol = ?`,
              found.symbol,
            );
      for (const site of rows) {
        sites.set(`${site.path}:${site.line}:${site.col}`, site);
      }
    }
    return [...sites.values()];
  }

  /**
   * The dataset of a DD at `path`:`line` that `word` is a qualifier of:
   * `PROD` or `KUNDEN` in `DSN=PROD.KUNDEN`.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @returns {string | undefined}
   */
  datasetAt(path, line, word) {
    const qualifier = word.toUpperCase();
    const dsns = /** @type {{ dsn: string }[]} */ (
      this.all(`SELECT d.dsn FROM dds d JOIN files f ON f.id = d.file WHERE f.path = ? AND d.dsn_line = ?`, path, line)
    );
    return dsns.find(({ dsn }) => dsn.split(".").includes(qualifier))?.dsn;
  }

  /**
   * Every DECLARE, OPEN, FETCH and CLOSE of the cursor `word` names at
   * `path`:`line`, in that file; none when it names no cursor there.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @returns {{ path: string, line: number, col: number, endCol: number, detail: string }[]}
   */
  cursorSites(path, line, word) {
    return this.all(
      `SELECT f.path, r.line, r.col, r.end_col AS endCol, r.detail FROM refs r JOIN files f ON f.id = r.file
       WHERE r.kind = 'cursor' AND r.file = (SELECT id FROM files WHERE path = ?) AND r.name = ?
         AND EXISTS (SELECT 1 FROM refs h WHERE h.file = r.file AND h.kind = 'cursor' AND h.name = ? AND h.line = ?)
       ORDER BY r.line`,
      path,
      word.toUpperCase(),
      word.toUpperCase(),
      line,
    );
  }

  /**
   * Where every DD names the dataset, at the name.
   * @param {string} dsn
   * @returns {{ path: string, line: number, col: number, endCol: number, disp: string | null }[]}
   */
  datasetSites(dsn) {
    return this.all(
      `SELECT f.path, d.dsn_line AS line, d.dsn_col AS col, d.dsn_col + length(d.dsn) AS endCol, d.disp
       FROM dds d JOIN files f ON f.id = d.file WHERE d.dsn = ? ORDER BY f.path, d.line`,
      dsn,
    );
  }

  /**
   * @param {string} path
   * @returns {TreeRow | undefined}
   */
  root(path) {
    const module = this.module(path);
    if (!module) {
      return undefined;
    }
    return { kind: "file", label: fileName(path), module: module.id, target: { path, line: 1 }, repeated: false };
  }

  /**
   * What the row's file needs: its includes, the tables it uses, what it
   * calls or runs in other files, and the names the indexer could not resolve.
   * @param {TreeRow} row
   * @returns {TreeRow[]}
   */
  dependencies(row) {
    if (row.module === undefined || row.repeated) {
      return [];
    }
    /** @type {TreeRow[]} */
    const rows = [];
    /** @type {TreeRow[]} */
    const missing = [];
    const seenFiles = new Set();
    const includes = /** @type {{ name: string, file: number | null, path: string | null }[]} */ (
      this.all(
        `SELECT r.name, l.target_file AS file, tf.path FROM refs r
         LEFT JOIN links l ON l.ref = r.id LEFT JOIN files tf ON tf.id = l.target_file
         WHERE r.file = ? AND r.kind = 'include' ORDER BY r.line`,
        row.module,
      )
    );
    for (const include of includes) {
      if (include.file === null || include.path === null) {
        missing.push({ kind: "unresolved", label: `%INCLUDE ${include.name}`, parent: row, repeated: false });
      } else if (!seenFiles.has(include.file)) {
        seenFiles.add(include.file);
        rows.push(this.row(row, "include", fileName(include.path), include.file, { path: include.path, line: 1 }));
      }
    }
    rows.push(...missing.sort(byLabel));

    const targets = /** @type {{ kind: string, detail: string | null, id: number, name: string, file: number, path: string, line: number, col: number, language: string }[]} */ (
      this.all(
        `SELECT r.kind, r.detail, ts.id, ts.name, ts.file, tf.path, ts.name_line AS line, ts.name_col AS col, tf.language FROM refs r
         JOIN links l ON l.ref = r.id JOIN symbols ts ON ts.id = l.target_symbol JOIN files tf ON tf.id = ts.file
         WHERE r.file = ? AND ts.file != r.file ORDER BY r.id`,
        row.module,
      )
    );
    /** @type {Map<number, { row: TreeRow, operations: Set<string> }>} */
    const tables = new Map();
    /** @type {Map<number, TreeRow>} */
    const calls = new Map();
    for (const target of targets) {
      const place = { path: target.path, line: target.line, col: target.col, endCol: target.col + target.name.length };
      if (target.language === "db2") {
        let table = tables.get(target.id);
        if (!table) {
          table = { row: this.row(row, "table", `TABLE ${target.name}`, target.file, place), operations: new Set() };
          tables.set(target.id, table);
        }
        if (target.detail) table.operations.add(target.detail);
      } else if (!calls.has(target.id)) {
        const verb = target.kind === "psb" ? "PSB" : target.kind === "dbd" ? "DBD" : "CALL";
        calls.set(target.id, this.row(row, "call", `${verb} ${target.name}`, target.file, place));
      }
    }
    for (const table of tables.values()) {
      table.row.detail = [...table.operations].sort().join(", ");
    }
    rows.push(...[...tables.values()].map((table) => table.row).sort(byLabel));
    rows.push(...[...calls.values()].sort(byLabel));

    const unresolved = /** @type {{ name: string }[]} */ (
      this.all(
        `SELECT DISTINCT r.name FROM refs r WHERE r.file = ? AND r.kind IN ${MISSING}
         AND NOT EXISTS (SELECT 1 FROM links l WHERE l.ref = r.id) ORDER BY r.name`,
        row.module,
      )
    );
    for (const { name } of unresolved) {
      rows.push({ kind: "unresolved", label: `CALL ${name}`, parent: row, repeated: false });
    }
    return rows;
  }

  /**
   * Who needs the row's file: files that include it, and definitions in other
   * files that call, run or use what it defines.
   * @param {TreeRow} row
   * @returns {TreeRow[]}
   */
  dependents(row) {
    if (row.module === undefined || row.repeated) {
      return [];
    }
    const includers = /** @type {{ id: number, path: string }[]} */ (
      this.all(
        `SELECT DISTINCT f.id, f.path FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
         WHERE l.target_file = ? AND l.target_symbol IS NULL AND r.file != l.target_file`,
        row.module,
      )
    ).map((file) => this.row(row, "includedBy", fileName(file.path), file.id, { path: file.path, line: 1 }));

    const callers = /** @type {{ caller: number | null, callerName: string | null, file: number, path: string, line: number, col: number, endCol: number, callee: string, calleeId: number, detail: string | null }[]} */ (
      this.all(
        `SELECT r.caller, cs.name AS callerName, r.file, f.path, r.line, r.col, r.end_col AS endCol,
           ts.name AS callee, ts.id AS calleeId, r.detail
         FROM links l JOIN symbols ts ON ts.id = l.target_symbol JOIN refs r ON r.id = l.ref
         JOIN files f ON f.id = r.file LEFT JOIN symbols cs ON cs.id = r.caller
         WHERE l.target_file = ? AND r.file != l.target_file ORDER BY r.id`,
        row.module,
      )
    );
    const tables = row.target ? this.module(row.target.path)?.language === "db2" : false;
    /** @type {Map<string, { row: TreeRow, operations: Set<string> }>} */
    const calls = new Map();
    for (const caller of callers) {
      const who = caller.caller === null ? `file ${caller.file}` : `${caller.caller}`;
      // A file of tables lists each table a caller uses; any other file each caller once.
      const key = tables ? `${who}:${caller.calleeId}` : who;
      let call = calls.get(key);
      if (!call) {
        const label = `${caller.callerName ?? fileName(caller.path)} → ${caller.callee}`;
        // The row opens the caller's first use of the callee, not the caller's start.
        const place = { path: caller.path, line: caller.line, col: caller.col, endCol: caller.endCol };
        call = { row: this.row(row, "calledBy", label, caller.file, place), operations: new Set() };
        calls.set(key, call);
      }
      if (tables && caller.detail) call.operations.add(caller.detail);
    }
    for (const call of calls.values()) {
      if (call.operations.size > 0) call.row.detail = [...call.operations].sort().join(", ");
    }
    return [...includers.sort(byLabel), ...[...calls.values()].map((call) => call.row).sort(byLabel)];
  }

  /**
   * Every DD statement of a dataset, `%` matching anything: who writes it
   * (DISP=NEW or MOD) and who reads it, in which job, step and program.
   * @param {string} dsn
   * @returns {{ dsn: string, member: string | null, disp: string | null, dd: string, job: string | null, step: string | null, program: string | null, procedure: string | null, path: string, line: number }[]}
   */
  datasetUsers(dsn) {
    return this.all(
      `SELECT d.dsn, d.member, d.disp, d.name AS dd, j.name AS job, s.name AS step, s.program, s.procedure, f.path, d.line
       FROM dds d JOIN files f ON f.id = d.file LEFT JOIN steps s ON s.id = d.step LEFT JOIN symbols j ON j.id = s.job
       WHERE d.dsn LIKE ? ORDER BY d.dsn, f.path, d.line`,
      dsn,
    );
  }

  /**
   * The files a program reads and writes, and the DD statement each is in
   * the JCL steps running it: the DD named like the file, or like its TITLE.
   * Only the program's own member counts, not what it calls.
   * @param {string} program
   */
  programFiles(program) {
    const ios = /** @type {{ operation: string, name: string, record: string | null, key: string | null, title: string | null }[]} */ (
      this.all(
        `SELECT io.operation, io.name, io.record, io.key, io.title FROM file_io io JOIN files f ON f.id = io.file
         WHERE f.member = ? ORDER BY io.id`,
        program,
      )
    );
    const dds = /** @type {{ name: string, dsn: string | null, member: string | null, disp: string | null, job: string | null, step: string | null, path: string, line: number }[]} */ (
      this.all(
        `SELECT d.name, d.dsn, d.member, d.disp, j.name AS job, s.name AS step, f.path, d.line
         FROM steps s JOIN dds d ON d.step = s.id JOIN files f ON f.id = d.file LEFT JOIN symbols j ON j.id = s.job
         WHERE s.program = ? ORDER BY f.path, d.line`,
        program,
      )
    );
    /** @type {Map<string, { name: string, dd: string, operations: string[], records: string[], keys: string[], dds: typeof dds }>} */
    const files = new Map();
    for (const io of ios) {
      let found = files.get(io.name);
      if (!found) {
        found = { name: io.name, dd: io.name, operations: [], records: [], keys: [], dds: [] };
        files.set(io.name, found);
      }
      if (io.title) found.dd = io.title;
      if (!found.operations.includes(io.operation)) found.operations.push(io.operation);
      if (io.record && !found.records.includes(io.record)) found.records.push(io.record);
      if (io.key && !found.keys.includes(io.key)) found.keys.push(io.key);
    }
    for (const found of files.values()) found.dds = dds.filter((d) => d.name === found.dd);
    return [...files.values()];
  }

  /**
   * A Db2 table's columns from its CREATE TABLE, and every embedded SQL
   * statement using each column, in the order of the DDL; columns only SQL
   * names come after.
   * @param {string} table
   */
  tableColumns(table) {
    const defined = /** @type {{ name: string, type: string, not_null: number, key: number | null }[]} */ (
      this.all(`SELECT name, type, not_null, key FROM columns WHERE table_name = ? ORDER BY file, position`, table)
    );
    const uses = /** @type {{ column: string, operation: string, cursor: string | null, usage: string, host: string | null, expression: string | null, caller: string | null, path: string, line: number }[]} */ (
      this.all(
        `SELECT coalesce(c.column_name, '') AS "column", c.operation, c.cursor, c.usage, c.host, c.expression, s.name AS caller, f.path, c.line
         FROM sql_columns c JOIN files f ON f.id = c.file LEFT JOIN symbols s ON s.id = c.caller
         WHERE c.table_name = ? ORDER BY f.path, c.line, c.id`,
        table,
      )
    );
    /** @type {Map<string, { name: string, type: string | null, notNull: boolean, key: number | null, uses: typeof uses }>} */
    const columns = new Map();
    for (const d of defined) columns.set(d.name, { name: d.name, type: d.type, notNull: d.not_null === 1, key: d.key, uses: [] });
    for (const use of uses) {
      let found = columns.get(use.column);
      if (!found) {
        found = { name: use.column, type: null, notNull: false, key: null, uses: [] };
        columns.set(use.column, found);
      }
      found.uses.push(use);
    }
    return [...columns.values()];
  }

  /**
   * The PSB with this name, or of the transaction with this code: its PCBs in
   * order with their sensitive segments, each with its length and key from
   * the DBD, and the jobs and transactions using it.
   * @param {string} name
   */
  psbLayout(name) {
    const psbName =
      /** @type {{ psb: string } | undefined} */ (
        this.all(`SELECT r.name AS psb FROM symbols t JOIN refs r ON r.caller = t.id AND r.kind = 'psb' WHERE t.kind = 'transaction' AND t.name = ?`, name)[0]
      )?.psb ?? name;
    const psbs = /** @type {{ id: number, name: string, detail: string | null, path: string, line: number }[]} */ (
      this.all(`SELECT s.id, s.name, s.detail, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.kind = 'psb' AND s.name = ? ORDER BY f.path`, psbName)
    );
    const users = /** @type {{ kind: string, name: string, path: string, line: number }[]} */ (
      this.all(
        // A transaction's PSB is named on its APPLCTN, several lines up.
        `SELECT c.kind, c.name, f.path, CASE c.kind WHEN 'transaction' THEN c.line ELSE r.line END AS line
         FROM refs r JOIN files f ON f.id = r.file LEFT JOIN symbols c ON c.id = r.caller
         WHERE r.kind = 'psb' AND r.name = ? ORDER BY f.path, line`,
        psbName,
      )
    );
    return {
      name: psbName,
      users,
      psbs: psbs.map((psb) => ({
        ...psb,
        pcbs: /** @type {{ id: number, position: number, type: string, name: string | null, dbd: string | null, procopt: string | null }[]} */ (
          this.all(`SELECT id, position, type, name, dbd, procopt FROM pcbs WHERE psb = ? ORDER BY position`, psb.id)
        ).map((pcb) => ({
          ...pcb,
          segments: /** @type {{ name: string, parent: string | null, procopt: string | null, bytes: number | null, key: string | null }[]} */ (
            this.all(
              `SELECT g.name, g.parent, g.procopt, s.bytes,
                 (SELECT group_concat(k.name) FROM segment_fields k WHERE k.segment = s.id AND k.sequence IS NOT NULL) AS key
               FROM sensegs g LEFT JOIN segments s ON s.name = g.name AND s.dbd IN (SELECT id FROM symbols WHERE kind = 'dbd' AND name = ?)
               WHERE g.pcb = ? ORDER BY g.id`,
              pcb.dbd,
              pcb.id,
            )
          ),
        })),
      })),
    };
  }

  /**
   * A program's DL/I calls, and the PSBs it runs under: the PSB named like it
   * (a transaction's program) and those its JCL steps give. A PCB parameter
   * is the PSB's PCB at that position, after the I/O PCB IMS puts first
   * unless the program runs as DLI batch without CMPAT=YES.
   * @param {string} program
   */
  programDli(program) {
    const calls = /** @type {{ function: string | null, pcb: string | null, pcb_parameter: number | null, io_area: string | null, path: string | null, caller: string | null, file: string, line: number }[]} */ (
      this.all(
        `SELECT d.function, d.pcb, d.pcb_parameter, d.io_area, d.path, s.name AS caller, f.path AS file, d.line
         FROM dli_calls d JOIN files f ON f.id = d.file LEFT JOIN symbols s ON s.id = d.caller
         WHERE f.member = ? ORDER BY f.path, d.line`,
        program,
      )
    );
    const runs = /** @type {{ psb: string, how: string, batch: number }[]} */ (
      this.all(
        `SELECT name AS psb, 'transaction program' AS how, 0 AS batch FROM symbols WHERE kind = 'psb' AND name = ?
         UNION ALL
         SELECT s.psb, coalesce(j.name, '?') || ' step ' || coalesce(s.name, '?'), s.parm LIKE 'DLI,%'
         FROM steps s LEFT JOIN symbols j ON j.id = s.job WHERE s.program = ? AND s.psb IS NOT NULL`,
        program,
        program,
      )
    );
    /** @type {Map<string, { name: string, uses: string[], batch: boolean }>} */
    const byName = new Map();
    for (const run of runs) {
      const found = byName.get(run.psb);
      if (found) {
        found.uses.push(run.how);
        found.batch &&= run.batch === 1;
      } else byName.set(run.psb, { name: run.psb, uses: [run.how], batch: run.batch === 1 });
    }
    const psbs = [...byName.values()].map((psb) => {
      const gen = /** @type {{ id: number, detail: string | null } | undefined} */ (
        this.all(`SELECT id, detail FROM symbols WHERE kind = 'psb' AND name = ? ORDER BY id LIMIT 1`, psb.name)[0]
      );
      const pcbs = /** @type {{ position: number, type: string, name: string | null, dbd: string | null, procopt: string | null }[]} */ (
        gen ? this.all(`SELECT position, type, name, dbd, procopt FROM pcbs WHERE psb = ? ORDER BY position`, gen.id) : []
      );
      const ioPcb = !psb.batch || /\bCMPAT=YES\b/.test(gen?.detail ?? "");
      return { ...psb, defined: gen !== undefined, ioPcb, pcbs };
    });
    return { calls, psbs };
  }

  /**
   * What IMS transactions do to the data: for the program a transaction runs
   * (the one named like its PSB) and the programs that one calls, the
   * segments its DL/I calls read, insert, replace or delete, the messages it
   * receives and sends, and the Db2 tables its SQL reads and changes. `name`
   * is a transaction code, or a PSB or program to get its transactions; empty
   * for all.
   * @param {string} name
   */
  transactionCrud(name) {
    const transactions = /** @type {{ code: string, psb: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT t.name AS code, r.name AS psb, f.path, t.line
         FROM symbols t JOIN files f ON f.id = t.file JOIN refs r ON r.caller = t.id AND r.kind = 'psb'
         WHERE t.kind = 'transaction' AND (? = '' OR ? IN (t.name, r.name)) ORDER BY t.name, f.path`,
        name,
        name,
      )
    );
    // The programs a PSB's program calls; transactions often share a PSB.
    /** @type {Map<string, { id: number, member: string, path: string }[]>} */
    const reaches = new Map();
    return transactions.map((transaction) => {
      if (!reaches.has(transaction.psb)) {
        const reach = /** @type {{ id: number, member: string, path: string }[]} */ (
          this.all(
            `WITH RECURSIVE reach(id) AS (
               SELECT id FROM files WHERE member = ? AND language = 'pli'
               UNION
               SELECT l.target_file FROM reach JOIN refs r ON r.file = reach.id AND r.kind IN ('call', 'fetch')
               JOIN links l ON l.ref = r.id JOIN files tf ON tf.id = l.target_file AND tf.language = 'pli')
             SELECT f.id, f.member, f.path FROM reach JOIN files f ON f.id = reach.id ORDER BY f.member <> ?, f.path`,
            transaction.psb,
            transaction.psb,
          )
        );
        reaches.set(transaction.psb, reach);
      }
      const reached = reaches.get(transaction.psb) ?? [];
      return {
        ...transaction,
        programs: reached.map(({ member, path }) => ({ member, path })),
        ...this.dataUse("file", reached.map((f) => f.id), transaction.psb),
      };
    });
  }

  /**
   * What a procedure does to the data: the CRUD matrix of `transactionCrud`
   * over the procedure and every procedure it calls, in its program and in
   * others. The PCBs are those of the PSB named like its program, if any.
   * Null when there is no such procedure.
   * @param {string} id a procedure's page id
   */
  procedureCrud(id) {
    const focus = this.symbolOf(id);
    if (focus === undefined) return null;
    const procedure = /** @type {{ name: string, member: string, path: string, line: number }} */ (
      this.all(`SELECT s.name, f.member, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.id = ?`, focus)[0]
    );
    const reached = new Set([focus]);
    for (let frontier = [focus]; frontier.length; ) {
      const callees = /** @type {{ target: number }[]} */ (
        this.all(
          `SELECT DISTINCT l.target_symbol AS target FROM refs r JOIN links l ON l.ref = r.id
           WHERE r.caller IN (SELECT value FROM json_each(?)) AND r.kind IN ('call', 'fetch') AND l.target_symbol IS NOT NULL`,
          JSON.stringify(frontier),
        )
      );
      frontier = callees.map((c) => c.target).filter((target) => !reached.has(target));
      for (const target of frontier) reached.add(target);
    }
    const procedures = /** @type {{ name: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT s.name, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file
         WHERE s.id IN (SELECT value FROM json_each(?)) ORDER BY s.id <> ?, f.path, s.line`,
        JSON.stringify([...reached]),
        focus,
      )
    );
    return { ...procedure, procedures, ...this.dataUse("caller", [...reached], procedure.member) };
  }

  /**
   * The CRUD matrix of the DL/I calls, SQL and record I/O in some files or
   * procedures (`by` says which `ids` are), with the PCBs of the PSB `psb`.
   * @param {"file" | "caller"} by
   * @param {number[]} ids
   * @param {string} psb
   */
  dataUse(by, ids, psb) {
    const inside = JSON.stringify(ids);
    const gen = /** @type {{ id: number } | undefined} */ (this.all(`SELECT id FROM symbols WHERE kind = 'psb' AND name = ? ORDER BY id LIMIT 1`, psb)[0]);
    const pcbs = /** @type {{ id: number, position: number, type: string, name: string | null, dbd: string | null }[]} */ (
      gen ? this.all(`SELECT id, position, type, name, dbd FROM pcbs WHERE psb = ? ORDER BY position`, gen.id) : []
    );
    const sensitive = /** @type {{ name: string, dbd: string }[]} */ (
      gen ? this.all(`SELECT g.name, p.dbd FROM sensegs g JOIN pcbs p ON p.id = g.pcb WHERE p.psb = ? ORDER BY g.id`, gen.id) : []
    );
    const calls = /** @type {{ function: string | null, pcb: string | null, pcb_parameter: number | null, segment: string | null, member: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT d.function, d.pcb, d.pcb_parameter, d.segment, f.member, f.path, d.line
         FROM dli_calls d JOIN files f ON f.id = d.file WHERE d.${by} IN (SELECT value FROM json_each(?)) ORDER BY f.path, d.line`,
        inside,
      )
    );
    const files = /** @type {{ operation: string, name: string, record: string | null, key: string | null, member: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT io.operation, io.name, io.record, io.key, f.member, f.path, io.line
         FROM file_io io JOIN files f ON f.id = io.file WHERE io.${by} IN (SELECT value FROM json_each(?)) ORDER BY f.path, io.line`,
        inside,
      )
    );
    const sql = /** @type {{ operation: string, cursor: string | null, schema: string | null, table_name: string, columns: string | null, keys: string | null, member: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT c.operation, c.cursor, c.schema, c.table_name,
           group_concat(DISTINCT CASE WHEN c.usage IN ('select', 'set', 'insert') THEN c.column_name END) AS columns,
           group_concat(DISTINCT CASE WHEN c.usage = 'where' THEN c.column_name END) AS keys,
           f.member, f.path, min(c.line) AS line
         FROM sql_columns c JOIN files f ON f.id = c.file
         WHERE c.${by} IN (SELECT value FROM json_each(?)) AND c.table_name IS NOT NULL AND c.operation IN ('SELECT', 'DECLARE', 'INSERT', 'UPDATE', 'DELETE')
         GROUP BY c.file, c.caller, c.operation, c.cursor, c.schema, c.table_name ORDER BY f.path, line`,
        inside,
      )
    );

    /** @typedef {"insert" | "read" | "update" | "delete"} Operation */
    /** @type {Map<string, { kind: "segment" | "table" | "message" | "file", owner: string | null, name: string, uses: { operation: Operation, how: string, program: string, path: string, line: number }[] }>} */
    const resources = new Map();
    /** @param {"segment" | "table" | "message" | "file"} kind @param {string | null} owner @param {string} name @param {Operation} operation @param {string} how @param {{ member: string, path: string, line: number }} at */
    const use = (kind, owner, name, operation, how, at) => {
      const key = `${kind} ${owner} ${name}`;
      if (!resources.has(key)) resources.set(key, { kind, owner, name, uses: [] });
      resources.get(key)?.uses.push({ operation, how, program: at.member, path: at.path, line: at.line });
    };
    /** @type {Record<string, Operation>} */
    const DLI = { GU: "read", GN: "read", GNP: "read", GHU: "read", GHN: "read", GHNP: "read", ISRT: "insert", REPL: "update", DLET: "delete" };
    // A call without SSA works on the segment the last call on its PCB got.
    /** @type {Map<string, string>} */
    const lastSegment = new Map();
    for (const call of calls) {
      const operation = DLI[call.function ?? ""];
      if (!operation) continue;
      // A PCB parameter counts in the main program only; IMS puts the I/O PCB first.
      const position = call.member === psb && call.pcb_parameter ? call.pcb_parameter - 1 : undefined;
      const pcb = pcbs.find((p) => p.position === position);
      if (position === 0) {
        use("message", null, "I/O PCB", operation, `${call.function}${call.segment ? ` MOD ${call.segment}` : ""}`, call);
        continue;
      }
      if (pcb?.type === "TP") {
        use("message", null, pcb.name ?? `PCB ${pcb.position}`, operation, call.function ?? "", call);
        continue;
      }
      const pcbKey = `${call.path} ${call.pcb}`;
      if (call.segment) lastSegment.set(pcbKey, call.segment);
      const segment = call.segment ?? lastSegment.get(pcbKey) ?? "?";
      const dbd = pcb?.dbd ?? sensitive.find((s) => s.name === segment)?.dbd ?? null;
      use("segment", dbd, segment, operation, call.function ?? "", call);
    }
    /** @type {Record<string, Operation>} */
    const SQL = { SELECT: "read", DECLARE: "read", INSERT: "insert", UPDATE: "update", DELETE: "delete" };
    for (const row of sql) {
      const how = [
        row.operation === "DECLARE" ? `CURSOR ${row.cursor}` : row.operation,
        row.columns ? `${row.operation === "UPDATE" ? "SET " : ""}${row.columns.replaceAll(",", ", ")}` : "",
        row.keys ? `WHERE ${row.keys.replaceAll(",", ", ")}` : "",
      ].filter(Boolean).join(" ");
      use("table", row.schema, row.table_name, SQL[row.operation], how, row);
    }
    // GET and PUT without FILE (SYSIN, SYSPRINT) are not data.
    /** @type {Record<string, Operation>} */
    const IO = { READ: "read", GET: "read", WRITE: "insert", LOCATE: "insert", PUT: "insert", REWRITE: "update", DELETE: "delete" };
    for (const io of files) {
      if (!IO[io.operation] || ["SYSIN", "SYSPRINT"].includes(io.name)) continue;
      const how = [io.operation, io.record && `${io.operation === "LOCATE" ? "" : ["READ", "GET"].includes(io.operation) ? "INTO " : "FROM "}${io.record}`, io.key && `KEY ${io.key}`].filter(Boolean).join(" ");
      use("file", null, io.name, IO[io.operation], how, io);
    }
    const kinds = { message: 0, segment: 1, table: 2, file: 3 };
    const operations = { insert: 0, read: 1, update: 2, delete: 3 };
    for (const resource of resources.values()) resource.uses.sort((a, b) => operations[a.operation] - operations[b.operation]);
    return { defined: gen !== undefined, resources: [...resources.values()].sort((a, b) => kinds[a.kind] - kinds[b.kind]) };
  }

  /**
   * What can go when the system is replaced: the branches under conditions
   * that are never true, the procedures nothing live calls, and the
   * variables nothing live reads. Worked out over the whole workspace, since
   * callers and readers can be anywhere, once per graph version; `path`
   * keeps what is in that file, empty for everything.
   * @param {string} path
   */
  deadCode(path) {
    const version = Graph.version(this.db);
    const cached = this.dead;
    const found = cached && cached.version === version ? cached.found : this.findDeadCode();
    this.dead = { version, found };
    const { conditions, procedures, variables } = found;
    /** @param {{ path: string }} item */
    const inPath = (item) => !path || item.path === path;
    return { conditions: conditions.filter(inPath), procedures: procedures.filter(inPath), variables: variables.filter(inPath) };
  }

  /** @returns {DeadCode} */
  findDeadCode() {
    // 1. Conditions on constants: literals, and variables with an INIT that
    // nothing writes, passes as an argument or overlays.
    const tests = /** @type {{ statement: number, file: number, path: string, procedure: string | null, kind: string, detail: string, line: number, left: string, operator: string, right: string, lv: number | null, rv: number | null }[]} */ (
      this.all(
        `WITH tests AS (
           SELECT s.id, s.parent, c.left, c.operator, c.right FROM comparisons c JOIN statements s ON s.id = c.statement
           WHERE s.kind IN ('if', 'when', 'do')
           UNION ALL
           SELECT s.id, s.parent, ltrim(s.detail, '^¬ '), CASE WHEN substr(s.detail, 1, 1) IN ('^', '¬') THEN 'not' ELSE 'is' END, '' FROM statements s
           WHERE s.kind = 'if' AND s.detail NOT LIKE '% %' AND s.detail NOT LIKE '%(%')
         SELECT t.id AS statement, s.file, f.path, p.name AS procedure, s.kind, s.detail, s.line, t.left, t.operator, t.right,
           (SELECT a.variable FROM accesses a INDEXED BY accesses_statement WHERE a.statement IN (t.id, t.parent) AND a.name = t.left AND a.variable IS NOT NULL LIMIT 1) AS lv,
           (SELECT a.variable FROM accesses a INDEXED BY accesses_statement WHERE a.statement IN (t.id, t.parent) AND a.name = t.right AND a.variable IS NOT NULL LIMIT 1) AS rv
         FROM tests t JOIN statements s ON s.id = t.id JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller`,
      )
    );
    const named = /** @type {number[]} */ ([...new Set(tests.flatMap((t) => [t.lv, t.rv]).filter((v) => v !== null))]);
    // The compared variables and the structures they are in: a variable can
    // change through any of them.
    /** @type {Map<number, { id: number, parent: number | null, name: string, init: string | null, dims: string | null, type: string | null, storage: string | null, external: number, parameter: number | null, changed: number }>} */
    const compared = new Map();
    for (let wanted = named; wanted.length; ) {
      const rows = /** @type {typeof compared extends Map<number, infer V> ? V[] : never} */ (
        this.all(
          `SELECT v.id, v.parent, v.name, v.init, v.dims, v.type, v.storage, v.external, v.parameter,
             EXISTS (SELECT 1 FROM accesses x WHERE x.variable = v.id AND x.mode IN ('write', 'arg'))
             OR EXISTS (SELECT 1 FROM variables d WHERE d.file = v.file AND d.storage = 'DEFINED' AND upper(d.base) = upper(v.name))
             OR EXISTS (SELECT 1 FROM statements s INDEXED BY statements_file JOIN accesses x INDEXED BY accesses_statement ON x.statement = s.id
               WHERE s.file = v.file AND x.name = v.name AND x.variable IS NULL AND x.mode IN ('write', 'arg')) AS changed
           FROM variables v WHERE v.id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(wanted),
        )
      );
      for (const row of rows) compared.set(row.id, row);
      wanted = /** @type {number[]} */ ([...new Set(rows.map((r) => r.parent).filter((p) => p !== null && !compared.has(p)))]);
    }
    /** @param {number | null} id @returns {boolean} */
    const fixed = (id) => {
      const v = id === null ? undefined : compared.get(id);
      if (!v) return true;
      return !v.changed && !v.external && v.parameter === null && !["BASED", "DEFINED", "PARAMETER", "CONTROLLED"].includes(v.storage ?? "") && fixed(v.parent);
    };
    const constants = new Map(
      named.flatMap((id) => {
        const v = compared.get(id);
        return v?.init && !v.dims && v.type !== "STRUCTURE" && fixed(id) ? [[id, { name: v.name, init: v.init }]] : [];
      }),
    );
    /** @param {string} text @returns {{ kind: "char" | "bit" | "number", value: string | number } | undefined} */
    const literal = (text) => {
      const quoted = /^'((?:[^']|'')*)'(B|X)?$/i.exec(text.trim());
      if (quoted?.[2]?.toUpperCase() === "X") return undefined;
      if (quoted?.[2]) return { kind: "bit", value: quoted[1].replace(/0+$/, "") };
      if (quoted) return { kind: "char", value: quoted[1].replaceAll("''", "'").replace(/ +$/, "") };
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return { kind: "number", value: Number(text) };
      return undefined;
    };
    /** @param {string} text @param {number | null} variable */
    const valueOf = (text, variable) => {
      const constant = variable === null ? undefined : constants.get(variable);
      return constant ? literal(constant.init) : variable === null ? literal(text) : undefined;
    };
    /** @type {Record<string, (order: number) => boolean>} */
    const OPERATORS = {
      "=": (o) => o === 0, "^=": (o) => o !== 0, "¬=": (o) => o !== 0, "<>": (o) => o !== 0,
      "<": (o) => o < 0, ">": (o) => o > 0, "<=": (o) => o <= 0, ">=": (o) => o >= 0,
      "^<": (o) => o >= 0, "¬<": (o) => o >= 0, "^>": (o) => o <= 0, "¬>": (o) => o <= 0,
    };
    // True, false, or undefined when it depends on the run.
    /** @param {typeof tests[number]} t */
    const decide = (t) => {
      const left = valueOf(t.left, t.lv);
      if (t.operator === "is" || t.operator === "not") return left?.kind === "bit" ? /1/.test(String(left.value)) === (t.operator === "is") : undefined;
      const right = valueOf(t.right, t.rv);
      if (!left || !right || left.kind !== right.kind || !OPERATORS[t.operator]) return undefined;
      // PL/I pads the shorter string: with blanks, bits with zeros.
      const width = Math.max(String(left.value).length, String(right.value).length);
      const pad = left.kind === "bit" ? "0" : " ";
      const order = left.kind === "number"
        ? Math.sign(Number(left.value) - Number(right.value))
        : String(left.value).padEnd(width, pad) < String(right.value).padEnd(width, pad) ? -1 : String(left.value).padEnd(width, pad) > String(right.value).padEnd(width, pad) ? 1 : 0;
      return OPERATORS[t.operator](order);
    };
    /** @type {Map<number, typeof tests>} */
    const byStatement = new Map();
    for (const t of tests) byStatement.get(t.statement)?.push(t) ?? byStatement.set(t.statement, [t]);
    /** @type {{ statement: number, always: boolean, why: string, test: typeof tests[number] }[]} */
    const decided = [];
    for (const [statement, own] of byStatement) {
      const first = own[0];
      const outcomes = own.map(decide);
      const why = [...new Set(own.flatMap((t) => [t.lv, t.rv]).filter((v) => v !== null && constants.has(v))
        .map((v) => `${constants.get(/** @type {number} */ (v))?.name} is always ${constants.get(/** @type {number} */ (v))?.init}`))].join(", ") || "it compares constants";
      // A WHEN's values are alternatives; an IF's or WHILE's comparisons
      // count when joined by & alone. A loop never run counts, one never left doesn't.
      if (first.kind === "when") {
        if (outcomes.every((o) => o === false)) decided.push({ statement, always: false, why, test: first });
        continue;
      }
      if (/[|]|[\^¬]\s*\(/.test(first.detail) || (first.kind === "do" && (!/\bWHILE\b/i.test(first.detail) || /\bUNTIL\b/i.test(first.detail)))) continue;
      const terms = first.kind === "do" ? 1 : first.detail.split("&").length;
      if (outcomes.includes(false)) decided.push({ statement, always: false, why, test: first });
      else if (first.kind === "if" && outcomes.length === terms && outcomes.every((o) => o === true)) decided.push({ statement, always: true, why, test: first });
    }
    const branches = /** @type {{ id: number, parent: number, branch: string | null, line: number, end_line: number }[]} */ (
      this.all(`SELECT id, parent, branch, line, end_line FROM statements WHERE parent IN (SELECT value FROM json_each(?))`, JSON.stringify(decided.map((d) => d.statement)))
    );
    const conditions = decided.flatMap((d) => {
      const dead = branches.filter((b) => b.parent === d.statement && (d.test.kind !== "if" || b.branch === (d.always ? "else" : "then")));
      if (!dead.length) return [];
      const t = d.test;
      return [{
        path: t.path, file: t.file, line: t.line, procedure: t.procedure, kind: t.kind, condition: t.detail, always: d.always, why: d.why,
        branch: t.kind === "if" ? (d.always ? "else" : "then") : "body", roots: dead.map((b) => b.id),
        from: Math.min(...dead.map((b) => b.line)), to: Math.max(...dead.map((b) => b.end_line)),
      }];
    });
    const deadStatements = new Set(
      /** @type {{ id: number }[]} */ (
        this.all(
          `WITH RECURSIVE dead(id) AS (SELECT value FROM json_each(?) UNION SELECT s.id FROM dead JOIN statements s ON s.parent = dead.id) SELECT id FROM dead`,
          JSON.stringify(conditions.flatMap((c) => c.roots)),
        )
      ).map((s) => s.id),
    );

    // 2. Procedures no live code calls. Live are the main and fetchable
    // ones, those a job or transaction runs, and what they call outside the
    // dead branches.
    const deadCalls = /** @type {{ id: number }[]} */ (
      this.all(
        `SELECT r.id FROM json_each(?) d JOIN refs r ON r.file = d.value ->> 'file' AND r.line BETWEEN d.value ->> 'from' AND d.value ->> 'to'
         WHERE r.kind IN ('call', 'fetch')`,
        JSON.stringify(conditions.map((c) => ({ file: c.file, from: c.from, to: c.to }))),
      )
    ).map((r) => r.id);
    // A link to a file without a symbol means its outermost procedures.
    const roots = /** @type {{ id: number }[]} */ (
      this.all(
        `SELECT id FROM symbols WHERE kind = 'procedure' AND (detail LIKE '%OPTIONS%MAIN%' OR detail LIKE '%FETCHABLE%')
         UNION
         SELECT t.id FROM links l JOIN refs r ON r.id = l.ref LEFT JOIN symbols c ON c.id = r.caller JOIN symbols t ON t.id = l.target_symbol
         WHERE t.kind = 'procedure' AND (c.id IS NULL OR c.kind <> 'procedure')
         UNION
         SELECT t.id FROM links l JOIN refs r ON r.id = l.ref LEFT JOIN symbols c ON c.id = r.caller
           JOIN symbols t ON t.file = l.target_file AND t.parent IS NULL AND t.kind = 'procedure'
         WHERE l.target_symbol IS NULL AND r.kind IN ('program', 'procedure') AND (c.id IS NULL OR c.kind <> 'procedure')`,
      )
    ).map((r) => r.id);
    const calls = /** @type {{ ref: number, caller: number, target: number }[]} */ (
      this.all(
        `SELECT r.id AS ref, r.caller, l.target_symbol AS target FROM refs r JOIN links l ON l.ref = r.id
         WHERE r.kind IN ('call', 'fetch') AND r.caller IS NOT NULL AND l.target_symbol IS NOT NULL
         UNION ALL
         SELECT r.id, r.caller, t.id FROM refs r JOIN links l ON l.ref = r.id AND l.target_symbol IS NULL
           JOIN symbols t ON t.file = l.target_file AND t.parent IS NULL AND t.kind = 'procedure'
         WHERE r.kind IN ('call', 'fetch') AND r.caller IS NOT NULL`,
      )
    );
    const skipped = new Set(deadCalls);
    /** @type {Map<number, number[]>} */
    const callees = new Map();
    for (const call of calls) if (!skipped.has(call.ref)) callees.get(call.caller)?.push(call.target) ?? callees.set(call.caller, [call.target]);
    const live = new Set(roots);
    for (let frontier = roots; frontier.length; ) {
      frontier = frontier.flatMap((id) => callees.get(id) ?? []).filter((id) => !live.has(id));
      for (const id of frontier) live.add(id);
    }
    const allProcedures = /** @type {{ id: number, parent: number | null, name: string, path: string, line: number, end_line: number, callers: string | null }[]} */ (
      this.all(
        `SELECT s.id, s.parent, s.name, f.path, s.line, s.end_line,
           (SELECT group_concat(DISTINCT c.name) FROM links l JOIN refs r ON r.id = l.ref JOIN symbols c ON c.id = r.caller WHERE l.target_symbol = s.id) AS callers
         FROM symbols s JOIN files f ON f.id = s.file WHERE s.kind = 'procedure' ORDER BY f.path, s.line`,
      )
    );
    const deadProcedures = new Set(allProcedures.filter((p) => !live.has(p.id)).map((p) => p.id));
    // A dead procedure's nested ones go with it.
    const procedures = allProcedures
      .filter((p) => deadProcedures.has(p.id) && !(p.parent !== null && deadProcedures.has(p.parent)))
      .map(({ name, path, line, end_line, callers }) => ({ name, path, line, end: end_line, callers: callers ? callers.split(",") : [] }));

    // 3. Variables no live statement reads, as a whole, a field, or through
    // a LIKE copy. Parameters, files, entries and pointers that base another
    // variable stay; a dead procedure's own variables go with it.
    const declared = /** @type {{ id: number, parent: number | null, scope: number | null, name: string, type: string | null, storage: string | null, external: number, parameter: number | null, path: string, line: number, procedure: string | null }[]} */ (
      this.all(
        `SELECT v.id, v.parent, v.scope, v.name, v.type, v.storage, v.external, v.parameter, f.path, v.line, p.name AS procedure
         FROM variables v JOIN files f ON f.id = v.file LEFT JOIN symbols p ON p.id = v.scope ORDER BY v.id`,
      )
    );
    const accesses = /** @type {{ variable: number | null, through: number | null, mode: string, statement: number, caller: number | null, kind: string }[]} */ (
      this.all(`SELECT x.variable, x.through, x.mode, x.statement, s.caller, s.kind FROM accesses x JOIN statements s ON s.id = x.statement`)
    );
    const read = new Set(), written = new Set();
    for (const x of accesses) {
      if (deadStatements.has(x.statement) || (x.caller !== null && deadProcedures.has(x.caller))) continue;
      // A loop tests its control variable.
      const into = x.mode === "write" && x.kind !== "do" ? written : read;
      if (x.variable !== null) into.add(x.variable);
      if (x.through !== null) into.add(x.through);
    }
    const kept = new Set(
      /** @type {{ name: string }[]} */ (this.all(`SELECT DISTINCT upper(base) AS name FROM variables WHERE base IS NOT NULL UNION SELECT DISTINCT upper(like) FROM variables WHERE like IS NOT NULL`))
        .flatMap((b) => b.name.match(/[A-Z_#@$][\w#@$]*/g) ?? []),
    );
    // Reading a structure reads its fields; reading a field needs its structure.
    // Ids grow down a structure, so one pass each way does it.
    const readAbove = new Set(), readBelow = new Set(), writtenBelow = new Set();
    for (const v of declared) if (read.has(v.id) || readAbove.has(v.parent)) readAbove.add(v.id);
    for (const v of [...declared].reverse()) {
      if (read.has(v.id) || readBelow.has(v.id)) readBelow.add(v.parent);
      if (written.has(v.id) || writtenBelow.has(v.id)) writtenBelow.add(v.parent);
    }
    const isDead = /** @param {typeof declared[number]} v */ (v) =>
      !readAbove.has(v.id) && !readBelow.has(v.id) && v.parameter === null && v.external === 0 && v.name !== "*"
      && !["FILE", "ENTRY"].includes(v.type ?? "") && v.storage !== "PARAMETER" && !kept.has(v.name.toUpperCase())
      && !(v.scope !== null && deadProcedures.has(v.scope));
    /** @type {Set<number | null>} */
    const deadVariables = new Set(declared.filter(isDead).map((v) => v.id));
    const variables = declared
      .filter((v) => deadVariables.has(v.id) && !deadVariables.has(v.parent))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
      .map((v) => ({ name: v.name, path: v.path, line: v.line, procedure: v.procedure, written: written.has(v.id) || writtenBelow.has(v.id) }));

    return {
      conditions: conditions.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
        .map(({ path, line, procedure, kind, condition, always, why, branch, from, to }) => ({ path, line, procedure, kind, condition, always, why, branch, from, to })),
      procedures,
      variables,
    };
  }

  /**
   * An MFS format, or a message's: the format's fields with their labels,
   * the fields of every message mapped through it (SOR=) in message order,
   * and the PL/I members naming the format or a message.
   * @param {string} name a format or message
   */
  screenFields(name) {
    const sor = /** @type {{ name: string } | undefined} */ (
      this.db
        .prepare(
          `SELECT r.name FROM symbols m JOIN refs r ON r.caller = m.id AND r.kind = 'screen'
           WHERE m.kind = 'message' AND m.name = ? AND r.name IN (SELECT name FROM symbols WHERE kind = 'format')`,
        )
        .get(name)
    );
    const format = sor?.name ?? name;
    const screens = /** @type {{ id: number, kind: string, name: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT s.id, s.kind, s.name, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.kind = 'format' AND s.name = ?
         UNION ALL
         SELECT DISTINCT m.id, m.kind, m.name, f.path, m.line FROM symbols m JOIN refs r ON r.caller = m.id AND r.kind = 'screen' JOIN files f ON f.id = m.file
         WHERE m.kind = 'message' AND r.name = ?`,
        format,
        format,
      )
    );
    const fieldsOf = /** @param {number} id */ (id) => this.all(
      `SELECT name, dfld, row, col, length, segment, offset, label, literal, attributes FROM mfs_fields WHERE screen = ? ORDER BY id`,
      id,
    );
    const users = /** @type {{ name: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT r.name, f.path, r.line FROM refs r JOIN files f ON f.id = r.file
         WHERE r.kind = 'screen' AND f.language = 'pli' AND r.name IN (SELECT value FROM json_each(?)) ORDER BY f.path, r.line`,
        JSON.stringify(screens.map((s) => s.name)),
      )
    );
    return {
      format,
      users,
      screens: screens.map((s) => ({
        ...s,
        fields: /** @type {{ name: string | null, dfld: string | null, row: number | null, col: number | null, length: number | null, segment: number | null, offset: number | null, label: string | null, literal: string | null, attributes: string }[]} */ (
          fieldsOf(s.id)
        ),
      })),
    };
  }

  /**
   * The path of a screen's input through the code. For each input message
   * of the format: the programs that receive it, by the transaction code in
   * its first field, else those naming the format or message; in each, the
   * I/O area of the GU on the I/O PCB; and for every field of the message,
   * the variables of the area at its place, after the LL and ZZ fields that
   * lead the area. For each variable, the variables it goes on to and its
   * rules: what it is checked against, and what follows, such as the error
   * message set when the check fails.
   * @param {string} name a format, or one of its messages
   */
  screenInput(name) {
    const { format } = this.screenFields(name);
    const messages = /** @type {{ id: number, name: string, path: string, line: number }[]} */ (
      this.all(
        `SELECT DISTINCT m.id, m.name, f.path, m.line FROM symbols m JOIN refs r ON r.caller = m.id AND r.kind = 'screen' JOIN files f ON f.id = m.file
         WHERE m.kind = 'message' AND m.detail = 'INPUT' AND r.name = ? ORDER BY m.name`,
        format,
      )
    );
    /** @typedef {{ qualified: string, path: string, line: number, goes: string[], rules: ReturnType<Graph["variableRules"]>["rules"] }} Receiver */
    let truncated = false;
    const result = messages.map((message) => {
      const mflds = /** @type {{ dfld: string | null, segment: number | null, offset: number | null, length: number | null, literal: string | null, line: number }[]} */ (
        this.all(`SELECT dfld, segment, offset, length, literal, line FROM mfs_fields WHERE screen = ? AND kind = 'MFLD' ORDER BY id`, message.id)
      );
      const dflds = /** @type {{ name: string, label: string | null, row: number | null, col: number | null }[]} */ (
        this.all(
          `SELECT d.name, d.label, d.row, d.col FROM mfs_fields d JOIN symbols s ON s.id = d.screen
           WHERE s.kind = 'format' AND s.name = ? AND d.kind = 'DFLD' AND d.name IS NOT NULL`,
          format,
        )
      );
      // The transaction code is the literal the message starts with.
      const code = mflds.find((m) => m.literal && !m.offset)?.literal?.trim().split(/\s+/)[0] ?? "";
      const programs = /** @type {{ id: number, path: string }[]} */ (
        code
          ? this.all(
              `SELECT f.id, f.path FROM symbols t JOIN refs r ON r.caller = t.id AND r.kind = 'program' JOIN files f ON f.member = r.name AND f.language = 'pli'
               WHERE t.kind = 'transaction' AND t.name = ? ORDER BY f.path`,
              code,
            )
          : []
      );
      if (!programs.length) {
        programs.push(
          ...this.all(
            `SELECT DISTINCT f.id, f.path FROM refs r JOIN files f ON f.id = r.file
             WHERE r.kind = 'screen' AND f.language = 'pli' AND r.name IN (?, ?) ORDER BY f.path`,
            format,
            message.name,
          ).map((row) => /** @type {{ id: number, path: string }} */ (row)),
        );
      }
      // The I/O area the program gets the message into.
      const receives = /** @type {{ path: string, line: number, area: string, variable: number | null }[]} */ (
        this.all(
          `SELECT f.path, d.line, d.io_area AS area, (
             SELECT a.variable FROM statements s JOIN accesses a ON a.statement = s.id AND a.mode = 'arg' AND upper(a.name) = upper(d.io_area)
             WHERE s.file = d.file AND s.line = d.line AND s.kind = 'call' LIMIT 1) AS variable
           FROM dli_calls d JOIN files f ON f.id = d.file
           WHERE d.file IN (SELECT value FROM json_each(?)) AND d.function = 'GU' AND d.pcb_parameter = 1 AND d.io_area IS NOT NULL
           ORDER BY f.path, d.line`,
          JSON.stringify(programs.map((p) => p.id)),
        )
      );
      // Where each field of each area lies; unknown from the first field whose length is not known.
      const areas = receives.map((receive) => {
        const rows = /** @type {{ id: number, qualified: string, type: string | null, size: string | null, dims: string | null, line: number, path: string }[]} */ (
          receive.variable === null ? [] : this.all(
            `WITH RECURSIVE tree(id) AS (SELECT ? UNION ALL SELECT v.id FROM variables v JOIN tree ON v.parent = tree.id)
             SELECT v.id, v.qualified, v.type, v.size, v.dims, v.line, f.path FROM variables v JOIN tree ON tree.id = v.id JOIN files f ON f.id = v.file ORDER BY v.line`,
            receive.variable,
          )
        );
        /** @type {{ id: number, qualified: string, line: number, path: string, start: number, end: number }[]} */
        const leaves = [];
        let at = 0;
        for (const row of rows.slice(1)) {
          if (row.type === "STRUCTURE") continue;
          const length = row.dims ? undefined : bytes(row);
          if (!length) break;
          leaves.push({ ...row, start: at, end: at + length });
          at += length;
        }
        let header = 0;
        for (const leaf of leaves.slice(0, 2)) {
          const row = rows.find((r) => r.id === leaf.id);
          if (row?.type !== "FIXED BIN") break;
          header = leaf.end;
        }
        return { ...receive, header, leaves };
      });
      /** @type {Map<number, Receiver>} */
      const receivers = new Map();
      const receiver = (/** @type {{ id: number, qualified: string, line: number, path: string }} */ leaf) => {
        const known = receivers.get(leaf.id);
        if (known) return known;
        const found = this.variableRules(leaf.id);
        truncated ||= found.truncated;
        const goes = /** @type {{ qualified: string }[]} */ (
          this.all(
            `SELECT DISTINCT qualified FROM variables WHERE id IN (SELECT value FROM json_each(?)) AND id <> ? ORDER BY qualified`,
            JSON.stringify(found.passed.reached),
            leaf.id,
          )
        ).map((row) => row.qualified);
        const made = { qualified: leaf.qualified, path: leaf.path, line: leaf.line, goes, rules: found.rules };
        receivers.set(leaf.id, made);
        return made;
      };
      const fields = mflds.map((mfld) => {
        const dfld = dflds.find((d) => d.name === mfld.dfld);
        /** @type {Receiver[]} */
        const variables = [];
        /** @type {{ area: string, path: string, start: number, end: number }[]} */
        const unmapped = [];
        for (const area of areas) {
          if ((mfld.segment ?? 1) !== 1 || mfld.offset === null || !mfld.length) continue;
          const start = area.header + mfld.offset;
          const end = start + mfld.length;
          const hit = area.leaves.filter((leaf) => leaf.start < end && leaf.end > start);
          if (hit.length) variables.push(...hit.map(receiver));
          else unmapped.push({ area: area.area, path: area.path, start: start + 1, end });
        }
        return { name: mfld.dfld, literal: mfld.literal, label: dfld?.label ?? null, row: dfld?.row ?? null, col: dfld?.col ?? null, offset: mfld.offset, length: mfld.length, line: mfld.line, variables, unmapped };
      });
      return { ...message, code, programs: programs.map((p) => p.path), receives: areas.map(({ path, line, area, header }) => ({ path, line, area, header })), fields };
    });
    return { format, messages: result, truncated };
  }

  /**
   * Where a field is written or passed to a CALL, and where it is compared,
   * each with the conditions it happens under, outermost first. Names are as
   * written, so KD.TYP and TYP both match TYP.
   * @param {string} name
   */
  fieldUses(name) {
    const sites = /** @type {{ statement: number, kind: string, detail: string | null, mode: string, name: string, value: string | null, operator: string | null, other: string | null, caller: string | null, path: string, line: number }[]} */ (
      this.all(
        `SELECT s.id AS statement, s.kind, s.detail, a.mode, a.name, a.value, NULL AS operator, NULL AS other, p.name AS caller, f.path, s.line
         FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller
         WHERE (a.name = ? OR a.name LIKE '%.' || ?) AND a.mode IN ('write', 'arg')
         UNION ALL
         SELECT s.id, s.kind, s.detail, 'compare', c.left, NULL, c.operator, c.right, p.name, f.path, s.line
         FROM comparisons c JOIN statements s ON s.id = c.statement JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller
         WHERE c.left = ? OR c.left LIKE '%.' || ? OR c.right = ? OR c.right LIKE '%.' || ?
         ORDER BY 10, 11 LIMIT 500`,
        name,
        name,
        name,
        name,
        name,
        name,
      )
    );
    // Each ancestor with the branch of it the path comes through.
    const ancestors = /** @param {number} id */ (id) => this.all(
      `WITH RECURSIVE up(id, via, depth) AS (
         SELECT parent, branch, 0 FROM statements WHERE id = ?
         UNION ALL
         SELECT s.parent, s.branch, up.depth + 1 FROM up JOIN statements s ON s.id = up.id WHERE s.parent IS NOT NULL
       )
       SELECT s.kind, s.detail, up.via, p.detail AS subject FROM up JOIN statements s ON s.id = up.id
       LEFT JOIN statements p ON p.id = s.parent ORDER BY up.depth DESC`,
      id,
    );
    return sites.map((site) => ({
      ...site,
      guards: /** @type {{ kind: string, detail: string | null, via: string | null, subject: string | null }[]} */ (ancestors(site.statement)),
    }));
  }

  /**
   * Where the value of each variable named so comes from and goes to, one
   * step each way: assignments (the other side's fields, or the literal),
   * other statements setting it, the parameters it is passed to, and for a
   * parameter the arguments its callers pass.
   * @param {string} name qualified as far as wanted: KDNR, MSG.KDNR
   */
  fieldLineage(name) {
    const variables = /** @type {{ id: number, qualified: string, parameter: number | null, scope: string | null, path: string, line: number }[]} */ (
      this.all(
        `SELECT v.id, v.qualified, v.parameter, s.name AS scope, f.path, v.line FROM variables v JOIN files f ON f.id = v.file LEFT JOIN symbols s ON s.id = v.scope
         WHERE v.qualified = ? OR v.qualified LIKE '%.' || ? ORDER BY f.path, v.line LIMIT 100`,
        name,
        name,
      )
    );
    // The other side of an assignment, a literal, or a statement other than an assignment.
    const moves = /** @param {number} id */ (id) => this.all(
      `SELECT me.mode, CASE WHEN me.through IS NOT NULL THEN me.name END AS copy, o.name, ov.qualified, me.value, s.kind, c.name AS caller, f.path, s.line
       FROM accesses me JOIN statements s ON s.id = me.statement JOIN files f ON f.id = s.file LEFT JOIN symbols c ON c.id = s.caller
       LEFT JOIN accesses o ON s.kind = 'assignment' AND o.statement = me.statement AND NOT (o.variable IS me.variable AND o.through IS me.through)
         AND o.mode = CASE me.mode WHEN 'write' THEN 'read' ELSE 'write' END
       LEFT JOIN variables ov ON ov.id = o.variable
       WHERE me.variable = ? AND me.mode IN ('read', 'write') AND (o.id IS NOT NULL OR me.mode = 'write')
       ORDER BY f.path, s.line`,
      id,
    );
    const passes = /** @param {number} id */ (id) => this.all(
      `SELECT a.position, s.detail AS callee, pv.qualified AS parameter, c.name AS caller, f.path, s.line
       FROM accesses a JOIN statements s ON s.id = a.statement JOIN files f ON f.id = s.file LEFT JOIN symbols c ON c.id = s.caller
       LEFT JOIN refs r ON r.file = s.file AND r.line = s.line AND r.kind = 'call' AND r.name = s.detail
       LEFT JOIN links l ON l.ref = r.id
       LEFT JOIN variables pv ON pv.scope = l.target_symbol AND pv.parameter = a.position AND pv.level = 1
       WHERE a.variable = ? AND a.mode = 'arg' ORDER BY f.path, s.line`,
      id,
    );
    const receives = /** @param {number} id */ (id) => this.all(
      `SELECT a.name, av.qualified, c.name AS caller, f.path, s.line
       FROM variables p JOIN links l ON l.target_symbol = p.scope JOIN refs r ON r.id = l.ref AND r.kind = 'call'
       JOIN statements s ON s.file = r.file AND s.line = r.line AND s.kind = 'call' AND s.detail = r.name
       JOIN accesses a ON a.statement = s.id AND a.mode = 'arg' AND a.position = p.parameter
       LEFT JOIN variables av ON av.id = a.variable
       JOIN files f ON f.id = s.file LEFT JOIN symbols c ON c.id = s.caller
       WHERE p.id = ? ORDER BY f.path, s.line`,
      id,
    );
    return variables.map((v) => ({
      ...v,
      moves: /** @type {{ mode: string, copy: string | null, name: string | null, qualified: string | null, value: string | null, kind: string, caller: string | null, path: string, line: number }[]} */ (
        moves(v.id)
      ),
      passes: /** @type {{ position: number, callee: string | null, parameter: string | null, caller: string | null, path: string, line: number }[]} */ (passes(v.id)),
      receives: /** @type {{ name: string, qualified: string | null, caller: string | null, path: string, line: number }[]} */ (
        v.parameter ? receives(v.id) : []
      ),
    }));
  }

  /**
   * The comments of procedures and declarations, and the string literals of
   * statements, that contain the text, ignoring case: where a business term,
   * message or error code shows up.
   * @param {string} text
   */
  textSearch(text) {
    return /** @type {{ what: string, name: string | null, kind: string | null, detail: string | null, target: string | null, text: string, caller: string | null, path: string, line: number }[]} */ (
      this.all(
        `SELECT 'procedure' AS what, s.name, NULL AS kind, NULL AS detail, NULL AS target, s.comment AS text, NULL AS caller, f.path, s.line
         FROM symbols s JOIN files f ON f.id = s.file WHERE s.comment LIKE '%' || ? || '%'
         UNION ALL
         SELECT 'variable', v.qualified, NULL, NULL, NULL, v.comment, NULL, f.path, v.line
         FROM variables v JOIN files f ON f.id = v.file WHERE v.comment LIKE '%' || ? || '%'
         UNION ALL
         SELECT 'literal', NULL, s.kind, s.detail,
           (SELECT a.name FROM accesses a WHERE a.statement = s.id AND a.mode = 'write' LIMIT 1), l.text, p.name, f.path, s.line
         FROM literals l JOIN statements s ON s.id = l.statement JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller
         WHERE l.text LIKE '%' || ? || '%'
         ORDER BY 1 DESC, 8, 9 LIMIT 500`,
        text,
        text,
        text,
      )
    );
  }

  // ---- Show Graph page ----------------------------------------------------
  // The page asks for what one view draws. A module's id is its path, a
  // definition's `path:name:line`, so a page reloaded after a sync still finds
  // what it showed; `external:NAME` is an include the repository lacks.

  /**
   * Per-file totals for the overview, the summary and the lists, read once
   * per graph version: they go over every link, a second on 6M lines.
   * @returns {PageTotals}
   */
  pageTotals() {
    const version = Graph.version(this.db) ?? 0;
    if (this.totals?.version === version) return this.totals;
    /** @type {Map<number, string>} */
    const paths = new Map();
    for (const file of /** @type {{ id: number, path: string }[]} */ (this.all(`SELECT id, path FROM files ORDER BY path`))) {
      paths.set(file.id, file.path);
    }
    /** @type {Map<number, number>} */
    const procedures = new Map();
    for (const row of /** @type {{ file: number, n: number }[]} */ (
      this.all(`SELECT file, count(*) AS n FROM symbols WHERE kind != 'package' GROUP BY file`)
    )) {
      procedures.set(row.file, row.n);
    }
    const calls = /** @type {{ a: number, b: number, n: number }[]} */ (
      this.all(
        `SELECT r.file AS a, l.target_file AS b, count(*) AS n FROM refs r JOIN links l ON l.ref = r.id
         WHERE l.target_symbol IS NOT NULL AND r.kind != 'include' AND l.target_file != r.file GROUP BY r.file, l.target_file`,
      )
    ).map((row) => /** @type {[number, number, number]} */ ([row.a, row.b, row.n]));
    const includes = /** @type {{ a: number, b: number | null, name: string }[]} */ (
      this.all(`SELECT r.file AS a, l.target_file AS b, r.name FROM refs r LEFT JOIN links l ON l.ref = r.id WHERE r.kind = 'include'`)
    ).map((row) => /** @type {[number, number | null, string]} */ ([row.a, row.b, row.name]));
    /** @type {Map<string, number[]>} */
    const unresolved = new Map();
    for (const { file, name } of /** @type {{ file: number, name: string }[]} */ (
      this.all(
        `SELECT DISTINCT r.file, r.name FROM refs r WHERE r.kind IN ${MISSING}
         AND NOT EXISTS (SELECT 1 FROM links l WHERE l.ref = r.id)`,
      )
    )) {
      const files = unresolved.get(name);
      if (files) files.push(file);
      else unresolved.set(name, [file]);
    }
    const linked = /** @type {{ n: number }[]} */ (this.all(`SELECT count(*) AS n FROM links WHERE target_symbol IS NOT NULL`))[0].n;
    this.totals = { version, paths, procedures, calls, includes, unresolved, linked };
    return this.totals;
  }

  pageSummary() {
    const totals = this.pageTotals();
    let procedures = 0;
    for (const n of totals.procedures.values()) procedures += n;
    return { project: this.project, modules: totals.paths.size, procedures, calls: totals.linked, unresolved: totals.unresolved.size };
  }

  /**
   * One folder: its subfolders and its own modules, with the calls and
   * includes between them summed up. Past `limit` items only the most
   * connected are kept: a force layout of 20,000 modules never finishes.
   * @param {string} folder "" for the top
   * @param {boolean} isolated keep the modules without links too
   * @param {number} [limit]
   */
  pageOverview(folder, isolated, limit = 300) {
    const totals = this.pageTotals();
    const inside = folder ? `${folder}/` : "";
    // What a module is drawn as here: itself, the subfolder holding it, or nothing.
    /** @type {Map<number, string | null>} */
    const item = new Map();
    /** @type {Map<string, number>} modules in each subfolder, all levels down */
    const below = new Map();
    for (const [id, path] of totals.paths) {
      const at = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (at === folder) {
        item.set(id, path);
      } else if (at.startsWith(inside)) {
        const sub = `dir:${inside}${at.slice(inside.length).split("/")[0]}`;
        item.set(id, sub);
        below.set(sub, (below.get(sub) ?? 0) + 1);
      } else {
        item.set(id, null);
      }
    }
    /** @type {Map<string, number>} */
    const pairs = new Map();
    /** @type {Map<string, number>} */
    const degree = new Map();
    /** @param {string | null | undefined} a @param {string | null | undefined} b @param {string} kind @param {number} weight */
    const bump = (a, b, kind, weight) => {
      if (!a || !b || a === b) return;
      const key = `${kind}\t${a}\t${b}`;
      pairs.set(key, (pairs.get(key) ?? 0) + weight);
      degree.set(a, (degree.get(a) ?? 0) + weight);
      degree.set(b, (degree.get(b) ?? 0) + weight);
    };
    for (const [source, target, weight] of totals.calls) bump(item.get(source), item.get(target), "calls", weight);
    for (const [source, target, name] of totals.includes) {
      // An include the repository lacks is drawn in the top folder.
      const included = target !== null ? item.get(target) : folder ? null : `external:${name}`;
      bump(item.get(source), included, "imports", 1);
    }

    const folders = [...below].map(([id, modules]) => ({ id, modules })).sort((a, b) => (a.id < b.id ? -1 : 1));
    /** @type {GraphNode[]} */
    const modules = [];
    for (const [id, path] of totals.paths) {
      if (item.get(id) === path) modules.push(moduleNode(path));
    }
    for (const key of degree.keys()) {
      if (key.startsWith("external:")) modules.push({ id: key, kind: "external", name: key.slice("external:".length) });
    }
    const connected = modules.filter((n) => isolated || degree.has(n.id));
    const room = Math.max(0, limit - folders.length);
    const shown = connected.length <= room ? connected : [...connected].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, room);
    const drawn = new Set([...folders.map((f) => f.id), ...shown.map((n) => n.id)]);
    /** @type {[string, string, string, number][]} */
    const edges = [];
    for (const [key, weight] of pairs) {
      const [kind, a, b] = key.split("\t");
      if (drawn.has(a) && drawn.has(b)) edges.push([a, b, kind, weight]);
    }
    return { folders, modules: shown, edges, connected: connected.length, unlinked: modules.length - connected.length };
  }

  /**
   * A module's procedures, the procedures outside calling them or called by
   * them, and those calls; null when the graph has no such module.
   * @param {string} path
   * @returns {PageGraph | null}
   */
  pageModule(path) {
    const file = this.module(path);
    if (!file) return null;
    const edges = new Edges();
    for (const symbol of /** @type {{ id: number, parent: number | null }[]} */ (this.all(`SELECT id, parent FROM symbols WHERE file = ?`, file.id))) {
      edges.add(symbol.parent === null ? `f${file.id}` : `s${symbol.parent}`, "DEFINES", `s${symbol.id}`);
    }
    for (const call of /** @type {{ caller: number | null, target: number }[]} */ (
      this.all(
        `SELECT r.caller, l.target_symbol AS target FROM refs r JOIN links l ON l.ref = r.id
         WHERE r.file = ? AND l.target_symbol IS NOT NULL AND r.kind != 'include'`,
        file.id,
      )
    )) {
      edges.add(call.caller === null ? `f${file.id}` : `s${call.caller}`, "CALLS", `s${call.target}`);
    }
    for (const call of /** @type {{ caller: number | null, file: number, target: number }[]} */ (
      this.all(
        `SELECT r.caller, r.file, l.target_symbol AS target FROM links l JOIN refs r ON r.id = l.ref
         WHERE l.target_file = ? AND l.target_symbol IS NOT NULL AND r.kind != 'include'`,
        file.id,
      )
    )) {
      edges.add(call.caller === null ? `f${call.file}` : `s${call.caller}`, "CALLS", `s${call.target}`);
    }
    return this.pageGraph(edges, [`f${file.id}`]);
  }

  /**
   * A procedure with its callees `depth` levels down and its callers `depth`
   * levels up, and the calls between them; null when there is no such
   * procedure. A file calling from its top level is a caller that ends the walk.
   * @param {string} id
   * @param {number} depth 0 for all the way
   * @param {Direction} [direction]
   * @returns {PageGraph | null}
   */
  pageProcedure(id, depth, direction = "both") {
    if (depth === 0) depth = Infinity;
    const focus = this.symbolOf(id);
    if (focus === undefined) return null;
    const edges = new Edges();
    const seen = new Set([`s${focus}`]);
    /** @param {number[]} symbols */
    const calleesOf = (symbols) =>
      /** @type {{ caller: number, target: number }[]} */ (
        this.all(
          `SELECT r.caller, l.target_symbol AS target FROM refs r JOIN links l ON l.ref = r.id
           WHERE r.caller IN (SELECT value FROM json_each(?)) AND l.target_symbol IS NOT NULL AND r.kind != 'include'`,
          JSON.stringify(symbols),
        )
      );
    // Callees first, then callers, breadth first: the page draws a procedure on the level it is reached at first.
    let frontier = direction === "up" ? [] : [focus];
    for (let level = 1; level <= depth && frontier.length > 0; level++) {
      /** @type {number[]} */
      const next = [];
      for (const call of calleesOf(frontier)) {
        if (seen.has(`s${call.target}`)) continue;
        seen.add(`s${call.target}`);
        next.push(call.target);
      }
      frontier = next;
    }
    // Its own set: a callee that calls back must not stop the walk up.
    const above = new Set([`s${focus}`]);
    frontier = direction === "down" ? [] : [focus];
    for (let level = 1; level <= depth && frontier.length > 0; level++) {
      /** @type {number[]} */
      const next = [];
      for (const call of /** @type {{ caller: number | null, file: number, target: number }[]} */ (
        this.all(
          `SELECT r.caller, r.file, l.target_symbol AS target FROM links l JOIN refs r ON r.id = l.ref
           WHERE l.target_symbol IN (SELECT value FROM json_each(?)) AND r.kind != 'include'`,
          JSON.stringify(frontier),
        )
      )) {
        const caller = call.caller === null ? `f${call.file}` : `s${call.caller}`;
        edges.add(caller, "CALLS", `s${call.target}`);
        if (above.has(caller)) continue;
        above.add(caller);
        seen.add(caller);
        if (call.caller !== null) next.push(call.caller);
      }
      frontier = next;
    }
    const symbols = [...seen].filter((key) => key.startsWith("s")).map((key) => Number(key.slice(1)));
    for (const call of calleesOf(symbols)) {
      if (seen.has(`s${call.target}`)) edges.add(`s${call.caller}`, "CALLS", `s${call.target}`);
    }
    return this.pageGraph(edges, [`s${focus}`]);
  }

  /**
   * The modules a module uses, transitively, or the modules using it, or
   * both, and the calls and includes between them; null when the graph has
   * no such module. Any reference that resolves to another file is a use.
   * @param {string} path
   * @param {Direction} direction
   * @returns {PageGraph | null}
   */
  pageDependencies(path, direction) {
    const file = this.module(path);
    if (!file) return null;
    const edges = new Edges();
    /** @param {"r.file" | "l.target_file"} from */
    const walk = (from) => {
      const seen = new Set([file.id]);
      let frontier = [file.id];
      while (frontier.length > 0) {
        /** @type {number[]} */
        const next = [];
        for (const use of /** @type {{ user: number, used: number, include: number }[]} */ (
          this.all(
            `SELECT DISTINCT r.file AS user, l.target_file AS used, r.kind = 'include' AS include FROM refs r JOIN links l ON l.ref = r.id
             WHERE ${from} IN (SELECT value FROM json_each(?)) AND l.target_file IS NOT NULL AND l.target_file != r.file`,
            JSON.stringify(frontier),
          )
        )) {
          edges.add(`f${use.user}`, use.include ? "INCLUDES" : "CALLS", `f${use.used}`);
          const other = from === "r.file" ? use.used : use.user;
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
        }
        frontier = next;
      }
    };
    if (direction !== "up") walk("r.file");
    if (direction !== "down") walk("l.target_file");
    return this.pageGraph(edges, [`f${file.id}`]);
  }

  /**
   * Every module or procedure a module or procedure uses, or is used by, all
   * the way, with its distance in calls or includes, as tab-separated text;
   * null when there is no such module or procedure.
   * @param {string} id a module's path or a procedure's page id
   * @param {Direction} direction
   * @returns {string | null}
   */
  pageDependencyList(id, direction) {
    const page = this.module(id) ? this.pageDependencies(id, direction) : this.pageProcedure(id, 0, direction);
    if (!page) return null;
    const node = new Map(page.nodes.map((n) => [n.id, n]));
    /** @type {Map<string, string[]>} */
    const down = new Map();
    /** @type {Map<string, string[]>} */
    const up = new Map();
    for (const [source, , target] of page.edges) {
      (down.get(source) ?? down.set(source, []).get(source))?.push(target);
      (up.get(target) ?? up.set(target, []).get(target))?.push(source);
    }
    const lines = ["direction\tlevel\tmodule\tprocedure\tline"];
    for (const [label, next, wanted] of /** @type {const} */ ([["uses", down, "down"], ["used by", up, "up"]])) {
      if (direction !== "both" && direction !== wanted) continue;
      /** @type {Map<string, number>} */
      const level = new Map([[id, 0]]);
      let frontier = [id];
      for (let depth = 1; frontier.length > 0; depth++) {
        /** @type {string[]} */
        const reached = [];
        for (const at of frontier) {
          for (const other of next.get(at) ?? []) {
            if (level.has(other)) continue;
            level.set(other, depth);
            reached.push(other);
          }
        }
        frontier = reached;
      }
      level.delete(id);
      const rows = [...level].map(([key, depth]) => {
        const n = /** @type {GraphNode} */ (node.get(key));
        return n.kind === "module" ? { depth, module: n.id, procedure: "", line: "" } : { depth, module: n.path ?? "", procedure: n.name, line: String(n.line ?? "") };
      });
      rows.sort((a, b) => a.depth - b.depth || a.module.localeCompare(b.module) || a.procedure.localeCompare(b.procedure));
      for (const row of rows) lines.push(`${label}\t${row.depth}\t${row.module}\t${row.procedure}\t${row.line}`);
    }
    return `${lines.join("\n")}\n`;
  }

  /**
   * A procedure's statements in source order, with each call expanded into
   * the callee's statements `depth` calls deep, and the code of the includes
   * where they are included. Each procedure and include on the way gets a
   * lane. Null when there is no such procedure.
   * @param {string} id
   * @param {number} depth
   * @returns {{ lanes: FlowLane[], steps: FlowStep[], truncated: boolean } | null}
   */
  pageFlow(id, depth) {
    const focus = this.symbolOf(id);
    if (focus === undefined) return null;
    const { lanes, tops, truncated } = this.flowOf([{ caller: focus }], depth, null);
    return { lanes, steps: tops[0], truncated };
  }

  /**
   * A variable's data flow, end to end. Where it, the structures around it
   * or the fields in it are set, read, passed to a CALL or compared, and
   * inside a callee what happens to the parameter in that place: the flow of
   * each procedure that does, keeping only those statements, what the
   * comparisons lead to, and the IFs, SELECTs, loops and ON-units they are
   * in. Each kept statement is marked with what it does to the variable.
   * Besides the flow: its rules, every condition or SQL WHERE that tests it
   * with what follows, and the statements that set it. Null when there is no
   * such variable.
   * @param {string} id `path:qualified:line` of the variable
   */
  pageDataFlow(id) {
    const parts = /^(.*):([^:]*):(\d+)$/.exec(id);
    const variable = parts && /** @type {{ id: number } | undefined} */ (
      this.all(`SELECT v.id FROM variables v JOIN files f ON f.id = v.file WHERE f.path = ? AND v.qualified = ? AND v.line = ?`, parts[1], parts[2], Number(parts[3]))[0]
    );
    if (!parts || !variable) return null;
    const { passed, touched, tests, rules, sets, truncated } = this.variableRules(variable.id);

    // The flow: what touches it, marked with how, and what its comparisons lead to.
    const rank = /** @type {Record<string, number>} */ ({ compare: 5, write: 4, arg: 3, read: 2, outcome: 1 });
    /** @type {Map<number, string>} */
    const marks = new Map();
    const mark = (/** @type {number} */ statement, /** @type {string} */ how) => {
      if ((rank[marks.get(statement) ?? ""] ?? 0) < rank[how]) marks.set(statement, how);
    };
    for (const row of touched) mark(row.statement, row.mode);
    for (const statement of tests) mark(statement, "compare");
    for (const rule of rules) for (const outcome of [...rule.then, ...rule.else]) mark(outcome.statement, "outcome");
    /** @type {Map<string, { caller: number } | { file: number }>} */
    const owners = new Map();
    for (const row of touched) if (row.top || !passed.called.has(row.caller ?? 0)) owners.set(row.caller ? `s${row.caller}` : `f${row.file}`, row.caller ? { caller: row.caller } : { file: row.file });
    const parents = /** @type {{ id: number }[]} */ (
      this.all(
        `WITH RECURSIVE kept(id) AS (SELECT value FROM json_each(?) UNION SELECT s.parent FROM statements s JOIN kept ON s.id = kept.id WHERE s.parent IS NOT NULL)
         SELECT id FROM kept`,
        JSON.stringify([...marks.keys()]),
      )
    );
    for (const row of parents) if (!marks.has(row.id)) marks.set(row.id, "");
    // The names in each statement that hold the value, as written there.
    /** @type {Map<number, string[]>} */
    const names = new Map();
    for (const row of touched) {
      const list = names.get(row.statement) ?? names.set(row.statement, []).get(row.statement) ?? [];
      if (!list.includes(row.name)) list.push(row.name);
    }
    const flow = this.flowOf([...owners.values()], 100, marks, names);
    const where = { lane: 0, path: parts[1], line: Number(parts[3]) };
    const steps = flow.tops.length === 1 ? flow.tops[0]
      : flow.tops.length ? [{ kind: "select", text: `Data flow of ${parts[2]}`, ...where, branches: flow.tops.map((steps, i) => ({ guard: flow.lanes[steps[0]?.lane ?? i].name, steps })) }]
      : [];
    return { variable: parts[2], lanes: flow.lanes, steps, truncated: truncated || flow.truncated, rules, sets };
  }

  /**
   * A variable's rules: every condition or SQL WHERE that tests it, or the
   * variables its value goes on to, with what follows from it and when it
   * is tested at all; and the statements that set it. Also what the data
   * flow is drawn from: the statements that touch it and those that test it.
   * @param {number} id the variable
   */
  variableRules(id) {
    const variable = { id };
    // Also where the variable goes under another name, as the parameter of a procedure it is passed to.
    const passed = this.passedOn(variable.id);
    const reached = JSON.stringify(passed.reached);
    /** @type {Map<string, string[]>} */
    const sources = new Map();

    // Every statement that touches it; a field of a LIKE copy is the template's field, reached through the copy.
    const touched = /** @type {{ statement: number, caller: number | null, file: number, mode: string, name: string, reached: number, top: number }[]} */ (
      this.all(
        `WITH RECURSIVE ${FAMILIES}
         SELECT DISTINCT a.statement, s.caller, s.file, a.mode, a.name, touching.root AS reached, touching.root = ? AS top FROM touching CROSS JOIN accesses a ON a.id = touching.access
         JOIN statements s ON s.id = a.statement
         ORDER BY s.file, s.line`,
        reached,
        variable.id,
      )
    ).filter((row) => passed.live(row.reached, row.statement));

    // The comparisons. A WHEN's comparison belongs to it, the read of the SELECT subject to the SELECT.
    const found = /** @type {{ id: number, at: number, statement: number, parent: number | null, tested: number, left: string, operator: string, right: string, kind: string, detail: string | null, line: number, path: string, procedure: string | null, name: string }[]} */ (
      this.all(
        `WITH reached(id) AS (SELECT value FROM json_each(?))
         SELECT DISTINCT c.id, a.statement AS at, c.statement, s.parent, coalesce(a.through, a.variable) AS tested, c.left, c.operator, c.right, s.kind, s.detail, s.line, f.path, p.name AS procedure, a.name
         FROM accesses a JOIN statements s ON a.statement = s.id OR a.statement = s.parent JOIN comparisons c ON c.statement = s.id
         JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller
         WHERE a.mode = 'read' AND ((a.through IS NULL AND a.variable IN reached) OR a.through IN reached)
         ORDER BY f.path, s.line, c.id LIMIT 1001`,
        reached,
      )
    ).filter((c, i, all) => passed.live(c.tested, c.at) && all.findIndex((o) => o.id === c.id && passed.live(o.tested, o.at)) === i);
    let truncated = found.length > 1000 || passed.truncated;
    // A side mentions the variable when it holds its name as written, also in SUBSTR(...) or with a subscript.
    const mentions = (/** @type {string} */ side, /** @type {string} */ name) =>
      new RegExp(`(?:^|[^\\w#@$.])${name.replace(/[.$]/g, "\\$&")}(?![\\w#@$])`, "i").test(side);
    const flipped = /** @type {Record<string, string>} */ ({ "<": ">", ">": "<", "<=": ">=", ">=": "<=", "^<": "^>", "^>": "^<", "¬<": "¬>", "¬>": "¬<" });
    /** @typedef {{ text: string, guards: string[], path: string, line: number, statement: number }} Outcome */
    // Which statement of the flow tests it: a WHEN is drawn as a branch of its SELECT.
    /** @type {number[]} */
    const tests = [];
    /** @type {Map<number | string, { statement: number, procedure: string, path: string, line: number, field: string, operator: string, values: string[], condition: string, when: string[][], then: Outcome[], else: Outcome[] }>} */
    const rules = new Map();
    // Which of the reached variables each rule tests, to find the calls that lead to it.
    /** @type {Map<number | string, number>} */
    const testing = new Map();
    for (const c of found.slice(0, 1000)) {
      if (!mentions(c.left, c.name) && !mentions(c.right, c.name)) continue;
      const onLeft = mentions(c.left, c.name);
      const other = onLeft ? c.right : c.left;
      const rule = rules.get(c.statement);
      if (rule) {
        rule.values.push(other);
        continue;
      }
      const condition = c.kind === "when" ? `WHEN (${c.detail})` : c.kind === "do" ? `DO ${c.detail}` : `${c.kind.toUpperCase()} ${c.detail}`;
      const operator = onLeft ? c.operator : flipped[c.operator] ?? c.operator;
      tests.push(c.kind === "when" && c.parent ? c.parent : c.statement);
      rules.set(c.statement, { statement: c.statement, procedure: c.procedure ?? c.path, path: c.path, line: c.line, field: onLeft ? c.left : c.right, operator, values: [other], condition, when: [], then: [], else: [] });
      testing.set(c.statement, c.tested);
    }
    // What a WHEN does not lead to: the OTHERWISE of its SELECT is what happens when it is false.
    const otherwise = /** @type {{ rule: number, id: number }[]} */ (
      this.all(
        `SELECT w.id AS rule, o.id FROM statements w JOIN statements o ON o.parent = w.parent AND o.kind = 'otherwise'
         WHERE w.kind = 'when' AND w.id IN (SELECT value FROM json_each(?))`,
        JSON.stringify([...rules.keys()]),
      )
    );
    // What each comparison leads to: the statements in it that do something,
    // each with the IFs, WHENs, loops and ON-units between it and the rule.
    const inside = /** @type {{ top: number, id: number, parent: number, kind: string, branch: string | null, detail: string | null, line: number, end_line: number | null, path: string }[]} */ (
      this.all(
        `WITH RECURSIVE inside(top, id) AS (SELECT value, value FROM json_each(?) UNION SELECT inside.top, s.id FROM statements s JOIN inside ON s.parent = inside.id)
         SELECT inside.top, s.id, s.parent, s.kind, s.branch, s.detail, s.line, s.end_line, f.path
         FROM inside JOIN statements s ON s.id = inside.id JOIN files f ON f.id = s.file WHERE s.id <> inside.top ORDER BY s.line, s.id`,
        JSON.stringify([...rules.keys(), ...otherwise.map((o) => o.id)]),
      )
    );
    const byId = new Map(inside.map((s) => [s.id, s]));
    const containers = new Set(["if", "select", "when", "otherwise", "do", "begin", "declare", "null", "on"]);
    for (const s of inside) {
      if (containers.has(s.kind)) continue;
      const owners = otherwise.filter((o) => o.id === s.top).map((o) => rules.get(o.rule));
      const rule = rules.get(s.top);
      if (!rule && !owners.length) continue;
      /** @type {string[]} */
      const guards = [];
      let at = s;
      while (at.parent !== s.top) {
        const parent = byId.get(at.parent);
        if (!parent) break;
        if (parent.kind === "if") guards.unshift(`IF ${parent.detail} [${at.branch === "else" ? "false" : "true"}]`);
        else if (parent.kind === "when") guards.unshift(`WHEN (${parent.detail})`);
        else if (parent.kind === "otherwise") guards.unshift("OTHERWISE");
        else if (parent.kind === "do" && parent.detail) guards.unshift(`DO ${parent.detail}`);
        else if (parent.kind === "on") guards.unshift(`ON ${parent.detail}`);
        at = parent;
      }
      const lists = rule ? [at.branch === "else" ? rule.else : rule.then] : owners.map((o) => o?.else ?? []);
      for (const outcomes of lists) {
        if (outcomes.length < 50) outcomes.push({ text: this.statementText(s, sources), guards, path: s.path, line: s.line, statement: s.id });
        else truncated = true;
      }
    }

    // The WHERE conditions of the database statements it is in, which are rules too.
    const sql = /** @type {{ statement: number, tested: number, kind: string, at: number, end_line: number | null, path: string, procedure: string | null, operation: string, schema: string | null, table_name: string | null, expression: string | null, line: number, name: string }[]} */ (
      this.all(
        `WITH RECURSIVE ${FAMILIES}
         SELECT DISTINCT s.id AS statement, touching.root AS tested, s.kind, s.line AS at, s.end_line, f.path, p.name AS procedure,
           c.operation, c.schema, c.table_name, c.expression, c.line, a.name
         FROM touching CROSS JOIN accesses a ON a.id = touching.access
         JOIN statements s ON s.id = a.statement AND s.kind = 'exec'
         JOIN sql_columns c ON c.file = s.file AND c.line BETWEEN s.line AND coalesce(s.end_line, s.line) AND c.host = a.name
         JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller
         WHERE c.usage = 'where'
         ORDER BY f.path, c.line LIMIT 1000`,
        reached,
      )
    ).filter((c) => passed.live(c.tested, c.statement));
    for (const c of sql) {
      const key = `${c.statement} ${c.expression}`;
      if (rules.has(key)) continue;
      const table = [c.schema, c.table_name].filter(Boolean).join(".") || "?";
      tests.push(c.statement);
      const statement = { text: this.statementText({ ...c, line: c.at }, sources), guards: [], path: c.path, line: c.at, statement: c.statement };
      rules.set(key, { statement: c.statement, procedure: c.procedure ?? c.path, path: c.path, line: c.line, field: c.name, operator: "", values: [], condition: `${c.operation} ${table} WHERE ${c.expression}`, when: [], then: [statement], else: [] });
      testing.set(key, c.tested);
    }

    // When each rule is tested at all: the IFs, WHENs, loops and ON-units
    // around it, and in a procedure the variable is passed to, the way to
    // each CALL that passes it, back to where the variable is declared.
    const viaSteps = [...passed.via.values()].flat().map((v) => v.step);
    const writes = touched.filter((row) => row.mode === "write");
    const around = /** @type {{ start: number, id: number, parent: number | null, kind: string, branch: string | null, detail: string | null, line: number, end_line: number | null, path: string, procedure: string | null }[]} */ (
      this.all(
        `WITH RECURSIVE up(start, id) AS (SELECT value, value FROM json_each(?) UNION SELECT up.start, s.parent FROM statements s JOIN up ON s.id = up.id WHERE s.parent IS NOT NULL)
         SELECT up.start, s.id, s.parent, s.kind, s.branch, s.detail, s.line, s.end_line, f.path, p.name AS procedure
         FROM up JOIN statements s ON s.id = up.id JOIN files f ON f.id = s.file LEFT JOIN symbols p ON p.id = s.caller`,
        JSON.stringify([...new Set([...[...rules.values()].map((r) => r.statement), ...viaSteps, ...writes.map((row) => row.statement)])]),
      )
    );
    const statement = new Map(around.map((s) => [s.id, s]));
    const guardsOf = (/** @type {number} */ id) => {
      /** @type {string[]} */
      const guards = [];
      let at = statement.get(id);
      while (at?.parent) {
        const parent = statement.get(at.parent);
        if (!parent) break;
        const select = parent.parent ? statement.get(parent.parent) : undefined;
        const subject = select?.detail ? `SELECT (${select.detail}) ` : "SELECT ";
        if (parent.kind === "if") guards.unshift(`IF ${parent.detail} [${at.branch === "else" ? "false" : "true"}]`);
        else if (parent.kind === "when") guards.unshift(`${subject}WHEN (${parent.detail})`);
        else if (parent.kind === "otherwise") guards.unshift(`${subject}OTHERWISE`);
        else if (parent.kind === "do" && parent.detail) guards.unshift(`DO ${parent.detail}`);
        else if (parent.kind === "on") guards.unshift(`ON ${parent.detail}`);
        at = parent;
      }
      return guards;
    };
    /** @returns {string[][]} */
    const pathsTo = (/** @type {number} */ tested, /** @type {number} */ id, /** @type {Set<number>} */ seen) => {
      const own = guardsOf(id);
      const via = tested === variable.id || seen.has(tested) ? [] : passed.via.get(tested) ?? [];
      if (!via.length) return [own];
      /** @type {string[][]} */
      const paths = [];
      for (const { step, from } of via) {
        // The assignment that copies into it: what led to its source leads here.
        if (step === id) {
          paths.push(...pathsTo(from, id, new Set([...seen, tested])));
          continue;
        }
        const row = statement.get(step);
        if (!row) continue;
        const text = `${row.procedure ?? row.path}: ${this.statementText(row, sources).replace(/\s+/g, " ")}`;
        // A guard around both the step and what follows it is said once.
        for (const path of pathsTo(from, step, new Set([...seen, tested]))) paths.push([...path, text, ...own.filter((guard) => !path.includes(guard))]);
        if (paths.length >= 5) break;
      }
      if (paths.length > 5) truncated = true;
      return paths.slice(0, 5);
    };
    for (const [key, rule] of rules) {
      const paths = pathsTo(testing.get(key) ?? variable.id, rule.statement, new Set());
      rule.when = paths.length === 1 && !paths[0].length ? [] : paths;
    }
    // Where it is set, and when: what a message or return code says comes from here.
    /** @type {Map<number, { statement: number, procedure: string, path: string, line: number, text: string, when: string[][] }>} */
    const sets = new Map();
    for (const row of writes) {
      const at = statement.get(row.statement);
      if (!at || sets.has(row.statement)) continue;
      const paths = pathsTo(row.reached, row.statement, new Set());
      sets.set(row.statement, { statement: row.statement, procedure: at.procedure ?? at.path, path: at.path, line: at.line, text: this.statementText(at, sources), when: paths.length === 1 && !paths[0].length ? [] : paths });
    }
    return {
      passed,
      touched,
      tests,
      truncated,
      rules: [...rules.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
      sets: [...sets.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    };
  }

  /**
   * The variable, and the variables its value goes on to: for every CALL
   * that passes it, its structure or a field of it, the callee's parameter in
   * that place; for a function it is an argument of, the function's
   * parameter; for an assignment or EXEC SQL that reads it, the variables
   * it writes; for a RETURN of it, the variables assigned the function's
   * result; and on from each of those. `via` holds for each variable reached
   * the statements that lead to it, and from which; `called` the procedures
   * entered by a CALL, which the flow draws inside the CALL.
   *
   * A parameter is the variable under another name, so it holds the value
   * everywhere. A copy holds it only from the copy on, until a statement
   * that reads nothing reached overwrites it: `live` tells whether a
   * statement sees the value in a variable reached. That is by line within
   * the procedure of the copy, a loop around both counting as both ways, and
   * a write ending it for what follows in the write's own block. Elsewhere,
   * such as in procedures that read a copied global, it is everywhere.
   * @param {number} id
   * @returns {{ reached: number[], via: Map<number, { step: number, from: number }[]>, called: Set<number>, truncated: boolean, live: (variable: number, statement: number) => boolean }}
   */
  passedOn(id) {
    const reached = [id];
    /** @type {Map<number, { step: number, from: number }[]>} */
    const via = new Map();
    /** @type {Set<number>} */
    const called = new Set();
    // The copies each copied variable starts at; a variable without is the root or a parameter.
    /** @type {Map<number, number[]>} */
    const starts = new Map();
    /** @type {Set<number>} */
    const aliases = new Set([id]);

    /** @typedef {{ id: number, owner: string, line: number, parent: number | null, around: Set<number>, loops: number[] }} Place */
    /** @type {Map<number, Place>} */
    const places = new Map();
    const place = (/** @type {number} */ statement) => {
      const known = places.get(statement);
      if (known) return known;
      const chain = /** @type {{ id: number, parent: number | null, kind: string, detail: string | null, line: number, caller: number | null, file: number }[]} */ (
        this.all(
          `WITH RECURSIVE up(id, depth) AS (SELECT ?, 0 UNION SELECT s.parent, up.depth + 1 FROM statements s JOIN up ON s.id = up.id WHERE s.parent IS NOT NULL)
           SELECT s.id, s.parent, s.kind, s.detail, s.line, s.caller, s.file FROM up JOIN statements s ON s.id = up.id ORDER BY up.depth`,
          statement,
        )
      );
      const self = chain[0];
      const found = {
        id: statement,
        owner: self ? (self.caller ? `s${self.caller}` : `f${self.file}`) : "",
        line: self?.line ?? 0,
        parent: self?.parent ?? null,
        around: new Set(chain.slice(1).map((s) => s.id)),
        loops: chain.slice(1).filter((s) => s.kind === "do" && s.detail).map((s) => s.id),
      };
      places.set(statement, found);
      return found;
    };
    const before = (/** @type {Place} */ a, /** @type {Place} */ b) => a.line < b.line || (a.line === b.line && a.id < b.id);
    // The statements that overwrite a copied variable with something else.
    /** @type {Map<number, Place[]>} */
    const kills = new Map();
    const killsOf = (/** @type {number} */ variable) => {
      const known = kills.get(variable);
      if (known) return known;
      const rows = /** @type {{ statement: number }[]} */ (
        this.all(
          `SELECT DISTINCT w.statement FROM accesses w
           WHERE w.mode = 'write' AND ((w.variable = ? AND w.through IS NULL) OR w.through = ?)
             AND NOT EXISTS (SELECT 1 FROM accesses r WHERE r.statement = w.statement AND r.mode = 'read' AND coalesce(r.through, r.variable) IN (SELECT value FROM json_each(?)))`,
          variable,
          variable,
          JSON.stringify(reached),
        )
      );
      const found = rows.map((row) => place(row.statement));
      kills.set(variable, found);
      return found;
    };
    const live = (/** @type {number} */ variable, /** @type {number} */ statement) => {
      const from = starts.get(variable);
      if (aliases.has(variable) || !from) return true;
      const at = place(statement);
      for (const start of from.map(place)) {
        if (start.owner !== at.owner || start.id === at.id) return true;
        if (start.loops.some((loop) => at.around.has(loop))) return true;
        if (before(at, start)) continue;
        const killed = killsOf(variable).some((k) => k.owner === at.owner && before(start, k) && before(k, at) && (k.parent === null || at.around.has(k.parent)));
        if (!killed) return true;
      }
      return false;
    };

    for (let i = 0; i < reached.length && reached.length < 100; i++) {
      const at = JSON.stringify([reached[i]]);
      const calls = /** @type {{ passed: number, parameter: number, step: number, at: number, procedure: number }[]} */ (
        this.all(
          `WITH RECURSIVE ${FAMILIES}
           SELECT DISTINCT a.variable AS passed, pv.id AS parameter, s.id AS step, s.id AS at, l.target_symbol AS procedure
           FROM touching CROSS JOIN accesses a ON a.id = touching.access
           JOIN statements s ON s.id = a.statement
           JOIN refs r ON r.file = s.file AND r.line = s.line AND r.kind = 'call' AND r.name = s.detail JOIN links l ON l.ref = r.id
           CROSS JOIN variables pv ON pv.scope = l.target_symbol AND pv.parameter = a.position AND pv.level = 1
           WHERE a.mode = 'arg'`,
          at,
        )
      );
      const functions = /** @type {{ passed: number, parameter: number, step: number, at: number }[]} */ (
        this.all(
          `WITH RECURSIVE ${FAMILIES}
           SELECT DISTINCT a.variable AS passed, pv.id AS parameter, s.id AS step, s.id AS at
           FROM touching CROSS JOIN accesses a ON a.id = touching.access
           JOIN statements s ON s.id = a.statement
           JOIN refs r ON r.file = s.file AND r.line BETWEEN s.line AND s.end_line AND r.kind = 'invoke' JOIN links l ON l.ref = r.id
           CROSS JOIN variables pv ON pv.scope = l.target_symbol AND pv.parameter = a.position AND pv.level = 1
           WHERE a.mode = 'read' AND a.position IS NOT NULL`,
          at,
        )
      );
      const moves = /** @type {{ passed: number, parameter: number, step: number, at: number }[]} */ (
        this.all(
          `WITH RECURSIVE ${FAMILIES}
           SELECT DISTINCT a.variable AS passed, coalesce(w.through, w.variable) AS parameter, s.id AS step, s.id AS at
           FROM touching CROSS JOIN accesses a ON a.id = touching.access
           JOIN statements s ON s.id = a.statement AND s.kind IN ('assignment', 'exec')
           JOIN accesses w INDEXED BY accesses_statement ON w.statement = s.id AND w.mode = 'write' AND w.variable IS NOT NULL
           WHERE a.mode = 'read' AND w.variable IS NOT a.variable`,
          at,
        )
      );
      const returns = /** @type {{ passed: number, parameter: number, step: number, at: number }[]} */ (
        this.all(
          `WITH RECURSIVE ${FAMILIES}
           SELECT DISTINCT a.variable AS passed, coalesce(w.through, w.variable) AS parameter, t.id AS step, s.id AS at
           FROM touching CROSS JOIN accesses a ON a.id = touching.access
           JOIN statements s ON s.id = a.statement AND s.kind = 'return'
           JOIN links l ON l.target_symbol = s.caller JOIN refs r ON r.id = l.ref AND r.kind = 'invoke'
           JOIN statements t ON t.file = r.file AND r.line BETWEEN t.line AND t.end_line AND t.kind = 'assignment'
           JOIN accesses w INDEXED BY accesses_statement ON w.statement = t.id AND w.mode = 'write' AND w.variable IS NOT NULL
           WHERE a.mode = 'read'`,
          at,
        )
      );
      const bound = [...calls, ...functions];
      for (const row of [...bound, ...moves, ...returns]) {
        if (!live(reached[i], row.at)) continue;
        const field = this.sameField(reached[i], row.passed, row.parameter);
        if (field === reached[i] || field === id) continue;
        if (!reached.includes(field)) {
          reached.push(field);
          // A copy from it no longer overwrites with something else.
          kills.clear();
        }
        if (bound.includes(row)) aliases.add(field);
        else (starts.get(field) ?? starts.set(field, []).get(field) ?? []).push(row.step);
        (via.get(field) ?? via.set(field, []).get(field) ?? []).push({ step: row.step, from: reached[i] });
      }
      for (const row of calls) if (live(reached[i], row.at)) called.add(row.procedure);
    }
    return { reached, via, called, truncated: reached.length >= 100, live };
  }

  /**
   * The variable in `parameter` that stands for `tracked` when `passed` is
   * the argument: the field in the same place when a structure around
   * `tracked` is passed, else the parameter itself.
   * @param {number} tracked
   * @param {number | null} passed
   * @param {number} parameter
   * @returns {number}
   */
  sameField(tracked, passed, parameter) {
    /** @type {number[]} */
    const places = [];
    for (let at = tracked; at !== passed; ) {
      const row = /** @type {{ parent: number | null, place: number } | undefined} */ (
        this.all(`SELECT parent, (SELECT count(*) FROM variables o WHERE o.parent = v.parent AND o.id < v.id) AS place FROM variables v WHERE id = ?`, at)[0]
      );
      if (!row || row.parent === null) return parameter;
      places.unshift(row.place);
      at = row.parent;
    }
    let field = parameter;
    for (const place of places) {
      const child = /** @type {{ id: number } | undefined} */ (this.all(`SELECT id FROM variables WHERE parent = ? ORDER BY id LIMIT 1 OFFSET ?`, field, place)[0]);
      if (!child) return parameter;
      field = child.id;
    }
    return field;
  }

  /**
   * The statement's source from its keyword to the semicolon, keeping its
   * lines and their indentation, without comments.
   * @param {{ path: string, kind: string, line: number, end_line: number | null }} row
   * @param {Map<string, string[]>} sources the files read so far, by path
   */
  statementText(row, sources) {
    const lines = sources.get(row.path) ?? sources.set(row.path, blankMargins(this.read(row.path) ?? "", "pli").split("\n")).get(row.path) ?? [];
    const blank = (/** @type {string} */ s) => s.replace(/[^\n]/g, " ");
    let text = lines.slice(row.line - 1, Math.min(row.end_line ?? row.line, row.line + 60)).join("\n").replace(/\t/g, " ").replace(/\/\*[\s\S]*?\*\//g, blank);
    const at = text.search(new RegExp(row.kind === "declare" ? "\\b(?:DCL|DECLARE)\\b" : `\\b${row.kind}\\b`, "i"));
    // What comes before the statement on its first line turns into blanks, so the columns stay.
    text = at >= 0 ? blank(text.slice(0, at)).replace(/[^\n]*\n/g, "") + text.slice(at) : text.replace(/^.*\b(?:THEN|ELSE|OTHERWISE)\b|^\s*WHEN\s*\([^)]*\)|^\s*ON\s+[\w#@$]+(?:\s*\([^)]*\))?(?:\s*,\s*[\w#@$]+(?:\s*\([^)]*\))?)*(?:\s+SNAP\b)?/i, blank);
    const end = text.indexOf(";");
    const kept = (end >= 0 ? text.slice(0, end + 1) : text).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    const indent = Math.min(...kept.map((l) => l.length - l.trimStart().length));
    text = kept.map((l) => l.slice(indent)).join("\n");
    return (text.length > 1000 ? `${text.slice(0, 999)}…` : text) || row.kind.toUpperCase();
  }

  /**
   * The flows of procedures, or of an include's code outside any, each in a
   * lane of its own: a list of steps per owner. With `keep`, only those
   * statements, each step with its mark as `access`, and the includes
   * holding some of them.
   * @param {({ caller: number } | { file: number })[]} owners
   * @param {number} depth
   * @param {Map<number, string> | null} keep
   * @param {Map<number, string[]>} [names] the names to mark in each statement's text
   * @returns {{ lanes: FlowLane[], tops: FlowStep[][], truncated: boolean }}
   */
  flowOf(owners, depth, keep, names) {
    const keptIn = new Set(
      keep && /** @type {{ caller: number | null }[]} */ (this.all(`SELECT DISTINCT caller FROM statements WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify([...keep.keys()]))).map((r) => r.caller),
    );
    /** @type {FlowLane[]} */
    const lanes = [];
    /** @type {Map<string, number>} */
    const laneOf = new Map();
    /** @param {string} key @param {() => FlowLane} make */
    const lane = (key, make) => laneOf.get(key) ?? laneOf.set(key, lanes.push(make()) - 1).get(key) ?? 0;
    /** @param {number} symbol @returns {FlowLane} */
    const procedureLane = (symbol) => {
      const node = this.symbolNodes(`s.id = ?`, symbol)[0];
      return { id: node.id, kind: "procedure", name: node.name, path: node.path ?? "", line: node.line ?? 1 };
    };
    /** @type {Map<string, string[]>} */
    const sources = new Map();
    /** @param {FlowRow} row */
    const snippet = (row) => this.statementText(row, sources);
    let budget = FLOW_LIMIT;
    let truncated = false;

    /**
     * @param {{ caller: number } | { file: number }} owner a procedure, or an include's code outside any
     * @param {number} at the lane
     * @param {number} level calls made to get here
     * @param {Set<string>} stack the procedures and includes on the way, which are not expanded again
     * @returns {FlowStep[]}
     */
    const stepsOf = (owner, at, level, stack) => {
      const [where, ...keys] = "caller" in owner ? ["file = (SELECT file FROM symbols WHERE id = ?) AND {}.caller = ?", owner.caller, owner.caller] : ["file = ? AND {}.caller IS NULL", owner.file];
      const rows = /** @type {FlowRow[]} */ (
        this.all(`SELECT s.id, s.parent, s.kind, s.branch, s.detail, s.line, s.end_line, f.path FROM statements s JOIN files f ON f.id = s.file WHERE s.${where.replace("{}", "s")} ORDER BY s.line, s.id`, ...keys)
      );
      const refs = /** @type {{ kind: string, name: string, line: number, symbol: number | null, file: number | null, target: string | null }[]} */ (
        this.all(
          `SELECT r.kind, r.name, r.line, l.target_symbol AS symbol, l.target_file AS file, t.path AS target FROM refs r
           LEFT JOIN links l ON l.ref = r.id LEFT JOIN files t ON t.id = l.target_file
           WHERE r.${where.replace("{}", "r")} AND r.kind IN ('call', 'fetch', 'include') ORDER BY r.line, r.id`,
          ...keys,
        )
      );
      /** @type {Map<string, (typeof refs)[number]>} */
      const callAt = new Map();
      for (const ref of refs) if (ref.kind !== "include" && !callAt.has(`${ref.line} ${ref.name}`)) callAt.set(`${ref.line} ${ref.name}`, ref);
      /** @type {Map<number | null, FlowRow[]>} */
      const children = new Map();
      for (const row of rows) (children.get(row.parent) ?? children.set(row.parent, []).get(row.parent))?.push(row);

      /** @param {FlowRow} row @returns {FlowStep} */
      const call = (row) => {
        const step = { kind: "call", text: snippet(row), lane: at, path: row.path, line: row.line, ...(keep?.get(row.id) && { access: keep.get(row.id) }), ...(names?.has(row.id) && { names: names.get(row.id) }) };
        const ref = callAt.get(`${row.line} ${row.detail?.toUpperCase()}`);
        if (!ref?.file) return { ...step, call: "missing" };
        if (!ref.symbol) return { ...step, call: "external" };
        if (stack.has(`s${ref.symbol}`)) return { ...step, call: "recursive" };
        if (level >= depth) return { ...step, call: "cut" };
        if (budget <= 0) {
          truncated = true;
          return { ...step, call: "cut" };
        }
        // A data flow draws a callee only where it touches what was passed.
        if (keep && !keptIn.has(ref.symbol)) return { ...step, call: "expanded" };
        const to = lane(`s${ref.symbol}`, () => procedureLane(/** @type {number} */ (ref.symbol)));
        return { ...step, call: "expanded", steps: stepsOf({ caller: ref.symbol }, to, level + 1, new Set([...stack, `s${ref.symbol}`])) };
      };
      /** @param {(typeof refs)[number]} ref @returns {FlowStep} */
      const include = (ref) => {
        const text = `%INCLUDE ${ref.name}`;
        if (!ref.file || !ref.target) return { kind: "include", text, lane: at, path: rows[0]?.path ?? "", line: ref.line, call: "missing" };
        const to = lane(`f${ref.file}`, () => ({ id: /** @type {string} */ (ref.target), kind: "include", name: ref.name, path: /** @type {string} */ (ref.target), line: 1 }));
        // Code in an include runs where it is included: no call, so no level.
        const steps = stack.has(`f${ref.file}`) ? [] : stepsOf({ file: ref.file }, to, level, new Set([...stack, `f${ref.file}`]));
        return { kind: "include", text, lane: to, path: ref.target, line: 1, ...(steps.length > 0 && { steps }) };
      };
      /** @param {FlowRow} row @returns {FlowStep[]} */
      const convert = (row) => {
        if (keep && !keep.has(row.id)) return [];
        budget--;
        const inner = children.get(row.id) ?? [];
        const step = { kind: row.kind, text: snippet(row), lane: at, path: row.path, line: row.line, ...(keep?.get(row.id) && { access: keep.get(row.id) }), ...(names?.has(row.id) && { names: names.get(row.id) }) };
        switch (row.kind) {
          case "if":
            return [{ ...step, text: `IF ${row.detail ?? ""}`, branches: [
              { guard: "true", steps: walk(inner.filter((r) => r.branch === "then")) },
              { guard: "false", steps: walk(inner.filter((r) => r.branch === "else")) },
            ] }];
          case "select":
            return [{ ...step, branches: inner.filter((r) => !keep || keep.has(r.id)).map((r) => ({ guard: r.kind === "otherwise" ? "otherwise" : r.detail ?? "", steps: walk(children.get(r.id) ?? []) })) }];
          case "do":
          case "begin":
            return row.detail ? [{ ...step, kind: "loop", text: `DO ${row.detail}`, steps: walk(inner) }] : walk(inner);
          case "call":
          case "fetch":
            return [call(row)];
        }
        // An ON-unit runs when its condition is raised, not here; only a data flow shows what it does.
        return keep && inner.length ? [{ ...step, text: `ON ${row.detail ?? ""}`, steps: walk(inner) }] : [step];
      };
      /** @param {FlowRow[]} list @returns {FlowStep[]} */
      const walk = (list) => list.flatMap(convert);

      /** @type {(FlowRow | (typeof refs)[number])[]} */
      const top = [...(children.get(null) ?? []), ...refs.filter((r) => r.kind === "include")];
      top.sort((a, b) => a.line - b.line);
      return top.flatMap((item) => ("id" in item ? convert(item) : [include(item)]).filter((step) => !keep || step.kind !== "include" || step.steps));
    };

    /** @param {number} file @returns {FlowLane} */
    const includeLane = (file) => {
      const path = /** @type {{ path: string }} */ (this.all(`SELECT path FROM files WHERE id = ?`, file)[0]).path;
      return { id: path, kind: "include", name: path.split("/").pop() ?? path, path, line: 1 };
    };
    const tops = owners.map((owner) => {
      const key = "caller" in owner ? `s${owner.caller}` : `f${owner.file}`;
      const at = lane(key, () => ("caller" in owner ? procedureLane(owner.caller) : includeLane(owner.file)));
      return stepsOf(owner, at, 0, new Set([key]));
    });
    if (!keep) return { lanes, tops, truncated };

    // A data flow drops what does nothing to the variable, which can leave
    // an include's or a procedure's lane without a step.
    /** @type {FlowStep[]} */
    const all = [];
    /** @param {FlowStep[]} steps */
    const collect = (steps) => {
      for (const step of steps) {
        all.push(step);
        for (const branch of step.branches ?? []) collect(branch.steps);
        collect(step.steps ?? []);
      }
    };
    for (const steps of tops) collect(steps);
    const used = [...new Set(all.map((step) => step.lane))].sort((a, b) => a - b);
    const moved = new Map(used.map((old, now) => [old, now]));
    for (const step of all) step.lane = moved.get(step.lane) ?? 0;
    return { lanes: used.map((old) => lanes[old]), tops: tops.filter((steps) => steps.length), truncated };
  }

  /**
   * The tables, views and aliases a DDL file creates, the ones `depth`
   * relations away in either direction, and the relations between them all.
   * Null when the file creates none.
   * @param {string} path
   * @param {number} depth
   * @returns {{ entities: ModelEntity[], relations: ModelRelation[], truncated: boolean } | null}
   */
  pageDataModel(path, depth) {
    const ENTITY_KINDS = `('table', 'view', 'alias')`;
    const own = /** @type {{ id: number }[]} */ (
      this.all(`SELECT s.id FROM symbols s JOIN files f ON f.id = s.file WHERE f.path = ? AND s.kind IN ${ENTITY_KINDS} ORDER BY s.id`, path)
    ).map((r) => r.id);
    if (own.length === 0) return null;
    const RELATIONS = `SELECT r.caller AS source, l.target_symbol AS target, r.detail, cs.kind FROM refs r
      JOIN symbols cs ON cs.id = r.caller JOIN links l ON l.ref = r.id
      WHERE r.kind = 'table' AND cs.kind IN ${ENTITY_KINDS} AND l.target_symbol IS NOT NULL`;
    /** @type {Map<number, number>} */
    const distance = new Map(own.map((id) => [id, 0]));
    let truncated = false;
    for (let level = 1, frontier = own; level <= depth && frontier.length > 0; level++) {
      const near = /** @type {{ source: number, target: number }[]} */ (
        this.all(
          `SELECT * FROM (${RELATIONS} AND r.caller IN (SELECT value FROM json_each(?)))
           UNION SELECT * FROM (${RELATIONS} AND l.target_symbol IN (SELECT value FROM json_each(?)))`,
          JSON.stringify(frontier),
          JSON.stringify(frontier),
        )
      );
      frontier = [];
      for (const id of near.flatMap((r) => [r.source, r.target])) {
        if (distance.has(id)) continue;
        if (distance.size >= MODEL_LIMIT) {
          truncated = true;
          break;
        }
        distance.set(id, level);
        frontier.push(id);
      }
    }

    const ids = JSON.stringify([...distance.keys()]);
    const symbols = /** @type {{ id: number, kind: ModelEntity["kind"], name: string, qualifier: string | null, path: string, line: number }[]} */ (
      this.all(`SELECT s.id, s.kind, s.name, s.qualifier, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.id IN (SELECT value FROM json_each(?))`, ids)
    );
    const pageId = new Map(symbols.map((s) => [s.id, `${s.path}:${s.name}:${s.line}`]));
    const links = /** @type {{ source: number, target: number, detail: string | null, kind: string }[]} */ (
      this.all(`${RELATIONS} AND r.caller IN (SELECT value FROM json_each(?)) AND l.target_symbol IN (SELECT value FROM json_each(?)) ORDER BY r.id`, ids, ids)
    );
    /** @type {Map<string, ModelRelation>} */
    const relations = new Map();
    /** @type {Map<number, Set<string>>} */
    const foreign = new Map();
    for (const link of links) {
      const columns = link.detail?.match(/\((.*)\)/)?.[1].split(", ").filter(Boolean) ?? [];
      const kind = link.kind === "table" ? "references" : link.kind === "view" ? "view" : "alias";
      const relation = { from: pageId.get(link.source) ?? "", to: pageId.get(link.target) ?? "", kind, columns };
      relations.set(JSON.stringify(relation), /** @type {ModelRelation} */ (relation));
      for (const column of columns) (foreign.get(link.source) ?? foreign.set(link.source, new Set()).get(link.source))?.add(column);
    }
    const columns = /** @type {{ table: number, name: string, type: string, notNull: number, key: number | null }[]} */ (
      this.all(`SELECT table_symbol AS "table", name, type, not_null AS "notNull", key FROM columns WHERE table_symbol IN (SELECT value FROM json_each(?)) ORDER BY table_symbol, position`, ids)
    );
    /** @type {ModelEntity[]} */
    const entities = symbols.map((s) => ({
      id: pageId.get(s.id) ?? "",
      kind: s.kind,
      name: s.name,
      qualifier: s.qualifier,
      path: s.path,
      line: s.line,
      distance: distance.get(s.id) ?? 0,
      columns: columns
        .filter((c) => c.table === s.id)
        .map((c) => ({ name: c.name, type: c.type, notNull: c.notNull === 1, key: c.key, foreign: foreign.get(s.id)?.has(c.name) ?? false })),
    }));
    entities.sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path) || a.line - b.line);
    return { entities, relations: [...relations.values()], truncated };
  }

  /**
   * What the details panel lists for a module or a procedure; null for neither.
   * @param {string} id
   */
  pageDetails(id) {
    const file = this.module(id);
    if (file) {
      const modules = (/** @type {string} */ sql) =>
        /** @type {{ path: string }[]} */ (this.all(sql, file.id)).map((row) => moduleNode(row.path));
      return {
        node: moduleNode(file.path),
        procedures: this.symbolNodes(`s.file = ? AND s.kind != 'package'`, file.id),
        includes: /** @type {{ name: string, path: string | null }[]} */ (
          this.all(
            `SELECT DISTINCT r.name, tf.path FROM refs r LEFT JOIN links l ON l.ref = r.id LEFT JOIN files tf ON tf.id = l.target_file
             WHERE r.file = ? AND r.kind = 'include'`,
            file.id,
          )
        ).map((row) => (row.path === null ? { id: `external:${row.name}`, kind: "external", name: row.name } : moduleNode(row.path))),
        includedBy: modules(
          `SELECT DISTINCT f.path FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
           WHERE l.target_file = ? AND r.kind = 'include' AND r.file != l.target_file`,
        ),
        callsInto: modules(
          `SELECT DISTINCT tf.path FROM refs r JOIN links l ON l.ref = r.id JOIN files tf ON tf.id = l.target_file
           WHERE r.file = ? AND l.target_symbol IS NOT NULL AND r.kind != 'include' AND l.target_file != r.file`,
        ),
        calledFrom: modules(
          `SELECT DISTINCT f.path FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
           WHERE l.target_file = ? AND l.target_symbol IS NOT NULL AND r.kind != 'include' AND r.file != l.target_file`,
        ),
        unresolved: /** @type {{ name: string }[]} */ (
          this.all(
            `SELECT DISTINCT r.name FROM refs r WHERE r.file = ? AND r.kind IN ${MISSING}
             AND NOT EXISTS (SELECT 1 FROM links l WHERE l.ref = r.id) ORDER BY r.name`,
            file.id,
          )
        ).map((row) => row.name),
      };
    }
    const symbol = this.symbolOf(id);
    if (symbol === undefined) return null;
    const [node] = this.symbolNodes(`s.id = ?`, symbol);
    const { parent } = /** @type {{ parent: number | null }} */ (this.all(`SELECT parent FROM symbols WHERE id = ?`, symbol)[0]);
    const callers = /** @type {{ caller: number | null, path: string }[]} */ (
      this.all(
        `SELECT DISTINCT r.caller, f.path FROM links l JOIN refs r ON r.id = l.ref JOIN files f ON f.id = r.file
         WHERE l.target_symbol = ? AND r.kind != 'include'`,
        symbol,
      )
    );
    return {
      node,
      definedIn: parent === null ? [moduleNode(/** @type {string} */ (node.path))] : this.symbolNodes(`s.id = ?`, parent),
      calledBy: [
        ...callers.filter((row) => row.caller === null).map((row) => moduleNode(row.path)),
        ...this.symbolNodes(
          `s.id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(callers.filter((row) => row.caller !== null).map((row) => row.caller)),
        ),
      ],
      calls: this.symbolNodes(
        `s.id IN (SELECT l.target_symbol FROM refs r JOIN links l ON l.ref = r.id WHERE r.caller = ? AND r.kind != 'include')`,
        symbol,
      ),
      defines: this.symbolNodes(`s.parent = ?`, symbol),
    };
  }

  /**
   * Up to 50 procedures and modules whose name has `query` in it, exact names first.
   * @param {string} query
   * @returns {GraphNode[]}
   */
  pageSearch(query) {
    const name = query.trim().toUpperCase();
    if (!name) return [];
    const like = `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const found = [
      ...this.symbolNodes(`s.kind != 'package' AND s.name LIKE ? ESCAPE '\\' ORDER BY s.name = ? DESC, s.name LIMIT 50`, like, name),
      .../** @type {{ path: string }[]} */ (this.all(`SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT 50`, like)).map((row) =>
        moduleNode(row.path),
      ),
    ];
    const label = (/** @type {GraphNode} */ n) => (n.kind === "module" ? n.id : n.name).toUpperCase();
    const rank = (/** @type {GraphNode} */ n) => (label(n) === name || n.name.toUpperCase() === name ? "0" : "1") + label(n);
    return found.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0)).slice(0, 50);
  }

  /**
   * A sidebar tab: modules, OPTIONS(MAIN) entry points or the names nothing
   * defines, those containing `filter`, sorted, at most `limit`.
   * @param {"modules" | "entries" | "unresolved"} tab
   * @param {string} filter
   * @param {number} [limit]
   */
  pageList(tab, filter, limit = 500) {
    const totals = this.pageTotals();
    const wanted = filter.trim().toUpperCase();
    /** @type {{ id: string, text: string, sub?: string, count: number, title?: string }[]} */
    let rows = [];
    if (tab === "modules") {
      for (const [id, path] of totals.paths) rows.push({ id: path, text: path, count: totals.procedures.get(id) ?? 0 });
    } else if (tab === "entries") {
      const entries = /** @type {(SymbolRow & { detail: string | null, calls: number })[]} */ (
        this.all(
          `SELECT ${SYMBOL}, s.detail, (SELECT count(DISTINCT l.target_symbol) FROM refs r JOIN links l ON l.ref = r.id WHERE r.caller = s.id) AS calls
           FROM symbols s JOIN files f ON f.id = s.file WHERE s.detail LIKE '%MAIN%'`,
        )
      );
      rows = entries
        .filter((entry) => MAIN_OPTIONS.test(entry.detail ?? ""))
        .map((entry) => ({ id: `${entry.path}:${entry.name}:${entry.line}`, text: entry.name, sub: entry.path, count: entry.calls }));
    } else {
      for (const [name, files] of totals.unresolved) {
        const paths = files.map((file) => totals.paths.get(file) ?? "?");
        rows.push({ id: paths[0], text: name, count: files.length, title: `referenced in ${paths.slice(0, 20).join(", ")}${paths.length > 20 ? ", ..." : ""}` });
      }
    }
    rows = rows.filter((row) => row.text.toUpperCase().includes(wanted)).sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
    return { rows: rows.slice(0, limit), total: rows.length };
  }

  /**
   * The nodes of edges between `s<symbol id>` and `f<file id>` keys, and the
   * edges by node id.
   * @param {Edges} edges
   * @param {string[]} keys nodes to include even without edges
   * @returns {PageGraph}
   */
  pageGraph(edges, keys) {
    const all = new Set(keys);
    for (const [a, , b] of edges.list) {
      all.add(a);
      all.add(b);
    }
    const ids = (/** @type {string} */ prefix) => JSON.stringify([...all].filter((key) => key.startsWith(prefix)).map((key) => Number(key.slice(1))));
    /** @type {Map<string, GraphNode>} */
    const nodes = new Map();
    for (const row of /** @type {{ id: number, path: string }[]} */ (this.all(`SELECT id, path FROM files WHERE id IN (SELECT value FROM json_each(?))`, ids("f")))) {
      nodes.set(`f${row.id}`, moduleNode(row.path));
    }
    const symbols = /** @type {(SymbolRow & { kind: string, detail: string | null })[]} */ (
      this.all(`SELECT ${SYMBOL}, s.kind, s.detail FROM symbols s JOIN files f ON f.id = s.file WHERE s.id IN (SELECT value FROM json_each(?))`, ids("s"))
    );
    for (const row of symbols) nodes.set(`s${row.id}`, symbolNode(row));
    /** @type {[string, string, string][]} */
    const edgeIds = [];
    for (const [a, type, b] of edges.list) {
      const source = nodes.get(a);
      const target = nodes.get(b);
      if (source && target) edgeIds.push([source.id, type, target.id]);
    }
    return { nodes: [...nodes.values()], edges: edgeIds };
  }

  /**
   * @param {string} where on symbols `s` and files `f`
   * @param {...(string | number | null)} params
   * @returns {GraphNode[]}
   */
  symbolNodes(where, ...params) {
    const rows = /** @type {(SymbolRow & { kind: string, detail: string | null })[]} */ (
      this.all(`SELECT ${SYMBOL}, s.kind, s.detail FROM symbols s JOIN files f ON f.id = s.file WHERE ${where}`, ...params)
    );
    return rows.map(symbolNode);
  }

  /**
   * The page id of the procedure to draw the flow of for `path`: the
   * innermost one around `line`, else the file's main one, else its first.
   * @param {string} path
   * @param {number} line
   * @returns {string | undefined}
   */
  flowProcedure(path, line) {
    const procedures = this.symbolNodes(`f.path = ? AND s.kind != 'package'`, path).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const around = procedures.filter((p) => (p.line ?? 0) <= line && line <= (p.end ?? 0)).at(-1);
    return (around ?? procedures.find((p) => p.mods?.includes("MAIN")) ?? procedures[0])?.id;
  }

  /**
   * The page id `path:qualified:line` of the variable named `word` at
   * `line`: the one declared there, else the one a statement there reads or
   * writes, the innermost statement first. For a field of a LIKE copy, the copy.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @returns {string | undefined}
   */
  variableAt(path, line, word) {
    const name = word.toUpperCase();
    const rows = /** @type {{ path: string, qualified: string, line: number }[]} */ (
      this.all(
        `SELECT vf.path, v.qualified, v.line FROM variables v JOIN files vf ON vf.id = v.file
         WHERE vf.path = ? AND v.line = ? AND v.name = ?
         UNION ALL
         SELECT * FROM (SELECT vf.path, v.qualified, v.line FROM statements s JOIN files f ON f.id = s.file
           JOIN accesses a ON a.statement = s.id JOIN variables v ON v.id = CASE WHEN a.through IS NULL THEN a.variable ELSE a.through END
           JOIN files vf ON vf.id = v.file
           WHERE f.path = ? AND s.line <= ? AND ? <= s.end_line AND (a.name = ? OR a.name LIKE '%.' || ?)
           ORDER BY s.line DESC, s.id DESC)
         LIMIT 1`,
        path,
        line,
        name,
        path,
        line,
        line,
        name,
        name,
      )
    );
    return rows[0] && `${rows[0].path}:${rows[0].qualified}:${rows[0].line}`;
  }

  /**
   * The symbol a page id `path:name:line` means.
   * @param {string} id
   * @returns {number | undefined}
   */
  symbolOf(id) {
    const parts = /^(.*):([^:]*):(\d+)$/.exec(id);
    if (!parts) return undefined;
    const rows = /** @type {{ id: number }[]} */ (
      this.all(`SELECT s.id FROM symbols s JOIN files f ON f.id = s.file WHERE f.path = ? AND s.name = ? AND s.line = ?`, parts[1], parts[2], Number(parts[3]))
    );
    return rows[0]?.id;
  }

  /**
   * @param {TreeRow} parent
   * @param {TreeRow["kind"]} kind
   * @param {string} label
   * @param {number | undefined} module
   * @param {Target | undefined} target
   * @returns {TreeRow}
   */
  row(parent, kind, label, module, target) {
    // A file already open further up would repeat its subtree forever.
    let repeated = false;
    for (let p = /** @type {TreeRow | undefined} */ (parent); p; p = p.parent) {
      repeated ||= p.module === module;
    }
    return { kind, label, module, target, parent, repeated };
  }
}
