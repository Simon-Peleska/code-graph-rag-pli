// Answers the editor's questions from the SQLite graph the indexer keeps
// (indexer.js). Knows nothing about VS Code, so tests can use it.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** @typedef {import("node:sqlite").DatabaseSync} DatabaseSync */
/** @typedef {import("node:sqlite").StatementSync} StatementSync */

/**
 * Lines from 1.
 * @typedef {object} Target
 * @property {string} path
 * @property {number} line
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
 */

/**
 * The shape viz/graph.template.html reads. Edge ends are positions in
 * `nodes`: names repeated in every edge made the page for 20,000 files 43 MB
 * instead of 24.
 * @typedef {object} WholeGraph
 * @property {string} project
 * @property {GraphNode[]} nodes
 * @property {[number, string, number][]} edges
 */

/**
 * A file, or a definition in one, that a name means.
 * @typedef {object} Found
 * @property {number} file
 * @property {number | null} symbol null for the file itself
 * @property {string} path
 * @property {number} line
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

/** @param {TreeRow} a @param {TreeRow} b */
const byLabel = (a, b) => a.label.localeCompare(b.label);
/** @param {string} path */
const fileName = (path) => basename(path);

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
   * What `word` at `path`:`line` means. The indexer resolved the references
   * themselves, so those on the line answer first, then those of the
   * procedure around it, then the files the file includes. Plain name
   * matches are the fallback, unless `byName` is false.
   * @param {string} path
   * @param {number} line
   * @param {string} word
   * @param {boolean} byName
   * @returns {Found[]}
   */
  named(path, line, word, byName) {
    const name = word.toUpperCase();
    const LINKED = `SELECT DISTINCT l.target_file AS file, l.target_symbol AS symbol, tf.path,
        coalesce(ts.line, 1) AS line
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
      `SELECT s.file, s.id AS symbol, f.path, s.line FROM symbols s JOIN files f ON f.id = s.file WHERE s.name = ?`,
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
    return this.named(path, line, word, byName).map((found) => ({ path: found.path, line: found.line }));
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

    const targets = /** @type {{ kind: string, detail: string | null, id: number, name: string, file: number, path: string, line: number, language: string }[]} */ (
      this.all(
        `SELECT r.kind, r.detail, ts.id, ts.name, ts.file, tf.path, ts.line, tf.language FROM refs r
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
      const place = { path: target.path, line: target.line };
      if (target.language === "db2") {
        let table = tables.get(target.id);
        if (!table) {
          table = { row: this.row(row, "table", `TABLE ${target.name}`, target.file, place), operations: new Set() };
          tables.set(target.id, table);
        }
        if (target.detail) table.operations.add(target.detail);
      } else if (!calls.has(target.id)) {
        calls.set(target.id, this.row(row, "call", `CALL ${target.name}`, target.file, place));
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

    const callers = /** @type {{ caller: number | null, callerName: string | null, callerLine: number | null, file: number, path: string, line: number, callee: string, calleeId: number, detail: string | null }[]} */ (
      this.all(
        `SELECT r.caller, cs.name AS callerName, cs.line AS callerLine, r.file, f.path, r.line,
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
        const place = { path: caller.path, line: caller.callerLine ?? caller.line };
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
   * The whole project for the Show Graph page. A module's id is its path, a
   * definition's its path, name and line, so a page reloaded after a sync
   * still finds what it showed.
   * @returns {WholeGraph}
   */
  whole() {
    /** @type {GraphNode[]} */
    const nodes = [];
    /** @type {[number, string, number][]} */
    const edges = [];
    /** @type {Map<number, number>} */
    const filePosition = new Map();
    /** @type {Map<number, number>} */
    const symbolPosition = new Map();

    /** @type {Map<number, string[]>} */
    const unresolved = new Map();
    const missing = /** @type {{ file: number, name: string }[]} */ (
      this.all(
        `SELECT DISTINCT r.file, r.name FROM refs r WHERE r.kind IN ${MISSING}
         AND NOT EXISTS (SELECT 1 FROM links l WHERE l.ref = r.id) ORDER BY r.name`,
      )
    );
    for (const { file, name } of missing) {
      const names = unresolved.get(file);
      if (names) names.push(name);
      else unresolved.set(file, [name]);
    }

    for (const file of /** @type {{ id: number, path: string }[]} */ (this.all(`SELECT id, path FROM files`))) {
      /** @type {GraphNode} */
      const node = { id: file.path, kind: "module", name: fileName(file.path), path: file.path };
      const names = unresolved.get(file.id);
      if (names) node.unresolved = names;
      filePosition.set(file.id, nodes.length);
      nodes.push(node);
    }
    const symbols = /** @type {(SymbolRow & { parent: number | null, kind: string })[]} */ (
      this.all(`SELECT ${SYMBOL}, s.parent, s.kind FROM symbols s JOIN files f ON f.id = s.file ORDER BY s.id`)
    );
    for (const symbol of symbols) {
      symbolPosition.set(symbol.id, nodes.length);
      nodes.push({
        id: `${symbol.path}:${symbol.name}:${symbol.line}`,
        kind: symbol.kind === "package" ? "class" : "function",
        name: symbol.name,
        path: symbol.path,
        line: symbol.line,
        end: symbol.end,
      });
    }
    // Parents are inserted before their children, so their positions are known.
    for (const symbol of symbols) {
      const parent = symbol.parent === null ? filePosition.get(symbol.file) : symbolPosition.get(symbol.parent);
      edges.push([/** @type {number} */ (parent), "DEFINES", /** @type {number} */ (symbolPosition.get(symbol.id))]);
    }

    /** @type {Map<string, number>} */
    const externals = new Map();
    const seen = new Set();
    const links = /** @type {{ kind: string, name: string, file: number, caller: number | null, targetFile: number | null, targetSymbol: number | null }[]} */ (
      this.all(
        `SELECT r.kind, r.name, r.file, r.caller, l.target_file AS targetFile, l.target_symbol AS targetSymbol
         FROM refs r LEFT JOIN links l ON l.ref = r.id WHERE r.kind = 'include' OR l.target_symbol IS NOT NULL`,
      )
    );
    for (const link of links) {
      const source = /** @type {number} */ (
        link.kind !== "include" && link.caller !== null ? symbolPosition.get(link.caller) : filePosition.get(link.file)
      );
      let type = "CALLS";
      let target;
      if (link.kind === "include") {
        type = "IMPORTS";
        target = link.targetFile === null ? undefined : filePosition.get(link.targetFile);
        if (target === undefined) {
          // An include of a member the repository does not have.
          target = externals.get(link.name);
          if (target === undefined) {
            target = nodes.length;
            externals.set(link.name, target);
            nodes.push({ id: `external:${link.name}`, kind: "external", name: link.name });
          }
        }
      } else {
        target = symbolPosition.get(/** @type {number} */ (link.targetSymbol));
      }
      const key = `${source} ${type} ${target}`;
      if (target === undefined || source === target || seen.has(key)) continue;
      seen.add(key);
      edges.push([source, type, target]);
    }
    return { project: this.project, nodes, edges };
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
