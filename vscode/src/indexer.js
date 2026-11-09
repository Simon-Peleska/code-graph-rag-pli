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
import { mfsFields } from "./mfs.js";

/** @typedef {import("web-tree-sitter").Node} Node */

/**
 * procedure, package: PL/I; job, proc: JCL; format, message: MFS;
 * table, view, alias: Db2.
 * @typedef {"procedure" | "package" | "job" | "proc" | "format" | "message" | "table" | "view" | "alias" | "psb" | "dbd" | "transaction"} SymbolKind
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
 * @property {string | null} [detail] a procedure's OPTIONS and RETURNS, a gen's or transaction's operands
 * @property {string | null} [comment] a procedure's: the comments right above it
 */

/**
 * include: %INCLUDE, EXEC SQL INCLUDE, JCL INCLUDE, assembler COPY.
 * call, fetch: PL/I CALL and FETCH. invoke: PL/I `name(...)` in an
 * expression, a function call or an array element. program, procedure: what
 * a JCL step runs. screen: an MFS format or message. table: a Db2 table.
 * @typedef {"include" | "call" | "fetch" | "invoke" | "program" | "procedure" | "screen" | "table" | "psb" | "dbd"} RefKind
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
 * A declared PL/I variable or structure field. Lines from 1.
 * @typedef {object} ParsedVariable
 * @property {number} scope position in the file's symbols of the procedure or package it is declared in, -1 for the file
 * @property {number} parent position in the file's variables of its structure, -1 at level 1
 * @property {number} level
 * @property {string} name `*` for a filler
 * @property {string} qualified `KUNDE.ADR.ORT`
 * @property {string | null} type CHAR, VARCHAR, BIT, PIC, FIXED DEC, FIXED BIN, FLOAT, POINTER, FILE, ENTRY, STRUCTURE, ...
 * @property {string | null} size what the type's parentheses hold: `8`, `7,2`, a picture
 * @property {string | null} dims `0:9,3`
 * @property {string | null} storage STATIC, AUTOMATIC, BASED, CONTROLLED, DEFINED, CONSTANT (VALUE) or PARAMETER
 * @property {string | null} base the pointer of BASED, the variable of DEFINED
 * @property {string | null} init INIT or VALUE
 * @property {string | null} like
 * @property {boolean} external
 * @property {number | null} parameter position in its procedure's parameter list, from 1
 * @property {string} attributes everything after the name, as written
 * @property {number} line
 * @property {string | null} [comment] the comments right above it or after it on its line
 */

/**
 * A JCL EXEC statement. Lines from 1.
 * @typedef {object} ParsedStep
 * @property {number} job position in the file's symbols of its job or procedure, -1 for none
 * @property {string | null} name
 * @property {string | null} program what runs: PGM=, MBR=, or the program in DFSRRC00's PARM
 * @property {string | null} procedure the cataloged or in-stream procedure it runs
 * @property {string | null} psb from DFSRRC00's PARM or PSB=
 * @property {string | null} parm
 * @property {number} line
 */

/**
 * A JCL DD statement. Lines from 1.
 * @typedef {object} ParsedDd
 * @property {number} step position in the file's steps, -1 before the first
 * @property {string} name a concatenation's DD has the name of the one before it
 * @property {string | null} dsn without member or generation
 * @property {string | null} member a PDS member or GDG generation (`+1`, `0`)
 * @property {string | null} disp as written without parentheses, NEW when a DSN has none
 * @property {string} attributes the operands as written
 * @property {number} line
 */

/**
 * A PL/I record or stream I/O statement on one file. Lines from 1.
 * @typedef {object} ParsedFileIo
 * @property {number} caller position in the file's symbols of its procedure, -1 for none
 * @property {string} operation OPEN, CLOSE, READ, WRITE, REWRITE, DELETE, LOCATE, GET or PUT
 * @property {string} name the PL/I file; SYSIN or SYSPRINT for a GET or PUT without FILE
 * @property {string | null} record INTO, FROM or SET, or LOCATE's based variable
 * @property {string | null} key KEY, KEYTO or KEYFROM
 * @property {string | null} title OPEN's TITLE, the DD name when it is not the file's
 * @property {string} statement as written
 * @property {number} line
 */

/**
 * A column an embedded SQL statement uses. Lines from 1.
 * @typedef {object} ParsedSqlColumn
 * @property {number} caller position in the file's symbols of its procedure, -1 for none
 * @property {string} operation SELECT, INSERT, UPDATE, DELETE, DECLARE (a cursor's query) or FETCH
 * @property {string | null} cursor
 * @property {string | null} schema
 * @property {string | null} table null when an unqualified column could be any of several tables
 * @property {string | null} column `*` for all, null for a select item without a column (`COUNT(*)`)
 * @property {string} usage select, where, join, group, order, having, set, insert or read (in a SET or VALUES expression)
 * @property {string | null} host the host variable it goes into or is compared with
 * @property {string | null} expression the predicate, assigned value or select item, when it is more than the column
 * @property {number} line
 */

/**
 * A column of a CREATE TABLE. Lines from 1.
 * @typedef {object} ParsedColumn
 * @property {number} table position in the file's symbols of its table
 * @property {string} name
 * @property {string} type `DECIMAL(11,2)`
 * @property {boolean} notNull
 * @property {number | null} key position in the primary key, from 1
 * @property {number} position from 1
 * @property {number} line
 */

/**
 * A PCB of a PSB gen. Lines from 1.
 * @typedef {object} ParsedPcb
 * @property {number} psb position in the file's symbols of its PSB
 * @property {number} position in the PSB, from 1
 * @property {string} type TP, DB or GSAM
 * @property {string | null} name PCBNAME=, or the statement's label
 * @property {string | null} dbd
 * @property {string | null} procopt
 * @property {string} attributes the operands as written
 * @property {number} line
 */

/**
 * A SENSEG of a PCB. Lines from 1.
 * @typedef {object} ParsedSenseg
 * @property {number} pcb position in the file's pcbs
 * @property {string} name
 * @property {string | null} parent
 * @property {string | null} procopt
 * @property {number} line
 */

/**
 * A SEGM of a DBD gen. Lines from 1.
 * @typedef {object} ParsedSegment
 * @property {number} dbd position in the file's symbols of its DBD
 * @property {string} name
 * @property {string | null} parent
 * @property {number | null} bytes
 * @property {number} position in the DBD, from 1, which is the hierarchy's order
 * @property {number} line
 */

/**
 * A FIELD of a segment. Lines from 1.
 * @typedef {object} ParsedSegmentField
 * @property {number} segment position in the file's segments
 * @property {string} name
 * @property {string | null} sequence U or M for the sequence field, else null
 * @property {number | null} start from 1
 * @property {number | null} bytes
 * @property {string | null} type C, P, X, ...
 * @property {number} line
 */

/**
 * A DL/I call: CALL PLITDLI, CEETDLI or AIBTDLI. Lines from 1.
 * @typedef {object} ParsedDliCall
 * @property {number} caller position in the file's symbols of its procedure, -1 for none
 * @property {string} entry PLITDLI, CEETDLI or AIBTDLI
 * @property {string | null} function GU, GNP, ISRT, ... from a literal or the INIT of the variable passed
 * @property {string | null} pcb the PCB (the AIB for AIBTDLI) as passed
 * @property {number | null} pcbParameter the parameter of the main procedure the PCB comes from, from 1
 * @property {string | null} ioArea
 * @property {string | null} segment the last SSA's segment, the one the call is about
 * @property {string | null} path the segments of all SSAs, `KUNDE/KONTO`, `?` for one not known
 * @property {string} arguments as written
 * @property {number} line
 */

/**
 * An executable PL/I statement, or a WHEN or OTHERWISE of a SELECT. Lines from 1.
 * @typedef {object} ParsedStatement
 * @property {number} caller position in the file's symbols of its procedure, -1 for none
 * @property {number} parent position in the file's statements of the statement it is in, -1 for none
 * @property {string} kind if, do, select, when, otherwise, assignment, call, ...
 * @property {"then" | "else" | null} branch which part of the IF it is in parent
 * @property {string | null} label
 * @property {string | null} detail the condition or head: IF condition, WHEN values, SELECT subject, DO spec, ...
 * @property {number} line
 * @property {number} endLine
 */

/**
 * A field a statement reads or writes, by its qualified name as written.
 * @typedef {object} ParsedAccess
 * @property {number} statement position in the file's statements
 * @property {string} name
 * @property {"read" | "write" | "arg"} mode arg: passed to a CALL, which may change it
 * @property {string | null} value the literal written
 * @property {number | null} position an argument's, from 1
 */

/**
 * @typedef {object} ParsedComparison
 * @property {number} statement position in the file's statements
 * @property {string} left
 * @property {string} operator =, ^=, <, ... with ¬ written as ^
 * @property {string} right
 */

/**
 * @typedef {object} ParsedFile
 * @property {ParsedSymbol[]} symbols
 * @property {ParsedRef[]} refs
 * @property {ParsedVariable[]} variables
 * @property {ParsedStep[]} steps
 * @property {ParsedDd[]} dds
 * @property {ParsedFileIo[]} fileIo
 * @property {ParsedSqlColumn[]} sqlColumns
 * @property {ParsedColumn[]} columns
 * @property {ParsedPcb[]} pcbs
 * @property {ParsedSenseg[]} sensegs
 * @property {ParsedSegment[]} segments
 * @property {ParsedSegmentField[]} segmentFields
 * @property {ParsedDliCall[]} dliCalls
 * @property {ParsedStatement[]} statements
 * @property {ParsedAccess[]} accesses
 * @property {ParsedComparison[]} comparisons
 * @property {{ statement: number, text: string }[]} literals the string literals of a statement, without quotes
 * @property {(import("./mfs.js").MfsFieldFact & { symbol: number })[]} mfsFields symbol: position in the file's symbols of the format or message
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
 * @property {number} resolved accesses linked to the variable they name
 * @property {number} resolveMs
 */

