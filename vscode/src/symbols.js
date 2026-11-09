// Go to Definition, Find All References and completion for the names the
// graph does not hold: PL/I variables and structure fields, HLASM labels and
// Db2 columns. Declarations are read from the source (source.js); the graph
// supplies what a file includes, its procedures and the tables it uses.
// Knows nothing about VS Code, so tests can use it.

import {
  ddlTables,
  hlasmStatements,
  isNameChar,
  languageOf,
  Lines,
  pliCode,
  pliDeclarations,
  pliUses,
  qualifiersBefore,
  skipBlanksBack,
  sqlStatements,
} from "./source.js";

/** @typedef {import("./graph.js").Definition} Definition */
/** @typedef {import("./source.js").Declaration} Declaration */
/** @typedef {import("./source.js").Language} Language */
/** @typedef {import("./source.js").Table} Table */
/** @typedef {import("./source.js").Use} Use */

/**
 * What the symbols need from the rest of the project.
 * @typedef {object} Sources
 * @property {(path: string) => string | undefined} read
 * @property {(path: string) => { path: string, line: number }[]} includedFiles the files `path` includes, with the line (from 1) of each include
 * @property {(path: string) => string[]} includingFiles
 * @property {(path: string) => Definition[]} blocks the procedures of `path`: what a declaration is local to
 * @property {(path: string) => Definition[]} tablesOf the tables and views the procedures of `path` use
 * @property {(path: string, name: string) => string[]} tableUsers the files using the table `name` defined in `path`
 */

/**
 * A declared name and where it is; lines and columns from 0. `detail` is
 * the qualified name and its attributes: `CUST.ADDR.CITY CHAR(20)`.
 * @typedef {object} Symbol
 * @property {"variable" | "field" | "label" | "column"} kind
 * @property {string} name
 * @property {string} path
 * @property {number} line
 * @property {number} col
 * @property {number} endCol
 * @property {string} detail
 */

/**
 * @typedef {object} Site
 * @property {string} path
 * @property {number} line
 * @property {number} col
 * @property {number} endCol
 */

/**
 * What to complete at a position: the fields of a structure (`CUST.`), the
 * columns in an SQL statement, the variables of a `:host` reference, or any
 * name in code.
 * @typedef {object} Completions
 * @property {"fields" | "sql" | "host" | "code"} context
 * @property {Symbol[]} symbols
 */

/**
 * @typedef {object} Analysis
 * @property {string} path
 * @property {string} text
 * @property {Language | undefined} language
 * @property {Lines} lines
 * @property {string} code
 * @property {Declaration[]} declarations
 * @property {Use[]} uses
 * @property {Map<number, Set<string>>} sqlNames the names in each SQL statement, host variables left out, by the statement's start
 * @property {Table[]} tables
 */

/**
 * A declaration as seen from a place in a file: `scope` is the first line of
 * the procedure it is local to there, 0 for the whole file.
 * @typedef {object} Visible
 * @property {Declaration} declaration
 * @property {Analysis} analysis
 * @property {number} scope
 */

/**
 * The procedures of a file, sorted by first line, and for each line (from 1)
 * the index of the innermost one holding it, -1 for none.
 * @typedef {object} Procedures
 * @property {Definition[]} list
 * @property {Int32Array} innermost
 */

/**
 * What one lookup has learned so far: a file's text, procedures, includes
 * and tables, and what is visible inside each procedure. Find All References resolves every use of
 * a name in every includer, so asking the graph per use took seconds.
 * @typedef {object} Memo
 * @property {Map<string, Analysis | undefined>} analyses
 * @property {Map<string, Procedures>} procedures
 * @property {Map<string, { path: string, line: number }[]>} included
 * @property {Map<string, { table: Table, analysis: Analysis }[]>} tables
 * @property {Map<string, Visible[]>} visible
 */

/** @returns {Memo} */
const newMemo = () => ({ analyses: new Map(), procedures: new Map(), included: new Map(), tables: new Map(), visible: new Map() });

