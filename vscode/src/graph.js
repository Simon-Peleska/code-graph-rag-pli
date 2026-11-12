// Answers the editor's questions from the SQLite graph the indexer keeps
// (indexer.js). Knows nothing about VS Code, so tests can use it.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { MAIN_OPTIONS, blankMargins } from "./source.js";

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

export class Graph {
  /**
   * @param {DatabaseSync} db
   * @param {string} root the folder the graph's paths are relative to
   */
  constructor(db, root) {
    this.db = db;
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
    // What each comparison leads to: the statements in it that do something,
    // each with the IFs, WHENs, loops and ON-units between it and the rule.
    const inside = /** @type {{ top: number, id: number, parent: number, kind: string, branch: string | null, detail: string | null, line: number, end_line: number | null, path: string }[]} */ (
      this.all(
        `WITH RECURSIVE inside(top, id) AS (SELECT value, value FROM json_each(?) UNION SELECT inside.top, s.id FROM statements s JOIN inside ON s.parent = inside.id)
         SELECT inside.top, s.id, s.parent, s.kind, s.branch, s.detail, s.line, s.end_line, f.path
         FROM inside JOIN statements s ON s.id = inside.id JOIN files f ON f.id = s.file WHERE s.id <> inside.top ORDER BY s.line, s.id`,
        JSON.stringify([...rules.keys()]),
      )
    );
    const byId = new Map(inside.map((s) => [s.id, s]));
    const containers = new Set(["if", "select", "when", "otherwise", "do", "begin", "declare", "null", "on"]);
    for (const s of inside) {
      const rule = rules.get(s.top);
      if (!rule || containers.has(s.kind)) continue;
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
      const outcomes = at.branch === "else" ? rule.else : rule.then;
      if (outcomes.length < 50) outcomes.push({ text: this.statementText(s, sources), guards, path: s.path, line: s.line, statement: s.id });
      else truncated = true;
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
        for (const path of pathsTo(from, step, new Set([...seen, tested]))) paths.push([...path, text, ...own]);
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

    // The flow: what touches it, marked with how, and what its comparisons lead to.
    const rank = /** @type {Record<string, number>} */ ({ compare: 5, write: 4, arg: 3, read: 2, outcome: 1 });
    /** @type {Map<number, string>} */
    const marks = new Map();
    const mark = (/** @type {number} */ statement, /** @type {string} */ how) => {
      if ((rank[marks.get(statement) ?? ""] ?? 0) < rank[how]) marks.set(statement, how);
    };
    for (const row of touched) mark(row.statement, row.mode);
    for (const statement of tests) mark(statement, "compare");
    for (const rule of rules.values()) for (const outcome of [...rule.then, ...rule.else]) mark(outcome.statement, "outcome");
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
    return {
      variable: parts[2],
      lanes: flow.lanes,
      steps,
      truncated: truncated || flow.truncated,
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
      // By file first: statements have no index on caller.
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
    return { lanes, tops, truncated };
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