// Raise it whenever the indexer reads something new; graphs of an older one are read again.
const INDEXER_VERSION = 10;

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
  detail TEXT,
  comment TEXT,
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
-- PL/I declarations: scope is the procedure or package they are declared
-- in, NULL for the file (an include member's); parent the structure.
CREATE TABLE IF NOT EXISTS variables (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  scope INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  parent INTEGER REFERENCES variables(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  qualified TEXT NOT NULL,
  type TEXT,
  size TEXT,
  dims TEXT,
  storage TEXT,
  base TEXT,
  init TEXT,
  like TEXT,
  external INTEGER NOT NULL,
  parameter INTEGER,
  attributes TEXT NOT NULL,
  comment TEXT,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS variables_file ON variables(file);
CREATE INDEX IF NOT EXISTS variables_name ON variables(name);
CREATE INDEX IF NOT EXISTS variables_scope ON variables(scope);
CREATE INDEX IF NOT EXISTS variables_parent ON variables(parent);
-- JCL: the steps of a job or procedure and their DD statements.
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  job INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  name TEXT,
  program TEXT,
  procedure TEXT,
  psb TEXT,
  parm TEXT,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_file ON steps(file);
CREATE INDEX IF NOT EXISTS steps_program ON steps(program);
CREATE TABLE IF NOT EXISTS dds (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  step INTEGER REFERENCES steps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dsn TEXT,
  member TEXT,
  disp TEXT,
  attributes TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dds_file ON dds(file);
CREATE INDEX IF NOT EXISTS dds_step ON dds(step);
CREATE INDEX IF NOT EXISTS dds_dsn ON dds(dsn);
-- PL/I I/O statements, one row per file they name.
CREATE TABLE IF NOT EXISTS file_io (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caller INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  name TEXT NOT NULL,
  record TEXT,
  key TEXT,
  title TEXT,
  statement TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS file_io_file ON file_io(file);
CREATE INDEX IF NOT EXISTS file_io_name ON file_io(name);
-- Db2: the columns embedded SQL uses, and the columns of CREATE TABLE.
CREATE TABLE IF NOT EXISTS sql_columns (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caller INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  cursor TEXT,
  schema TEXT,
  table_name TEXT,
  column_name TEXT,
  usage TEXT NOT NULL,
  host TEXT,
  expression TEXT,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sql_columns_file ON sql_columns(file);
CREATE INDEX IF NOT EXISTS sql_columns_column ON sql_columns(table_name, column_name);
CREATE INDEX IF NOT EXISTS sql_columns_host ON sql_columns(host);
CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  table_symbol INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  not_null INTEGER NOT NULL,
  key INTEGER,
  position INTEGER NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS columns_file ON columns(file);
CREATE INDEX IF NOT EXISTS columns_name ON columns(table_name, name);
-- IMS gens: the PCBs and SENSEGs of PSBs, the segments and fields of DBDs.
CREATE TABLE IF NOT EXISTS pcbs (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  psb INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  dbd TEXT,
  procopt TEXT,
  attributes TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pcbs_psb ON pcbs(psb);
CREATE INDEX IF NOT EXISTS pcbs_dbd ON pcbs(dbd);
CREATE TABLE IF NOT EXISTS sensegs (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  pcb INTEGER NOT NULL REFERENCES pcbs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent TEXT,
  procopt TEXT,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sensegs_pcb ON sensegs(pcb);
CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  dbd INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent TEXT,
  bytes INTEGER,
  position INTEGER NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS segments_dbd ON segments(dbd);
CREATE INDEX IF NOT EXISTS segments_name ON segments(name);
CREATE TABLE IF NOT EXISTS segment_fields (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  segment INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sequence TEXT,
  start INTEGER,
  bytes INTEGER,
  type TEXT,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS segment_fields_segment ON segment_fields(segment);
-- IMS DL/I calls; pcb_parameter is the main procedure's parameter the PCB
-- comes from, which is its position in the PSB.
CREATE TABLE IF NOT EXISTS dli_calls (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caller INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  entry TEXT NOT NULL,
  function TEXT,
  pcb TEXT,
  pcb_parameter INTEGER,
  io_area TEXT,
  segment TEXT,
  path TEXT,
  arguments TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dli_calls_file ON dli_calls(file);
CREATE INDEX IF NOT EXISTS dli_calls_segment ON dli_calls(segment);
-- MFS: the DFLDs of a format's first device and the MFLDs of a message.
CREATE TABLE IF NOT EXISTS mfs_fields (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  screen INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT,
  dfld TEXT,
  row INTEGER,
  col INTEGER,
  length INTEGER,
  segment INTEGER,
  offset INTEGER,
  label TEXT,
  literal TEXT,
  attributes TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mfs_fields_screen ON mfs_fields(screen);
CREATE INDEX IF NOT EXISTS mfs_fields_name ON mfs_fields(name);
-- PL/I's executable statements as a tree: parent is the statement one is in,
-- branch says whether in the THEN or ELSE of an IF.
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY,
  file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caller INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  parent INTEGER REFERENCES statements(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  branch TEXT,
  label TEXT,
  detail TEXT,
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS statements_file ON statements(file);
CREATE INDEX IF NOT EXISTS statements_parent ON statements(parent);
-- The fields a statement reads and writes, by name as written.
CREATE TABLE IF NOT EXISTS accesses (
  id INTEGER PRIMARY KEY,
  statement INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  value TEXT,
  position INTEGER,
  variable INTEGER REFERENCES variables(id) ON DELETE SET NULL,
  through INTEGER REFERENCES variables(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS accesses_statement ON accesses(statement);
CREATE INDEX IF NOT EXISTS accesses_variable ON accesses(variable);
CREATE INDEX IF NOT EXISTS accesses_through ON accesses(through) WHERE through IS NOT NULL;
CREATE INDEX IF NOT EXISTS accesses_name ON accesses(name);
-- Comparisons in conditions, and a SELECT's subject against each WHEN value.
CREATE TABLE IF NOT EXISTS comparisons (
  id INTEGER PRIMARY KEY,
  statement INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  left TEXT NOT NULL,
  operator TEXT NOT NULL,
  right TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comparisons_statement ON comparisons(statement);
-- The string literals of statements: messages, codes, report text.
CREATE TABLE IF NOT EXISTS literals (
  id INTEGER PRIMARY KEY,
  statement INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS literals_statement ON literals(statement);
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
  db.exec("CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value)");
  const version = /** @type {{ value: number } | undefined} */ (db.prepare("SELECT value FROM meta WHERE name = 'indexer_version'").get());
  if (version?.value !== INDEXER_VERSION) {
    // An older indexer's graph lacks tables and columns, and unchanged files
    // would never get the facts this one reads: it is built again.
    db.exec("DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS literals; DROP TABLE IF EXISTS comparisons; DROP TABLE IF EXISTS accesses; DROP TABLE IF EXISTS statements; DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS variables; DROP TABLE IF EXISTS dli_calls; DROP TABLE IF EXISTS mfs_fields; DROP TABLE IF EXISTS segment_fields; DROP TABLE IF EXISTS segments; DROP TABLE IF EXISTS sensegs; DROP TABLE IF EXISTS pcbs; DROP TABLE IF EXISTS sql_columns; DROP TABLE IF EXISTS columns; DROP TABLE IF EXISTS file_io; DROP TABLE IF EXISTS dds; DROP TABLE IF EXISTS steps; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS files");
    db.prepare("INSERT INTO meta (name, value) VALUES ('indexer_version', ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(INDEXER_VERSION);
  }
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
    "INSERT INTO symbols (file, parent, kind, name, qualifier, detail, comment, line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertStep = db.prepare("INSERT INTO steps (file, job, name, program, procedure, psb, parm, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertDd = db.prepare("INSERT INTO dds (file, step, name, dsn, member, disp, attributes, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertFileIo = db.prepare("INSERT INTO file_io (file, caller, operation, name, record, key, title, statement, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertSqlColumn = db.prepare(
    "INSERT INTO sql_columns (file, caller, operation, cursor, schema, table_name, column_name, usage, host, expression, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertColumn = db.prepare("INSERT INTO columns (file, table_symbol, table_name, name, type, not_null, key, position, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertPcb = db.prepare("INSERT INTO pcbs (file, psb, position, type, name, dbd, procopt, attributes, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertSenseg = db.prepare("INSERT INTO sensegs (file, pcb, name, parent, procopt, line) VALUES (?, ?, ?, ?, ?, ?)");
  const insertSegment = db.prepare("INSERT INTO segments (file, dbd, name, parent, bytes, position, line) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertSegmentField = db.prepare("INSERT INTO segment_fields (file, segment, name, sequence, start, bytes, type, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertMfsField = db.prepare(
    "INSERT INTO mfs_fields (file, screen, kind, name, dfld, row, col, length, segment, offset, label, literal, attributes, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDliCall = db.prepare(
    "INSERT INTO dli_calls (file, caller, entry, function, pcb, pcb_parameter, io_area, segment, path, arguments, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertStatement = db.prepare("INSERT INTO statements (file, caller, parent, kind, branch, label, detail, line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertAccess = db.prepare("INSERT INTO accesses (statement, name, mode, value, position) VALUES (?, ?, ?, ?, ?)");
  const insertComparison = db.prepare("INSERT INTO comparisons (statement, left, operator, right) VALUES (?, ?, ?, ?)");
  const insertLiteral = db.prepare("INSERT INTO literals (statement, text) VALUES (?, ?)");
  const insertVariable = db.prepare(
    `INSERT INTO variables (file, scope, parent, level, name, qualified, type, size, dims, storage, base, init, like, external, parameter, attributes, comment, line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      const text = readFileSync(join(root, path), "utf-8");
      let language = /** @type {keyof Grammars} */ (languageOf(path));
      if (language === "pli" && IMS_GEN.test(text.slice(0, 4000))) language = "hlasm";
      const parsed = parseFile(indexer, language, text);
      const file = Number(insertFile.run(path, language, memberOf(path), stat.mtime, stat.size).lastInsertRowid);
      added.push(file);
      /** @type {number[]} */
      const symbolIds = [];
      for (const symbol of parsed.symbols) {
        names.add(symbol.name);
        const parent = symbol.parent < 0 ? null : symbolIds[symbol.parent];
        const id = insertSymbol.run(file, parent, symbol.kind, symbol.name, symbol.qualifier, symbol.detail ?? null, symbol.comment ?? null, symbol.line, symbol.endLine).lastInsertRowid;
        symbolIds.push(Number(id));
      }
      /** @type {number[]} */
      const variableIds = [];
      for (const v of parsed.variables) {
        const id = insertVariable.run(
          file,
          v.scope < 0 ? null : symbolIds[v.scope],
          v.parent < 0 ? null : variableIds[v.parent],
          v.level,
          v.name,
          v.qualified,
          v.type,
          v.size,
          v.dims,
          v.storage,
          v.base,
          v.init,
          v.like,
          v.external ? 1 : 0,
          v.parameter,
          v.attributes,
          v.comment ?? null,
          v.line,
        ).lastInsertRowid;
        variableIds.push(Number(id));
      }
      /** @type {number[]} */
      const stepIds = [];
      for (const step of parsed.steps) {
        const job = step.job < 0 ? null : symbolIds[step.job];
        stepIds.push(Number(insertStep.run(file, job, step.name, step.program, step.procedure, step.psb, step.parm, step.line).lastInsertRowid));
      }
      for (const dd of parsed.dds) {
        insertDd.run(file, dd.step < 0 ? null : stepIds[dd.step], dd.name, dd.dsn, dd.member, dd.disp, dd.attributes, dd.line);
      }
      for (const io of parsed.fileIo) {
        insertFileIo.run(file, io.caller < 0 ? null : symbolIds[io.caller], io.operation, io.name, io.record, io.key, io.title, io.statement, io.line);
      }
      for (const c of parsed.sqlColumns) {
        insertSqlColumn.run(file, c.caller < 0 ? null : symbolIds[c.caller], c.operation, c.cursor, c.schema, c.table, c.column, c.usage, c.host, c.expression, c.line);
      }
      for (const c of parsed.columns) {
        insertColumn.run(file, symbolIds[c.table], parsed.symbols[c.table].name, c.name, c.type, c.notNull ? 1 : 0, c.key, c.position, c.line);
      }
      const pcbIds = parsed.pcbs.map((c) =>
        Number(insertPcb.run(file, symbolIds[c.psb], c.position, c.type, c.name, c.dbd, c.procopt, c.attributes, c.line).lastInsertRowid),
      );
      for (const c of parsed.sensegs) insertSenseg.run(file, pcbIds[c.pcb], c.name, c.parent, c.procopt, c.line);
      const segmentIds = parsed.segments.map((c) =>
        Number(insertSegment.run(file, symbolIds[c.dbd], c.name, c.parent, c.bytes, c.position, c.line).lastInsertRowid),
      );
      for (const c of parsed.segmentFields) insertSegmentField.run(file, segmentIds[c.segment], c.name, c.sequence, c.start, c.bytes, c.type, c.line);
      for (const f of parsed.mfsFields) {
        insertMfsField.run(file, symbolIds[f.symbol], f.kind, f.name, f.dfld, f.row, f.col, f.length, f.segment, f.offset, f.label, f.literal, f.attributes, f.line);
      }
      for (const c of parsed.dliCalls) {
        const caller = c.caller < 0 ? null : symbolIds[c.caller];
        insertDliCall.run(file, caller, c.entry, c.function, c.pcb, c.pcbParameter, c.ioArea, c.segment, c.path, c.arguments, c.line);
      }
      /** @type {number[]} */
      const statementIds = [];
      for (const st of parsed.statements) {
        const caller = st.caller < 0 ? null : symbolIds[st.caller];
        const parent = st.parent < 0 ? null : statementIds[st.parent];
        statementIds.push(Number(insertStatement.run(file, caller, parent, st.kind, st.branch, st.label, st.detail, st.line, st.endLine).lastInsertRowid));
      }
      for (const a of parsed.accesses) insertAccess.run(statementIds[a.statement], a.name, a.mode, a.value, a.position);
      for (const c of parsed.comparisons) insertComparison.run(statementIds[c.statement], c.left, c.operator, c.right);
      for (const l of parsed.literals) insertLiteral.run(statementIds[l.statement], l.text);
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
    const linkedAt = performance.now();
    // A file's accesses can mean other variables when it changed, or when
    // an include it uses, directly or through another include, did.
    /** @type {number[]} */
    let toResolve;
    if (!options.paths && known.size === 0) {
      toResolve = /** @type {{ id: number }[]} */ (db.prepare("SELECT id FROM files WHERE language = 'pli'").all()).map((f) => f.id);
    } else {
      const including = db.prepare(
        `SELECT DISTINCT r.file FROM refs r JOIN links l ON l.ref = r.id WHERE r.kind = 'include' AND l.target_file IN (SELECT value FROM json_each(?))`,
      );
      const includingNames = db.prepare(`SELECT DISTINCT file FROM refs WHERE kind = 'include' AND name IN (SELECT value FROM json_each(?))`);
      const found = new Set([...added, ...(/** @type {{ file: number }[]} */ (includingNames.all(JSON.stringify([...names])))).map((r) => r.file)]);
      for (let next = [...found]; next.length; ) {
        const more = /** @type {{ file: number }[]} */ (including.all(JSON.stringify(next))).map((r) => r.file).filter((f) => !found.has(f));
        for (const f of more) found.add(f);
        next = more;
      }
      toResolve = [...found];
    }
    const resolved = resolveAccesses(db, toResolve);
    if (total > 0) {
      db.exec(`INSERT INTO meta (name, value) VALUES ('graph_version', 1)
               ON CONFLICT (name) DO UPDATE SET value = value + 1`);
    }
    db.exec("COMMIT");
    onProgress({ phase: "link", done: refs.length, total: refs.length });
    return {
      changed: total,
      relinked: refs.length,
      resolved,
      parseMs: Math.round(parsedAt - started),
      linkMs: Math.round(linkedAt - parsedAt),
      resolveMs: Math.round(performance.now() - linkedAt),
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
  const file = { symbols: [], refs: [], variables: [], steps: [], dds: [], fileIo: [], sqlColumns: [], columns: [], pcbs: [], sensegs: [], segments: [], segmentFields: [], dliCalls: [], mfsFields: [], statements: [], accesses: [], comparisons: [], literals: [] };
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
      if (file.symbols.some((s) => s.kind === "format" || s.kind === "message")) {
        for (const field of mfsFields(text)) {
          const symbol = file.symbols.findIndex((s) => (s.kind === "format" || s.kind === "message") && s.name === field.screen);
          if (symbol >= 0) file.mfsFields.push({ ...field, symbol });
        }
      }
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
  // The root starts at the first token, not at the file's first character.
  const text = { source: root.text, offset: root.startIndex };
  /** @type {Map<string, SelectItem[]>} the select items of each cursor declared so far */
  const cursors = new Map();
  /** @type {Map<number, string[]>} each procedure's parameters, by its position in the symbols */
  const parameters = new Map();
  /** @type {{ caller: number, entry: string, args: string[], line: number }[]} read once the declarations are known */
  const dliCalls = [];
  /** @param {Node} node */
  const source = (node) => tidy(text.source.slice(node.startIndex - text.offset, node.endIndex - text.offset));
  /** @type {Set<string>} statement, name and mode of the accesses so far */
  const accessed = new Set();
  /** @type {{ line: number, endLine: number, text: string, trailing: boolean }[]} trailing: after code on its line */
  const comments = [];
  // Depth first, carrying the innermost procedure or package (the caller),
  // the innermost definition (the parent of a nested one), the innermost
  // statement and, for a statement, its branch of an IF and its label.
  /** @type {{ node: Node, caller: number, parent: number, statement: number, branch: "then" | "else" | null, label: string | null }[]} */
  const stack = [{ node: root, caller: -1, parent: -1, statement: -1, branch: null, label: null }];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const node = top.node;
    const type = node.type;
    let caller = top.caller;
    let parent = top.parent;
    let statement = top.statement;
    let label = null;
    let thenId = -1;
    let elseId = -1;
    const kind = STATEMENT_KINDS.get(type);
    if (kind) {
      const row = { caller, parent: statement, kind, branch: top.branch, label: top.label, detail: null, line: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
      statement = file.statements.push(row) - 1;
    }
    switch (type) {
      case "labeled_statement": {
        const prefix = node.namedChildren.find((c) => c?.type === "statement_prefix");
        label = prefix?.childForFieldName("label")?.text.toUpperCase() ?? null;
        break;
      }
      case "if_statement": {
        const condition = node.childForFieldName("condition");
        if (condition) file.statements[statement].detail = source(condition);
        thenId = node.childForFieldName("consequence")?.id ?? -1;
        elseId = node.childForFieldName("alternative")?.id ?? -1;
        break;
      }
      case "select_statement":
      case "do_statement":
      case "on_statement":
      case "return_statement":
      case "signal_statement":
      case "goto_statement": {
        const head = node.firstNamedChild;
        if (head && !head.type.endsWith("_statement") && !head.type.endsWith("_clause")) file.statements[statement].detail = source(head);
        break;
      }
      case "when_clause": {
        const values = node.namedChildren.slice(0, -1).filter((c) => c !== null);
        file.statements[statement].detail = values.map(source).join(", ");
        const subject = file.statements[top.statement]?.detail;
        if (subject) {
          for (const v of values) file.comparisons.push({ statement, left: subject, operator: "=", right: source(v) });
        }
        break;
      }
      case "binary_expression": {
        const left = node.firstNamedChild;
        const right = node.lastNamedChild;
        if (statement >= 0 && left && right) {
          const operator = text.source.slice(left.endIndex - text.offset, right.startIndex - text.offset).replace(/\s+/g, "").replace(/¬/g, "^");
          if (COMPARISONS.has(operator)) file.comparisons.push({ statement, left: source(left), operator, right: source(right) });
        }
        break;
      }
      case "procedure_statement":
      case "entry_statement":
      case "package_statement": {
        const name = labelOf(node);
        const site = node.parent;
        if (name && site) {
          const isPackage = node.type === "package_statement";
          parent = addSymbol(file, top.parent, isPackage ? "package" : "procedure", name, site);
          if (!isPackage || caller < 0) caller = parent;
          const heading = node.namedChildren.find((c) => c?.type === "procedure_heading");
          const options = heading?.namedChildren.filter((c) => c?.type === "options_attribute" || c?.type === "returns_attribute") ?? [];
          if (options.length) file.symbols[parent].detail = options.map((c) => tidy(c?.text ?? "")).join(" ");
          const list = heading?.namedChildren.find((c) => c?.type === "parameter_list");
          parameters.set(parent, list?.namedChildren.map((c) => c?.text.toUpperCase() ?? "") ?? []);
        }
        statement = -1;
        break;
      }
      case "declare_statement":
        readDeclaration(node, file, caller, parameters.get(caller) ?? []);
        statement = -1;
        break;
      case "open_statement":
      case "close_statement":
      case "read_statement":
      case "write_statement":
      case "rewrite_statement":
      case "delete_statement":
      case "get_statement":
      case "put_statement":
        readFileIo(text, node, file, caller);
        break;
      case "ERROR":
        // The grammar knows no LOCATE.
        if (/^LOCATE\b/i.test(node.text)) readFileIo(text, node, file, caller);
        break;
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
            readSql(tree.rootNode, file, caller, cursors, language.startPosition.row + 1);
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
        if (name) file.statements[statement].detail = name;
        if (name && DLI_ENTRIES.has(name)) {
          const list = node.namedChildren.find((c) => c?.type === "argument_list");
          const args = list?.namedChildren.map((c) => tidy(c?.text ?? "").toUpperCase()) ?? [];
          dliCalls.push({ caller, entry: name, args, line: node.startPosition.row + 1 });
        }
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
        if (statement < 0 || isCallEntry || !up) break;
        const access = readAccess(text, node, up, file.statements[statement].kind);
        const name = access && referenceName(node);
        if (!access || !name) break;
        const key = `${statement} ${name} ${access.mode}`;
        if (accessed.has(key)) break;
        accessed.add(key);
        file.accesses.push({ statement, name, mode: access.mode, value: access.value, position: access.position });
        break;
      }
      case "comment": {
        const start = node.startIndex - text.offset;
        const lineStart = text.source.lastIndexOf("\n", start - 1) + 1;
        const body = node.text
          .replace(/^\/\*|\*\/$/g, "")
          .split("\n")
          .map((line) => line.replace(/^[\s*=-]+|[\s*=-]+$/g, ""))
          .filter((line) => line)
          .join(" ");
        // A box line has no text but still joins the block.
        comments.push({ line: node.startPosition.row + 1, endLine: node.endPosition.row + 1, text: body, trailing: text.source.slice(lineStart, start).trim() !== "" });
        continue;
      }
      case "string_literal": {
        if (statement >= 0 && node.parent?.type !== "bit_literal" && node.parent?.type !== "hex_literal") file.literals.push({ statement, text: node.text.slice(1, node.text.lastIndexOf("'")).replace(/''/g, "'").trimEnd() });
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
      if (!child) continue;
      // A labeled statement's label and branch belong to the statement in it.
      let branch = type === "labeled_statement" ? top.branch : null;
      if (thenId >= 0) branch = child.id === thenId ? "then" : child.id === elseId ? "else" : null;
      stack.push({ node: child, caller, parent, statement, branch, label });
    }
  }
  // A parameter left undeclared has PL/I's default attributes.
  for (const [scope, names] of parameters) {
    const symbol = file.symbols[scope];
    for (const [i, name] of names.entries()) {
      if (file.variables.some((v) => v.scope === scope && v.name === name && v.level === 1)) continue;
      file.variables.push({
        scope, parent: -1, level: 1, name, qualified: name, type: null, size: null, dims: null, storage: "PARAMETER",
        base: null, init: null, like: null, external: false, parameter: i + 1, attributes: "", line: symbol.line,
      });
    }
  }
  for (const call of dliCalls) file.dliCalls.push(readDliCall(call));

  // A comment describes the procedure or declaration right below it, and a
  // declaration the comment after it on its line.
  /** @type {Map<number, typeof comments[number]>} */
  const aboveByEnd = new Map();
  /** @type {Map<number, string>} */
  const trailingAt = new Map();
  for (const c of comments) {
    if (c.trailing && !c.text) continue;
    if (c.trailing) trailingAt.set(c.line, [trailingAt.get(c.line), c.text].filter(Boolean).join(" "));
    else aboveByEnd.set(c.endLine, c);
  }
  /** @param {number} line */
  const above = (line) => {
    const block = [];
    for (let c = aboveByEnd.get(line - 1); c; c = aboveByEnd.get(c.line - 1)) if (c.text) block.unshift(c.text);
    return block.length ? block.join(" ") : null;
  };
  for (const symbol of file.symbols) symbol.comment = above(symbol.line);
  for (const v of file.variables) {
    if (v.storage === "PARAMETER" && !v.attributes) continue;
    v.comment = [above(v.line), trailingAt.get(v.line)].filter(Boolean).join(" ") || null;
  }
}

const DLI_ENTRIES = new Set(["PLITDLI", "CEETDLI", "AIBTDLI"]);

const COMPARISONS = new Set(["=", "^=", "<>", "<", ">", "<=", ">=", "^<", "^>"]);

// Declarations, procedures and the preprocessor's statements do nothing at run time.
/** @type {Map<string, string>} */
const STATEMENT_KINDS = new Map([
  ...["allocate", "assert", "assignment", "begin", "call", "close", "delete", "display", "do", "exec", "fetch", "free", "get", "goto",
    "if", "iterate", "leave", "null", "on", "open", "put", "read", "release", "resignal", "return", "revert", "rewrite", "select",
    "signal", "stop", "write"].map((kind) => /** @type {[string, string]} */ ([`${kind}_statement`, kind])),
  ["when_clause", "when"],
  ["otherwise_clause", "otherwise"],
]);

const LITERALS = new Set(["string_literal", "bit_literal", "hex_literal", "number"]);

const IO_KINDS = new Set(["open", "close", "read", "write", "rewrite", "delete", "get", "put"]);

/**
 * Whether a reference reads or writes, or undefined for one that is no field:
 * a GOTO's label, an ON's condition, an I/O statement's file.
 * @param {{ source: string, offset: number }} text
 * @param {Node} node the reference
 * @param {Node} up its parent
 * @param {string} kind its statement's
 * @returns {{ mode: "read" | "write" | "arg", value: string | null, position: number | null } | undefined}
 */
function readAccess(text, node, up, kind) {
  switch (up.type) {
    case "goto_statement":
    case "condition_spec":
      return undefined;
    case "assignment_statement": {
      const value = up.childForFieldName("value");
      if (value?.id === node.id) return { mode: "read", value: null, position: null };
      const literal = value && LITERALS.has(value.type) ? tidy(value.text) : null;
      return { mode: "write", value: literal, position: null };
    }
    case "do_specification":
      return { mode: up.childForFieldName("control")?.id === node.id ? "write" : "read", value: null, position: null };
    case "argument": {
      const list = up.parent;
      if (list?.parent?.type !== "call_statement") return { mode: "read", value: null, position: null };
      return { mode: "arg", value: null, position: list.namedChildren.findIndex((c) => c?.id === up.id) + 1 };
    }
  }
  if (!IO_KINDS.has(kind)) return { mode: "read", value: null, position: null };
  // READ FILE(F) INTO(X) KEY(K): the grammar keeps FILE's reference bare and
  // the others in an option whose keyword is only in the source.
  if (up.type.endsWith("_statement")) return undefined;
  const keyword = text.source.slice(up.startIndex - text.offset, up.startIndex - text.offset + 8).toUpperCase();
  if (/^(FILE|TITLE)\b/.test(keyword)) return undefined;
  if (/^(INTO|KEYTO|SET)\b/.test(keyword) || kind === "get") return { mode: "write", value: null, position: null };
  return { mode: "read", value: null, position: null };
}

/**
 * A DL/I call as written. Its function, segments and PCB parameter come
 * from the declarations, which may be in an include: resolveAccesses
 * fills them in.
 * @param {{ caller: number, entry: string, args: string[], line: number }} call
 * @returns {ParsedDliCall}
 */
function readDliCall(call) {
  const [, pcb, ioArea] = dliArguments(call.entry, call.args);
  return {
    caller: call.caller,
    entry: call.entry,
    function: null,
    pcb: pcb ?? null,
    pcbParameter: null,
    ioArea: ioArea ?? null,
    segment: null,
    path: null,
    arguments: call.args.join(", "),
    line: call.line,
  };
}

/**
 * The function, PCB, I/O area and SSAs: PL/I passes PLITDLI and AIBTDLI a
 * parameter count first.
 * @param {string} entry
 * @param {string[]} args
 */
function dliArguments(entry, args) {
  return entry === "CEETDLI" ? args : args.slice(1);
}

// FILE(KUNDIN), INTO(SATZ), KEY(SUBSTR(K,1,8)): one level of nested parentheses.
const IO_OPTION = /\b(FILE|INTO|FROM|SET|KEY|KEYTO|KEYFROM|TITLE|STRING)\s*\(((?:[^()']|'[^']*'|\((?:[^()']|'[^']*')*\))*)\)/gi;

/**
 * An I/O statement's files, read from its text up to the semicolon: the
 * grammar ends REWRITE before a KEY, so its node can be too short.
 * @param {{ source: string, offset: number }} text the root's text and where it starts
 * @param {Node} node
 * @param {ParsedFile} file
 * @param {number} caller
 */
function readFileIo(text, node, file, caller) {
  const start = node.startIndex - text.offset;
  const end = text.source.indexOf(";", start);
  const statement = tidy(text.source.slice(start, end < 0 ? node.endIndex - text.offset : end + 1));
  const operation = (statement.match(/^\w+/)?.[0] ?? "").toUpperCase();
  const line = node.startPosition.row + 1;
  /** @type {ParsedFileIo[]} */
  const found = [];
  let record = operation === "LOCATE" ? (statement.match(/^LOCATE\s+([\w.$#@]+)/i)?.[1].toUpperCase() ?? null) : null;
  let toString = false;
  for (const [, keyword, value] of statement.matchAll(IO_OPTION)) {
    const option = keyword.toUpperCase();
    const written = tidy(value).toUpperCase();
    if (option === "FILE") {
      found.push({ caller, operation, name: written, record, key: null, title: null, statement, line });
      continue;
    }
    if (option === "STRING") toString = true;
    const io = found.at(-1);
    if (option === "INTO" || option === "FROM" || option === "SET") {
      if (io) io.record = written;
      else record = written;
    } else if (option.startsWith("KEY") && io) io.key = written;
    else if (option === "TITLE" && io) io.title = written.replace(/^'|'$/g, "").trim();
  }
  // GET and PUT without FILE or STRING read SYSIN and write SYSPRINT.
  if (found.length === 0 && !toString && (operation === "GET" || operation === "PUT")) {
    found.push({ caller, operation, name: operation === "GET" ? "SYSIN" : "SYSPRINT", record: null, key: null, title: null, statement, line });
  }
  file.fileIo.push(...found);
}

/** Collapses blanks outside string literals, whose blanks are data ('GU  ' is a DL/I function). @param {string} text */
const tidy = (text) => text.replace(/('[^']*')|\s+/g, (_, literal) => literal ?? " ").trim();

/** The type a declaration's attribute nodes name, or null. @type {Record<string, string>} */
const TYPES = {
  char_attribute: "CHAR",
  bit_attribute: "BIT",
  picture_attribute: "PIC",
  float_attribute: "FLOAT",
  pointer_attribute: "POINTER",
  entry_attribute: "ENTRY",
  area_attribute: "AREA",
  offset_attribute: "OFFSET",
};

/** Storage classes as simple attributes, abbreviations included. @type {Record<string, string>} */
const STORAGE = { STATIC: "STATIC", AUTOMATIC: "AUTOMATIC", AUTO: "AUTOMATIC", CONTROLLED: "CONTROLLED", CTL: "CONTROLLED" };

/**
 * The items of one DECLARE: `DCL 1 A BASED(P), 2 (B, C) CHAR(8), 2 * CHAR(2);`.
 * @param {Node} statement
 * @param {ParsedFile} file
 * @param {number} scope
 * @param {string[]} parameters the parameters of the procedure it is in
 */
function readDeclaration(statement, file, scope, parameters) {
  /** @type {number[]} positions in file.variables of the open structures */
  const structure = [];
  for (const item of statement.namedChildren) {
    if (item?.type !== "declaration_item") continue;
    const levelNode = item.childForFieldName("level");
    const level = levelNode ? Number(levelNode.text) : 1;
    const nameNode = item.childForFieldName("name");
    const names =
      nameNode?.type === "factored_name_list"
        ? nameNode.namedChildren.map((n) => n?.text.toUpperCase() ?? "")
        : [nameNode && nameNode.type === "identifier" ? nameNode.text.toUpperCase() : "*"];
    const attributes = tidy(item.text.slice(nameNode ? nameNode.endIndex - item.startIndex : 0).replace(/^\s*\*/, ""));

    let type = null;
    let size = null;
    let dims = null;
    let storage = null;
    let base = null;
    let init = null;
    let like = null;
    let external = false;
    /** @param {Node} node */
    const inParens = (node) => {
      const spec = node.namedChildren.find((c) => c?.type === "length_spec" || c?.type === "precision");
      return spec ? spec.namedChildren.map((c) => c?.text).join(",") : null;
    };
    for (const attribute of item.namedChildren) {
      if (!attribute || attribute === levelNode || attribute === nameNode) continue;
      const word = attribute.text.toUpperCase();
      switch (attribute.type) {
        case "fixed_attribute":
          type = type ? `FIXED ${type}` : "FIXED";
          break;
        case "decimal_attribute":
        case "binary_attribute": {
          const base = attribute.type === "decimal_attribute" ? "DEC" : "BIN";
          type = type === "FIXED" || type === "FLOAT" ? `${type} ${base}` : base;
          size = inParens(attribute) ?? size;
          break;
        }
        case "char_attribute":
          type = /\bVAR(YING)?\b/i.test(attributes) ? "VARCHAR" : "CHAR";
          size = inParens(attribute);
          break;
        case "picture_attribute":
          type = "PIC";
          size = attribute.namedChildren[0]?.text.replace(/^'|'$/g, "") ?? null;
          break;
        case "dimension_attribute":
          dims = attribute.namedChildren.map((bound) => tidy(bound?.text ?? "")).join(",");
          break;
        case "based_attribute":
          storage = "BASED";
          base = attribute.namedChildren[0] ? tidy(attribute.namedChildren[0].text).toUpperCase() : null;
          break;
        case "defined_attribute":
          storage = "DEFINED";
          base = attribute.namedChildren[0] ? tidy(attribute.namedChildren[0].text).toUpperCase() : null;
          break;
        case "value_attribute":
          storage = "CONSTANT";
          init = tidy(attribute.namedChildren.map((c) => c?.text).join(","));
          break;
        case "init_attribute":
          init = tidy(attribute.text.replace(/^\s*INIT(IAL)?\s*\(/i, "").replace(/\)\s*$/, ""));
          break;
        case "like_attribute":
          like = attribute.namedChildren[0] ? tidy(attribute.namedChildren[0].text).toUpperCase() : null;
          break;
        case "simple_attribute":
          if (word in STORAGE) storage = STORAGE[word];
          else if (word === "EXTERNAL" || word === "EXT") external = true;
          else if (word === "FILE") type = "FILE";
          else if (word === "LABEL") type = "LABEL";
          break;
        default:
          if (attribute.type in TYPES) {
            type = type === "FIXED" && attribute.type === "float_attribute" ? "FLOAT" : TYPES[attribute.type];
            size = inParens(attribute) ?? size;
          }
      }
    }
    if (type === "FIXED") type = "FIXED DEC";

    while (structure.length && file.variables[structure[structure.length - 1]].level >= level) structure.pop();
    const parent = structure.length ? structure[structure.length - 1] : -1;
    if (parent >= 0) file.variables[parent].type ??= "STRUCTURE";
    for (const name of names) {
      const parameter = level === 1 ? parameters.indexOf(name) + 1 || null : null;
      file.variables.push({
        scope,
        parent,
        level,
        name,
        qualified: parent >= 0 ? `${file.variables[parent].qualified}.${name}` : name,
        type,
        size,
        dims,
        storage: storage ?? (parameter ? "PARAMETER" : null),
        base,
        init,
        like,
        external,
        parameter,
        attributes,
        line: item.startPosition.row + 1,
      });
      if (names.length === 1) structure.push(file.variables.length - 1);
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

/** The operands as written, without continuations. @param {Node} statement */
function operandsText(statement) {
  const operands = statement.childForFieldName("operands")?.namedChildren ?? [];
  return operands.flatMap((p) => (p?.type === "parameter" ? [tidy(p.text)] : [])).join(",");
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
        /** @type {ParsedStep} */
        const step = { job: caller, name: fieldText(statement, "name").toUpperCase() || null, program: null, procedure: null, psb: null, parm: null, line: statement.startPosition.row + 1 };
        let regionController = false;
        for (const [index, [key, value]] of jclParameters(statement).entries()) {
          if (key === "PARM") step.parm = tidy(value.text.replace(/^[()'"]+|[()'"]+$/g, ""));
          const name = memberName(value.text);
          if (!name) continue;
          if ((index === 0 && key === "") || key === "PROC") {
            step.procedure = name;
            addRef(file, caller, "procedure", name, statement);
          } else if (key === "PGM" && name === IMS_REGION_CONTROLLER) {
            regionController = true;
          } else if (key === "PGM" || key === "MBR") {
            step.program = name;
            addRef(file, caller, "program", name, statement);
          } else if (key === "PSB") {
            step.psb = name;
          }
        }
        // PARM='BMP,PROGRAM,PSB,...'
        if (regionController && step.parm) {
          const fields = step.parm.split(",");
          step.program = memberName(fields[1] ?? "") ?? step.program;
          step.psb = memberName(fields[2] ?? "") ?? step.psb;
          if (step.program) addRef(file, caller, "program", step.program, statement);
        }
        if (!step.program && regionController) step.program = IMS_REGION_CONTROLLER;
        if (step.psb) addRef(file, caller, "psb", step.psb, statement);
        file.steps.push(step);
        break;
      }
      case "dd_statement": {
        const written = fieldText(statement, "name").toUpperCase();
        // `//STEP2.EIN DD` overrides EIN in the procedure STEP2 runs; a nameless DD continues a concatenation.
        const name = written ? written.slice(written.lastIndexOf(".") + 1) : (file.dds.at(-1)?.name ?? "");
        /** @type {ParsedDd} */
        const dd = { step: file.steps.length - 1, name, dsn: null, member: null, disp: null, attributes: operandsText(statement), line: statement.startPosition.row + 1 };
        for (const [key, value] of jclParameters(statement)) {
          if (key === "DSN" || key === "DSNAME") {
            dd.dsn = (value.namedChildren[0]?.text ?? value.text).toUpperCase();
            const inParentheses = value.namedChildren[1];
            if (inParentheses) dd.member = inParentheses.text.replace(/^\(|\)$/g, "").toUpperCase();
          } else if (key === "DISP") {
            dd.disp = value.text.replace(/[()\s]/g, "").toUpperCase();
          }
        }
        if (dd.dsn && !dd.disp) dd.disp = "NEW";
        file.dds.push(dd);
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

// A PSB gen, DBD gen or IMS system definition: assembler macros whose first
// statement says what they are. Their members are rarely named like MFS.
const IMS_GEN = /^(?:[ \t]*\n|\*.*\n)*\S*[ \t]+(PRINT|TITLE|PCB|PSBGEN|DBD|DATASET|SEGM|IMSCTRL|APPLCTN|TRANSACT|DATABASE)[ \t]/;

/** The words of an operand value: `((KUNDE,SNGL))` is KUNDE and SNGL. @param {string | undefined} value */
const valueWords = (value) => (value ?? "").split(/[(),\s]+/).filter((w) => w && !w.includes("=") && !w.includes("'"));

/** @param {string | undefined} value */
const valueNumber = (value) => (value && /^\d+$/.test(value) ? Number(value) : null);

/**
 * @param {Node} root
 * @param {ParsedFile} file
 */
function readHlasm(root, file) {
  // A PSB's PCBs come before the PSBGEN that names it.
  /** @type {{ pcb: number, statement: Node }[]} */
  let pcbsOfPsb = [];
  let dbd = -1;
  /** @type {{ psb: string | null, type: string | null }} the APPLCTN the TRANSACTs below belong to */
  let application = { psb: null, type: null };
  for (const statement of root.namedChildren) {
    if (statement?.type !== "statement") continue;
    const operation = fieldText(statement, "operation").toUpperCase();
    const operands = statement.childForFieldName("operands");
    if (IMS_MACROS.has(operation)) {
      /** @type {Map<string, string>} */
      const keys = new Map();
      for (const operand of operands?.namedChildren ?? []) {
        if (operand?.type === "keyword_operand") keys.set(fieldText(operand, "key").toUpperCase(), operand.childForFieldName("value")?.text.toUpperCase() ?? "");
      }
      const name = valueWords(keys.get("NAME"))[0] ?? null;
      const line = statement.startPosition.row + 1;
      const attributes = [...keys].map(([key, value]) => `${key}=${value}`).join(",");
      if (operation === "PCB") {
        pcbsOfPsb.push({ pcb: file.pcbs.length, statement });
        file.pcbs.push({
          psb: -1,
          position: pcbsOfPsb.length,
          type: keys.get("TYPE") ?? "DB",
          name: keys.get("PCBNAME") ?? (fieldText(statement, "name").toUpperCase() || null),
          dbd: valueWords(keys.get("DBDNAME"))[0] ?? null,
          procopt: keys.get("PROCOPT") ?? null,
          attributes,
          line,
        });
      } else if (operation === "SENSEG" && name && file.pcbs.length) {
        const parent = valueWords(keys.get("PARENT"))[0] ?? null;
        file.sensegs.push({ pcb: file.pcbs.length - 1, name, parent: parent === "0" ? null : parent, procopt: keys.get("PROCOPT") ?? null, line });
      } else if (operation === "PSBGEN") {
        const psbName = valueWords(keys.get("PSBNAME"))[0];
        if (!psbName) continue;
        const psb = addSymbol(file, -1, "psb", psbName, statement);
        file.symbols[psb].detail = attributes;
        for (const { pcb, statement: site } of pcbsOfPsb) {
          file.pcbs[pcb].psb = psb;
          const target = file.pcbs[pcb].dbd;
          if (target) addRef(file, psb, "dbd", target, site);
        }
        pcbsOfPsb = [];
      } else if (operation === "DBD" && name) {
        dbd = addSymbol(file, -1, "dbd", name, statement);
        file.symbols[dbd].detail = attributes;
      } else if (operation === "SEGM" && name && dbd >= 0) {
        const parent = valueWords(keys.get("PARENT"))[0] ?? null;
        const position = file.segments.filter((s) => s.dbd === dbd).length + 1;
        file.segments.push({ dbd, name, parent: parent === "0" ? null : parent, bytes: valueNumber(valueWords(keys.get("BYTES"))[0]), position, line });
      } else if (operation === "FIELD" && name && file.segments.length) {
        const words = valueWords(keys.get("NAME"));
        file.segmentFields.push({
          segment: file.segments.length - 1,
          name,
          sequence: words[1] === "SEQ" ? (words[2] ?? "U") : null,
          start: valueNumber(keys.get("START")),
          bytes: valueNumber(keys.get("BYTES")),
          type: keys.get("TYPE") ?? null,
          line,
        });
      } else if (operation === "APPLCTN") {
        application = { psb: valueWords(keys.get("PSB"))[0] ?? null, type: keys.get("PGMTYPE") ?? null };
      } else if (operation === "TRANSACT") {
        // A transaction runs the program named like its application's PSB.
        for (const code of valueWords(keys.get("CODE"))) {
          const transaction = addSymbol(file, -1, "transaction", code, statement);
          file.symbols[transaction].detail = [application.psb && `PSB=${application.psb}`, application.type && `PGMTYPE=${application.type}`, attributes].filter(Boolean).join(",");
          if (!application.psb) continue;
          addRef(file, transaction, "psb", application.psb, statement);
          addRef(file, transaction, "program", application.psb, statement);
        }
      }
      continue;
    }
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

const IMS_MACROS = new Set(["PCB", "SENSEG", "PSBGEN", "DBD", "SEGM", "FIELD", "APPLCTN", "TRANSACT"]);

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
    if (kind === "table" && caller >= 0) readColumns(statement, file, caller);
    for (const table of db2TableNames(statement)) {
      addRef(file, caller, "table", table.name, table.site, null, table.qualifier);
    }
  }
}


/**
 * @param {Node} statement a create_table_statement
 * @param {ParsedFile} file
 * @param {number} table
 */
function readColumns(statement, file, table) {
  const elements = statement.descendantsOfType("table_elements")[0]?.namedChildren ?? [];
  const constraint = elements.find((e) => e?.type === "table_constraint" && /^\s*(CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY/i.test(e.text));
  const primaryKey = (constraint?.text.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((n) => n.trim().replaceAll('"', "").toUpperCase());
  let position = 0;
  for (const element of elements) {
    if (element?.type !== "column_definition") continue;
    const name = (element.childForFieldName("name")?.text ?? "").replaceAll('"', "").toUpperCase();
    const rest = element.text.slice((element.childForFieldName("type")?.endIndex ?? element.endIndex) - element.startIndex);
    const inline = /\bPRIMARY\s+KEY\b/i.test(rest);
    position++;
    file.columns.push({
      table,
      name,
      type: tidy(element.childForFieldName("type")?.text ?? "").toUpperCase(),
      notNull: /\bNOT\s+NULL\b/i.test(rest) || inline,
      key: inline ? 1 : primaryKey.includes(name) ? primaryKey.indexOf(name) + 1 : null,
      position,
      line: element.startPosition.row + 1,
    });
  }
}

// ---- Embedded SQL columns ----------------------------------------------------

/** @typedef {{ schema: string | null, table: string | null, column: string | null, expression: string | null }} SelectItem */
/** @typedef {{ node: Node, usage: string, around: Node | null, condition: Node | null }} Place where the walk is, and the clause and predicate it is in */

const SQL_OPERATIONS = /** @type {Record<string, string>} */ ({
  select_statement: "SELECT",
  insert_statement: "INSERT",
  update_statement: "UPDATE",
  delete_statement: "DELETE",
  declare_cursor_statement: "DECLARE",
  fetch_statement: "FETCH",
});

// The clauses that say how a column inside them is used.
const SQL_USAGES = /** @type {Record<string, string>} */ ({
  select_item: "select",
  where_clause: "where",
  having_clause: "having",
  joined_table: "join",
  group_by_clause: "group",
  order_by_clause: "order",
  values_clause: "read",
});

// The nodes whose table field names a table, not a column.
const TABLE_HOLDERS = new Set(["table_reference", "insert_statement", "update_statement", "delete_statement"]);

// Nothing in these is a column.
const NO_COLUMNS = new Set(["host_variable", "string", "special_register", "sequence_reference", "correlation"]);

/** `:KD.NAME :IND` is KD.NAME. @param {Node | null | undefined} node */
const hostName = (node) => node?.text.match(/^:\s*([\w.$#@]+)/)?.[1].toUpperCase() ?? null;

/**
 * The columns of one EXEC SQL statement: what is selected into which host
 * variable, compared, set or inserted. FETCH pairs its INTO with the select
 * items of the cursor declared before it in the same file.
 * @param {Node} root the statement parsed by the Db2 grammar
 * @param {ParsedFile} file
 * @param {number} caller
 * @param {Map<string, SelectItem[]>} cursors
 * @param {number} firstLine where the SQL starts in the PL/I file
 */
function readSql(root, file, caller, cursors, firstLine) {
  const statement = root.namedChildren[0];
  const operation = statement && SQL_OPERATIONS[statement.type];
  if (!statement || !operation) return;
  const cursor = statement.childForFieldName("cursor")?.text.toUpperCase() ?? statement.childForFieldName("name")?.text.toUpperCase() ?? null;
  /** @param {Node} node */
  const lineOf = (node) => firstLine + node.startPosition.row;

  if (operation === "FETCH") {
    const hosts = statement.descendantsOfType("into_clause")[0]?.namedChildren ?? [];
    const items = cursors.get(cursor ?? "") ?? [];
    for (const [i, host] of hosts.entries()) {
      const item = items[i];
      file.sqlColumns.push({ caller, operation, cursor, schema: item?.schema ?? null, table: item?.table ?? null, column: item?.column ?? null, usage: "select", host: hostName(host), expression: item?.expression ?? null, line: lineOf(statement) });
    }
    return;
  }

  // What the walk below collects; the columns are resolved once it has all tables.
  /** @type {Map<string, { schema: string | null, table: string }>} the tables, by their correlation name and their own name */
  const tables = new Map();
  /** @type {{ schema: string | null, table: string }[]} */
  const all = [];
  /** @type {(Node | null)[]} */
  let hostsInto = [];
  /** @type {(Node | null)[]} */
  let insertValues = [];
  /** @type {Node[]} */
  const selectItems = [];
  /** @type {{ qualifier: string | null, column: string, site: Node, place: Place, insert: number }[]} insert: the position in an INSERT's column list, else -1 */
  const found = [];
  /** @param {Node} reference */
  const addTable = (reference) => {
    const name = reference.childForFieldName("table");
    if (!name) return;
    const { name: table, qualifier: schema } = objectName(name);
    const entry = { schema, table };
    all.push(entry);
    tables.set(table, entry);
    const correlation = reference.namedChildren.find((c) => c?.type === "correlation")?.childForFieldName("name");
    if (correlation) tables.set(correlation.text.toUpperCase(), entry);
  };
  if (TABLE_HOLDERS.has(statement.type)) addTable(statement);

  /** @type {Set<number>} select items with a column in them */
  const withColumn = new Set();
  /** @type {SelectItem[]} */
  const cursorItems = [];

  /**
   * @param {string | null} qualifier
   * @param {string} column
   * @param {Node} site
   * @param {Place} place
   * @param {{ host: string | null, expression: string | null }} [given] for an INSERT column, its value
   */
  const add = (qualifier, column, site, { usage, around, condition }, given) => {
    const selectIndex = usage === "select" && around ? selectItems.findIndex((item) => item.id === around.id) : -1;
    let host = given?.host ?? null;
    let expression = given?.expression ?? null;
    let selectAll = false;
    if (usage === "select" && around) {
      withColumn.add(around.id);
      host = hostName(hostsInto[selectIndex]);
      const itemText = tidy(around.text).toUpperCase();
      selectAll = /\.\s*\*$/.test(itemText);
      if (!selectAll && itemText !== `${qualifier ? `${qualifier}.` : ""}${column}`) expression = itemText;
    } else if (usage === "set" && around) {
      const right = around.childForFieldName("right");
      host = hostName(right?.type === "host_variable" ? right : right?.descendantsOfType("host_variable")[0]);
      expression = right ? tidy(right.text) : null;
    } else if ((usage === "where" || usage === "having" || usage === "join") && condition) {
      host = hostName(condition.type === "host_variable" ? condition : condition.descendantsOfType("host_variable")[0]);
      expression = tidy(condition.text);
    }
    const target = qualifier ? tables.get(qualifier) : all.length === 1 ? all[0] : undefined;
    file.sqlColumns.push({
      caller,
      operation,
      cursor: operation === "DECLARE" ? cursor : null,
      schema: target?.schema ?? null,
      table: target?.table ?? null,
      column: selectAll ? "*" : column,
      usage,
      host,
      expression,
      line: lineOf(site),
    });
    if (operation === "DECLARE" && usage === "select") cursorItems.push({ schema: target?.schema ?? null, table: target?.table ?? null, column: selectAll ? "*" : column, expression });
  };

  // One walk down the statement that carries how the columns below are used,
  // so no column has to look up for its clause.
  /** @type {Place[]} */
  const stack = [{ node: statement, usage: "read", around: null, condition: null }];
  for (let place = stack.pop(); place; place = stack.pop()) {
    const current = place.node;
    if (current.type === "object_name") {
      const parts = current.namedChildren.map((p) => (p?.text ?? "").replaceAll('"', "").toUpperCase());
      const column = parts.pop() ?? "";
      found.push({ qualifier: parts.pop() ?? null, column, site: current, place, insert: -1 });
      continue;
    }
    if (current.type === "table_reference") addTable(current);
    else if (current.type === "select_item") selectItems.push(current);
    else if (current.type === "into_clause" && !hostsInto.length) hostsInto = current.namedChildren;
    else if (current.type === "row_value" && !insertValues.length) insertValues = current.namedChildren;
    if (current.type === "arguments") {
      // The grammar leaves A.B in function arguments as loose identifiers.
      const parts = current.children;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part?.type !== "identifier") {
          if (part?.namedChildCount && !NO_COLUMNS.has(part.type)) stack.push({ ...place, node: part });
          continue;
        }
        const dotted = parts[i + 1]?.text === "." && parts[i + 2]?.type === "identifier";
        const column = (dotted ? parts[i + 2]?.text : part.text) ?? "";
        found.push({ qualifier: dotted ? part.text.toUpperCase() : null, column: column.toUpperCase(), site: part, place, insert: -1 });
        if (dotted) i += 2;
      }
      continue;
    }
    const tableName = TABLE_HOLDERS.has(current.type) ? current.childForFieldName("table") : null;
    const functionName = current.type === "function_call" ? current.childForFieldName("name") : null;
    const left = current.type === "assignment" ? current.childForFieldName("left") : null;
    const children = current.namedChildren;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!child || NO_COLUMNS.has(child.type) || child.id === tableName?.id || child.id === functionName?.id) continue;
      if (child.type === "column_list") {
        if (current.type !== "insert_statement") continue;
        for (const [insert, name] of child.namedChildren.entries()) {
          if (name) found.push({ qualifier: null, column: name.text.replaceAll('"', "").toUpperCase(), site: name, place: { node: name, usage: "insert", around: child, condition: null }, insert });
        }
        continue;
      }
      let { usage, around, condition } = place;
      if (current.type === "assignment") {
        usage = child.id === left?.id ? "set" : "read";
        around = current;
      } else if (SQL_USAGES[child.type]) {
        usage = SQL_USAGES[child.type];
        around = child;
        condition = null;
      } else if (current.id === around?.id || current.type === "binary_expression") {
        // The predicate is the child of the clause, or of the AND / OR it is in.
        condition = child;
      }
      stack.push({ node: child, usage, around, condition });
    }
  }

  for (const { qualifier, column, site, place, insert } of found) {
    const value = insertValues[insert];
    if (insert < 0) add(qualifier, column, site, place);
    else if (value?.type === "host_variable") add(qualifier, column, site, place, { host: hostName(value), expression: null });
    else add(qualifier, column, site, place, { host: null, expression: value ? tidy(value.text) : null });
  }

  // Select items without a column: COUNT(*), a literal, a special register.
  for (const [index, item] of selectItems.entries()) {
    if (withColumn.has(item.id)) continue;
    const star = /^\s*\*\s*$/.test(item.text);
    file.sqlColumns.push({
      caller,
      operation,
      cursor: operation === "DECLARE" ? cursor : null,
      schema: all.length === 1 ? all[0].schema : null,
      table: all.length === 1 ? all[0].table : null,
      column: star ? "*" : null,
      usage: "select",
      host: hostName(hostsInto[index]),
      expression: star ? null : tidy(item.text).toUpperCase(),
      line: lineOf(item),
    });
  }
  if (operation === "DECLARE" && cursor) cursors.set(cursor, cursorItems);
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
 * @typedef {object} VariableRow
 * @property {number} id
 * @property {number | null} scope
 * @property {string} name
 * @property {string} qualified
 * @property {string | null} like
 * @property {number | null} parent
 * @property {string | null} init
 * @property {string | null} base
 * @property {number | null} parameter
 */

/**
 * Links the accesses of these files to the variables they name, with PL/I's
 * rules: the innermost procedure declaring a match wins, the procedure an
 * include is in declares what it includes, a name may leave out structure
 * levels (KUNDE_SEG.PLZ) and a field of a LIKE structure is the template's
 * field, reached through the structure.
 * @param {DatabaseSync} db
 * @param {number[]} files
 * @returns {number} accesses resolved
 */
function resolveAccesses(db, files) {
  const variablesOf = db.prepare("SELECT id, scope, parent, name, qualified, like, init, base, parameter FROM variables WHERE file = ? ORDER BY id");
  const includesOf = db.prepare(
    "SELECT r.caller, l.target_file AS target FROM refs r JOIN links l ON l.ref = r.id WHERE r.file = ? AND r.kind = 'include' ORDER BY r.id",
  );
  const parentsOf = db.prepare("SELECT id, parent, detail FROM symbols WHERE file = ?");
  const dliCallsOf = db.prepare("SELECT id, caller, entry, arguments FROM dli_calls WHERE file = ?");
  const updateDliCall = db.prepare("UPDATE dli_calls SET function = ?, pcb_parameter = ?, segment = ?, path = ? WHERE id = ?");
  const accessesOf = db.prepare("SELECT a.id, a.name, s.caller FROM accesses a JOIN statements s ON s.id = a.statement WHERE s.file = ?");
  const clear = db.prepare("UPDATE accesses SET variable = NULL, through = NULL WHERE statement IN (SELECT id FROM statements WHERE file = ?) AND variable IS NOT NULL");
  const update = db.prepare("UPDATE accesses SET variable = ?, through = ? WHERE id = ?");

  /** @type {Map<number, VariableRow[]>} an include's variables with those of the includes in it */
  const included = new Map();
  /** @param {number} file @param {Set<number>} seen */
  const variablesIncluded = (file, seen) => {
    const known = included.get(file);
    if (known) return known;
    const list = /** @type {VariableRow[]} */ (variablesOf.all(file));
    seen.add(file);
    for (const include of /** @type {{ target: number }[]} */ (includesOf.all(file))) {
      if (!seen.has(include.target)) list.push(...variablesIncluded(include.target, seen));
    }
    included.set(file, list);
    return list;
  };

  let resolved = 0;
  for (const file of files) {
    // The variables each scope declares, by their own name; 0 is the file's.
    /** @type {Map<number, Map<string, VariableRow[]>>} */
    const scopes = new Map();
    /** @param {number} scope @param {VariableRow} v */
    const declare = (scope, v) => {
      let byName = scopes.get(scope);
      if (!byName) scopes.set(scope, (byName = new Map()));
      const list = byName.get(v.name);
      if (list) list.push(v);
      else byName.set(v.name, [v]);
    };
    for (const v of /** @type {VariableRow[]} */ (variablesOf.all(file))) declare(v.scope ?? 0, v);
    for (const include of /** @type {{ caller: number | null, target: number }[]} */ (includesOf.all(file))) {
      for (const v of variablesIncluded(include.target, new Set([file]))) declare(include.caller ?? 0, v);
    }
    /** @type {Map<number, number>} */
    const parentOf = new Map();
    /** @type {Set<number>} the main procedures */
    const mains = new Set();
    for (const row of /** @type {{ id: number, parent: number | null, detail: string | null }[]} */ (parentsOf.all(file))) {
      parentOf.set(row.id, row.parent ?? 0);
      if (/\bMAIN\b/i.test(row.detail ?? "")) mains.add(row.id);
    }

    /** A name's variable, seen from a scope. @param {string[]} parts @param {number} from @returns {VariableRow | undefined} */
    const find = (parts, from) => {
      const last = parts[parts.length - 1];
      for (let scope = from; ; scope = parentOf.get(scope) ?? 0) {
        const matches = (scopes.get(scope)?.get(last) ?? []).filter((v) => {
          // The qualifiers given must be the variable's, in order, but may skip levels.
          const levels = v.qualified.split(".");
          let at = 0;
          for (const part of parts.slice(0, -1)) {
            while (at < levels.length - 1 && levels[at] !== part) at++;
            if (at >= levels.length - 1) return false;
            at++;
          }
          return true;
        });
        if (matches.length) return matches.find((v) => v.qualified === parts.join(".")) ?? matches[0];
        if (scope === 0) return undefined;
      }
    };

    clear.run(file);
    for (const access of /** @type {{ id: number, name: string, caller: number | null }[]} */ (accessesOf.all(file))) {
      const parts = access.name.split(".");
      const scope = access.caller ?? 0;
      let variable = find(parts, scope);
      let through = null;
      // ALT.KREDIT, ALT LIKE KUNDE_SEG: KUNDE_SEG.KREDIT.
      for (let i = parts.length - 1; !variable && i > 0; i--) {
        const structure = find(parts.slice(0, i), scope);
        if (!structure?.like) continue;
        variable = find([...structure.like.split("."), ...parts.slice(i)], scope);
        if (variable) through = structure.id;
      }
      if (!variable) continue;
      update.run(variable.id, through, access.id);
      resolved++;
    }

    /** @type {Map<number, VariableRow>} each structure's first field */
    const firstFields = new Map();
    for (const byName of scopes.values()) {
      for (const list of byName.values()) {
        for (const v of list) {
          const known = v.parent === null ? undefined : firstFields.get(v.parent);
          if (v.parent !== null && (!known || known.id > v.id)) firstFields.set(v.parent, v);
        }
      }
    }
    for (const call of /** @type {{ id: number, caller: number | null, entry: string, arguments: string }[]} */ (dliCallsOf.all(file))) {
      const scope = call.caller ?? 0;
      /** A literal's value, or the INIT of the variable (of a structure, its first field's). @param {string | undefined} arg */
      const value = (arg) => {
        if (arg === undefined) return null;
        if (arg.startsWith("'")) return arg.slice(1, arg.lastIndexOf("'"));
        const v = find(arg.split("."), scope);
        const init = v && (v.init ?? firstFields.get(v.id)?.init);
        return init?.startsWith("'") ? init.slice(1, init.lastIndexOf("'")) : null;
      };
      const [functionArg, pcb, , ...ssas] = dliArguments(call.entry, call.arguments.match(/(?:'[^']*'|[^,'])+/g)?.map((a) => a.trim()) ?? []);
      const segments = ssas.map((ssa) => value(ssa)?.slice(0, 8).trim() || "?");
      // A PCB mask is BASED on a pointer the main procedure gets as a parameter.
      const mask = pcb === undefined ? undefined : find(pcb.split("."), scope);
      const pointer = mask?.base ? find(mask.base.split("."), scope) : mask;
      const pcbParameter = pointer?.parameter && pointer.scope !== null && mains.has(pointer.scope) ? pointer.parameter : null;
      updateDliCall.run(
        value(functionArg)?.trim() || null,
        pcbParameter,
        segments.filter((s) => s !== "?").pop() ?? null,
        segments.length ? segments.join("/") : null,
        call.id,
      );
    }
  }
  return resolved;
}

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
  /** @type {Map<string, SymbolRow[]>} */
  const psbs = new Map();
  /** @type {Map<string, SymbolRow[]>} */
  const dbds = new Map();
  /** @type {Set<number>} the files of PSB and DBD gens, which no program is, though named like one */
  const genFiles = new Set();
  /** @type {Record<string, Map<string, SymbolRow[]> | undefined>} */
  const definedBy = { format: screens, message: screens, table: tables, view: tables, alias: tables, psb: psbs, dbd: dbds };
  for (const symbol of symbols) {
    symbolById.set(symbol.id, symbol);
    const list = symbolsOf.get(symbol.file);
    if (list) list.push(symbol);
    else symbolsOf.set(symbol.file, [symbol]);
    if (symbol.kind === "psb" || symbol.kind === "dbd") genFiles.add(symbol.file);
    const defined = definedBy[symbol.kind];
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
   * @param {Set<number>} [skipped]
   * @returns {number | undefined}
   */
  const member = (name, from, skipped = new Set()) => {
    const candidates = byMember.get(name)?.filter((id) => !skipped.has(id));
    if (!candidates?.length) return undefined;
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
    const target = member(name, from, genFiles);
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
      case "psb":
        return (psbs.get(ref.name) ?? []).map(at);
      case "dbd":
        return (dbds.get(ref.name) ?? []).map(at);
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
