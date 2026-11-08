// Keeps the graph of a z/OS repository in SQLite: every file, what it
// defines (PL/I procedures, JCL jobs and procedures, MFS formats and
// messages, Db2 tables) and what it refers to, each reference linked to what
// it means. Knows nothing about VS Code, so tests and an MCP server can use it.
//
//   const indexer = await createIndexer(grammars);
//   const db = openGraph("graph.sqlite");
//   sync(db, root, indexer);  // after start and whenever files change
//
// A sync re-reads only files whose size or time changed, then re-links only
// the references whose meaning those files can have changed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Language, Parser } from "web-tree-sitter";
import { blankMargins, languageOf, sqlOperation } from "./source.js";

/** @typedef {import("web-tree-sitter").Node} Node */

/**
 * procedure, package: PL/I; job, proc: JCL; format, message: MFS;
 * table, view, alias: Db2.
 * @typedef {"procedure" | "package" | "job" | "proc" | "format" | "message" | "table" | "view" | "alias"} SymbolKind
 */

/**
 * Lines from 1.
 * @typedef {object} ParsedSymbol
 * @property {number} parent position in the file's symbols, -1 at top level
 * @property {SymbolKind} kind
 * @property {string} name
 * @property {string | null} qualifier a Db2 object's schema: PROD in PROD.CUSTOMER
 * @property {number} line
 * @property {number} endLine
 */

/**
 * include: %INCLUDE, EXEC SQL INCLUDE, JCL INCLUDE, assembler COPY.
 * call, fetch: PL/I CALL and FETCH. invoke: PL/I `name(...)` in an
 * expression, a function call or an array element. program, procedure: what
 * a JCL step runs. screen: an MFS format or message. table: a Db2 table.
 * @typedef {"include" | "call" | "fetch" | "invoke" | "program" | "procedure" | "screen" | "table"} RefKind
 */

/**
 * Lines from 1, columns from 0.
 * @typedef {object} ParsedRef
 * @property {number} caller position in the file's symbols, -1 for the file
 * @property {RefKind} kind
 * @property {string} name
 * @property {string | null} qualifier a Db2 object's schema: PROD in PROD.CUSTOMER
 * @property {string | null} detail what SQL does with a table: SELECT, UPDATE, ...
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 */

/**
 * @typedef {object} ParsedFile
 * @property {ParsedSymbol[]} symbols
 * @property {ParsedRef[]} refs
 */

/**
 * @typedef {object} Grammars paths of the grammars' .wasm files
 * @property {string} pli
 * @property {string} jcl
 * @property {string} hlasm
 * @property {string} db2
 */

/** @typedef {Record<keyof Grammars, Parser>} Indexer */

/**
 * parse: reading changed files; link: resolving references.
 * @typedef {object} Progress
 * @property {"parse" | "link"} phase
 * @property {number} done
 * @property {number} total
 */

/**
 * @typedef {object} SyncResult
 * @property {number} changed files added, changed or removed
 * @property {number} relinked references resolved again
 * @property {number} parseMs
 * @property {number} linkMs
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL,
  member TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_member ON files(member);
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualifier TEXT,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS symbols_file ON symbols(file);
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS symbols_parent ON symbols(parent);
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caller INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qualifier TEXT,
  detail TEXT,
  line INTEGER NOT NULL,
  col INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_col INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refs_file ON refs(file);
CREATE INDEX IF NOT EXISTS refs_caller ON refs(caller);
CREATE INDEX IF NOT EXISTS refs_name ON refs(name);
-- What a reference means: a file (an include) or a definition in one. A
-- reference to a screen or table defined twice has two links, an unresolved
-- one none.
CREATE TABLE IF NOT EXISTS links (
  ref INTEGER NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  target_file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_symbol INTEGER REFERENCES symbols(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS links_ref ON links(ref);
CREATE INDEX IF NOT EXISTS links_target_file ON links(target_file);
CREATE INDEX IF NOT EXISTS links_target_symbol ON links(target_symbol);
-- graph_version: counts the syncs that changed something, so readers know
-- when to read again.
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value);
`;

/**
 * The grammars as build-grammars.sh writes them into `dir`.
 * @param {string} dir
 * @returns {Grammars}
 */