const LIKE = /\bLIKE\s+((?:[A-Za-z@#$_][A-Za-z0-9@#$_]*\s*\.\s*)*([A-Za-z@#$_][A-Za-z0-9@#$_]*))/i;

export class Symbols {
  /** @type {Map<string, Analysis>} */
  #analyses = new Map();
  /** @type {Sources} */
  #sources;

  /** @param {Sources} sources */
  constructor(sources) {
    this.#sources = sources;
  }

  // Parses a file once per text it has, and reads it once per lookup.
  /**
   * @param {string} path
   * @param {Memo} [memo]
   * @param {string | undefined} [text] the file's text, when already read
   * @returns {Analysis | undefined}
   */
  #analysis(path, memo, text) {
    if (memo?.analyses.has(path)) return memo.analyses.get(path);
    const analysis = this.#parse(path, text ?? this.#sources.read(path));
    memo?.analyses.set(path, analysis);
    return analysis;
  }

  /**
   * @param {string} path
   * @param {string | undefined} text
   * @returns {Analysis | undefined}
   */
  #parse(path, text) {
    if (text === undefined) {
      return undefined;
    }
    const cached = this.#analyses.get(path);
    if (cached?.text === text) {
      return cached;
    }
    const language = languageOf(path);
    /** @type {Analysis} */
    const analysis = {
      path, text, language, lines: new Lines(text), code: text, declarations: [], uses: [], sqlNames: new Map(), tables: [],
    };
    if (language === "pli") {
      analysis.code = pliCode(text);
      analysis.declarations = pliDeclarations(analysis.code);
      analysis.uses = pliUses(analysis.code);
      for (const use of analysis.uses) {
        if (!use.sql || use.host) continue;
        const names = analysis.sqlNames.get(use.sql.start) ?? new Set();
        names.add(use.name);
        analysis.sqlNames.set(use.sql.start, names);
      }
    } else if (language === "hlasm") {
      for (const statement of hlasmStatements(text)) {
        const label = statement.label;
        if (label) {
          const lineEnd = text.indexOf("\n", label.start);
          const rest = text.slice(label.start, lineEnd < 0 ? undefined : lineEnd).slice(0, 71).slice(label.end - label.start);
          analysis.declarations.push({ ...label, level: 1, attributes: rest.replace(/\s+/g, " ").trim() });
        }
        analysis.uses.push(...statement.operands.map((name) => ({ ...name, qualifiers: [], host: false })));
      }
    } else if (language === "db2") {
      analysis.tables = ddlTables(text);
    }
    this.#analyses.set(path, analysis);
    return analysis;
  }

  /**
   * @param {Analysis} analysis
   * @param {Declaration} declaration
   * @param {Symbol["kind"]} [kind]
   * @returns {Symbol}
   */
  #symbol(analysis, declaration, kind) {
    const at = analysis.lines.at(declaration.start);
    /** @type {string[]} */
    const qualified = [];
    for (let d = /** @type {Declaration | undefined} */ (declaration); d; d = d.parent) qualified.unshift(d.name);
    return {
      kind: kind ?? (analysis.language === "hlasm" ? "label" : declaration.parent ? "field" : "variable"),
      name: declaration.name,
      path: analysis.path,
      line: at.line,
      col: at.col,
      endCol: at.col + declaration.end - declaration.start,
      detail: `${qualified.join(".")} ${declaration.attributes}`.trim(),
    };
  }

  /**
   * @param {string} path
   * @param {Memo} memo
   * @returns {Procedures}
   */
  #procedures(path, memo) {
    const known = memo.procedures.get(path);
    if (known) return known;
    const list = this.#sources.blocks(path).sort((a, b) => a.line - b.line);
    const innermost = new Int32Array(list.reduce((last, b) => Math.max(last, b.end), 0) + 1).fill(-1);
    // Sorted by first line, a nested procedure comes after the one around it and overwrites its lines.
    list.forEach((block, i) => innermost.fill(i, block.line, block.end + 1));
    const procedures = { list, innermost };
    memo.procedures.set(path, procedures);
    return procedures;
  }

  /**
   * @param {string} path
   * @param {Memo} memo
   */
  #included(path, memo) {
    let included = memo.included.get(path);
    if (!included) {
      included = this.#sources.includedFiles(path);
      memo.included.set(path, included);
    }
    return included;
  }

  // The innermost procedure holding `line` (from 1).
  /**
   * @param {Procedures} procedures
   * @param {number} line
   * @returns {Definition | undefined}
   */
  #block(procedures, line) {
    const i = procedures.innermost[line] ?? -1;
    return i < 0 ? undefined : procedures.list[i];
  }

  // Every declaration visible at `line` (from 1) of `path`: its own, local
  // ones of the procedures around the line included, and those of the files
  // it includes, nested includes too.
  /**
   * @param {string} path
   * @param {number} line
   * @param {Memo} memo
   * @returns {Visible[]}
   */
  #visible(path, line, memo) {
    const own = this.#analysis(path, memo);
    if (!own) {
      return [];
    }
    /** @type {Visible[]} */
    const result = [];
    const blocks = this.#procedures(path, memo);
    /** @param {Definition | undefined} block */
    const inside = (block) => !block || (block.line <= line && line <= block.end);
    for (const declaration of own.declarations) {
      const block = this.#block(blocks, own.lines.at(declaration.start).line + 1);
      if (inside(block)) result.push({ declaration, analysis: own, scope: block?.line ?? 0 });
    }
    const seen = new Set([path]);
    /**
     * @param {string} file
     * @param {number} scope
     */
    const include = (file, scope) => {
      for (const included of this.#included(file, memo)) {
        if (seen.has(included.path)) continue;
        seen.add(included.path);
        const analysis = this.#analysis(included.path, memo);
        for (const declaration of analysis?.declarations ?? []) {
          result.push({ declaration, analysis: /** @type {Analysis} */ (analysis), scope });
        }
        include(included.path, scope);
      }
    };
    for (const included of this.#included(path, memo)) {
      const block = this.#block(blocks, included.line);
      if (!inside(block) || seen.has(included.path)) continue;
      seen.add(included.path);
      const analysis = this.#analysis(included.path, memo);
      for (const declaration of analysis?.declarations ?? []) {
        result.push({ declaration, analysis: /** @type {Analysis} */ (analysis), scope: block?.line ?? 0 });
      }
      include(included.path, block?.line ?? 0);
    }
    return result;
  }

  // The declarations `name` with `qualifiers` means among `visible`: the
  // innermost ones. PL/I lets a reference leave out structure levels, and a
  // structure declared LIKE another has that one's fields.
  /**
   * @param {Visible[]} visible
   * @param {string} name
   * @param {string[]} qualifiers
   * @returns {Visible[]}
   */
  #resolve(visible, name, qualifiers) {
    /** @type {Map<string, string>} */
    const likes = new Map();
    for (const v of visible) {
      const like = LIKE.exec(v.declaration.attributes);
      if (like) likes.set(v.declaration.name, like[2].toUpperCase());
    }
    /** @param {Declaration} declaration */
    const matches = (declaration) => {
      /** @type {string[]} */
      const ancestors = [];
      for (let d = declaration.parent; d; d = d.parent) ancestors.unshift(d.name);
      /** @param {string[]} wanted */
      const fits = (wanted) => {
        let at = 0;
        for (const ancestor of ancestors) if (at < wanted.length && ancestor === wanted[at]) at++;
        return at === wanted.length;
      };
      return fits(qualifiers) || fits(qualifiers.map((q) => likes.get(q) ?? q));
    };
    const found = visible.filter((v) => v.declaration.name === name && matches(v.declaration));
    const innermost = Math.max(...found.map((v) => v.scope));
    return found.filter((v) => v.scope === innermost);
  }

  // The columns `use`, a name in an SQL statement, can be: those of the
  // tables the statement names, or else of every table the file uses.
  /**
   * @param {Analysis} analysis
   * @param {Use} use
   * @param {Memo} memo
   * @returns {Symbol[]}
   */
  #columns(analysis, use, memo) {
    const tables = this.#tablesUsed(analysis.path, memo);
    const named = analysis.sqlNames.get(use.sql?.start ?? -1);
    const inStatement = tables.filter(({ table }) => named?.has(table.name));
    return (inStatement.length > 0 ? inStatement : tables).flatMap(({ table, analysis: ddl }) =>
      table.columns
        .filter((column) => column.name === use.name)
        .map((column) => this.#symbol(ddl, { ...column, parent: { ...table, level: 1, attributes: "" } }, "column")),
    );
  }

  // The tables `path` uses, read from their DDL.
  /**
   * @param {string} path
   * @param {Memo} memo
   * @returns {{ table: Table, analysis: Analysis }[]}
   */
  #tablesUsed(path, memo) {
    const known = memo.tables.get(path);
    if (known) return known;
    const tables = this.#sources.tablesOf(path).flatMap((definition) => {
      const ddl = this.#analysis(definition.path, memo);
      const table = ddl?.tables.find((t) => t.name === definition.name.toUpperCase());
      return table && ddl ? [{ table, analysis: ddl }] : [];
    });
    memo.tables.set(path, tables);
    return tables;
  }

  /**
   * @param {Analysis} analysis
   * @param {number} offset
   * @returns {Use | undefined}
   */
  #useAt(analysis, offset) {
    return analysis.uses.find((u) => u.start <= offset && offset <= u.end);
  }

  /**
   * @param {Analysis} analysis
   * @param {Use} use
   * @param {Memo} memo
   * @returns {Symbol[]}
   */
  #definitionsOf(analysis, use, memo) {
    if (use.sql && !use.host) {
      return this.#columns(analysis, use, memo);
    }
    const line = analysis.lines.at(use.start).line + 1;
    const key = `${analysis.path}:${this.#block(this.#procedures(analysis.path, memo), line)?.line ?? 0}`;
    let visible = memo.visible.get(key);
    if (!visible) {
      visible = this.#visible(analysis.path, line, memo);
      memo.visible.set(key, visible);
    }
    return this.#resolve(visible, use.name, use.qualifiers).map((v) => this.#symbol(v.analysis, v.declaration));
  }

  // Where the name at `offset` of `path` is declared. On a declaration
  // itself, that declaration.
  /**
   * @param {string} path
   * @param {number} offset
   * @returns {Symbol[]}
   */
  definitions(path, offset) {
    const analysis = this.#analysis(path);
    if (!analysis) {
      return [];
    }
    const declared = analysis.declarations.find((d) => d.start <= offset && offset <= d.end);
    if (declared) {
      return [this.#symbol(analysis, declared)];
    }
    if (analysis.language === "db2") {
      for (const table of analysis.tables) {
        const column = table.columns.find((c) => c.start <= offset && offset <= c.end);
        if (column) return [this.#symbol(analysis, { ...column, parent: { ...table, level: 1, attributes: "" } }, "column")];
      }
      return [];
    }
    const use = this.#useAt(analysis, offset);
    return use ? this.#definitionsOf(analysis, use, newMemo()) : [];
  }

  // Every place that uses what the name at `offset` of `path` declares,
  // across the files that can see it: those including the declaring file,
  // and for a column the files using its table.
  /**
   * @param {string} path
   * @param {number} offset
   * @returns {Site[]}
   */
  references(path, offset) {
    /** @type {Map<string, Site>} */
    const sites = new Map();
    const memo = newMemo();
    for (const target of this.definitions(path, offset)) {
      /** @param {Symbol} s */
      const same = (s) => s.path === target.path && s.line === target.line && s.col === target.col;
      /** @type {string[]} */
      let files;
      if (target.kind === "column") {
        const ddl = this.#analysis(target.path, memo);
        const at = ddl?.lines.offset(target.line, target.col);
        const table = ddl?.tables.find((t) => t.columns.some((c) => c.start === at));
        files = table ? this.#sources.tableUsers(target.path, table.name) : [];
      } else if (this.#block(this.#procedures(target.path, memo), target.line + 1)) {
        files = [target.path];
      } else {
        files = this.#includersOf(target.path);
      }
      for (const file of files) {
        const text = memo.analyses.get(file)?.text ?? this.#sources.read(file);
        if (!text?.toUpperCase().includes(target.name)) {
          continue;
        }
        const analysis = /** @type {Analysis} */ (this.#analysis(file, memo, text));
        const declared = new Set(analysis.declarations.map((d) => d.start));
        for (const use of analysis.uses) {
          if (use.name !== target.name || declared.has(use.start)) continue;
          if (target.kind === "column" ? !use.sql || use.host : false) continue;
          if (!this.#definitionsOf(analysis, use, memo).some(same)) continue;
          const at = analysis.lines.at(use.start);
          sites.set(`${file}:${use.start}`, { path: file, line: at.line, col: at.col, endCol: at.col + use.end - use.start });
        }
      }
    }
    return [...sites.values()];
  }

  // `path` and every file including it, directly or through other includes.
  /**
   * @param {string} path
   * @returns {string[]}
   */
  #includersOf(path) {
    const files = new Set([path]);
    const queue = [path];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      for (const includer of this.#sources.includingFiles(next)) {
        if (!files.has(includer)) {
          files.add(includer);
          queue.push(includer);
        }
      }
    }
    return [...files];
  }

  // What may be typed at `offset` of `path`.
  /**
   * @param {string} path
   * @param {number} offset
   * @returns {Completions}
   */
  completions(path, offset) {
    const analysis = this.#analysis(path);
    if (!analysis || (analysis.language !== "pli" && analysis.language !== "hlasm")) {
      return { context: "code", symbols: [] };
    }
    const code = analysis.code;
    let start = offset;
    while (start > 0 && isNameChar(code[start - 1])) start--;
    const line = analysis.lines.at(offset).line + 1;
    const memo = newMemo();
    const visible = this.#visible(path, line, memo);

    if (analysis.language === "pli") {
      const qualifiers = qualifiersBefore(code, start).names;
      if (qualifiers.length > 0) {
        const name = qualifiers[qualifiers.length - 1];
        const structures = this.#resolve(visible, name, qualifiers.slice(0, -1));
        const fields = structures.flatMap((structure) => {
          const like = LIKE.exec(structure.declaration.attributes);
          const shapes = like ? this.#resolve(visible, like[2].toUpperCase(), []) : [structure];
          return shapes.flatMap((shape) =>
            shape.analysis.declarations
              .filter((d) => d.parent === shape.declaration)
              .map((d) => this.#symbol(shape.analysis, d)),
          );
        });
        return { context: "fields", symbols: fields };
      }
      const statement = sqlStatements(code).find((s) => s.start <= start && start <= s.end);
      if (statement && code[skipBlanksBack(code, qualifiersBefore(code, start).start - 1)] === ":") {
        return { context: "host", symbols: this.#innermost(visible) };
      }
      if (statement) {
        const columns = this.#tablesUsed(path, memo).flatMap(({ table, analysis: ddl }) =>
          table.columns.map((c) => this.#symbol(ddl, { ...c, parent: { ...table, level: 1, attributes: "" } }, "column")),
        );
        return { context: "sql", symbols: columns };
      }
    }
    return { context: "code", symbols: this.#innermost(visible) };
  }

  // One symbol per name: the declaration in the innermost scope.
  /**
   * @param {Visible[]} visible
   * @returns {Symbol[]}
   */
  #innermost(visible) {
    /** @type {Map<string, Visible>} */
    const best = new Map();
    for (const v of visible) {
      const known = best.get(v.declaration.name);
      if (!known || v.scope > known.scope) best.set(v.declaration.name, v);
    }
    return [...best.values()].map((v) => this.#symbol(v.analysis, v.declaration));
  }
}