export function grammarsIn(dir) {
  /** @param {string} language */
  const wasm = (language) => join(dir, `tree-sitter-${language}.wasm`);
  return { pli: wasm("pli"), jcl: wasm("jcl"), hlasm: wasm("hlasm"), db2: wasm("db2") };
}

/**
 * Loads the grammars; slow, so once per process.
 * @param {Grammars} grammars
 * @returns {Promise<Indexer>}
 */
export async function createIndexer(grammars) {
  await Parser.init();
  /** @param {string} wasm */
  const parser = async (wasm) => {
    const parser = new Parser();
    parser.setLanguage(await Language.load(wasm));
    return parser;
  };
  return {
    pli: await parser(grammars.pli),
    jcl: await parser(grammars.jcl),
    hlasm: await parser(grammars.hlasm),
    db2: await parser(grammars.db2),
  };
}

/**
 * Opens the graph, creating its tables if needed.
 * @param {string} path
 * @returns {DatabaseSync}
 */
export function openGraph(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/**
 * Brings the graph up to date with the files under root. `paths` limits it
 * to those files and folders (relative, forward slashes), as a file watcher
 * reports them. Files named like members, without an extension, count as
 * PL/I, JCL, MFS or Db2 unless `members` is false.
 * @param {DatabaseSync} db
 * @param {string} root
 * @param {Indexer} indexer
 * @param {{ paths?: string[], members?: boolean, onProgress?: (progress: Progress) => void }} [options]
 * @returns {SyncResult}
 */
export function sync(db, root, indexer, options = {}) {
  const onProgress = options.onProgress ?? (() => {});
  const started = performance.now();

  /** @type {Map<string, { id: number, mtime: number, size: number }>} */
  const known = new Map();
  const knownUnder = db.prepare(
    "SELECT id, path, mtime, size FROM files WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'",
  );
  const knownRows = options.paths
    ? options.paths.flatMap((path) => knownUnder.all(path, path, path))
    : db.prepare("SELECT id, path, mtime, size FROM files").all();
  for (const row of /** @type {{ id: number, path: string, mtime: number, size: number }[]} */ (knownRows)) {
    known.set(row.path, row);
  }
  /** @type {Map<string, { mtime: number, size: number }>} */
  const onDisk = new Map();
  // Hidden files and folders, .git above all, are no source.
  /** @param {string} path */
  const look = (path) => {
    const name = path.split("/").pop() ?? "";
    if (name.startsWith(".")) return;
    let stat;
    try {
      stat = statSync(join(root, path));
    } catch {
      // Deleted meanwhile: removed from the graph like any other deleted file.
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(join(root, path))) look(path ? `${path}/${entry}` : entry);
    } else if (stat.isFile() && languageOf(path) && (options.members !== false || name.includes("."))) {
      onDisk.set(path, { mtime: Math.floor(stat.mtimeMs), size: stat.size });
    }
  };
  for (const path of options.paths ?? [""]) {
    if (!path.split("/").some((part) => part.startsWith("."))) look(path);
  }
  const removed = [...known.keys()].filter((path) => !onDisk.has(path));
  const changed = [...onDisk].filter(([path, stat]) => {
    const old = known.get(path);
    return !old || old.mtime !== stat.mtime || old.size !== stat.size;
  });

  // Names whose meaning may have changed: what the changed files defined
  // before and define now, and their member names.
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {number[]} */
  const added = [];
  const oldNames = db.prepare("SELECT name FROM symbols WHERE file = ?");
  const deleteFile = db.prepare("DELETE FROM files WHERE id = ?");
  const insertFile = db.prepare("INSERT INTO files (path, language, member, mtime, size) VALUES (?, ?, ?, ?, ?)");
  const insertSymbol = db.prepare(
    "INSERT INTO symbols (file, parent, kind, name, qualifier, line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRef = db.prepare(
    `INSERT INTO refs (file, caller, kind, name, qualifier, detail, line, col, end_line, end_col)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const total = removed.length + changed.length;
  db.exec("BEGIN");
  try {
    for (const [done, path] of [...removed, ...changed.map(([path]) => path)].entries()) {
      if (done % 200 === 0) onProgress({ phase: "parse", done, total });
      const old = known.get(path);
      names.add(memberOf(path));
      if (old) {
        for (const row of /** @type {{ name: string }[]} */ (oldNames.all(old.id))) names.add(row.name);
        deleteFile.run(old.id);
      }
      const stat = onDisk.get(path);
      if (!stat) continue;
      const language = /** @type {keyof Grammars} */ (languageOf(path));
      const parsed = parseFile(indexer, language, readFileSync(join(root, path), "utf-8"));
      const file = Number(insertFile.run(path, language, memberOf(path), stat.mtime, stat.size).lastInsertRowid);
      added.push(file);
      /** @type {number[]} */
      const symbolIds = [];
      for (const symbol of parsed.symbols) {
        names.add(symbol.name);
        const parent = symbol.parent < 0 ? null : symbolIds[symbol.parent];
        const id = insertSymbol.run(file, parent, symbol.kind, symbol.name, symbol.qualifier, symbol.line, symbol.endLine).lastInsertRowid;
        symbolIds.push(Number(id));
      }
      for (const ref of parsed.refs) {
        const caller = ref.caller < 0 ? null : symbolIds[ref.caller];
        insertRef.run(file, caller, ref.kind, ref.name, ref.qualifier, ref.detail, ref.line, ref.col, ref.endLine, ref.endCol);
      }
    }
    const parsedAt = performance.now();

    /** @type {RefRow[]} */
    let refs;
    if (!options.paths && known.size === 0) {
      refs = /** @type {RefRow[]} */ (db.prepare(`SELECT ${REF_COLUMNS} FROM refs`).all());
    } else {
      const ofNames = db.prepare(`SELECT ${REF_COLUMNS} FROM refs WHERE name IN (SELECT value FROM json_each(?))`);
      const ofFiles = db.prepare(`SELECT ${REF_COLUMNS} FROM refs WHERE file IN (SELECT value FROM json_each(?))`);
      /** @type {Map<number, RefRow>} */
      const unique = new Map();
      for (const row of /** @type {RefRow[]} */ ([...ofNames.all(JSON.stringify([...names])), ...ofFiles.all(JSON.stringify(added))])) {
        unique.set(row.id, row);
      }
      refs = [...unique.values()];
    }
    onProgress({ phase: "link", done: 0, total: refs.length });
    link(db, refs);
    if (total > 0) {
      db.exec(`INSERT INTO meta (name, value) VALUES ('graph_version', 1)
               ON CONFLICT (name) DO UPDATE SET value = value + 1`);
    }
    db.exec("COMMIT");
    onProgress({ phase: "link", done: refs.length, total: refs.length });
    return {
      changed: total,
      relinked: refs.length,
      parseMs: Math.round(parsedAt - started),
      linkMs: Math.round(performance.now() - parsedAt),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * The member a file is: its name without extension, upper case.
 * @param {string} path
 */
function memberOf(path) {
  return (path.split("/").pop() ?? "").replace(/\.[^.]*$/, "").toUpperCase();
}

/**
 * @param {Indexer} indexer
 * @param {keyof Grammars} language
 * @param {string} text
 * @returns {ParsedFile}
 */
function parseFile(indexer, language, text) {
  /** @type {ParsedFile} */
  const file = { symbols: [], refs: [] };
  const tree = indexer[language].parse(language === "pli" || language === "hlasm" ? blankMargins(text, language) : text);
  if (!tree) return file;
  switch (language) {
    case "pli":
      readPli(tree.rootNode, file, indexer.db2);
      break;
    case "jcl":
      readJcl(tree.rootNode, file);
      break;
    case "hlasm":
      readHlasm(tree.rootNode, file);
      break;
    case "db2":
      readDb2(tree.rootNode, file);
      break;
  }
  tree.delete();
  return file;
}

/**
 * @param {ParsedFile} file
 * @param {number} caller
 * @param {RefKind} kind
 * @param {string} name
 * @param {Node} site
 * @param {string | null} [detail]
 * @param {string | null} [qualifier]
 */
function addRef(file, caller, kind, name, site, detail = null, qualifier = null) {
  file.refs.push({
    caller,
    kind,
    name,
    qualifier,
    detail,
    line: site.startPosition.row + 1,
    col: site.startPosition.column,
    endLine: site.endPosition.row + 1,
    endCol: site.endPosition.column,
  });
}

/**
 * @param {ParsedFile} file
 * @param {number} parent
 * @param {SymbolKind} kind
 * @param {string} name
 * @param {Node} site
 * @param {string | null} [qualifier]
 * @returns {number} its position in the file's symbols
 */
function addSymbol(file, parent, kind, name, site, qualifier = null) {
  file.symbols.push({ parent, kind, name, qualifier, line: site.startPosition.row + 1, endLine: site.endPosition.row + 1 });
  return file.symbols.length - 1;
}

const MEMBER = /^[A-Z@#$][A-Z0-9@#$]{0,7}$/;

/**
 * A member name, from text that may be quoted or padded ('CUSTO   ').
 * @param {string} text
 * @returns {string | undefined}
 */
function memberName(text) {
  const name = text.trim().replace(/^['"]+|['"]+$/g, "").trim().toUpperCase();
  return MEMBER.test(name) ? name : undefined;
}

/**
 * @param {Node} node
 * @param {string} field
 * @returns {string}
 */
function fieldText(node, field) {
  return node.childForFieldName(field)?.text ?? "";
}

// ---- PL/I --------------------------------------------------------------------

/**
 * A procedure, entry or package is named by the label in front of it
 * (`MAIN: PROC;`), which the grammar puts on the enclosing labeled_statement.
 * @param {Node} node
 * @returns {string | undefined}
 */
function labelOf(node) {
  const parent = node.parent;
  if (parent?.type !== "labeled_statement") return undefined;
  for (const child of parent.children) {
    if (child?.type === "statement_prefix") {
      const label = child.childForFieldName("label");
      if (label) return label.text.toUpperCase();
    }
  }
  return undefined;
}

/**
 * `A.B(1)` is a reference with identifiers A, B and an argument; a builtin
 * like SUBSTR(...) has a builtin_name instead and gives undefined.
 * @param {Node} reference
 * @returns {string | undefined}
 */
function referenceName(reference) {
  const parts = [];
  for (const child of reference.children) {
    if (child?.type === "identifier") parts.push(child.text.toUpperCase());
  }
  return parts.length ? parts.join(".") : undefined;
}

/**
 * @param {Node} root
 * @param {ParsedFile} file
 * @param {Parser} db2 parses the SQL of EXEC SQL
 */
function readPli(root, file, db2) {
  // Depth first, carrying the innermost procedure or package (the caller)
  // and the innermost definition (the parent of a nested one).
  /** @type {{ node: Node, caller: number, parent: number }[]} */
  const stack = [{ node: root, caller: -1, parent: -1 }];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const node = top.node;
    let caller = top.caller;
    let parent = top.parent;
    switch (node.type) {
      case "procedure_statement":
      case "entry_statement":
      case "package_statement": {
        const name = labelOf(node);
        const site = node.parent;
        if (name && site) {
          const isPackage = node.type === "package_statement";
          parent = addSymbol(file, top.parent, isPackage ? "package" : "procedure", name, site);
          if (!isPackage || caller < 0) caller = parent;
        }
        break;
      }
      case "preprocessor_include":
        // One %INCLUDE can name several members; in DDNAME(MEMBER) the
        // member is the last identifier.
        for (const spec of node.namedChildren) {
          const idents = spec?.namedChildren.filter((c) => c?.type === "identifier") ?? [];
          const last = idents[idents.length - 1];
          if (last) addRef(file, caller, "include", last.text.toUpperCase(), node);
        }
        continue;
      case "exec_statement": {
        const member = node.childForFieldName("member");
        if (member) addRef(file, caller, "include", member.text.toUpperCase(), node);
        const language = node.childForFieldName("language");
        if (language?.text.toUpperCase() === "SQL") {
          const sql = node.text.slice(language.endIndex - node.startIndex).replace(/[;\s]+$/, "");
          const tree = db2.parse(`${sql};`);
          if (tree) {
            for (const table of db2TableNames(tree.rootNode)) {
              addRef(file, caller, "table", table.name, node, sqlOperation(node.text, table.name) ?? null, table.qualifier);
            }
            tree.delete();
          }
        }
        break;
      }
      case "call_statement":
      case "fetch_statement": {
        const entry = node.childForFieldName("entry");
        const name = entry && referenceName(entry);
        if (entry && name) addRef(file, caller, node.type === "call_statement" ? "call" : "fetch", name, entry);
        break;
      }
      case "reference": {
        // A parenthesised reference is a function call or an array element;
        // the grammar can't tell them apart. Only one that resolves to a
        // procedure becomes a call.
        const up = node.parent;
        const isCallEntry = up?.type === "call_statement" || up?.type === "fetch_statement";
        const isAssigned = up?.type === "assignment_statement" && up.namedChildren[0]?.id === node.id;
        if (!isCallEntry && !isAssigned && node.children.some((c) => c?.type === "argument")) {
          const name = referenceName(node);
          if (name) addRef(file, caller, "invoke", name, node);
        }
        break;
      }
      case "string_literal": {
        // MFS message and format names are passed as padded literals
        // ('CUSTO   '); anything else member-like simply won't resolve.
        const name = memberName(node.text);
        if (name) addRef(file, caller, "screen", name, node);
        continue;
      }
    }
    const children = node.namedChildren;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ node: child, caller, parent });
    }
  }
}

// ---- JCL ---------------------------------------------------------------------

// IMS region controller: PARM='BMP,PROGRAM,PSB,...' names the program second.
const IMS_REGION_CONTROLLER = "DFSRRC00";
const RUN_PROGRAM = /\bRUN\s+PROG(?:RAM)?\s*\(\s*([A-Z@#$][A-Z0-9@#$]{0,7})\s*\)/gi;

/**
 * (KEYWORD, value) per operand of a statement; "" for positional ones.
 * @param {Node} statement
 * @returns {[string, Node][]}
 */
function jclParameters(statement) {
  /** @type {[string, Node][]} */
  const parameters = [];
  for (const parameter of statement.childForFieldName("operands")?.namedChildren ?? []) {
    if (parameter?.type !== "parameter") continue;
    const value = parameter.childForFieldName("value");
    if (value) parameters.push([fieldText(parameter, "key").toUpperCase(), value]);
  }
  return parameters;
}

/**
 * @param {Node} root
 * @param {ParsedFile} file
 */
function readJcl(root, file) {
  let job = -1;
  let caller = -1;
  for (const statement of root.namedChildren) {
    if (!statement) continue;
    switch (statement.type) {
      case "job_statement":
      case "proc_statement": {
        const name = fieldText(statement, "name").toUpperCase();
        const isJob = statement.type === "job_statement";
        caller = name ? addSymbol(file, -1, isJob ? "job" : "proc", name, statement) : -1;
        if (isJob) job = caller;
        break;
      }
      case "pend_statement":
        caller = job;
        break;
      case "include_statement":
        // `// INCLUDE MEMBER=NAME` pulls in a member of the JCLLIB search order.
        for (const [key, value] of jclParameters(statement)) {
          if (key === "MEMBER") addRef(file, -1, "include", value.text.toUpperCase(), statement);
        }
        break;
      case "exec_statement": {
        const parameters = jclParameters(statement);
        let program;
        for (const [index, [key, value]] of parameters.entries()) {
          const name = memberName(value.text);
          if (!name) continue;
          if ((index === 0 && key === "") || key === "PROC") {
            addRef(file, caller, "procedure", name, statement);
          } else if (key === "PGM" || key === "MBR") {
            program = name;
            if (name !== IMS_REGION_CONTROLLER) addRef(file, caller, "program", name, statement);
          }
        }
        if (program === IMS_REGION_CONTROLLER) {
          for (const [key, value] of parameters) {
            if (key !== "PARM") continue;
            const fields = value.text.replace(/^[()'"]+|[()'"]+$/g, "").split(",");
            const name = fields.length > 1 ? memberName(fields[1]) : undefined;
            if (name) addRef(file, caller, "program", name, statement);
          }
        }
        break;
      }
      case "data_line":
        // IKJEFT01 with `DSN SYSTEM(..)` / `RUN PROGRAM(X)` in SYSTSIN.
        for (const match of statement.text.matchAll(RUN_PROGRAM)) {
          addRef(file, caller, "program", match[1].toUpperCase(), statement);
        }
        break;
    }
  }
}

// ---- HLASM (IMS MFS) ---------------------------------------------------------

/**
 * @param {Node} node
 * @returns {Node | undefined}
 */
function firstWord(node) {
  if (node.type === "word") return node;
  for (const child of node.namedChildren) {
    const word = child && firstWord(child);
    if (word) return word;
  }
  return undefined;
}

/**
 * @param {Node} root
 * @param {ParsedFile} file
 */
function readHlasm(root, file) {
  for (const statement of root.namedChildren) {
    if (statement?.type !== "statement") continue;
    const operation = fieldText(statement, "operation").toUpperCase();
    const operands = statement.childForFieldName("operands");
    if (operation === "COPY") {
      // The member is the first word of the operands: `COPY REGS`.
      const member = operands && firstWord(operands);
      if (member) addRef(file, -1, "include", member.text.toUpperCase(), statement);
      continue;
    }
    if (operation !== "FMT" && operation !== "MSG") continue;
    const name = fieldText(statement, "name").toUpperCase();
    if (!name) continue;
    const symbol = addSymbol(file, -1, operation === "FMT" ? "format" : "message", name, statement);
    if (operation !== "MSG") continue;
    // A message names the format it is mapped through (SOR=) and the message
    // that follows it (NXT=).
    for (const operand of operands?.namedChildren ?? []) {
      if (operand?.type !== "keyword_operand") continue;
      const key = fieldText(operand, "key").toUpperCase();
      const value = operand.childForFieldName("value");
      if ((key !== "SOR" && key !== "NXT") || !value) continue;
      const word = firstWord(value);
      const target = word && memberName(word.text);
      if (target) addRef(file, symbol, "screen", target, operand);
    }
  }
}

// ---- Db2 ---------------------------------------------------------------------

/** @type {Record<string, SymbolKind>} */
const DB2_DEFINITIONS = {
  create_table_statement: "table",
  create_view_statement: "view",
  create_alias_statement: "alias",
};

/**
 * The name and schema of an object_name, upper case: PROD.CUSTOMER is
 * CUSTOMER in PROD.
 * @param {Node | null} node
 * @returns {{ name: string, qualifier: string | null }}
 */
function objectName(node) {
  const parts = (node?.type === "object_name" ? node.namedChildren : [node]).map((part) =>
    (part?.text ?? "").replaceAll('"', "").toUpperCase(),
  );
  const name = parts.pop() ?? "";
  return { name, qualifier: parts.length ? parts.join(".") : null };
}

/**
 * Every object_name in a `table` position (FROM, JOIN, INTO, UPDATE,
 * REFERENCES, ...) or the `target` of an alias.
 * @param {Node} node
 * @returns {{ name: string, qualifier: string | null, site: Node }[]}
 */
function db2TableNames(node) {
  /** @type {{ name: string, qualifier: string | null, site: Node }[]} */
  const names = [];
  const stack = [node];
  for (let current = stack.pop(); current; current = stack.pop()) {
    for (let i = 0; i < current.childCount; i++) {
      const child = current.child(i);
      if (!child) continue;
      const field = current.fieldNameForChild(i);
      if (child.type === "object_name" && (field === "table" || field === "target")) {
        const { name, qualifier } = objectName(child);
        if (name) names.push({ name, qualifier, site: child });
      } else if (child.namedChildCount) {
        stack.push(child);
      }
    }
  }
  return names;
}

/**
 * @param {Node} root
 * @param {ParsedFile} file
 */
function readDb2(root, file) {
  for (const statement of root.namedChildren) {
    if (!statement) continue;
    const kind = DB2_DEFINITIONS[statement.type];
    const { name, qualifier } = kind ? objectName(statement.childForFieldName("name")) : { name: "", qualifier: null };
    const caller = name ? addSymbol(file, -1, kind, name, statement, qualifier) : -1;
    for (const table of db2TableNames(statement)) {
      addRef(file, caller, "table", table.name, table.site, null, table.qualifier);
    }
  }
}


// ---- Linking -----------------------------------------------------------------

const REF_COLUMNS = "id, file, caller, kind, name, qualifier";

/**
 * @typedef {object} RefRow
 * @property {number} id
 * @property {number} file
 * @property {number | null} caller
 * @property {RefKind} kind
 * @property {string} name
 * @property {string | null} qualifier
 */

/**
 * @typedef {object} SymbolRow
 * @property {number} id
 * @property {number} file
 * @property {number | null} parent
 * @property {SymbolKind} kind
 * @property {string} name
 * @property {string | null} qualifier
 */

/**
 * @typedef {object} Target
 * @property {number} file
 * @property {number | null} symbol null for the file itself
 */

/**
 * Replaces the links of these references with what they mean now.
 * @param {DatabaseSync} db
 * @param {RefRow[]} refs
 */
function link(db, refs) {
  if (refs.length === 0) return;
  // Everything a reference can mean, read whole: a few hundred ms for
  // 20,000 files, and one plain function for full and partial syncs.
  const files = /** @type {{ id: number, path: string, member: string, language: string }[]} */ (
    db.prepare("SELECT id, path, member, language FROM files").all()
  );
  const symbols = /** @type {SymbolRow[]} */ (db.prepare("SELECT id, file, parent, kind, name, qualifier FROM symbols").all());
  const includeRows = /** @type {{ file: number, name: string }[]} */ (
    db.prepare("SELECT file, name FROM refs WHERE kind = 'include'").all()
  );

  /** @type {Map<number, { path: string, member: string, language: string }>} */
  const fileById = new Map();
  // z/OS members are files named like the member, usually without an
  // extension.
  /** @type {Map<string, number[]>} */
  const byMember = new Map();
  for (const file of files) {
    fileById.set(file.id, file);
    const list = byMember.get(file.member);
    if (list) list.push(file.id);
    else byMember.set(file.member, [file.id]);
  }
  /** @type {Map<number, SymbolRow>} */
  const symbolById = new Map();
  /** @type {Map<number, SymbolRow[]>} */
  const symbolsOf = new Map();
  // Every definition of a screen or a table, by name.
  /** @type {Map<string, SymbolRow[]>} */
  const screens = new Map();
  /** @type {Map<string, SymbolRow[]>} */
  const tables = new Map();
  for (const symbol of symbols) {
    symbolById.set(symbol.id, symbol);
    const list = symbolsOf.get(symbol.file);
    if (list) list.push(symbol);
    else symbolsOf.set(symbol.file, [symbol]);
    const language = fileById.get(symbol.file)?.language;
    const defined = language === "hlasm" ? screens : language === "db2" ? tables : undefined;
    const named = defined?.get(symbol.name);
    if (named) named.push(symbol);
    else defined?.set(symbol.name, [symbol]);
  }

  /** @param {string} a @param {string} b */
  const sharedFolders = (a, b) => {
    const x = a.split("/");
    const y = b.split("/");
    let n = 0;
    while (n < x.length - 1 && n < y.length - 1 && x[n] === y[n]) n++;
    return n;
  };
  // The member file sharing the longest path with the referrer.
  /**
   * @param {string} name
   * @param {number} from
   * @returns {number | undefined}
   */
  const member = (name, from) => {
    const candidates = byMember.get(name);
    if (!candidates) return undefined;
    if (candidates.length === 1) return candidates[0];
    const path = fileById.get(from)?.path ?? "";
    /** @param {number} id */
    const pathOf = (id) => fileById.get(id)?.path ?? "";
    return [...candidates].sort(
      (a, b) => sharedFolders(pathOf(b), path) - sharedFolders(pathOf(a), path) || pathOf(a).localeCompare(pathOf(b)),
    )[0];
  };
  /** @param {number} file @param {string} name */
  const symbolNamed = (file, name) => symbolsOf.get(file)?.find((s) => s.name === name);
  /** @param {SymbolRow} symbol @returns {Target} */
  const at = (symbol) => ({ file: symbol.file, symbol: symbol.id });

  /** @type {Map<number, number[]>} */
  const includes = new Map();
  for (const row of includeRows) {
    const target = member(row.name, row.file);
    if (target === undefined) continue;
    const list = includes.get(row.file);
    if (list) list.push(target);
    else includes.set(row.file, [target]);
  }

  /**
   * A program or cataloged procedure is a member. Its entry is the
   * definition named like the member, or else every one not inside a
   * PL/I package.
   * @param {string} name
   * @param {number} from
   * @returns {Target[]}
   */
  const program = (name, from) => {
    const target = member(name, from);
    if (target === undefined || target === from) return [];
    const named = symbolNamed(target, name);
    if (named) return [at(named)];
    return (symbolsOf.get(target) ?? [])
      .filter((s) => s.parent === null || symbolById.get(s.parent)?.kind !== "package")
      .map(at);
  };

  /**
   * @param {RefRow} ref
   * @returns {Target[]}
   */
  const resolve = (ref) => {
    switch (ref.kind) {
      case "include": {
        const target = member(ref.name, ref.file);
        return target === undefined ? [] : [{ file: target, symbol: null }];
      }
      case "screen":
        return (screens.get(ref.name) ?? []).map(at);
      case "table": {
        // PROD.CUSTOMER means that table, not the alias TEST.CUSTOMER.
        const named = tables.get(ref.name) ?? [];
        const qualified = named.filter((s) => s.qualifier === ref.qualifier);
        return (ref.qualifier && qualified.length ? qualified : named).map(at);
      }
      case "procedure": {
        const inStream = symbolNamed(ref.file, ref.name);
        return inStream ? [at(inStream)] : program(ref.name, ref.file);
      }
      case "program":
        return program(ref.name, ref.file);
    }
    // A PL/I procedure of this file, then of a file it includes, then an
    // external one.
    const local = symbolNamed(ref.file, ref.name);
    if (local) return [at(local)];
    for (const included of includes.get(ref.file) ?? []) {
      const found = symbolNamed(included, ref.name);
      if (found) return [at(found)];
    }
    return ref.kind === "invoke" ? [] : program(ref.name, ref.file);
  };

  const deleteLinks = db.prepare("DELETE FROM links WHERE ref = ?");
  const insertLink = db.prepare("INSERT INTO links (ref, target_file, target_symbol) VALUES (?, ?, ?)");
  for (const ref of refs) {
    deleteLinks.run(ref.id);
    for (const target of resolve(ref)) {
      // A definition referring to itself, like a table's alias of the same name.
      if (target.symbol !== null && target.symbol === ref.caller) continue;
      insertLink.run(ref.id, target.file, target.symbol);
    }
  }
}
