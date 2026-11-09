# PL/I Graph

PL/I, JCL, MFS and Db2 support for VS Code, built on a code graph the
extension keeps of each workspace folder:

- **Highlighting** for PL/I (`.pli`, `.pl1`, `.pco`, `.inc`), JCL (`.jcl`,
  `.cntl`), IMS MFS and HLASM (`.mfs`, `.asm`, `.hlasm`, `.mlc`) and Db2 SQL
  (`.ddl`, `.db2`), from the same tree-sitter grammars the indexer uses and
  their own `highlights.scm` queries, as semantic tokens; `EXEC SQL` is read
  by the Db2 grammar. A TextMate grammar colors a file until its first parse
  is done (about 50 ms for 3,000 lines). An extensionless z/OS member gets
  its language once it is in the graph, by its third character: `J` is JCL,
  `F` MFS, `T` Db2, anything else PL/I. The graph also reads a member as
  assembler when its first statement is an IMS gen macro (`PCB`, `DBD`,
  `APPLCTN`, ...), so PSB gens, DBD gens and the IMS system definition are
  found whatever their names.
- **Go to Definition** (F12, Ctrl+click) on a called procedure or an
  `%INCLUDE` member, a job's programs and procedures, a screen's formats and
  messages and the tables a program or view uses. It uses the calls the
  indexer resolved for the procedure around the cursor, then falls back to a plain
  name lookup. On a definition itself, Ctrl+click lists its references.
- **Variables and structure fields**: Go to Definition and Find All
  References on a PL/I variable or field find its `DCL`, also in an
  `%INCLUDE` member and the members that one includes. A qualified name
  (`CUST.ADDR.CITY`, levels may be left out) goes to its field, through
  `LIKE` too, and a declaration local to a procedure hides an outer one.
  References of a field in an include reach every program including it. In
  `EXEC SQL`, `:NAME` is a variable and any other name a column of the
  tables the program uses, read from their `CREATE TABLE`. In HLASM and MFS,
  labels: an `EQU` from a `COPY` member, the `DFLD` an `MFLD` names.
- **Find All References** (Shift+F12) on all of these: every call of a
  procedure, every job step that runs a program, every program that uses a
  table or screen, every `%INCLUDE` of a member and every use of a variable,
  field, label or column.
- **Completion** of the variables and fields in scope (fields after
  `STRUCT.`), the file's procedures, the repository's programs and the PL/I
  built-in functions; in `EXEC SQL` the columns of the program's tables and
  all table names, after `:` the variables. In HLASM the labels in scope and
  the screens; in JCL the programs and procedures.
- **PL/I Dependencies** and **PL/I Dependents** in the Explorer: the active
  file's includes, the Db2 tables it uses with what it does to each
  (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), the procedures it calls in other
  files and the names the indexer could not resolve; and the files that include it
  or call into it, for a DDL file with what each program does to each table. They
  work for the JCL jobs, MFS screens and Db2 tables in the graph too (a job
  "calls" its programs, a program its tables and screens). Each row
  expands into its file. Files that already appear further up are marked
  `(repeated)` and don't expand. They follow the editor you switch to or
  click into; a file opened from them leaves them in place until you click
  or type in its editor.
- **Progress** of indexing: the status bar shows `PL/I graph 42%` while a
  sync runs, and a sync of 50 files or more, such as the first one, also
  shows a notification with the step (`Reading files: 5,000 of 20,000`).
- **PL/I Graph: Show Graph** (also the graph icon on those views) opens the
  whole graph next to the editor, starting at the active file's module. It is
  the page from `viz/`, drawn from the same database:
  - the overview is one folder at a time: its subfolders and its modules,
    with the calls and includes between them summed up. A folder with more
    than 300 modules shows the 300 most connected; search (`/`) and the
    module list reach every one.
  - a module shows its procedures with callers left and callees right, at
    most 60 a side (the most connected); the details list all of them.
  - **Go to source** in the details opens the file at that line.
  - When the graph changes, a **graph changed · reload** button appears;
    reloading keeps the current view.

  For 20,000 files the page holds about 24 MB of graph data: reading it takes
  about a second, and each view draws in under half a second.
- **PL/I Graph: Show 3270 Screen** (the window icon on an MFS file, or its
  context menu in the explorer) draws the MFS format at the cursor as a 3270
  terminal next to the editor, with
  [tn3270](https://github.com/Simon-Peleska/tn3270)'s canvas and its in-page
  host. Literals are protected text and input fields can be typed into and
  tabbed through, colored as a 3279 colors them. The sidebar lists the input
  fields: typing in either place shows in the other, and clicking a field's
  name opens its `DFLD`. Enter, F1-F24 (Shift for 13-24) and PageUp/PageDown
  (PA1/PA2) send the screen; the output channel logs the key and the fields.
  Editing the source redraws the screen and keeps the typed values.
- **An MCP server for Copilot**: the extension offers each workspace folder's
  graph to Copilot's agent mode (and any other chat in VS Code that uses MCP)
  as the server **PL/I Graph: <folder>**, with nothing to configure. Its
  tools are `find_definition`, `find_references`, `dependencies`,
  `dependents`, `dataset` (which job steps write and read a dataset),
  `program_files` (a program's files, records, keys and the datasets they
  are in), `table_columns` (a Db2 table's columns and the SQL statements
  that select, compare, set or insert each, with their host variables),
  `psb` (an IMS PSB or a transaction's: its PCBs, the segments each may
  access and who uses it), `screen` (an MFS format's fields with their
  labels, and where each message field sits in the program's I/O area),
  `dli` (a program's DL/I calls: function, SSA
  segments, I/O area and the PSB's PCB each call uses), `field` (where a
  field is set, passed to a CALL or compared, under which IF, WHEN, DO and
  ON conditions), `lineage` (where a variable's value comes from and goes
  to: assignments, and arguments bound to parameters), `text` (comments
  and string literals containing a word or message code), `get_source` and
  `query_graph`, a read-only SQL query over the
  tables below. Copilot lists them under the tools button in agent mode,
  and **MCP: List Servers** starts, stops and shows the server's log. It
  reads the graph the extension keeps up to date and never writes to it.
  Outside VS Code, any MCP client can start it as
  `node <extension>/out/mcp.cjs <graph .sqlite> <folder>` (Node 22.5 or
  newer); the output channel names the graph file on startup.

## How the graph is kept

Install `pli-graph.vsix`; it needs nothing else, on any platform. A worker
thread in the extension parses the sources with tree-sitter grammars compiled
to WebAssembly (`grammars/`, built by `build-grammars.sh` from the
`tree-sitter-*` checkouts next to this repository) and keeps one SQLite
graph per workspace folder in the extension's workspace storage. The
extension only reads it.

- The first sync of a workspace reads every file once: about 8 seconds and
  350 MB of memory for 20,000 files, giving a 60 MB graph.
- Later starts open the last session's graph at once and re-read only the
  files whose time or size changed (about 0.2 seconds when nothing changed).
- A saved, added or deleted file is in the graph a moment later: the worker
  re-reads it and re-links the references whose targets may have moved.
  Changes that arrive while a sync runs, such as a git checkout's, are
  synced together when it ends.

Clicking the status bar item opens a menu: Show Graph, Show Log and Rebuild
Graph. **Rebuild Graph** (also in the command palette) throws the graph away
and reads every file again. Messages and errors go to the **PL/I Graph**
output.

`pliGraph.extensionlessMembers` (default on) indexes files named like
`ABMAIN01`, by their third character as above.

Needs VS Code 1.101 or newer, whose Node has `node:sqlite`.

### The graph's tables

The graph is a plain SQLite file, so other tools (the MCP server, scripts)
can read it while VS Code runs:

- `files(id, path, language, member, mtime, size, syntax_errors, error_line, failure)`:
  every indexed file, `path` relative to the folder with `/`.
  `syntax_errors` counts the places the grammar could not read (from
  `error_line` on; facts there may be missing), `failure` says why reading
  the file failed, which leaves it without facts until it changes.
- `symbols(id, file, parent, kind, name, qualifier, detail, comment, line, end_line)`:
  procedures, packages, jobs, procedures in JCL, formats, messages, tables,
  views, aliases, PSBs, DBDs and IMS transactions; `parent` is the enclosing
  symbol, `detail` a procedure's `OPTIONS(...)` and `RETURNS(...)`, or the
  operands of a PSB, DBD or transaction (with its `APPLCTN`'s `PSB=` and
  `PGMTYPE=`).
- `refs(id, file, caller, kind, name, qualifier, detail, line, col, end_line, end_col)`:
  every call, fetch, include, program, procedure, table, screen, PSB and
  DBD reference, `caller` being the symbol it is in. A transaction refers
  to its PSB and to the program named like it, a PSB to the DBDs of its
  PCBs.
- `links(ref, target_file, target_symbol)`: what a reference resolved to, one
  row per target; none when it did not resolve. Includes link to a file only.
- `file_io(id, file, caller, operation, name, record, key, title, statement, line)`:
  every PL/I `OPEN`, `CLOSE`, `READ`, `WRITE`, `REWRITE`, `DELETE`, `LOCATE`,
  `GET` and `PUT`, one row per file it names. `record` is `INTO`, `FROM` or
  `SET` (`LOCATE`'s based variable), `key` is `KEY`, `KEYTO` or `KEYFROM`,
  `title` is `OPEN`'s `TITLE`. `GET` and `PUT` without `FILE` or `STRING`
  name `SYSIN` and `SYSPRINT`. A file's DD is the one named like its
  `title`, or else like the file.
- `sql_columns(id, file, caller, operation, cursor, schema, table_name, column_name, usage, host, expression, line)`:
  every column an embedded SQL statement uses. `usage` is `select`, `where`,
  `join`, `group`, `order`, `having`, `set`, `insert` or `read` (inside a
  `SET` or `VALUES` expression); `host` the host variable the column is
  selected into, compared with, set from or inserted from; `expression` the
  predicate, assigned value or select item when it is more than the column.
  A cursor's query has `operation` `DECLARE`, and each `FETCH` gets one row
  per `INTO` host variable with the cursor's select item at that position.
  An unqualified column in a join has no `table_name`.
- `columns(id, file, table_symbol, table_name, name, type, not_null, key, position, line)`:
  the columns of every `CREATE TABLE`, `key` being the position in the
  primary key.
- `pcbs(id, file, psb, position, type, name, dbd, procopt, attributes, line)`:
  the PCBs of every PSB gen in the order written, `type` `TP`, `DB` or
  `GSAM`, `name` its `PCBNAME=` or label.
- `sensegs(id, file, pcb, name, parent, procopt, line)`: the segments each
  PCB may access.
- `segments(id, file, dbd, name, parent, bytes, position, line)` and
  `segment_fields(id, file, segment, name, sequence, start, bytes, type, line)`:
  every DBD gen's segment hierarchy and fields, `sequence` `U` or `M` for
  the key field.
- `mfs_fields(id, file, screen, kind, name, dfld, row, col, length, segment, offset, label, literal, attributes, line)`:
  the `DFLD`s of every MFS format's first device, with `label` the literal
  to their left on the same row, and the `MFLD`s of every message in order,
  with `dfld` the screen field they map and `offset` where their data
  starts in the message segment after `LL ZZ` (and after the two attribute
  bytes of `ATTR=YES`).
- `dli_calls(id, file, caller, entry, function, pcb, pcb_parameter, io_area, segment, path, arguments, line)`:
  every `CALL PLITDLI`, `CEETDLI` or `AIBTDLI`. `function` (`GU`, `ISRT`,
  ...) and the SSA segments come from a literal or the `INIT` of the
  variable passed, wherever it is declared (an SSA structure's first field); `path` lists every
  SSA's segment (`KUNDE/KONTO`, `?` when unknown), `segment` the last.
  `pcb_parameter` is the main procedure's parameter the PCB mask is
  `BASED` on, which is its place in the PSB counting the I/O PCB.
- `statements(id, file, caller, parent, kind, branch, label, detail, line, end_line)`:
  every executable PL/I statement, and every `WHEN` and `OTHERWISE`, as a
  tree: `parent` is the statement it is in, `branch` `then` or `else` of its
  parent `IF`. `detail` is the head: the `IF` condition, `WHEN` values,
  `SELECT` subject, `DO` spec, `ON` condition, `RETURN` value, `GOTO`
  label, `SIGNAL` condition or `CALL` entry. Declarations are no statements.
- `accesses(id, statement, name, mode, value, position, variable, through)`:
  the fields each statement reads, writes (`value` the literal written) or
  passes to a `CALL` (`arg`, `position` from 1), by name as written.
  `variable` is the declaration the name resolves to by PL/I's scope rules,
  includes counted; for a field of a `LIKE` copy it is the template's field
  and `through` the copy.
- `comparisons(id, statement, left, operator, right)`: every comparison in a
  condition, and a `SELECT`'s subject against each `WHEN` value.
- `literals(id, statement, text)`: every string literal of a statement,
  without quotes and trailing blanks: messages, report text, codes. Bit
  and hex literals are left out.
- `variables(id, file, scope, parent, level, name, qualified, type, size, dims, storage, base, init, like, external, parameter, attributes, comment, line)`:
  every PL/I declaration and structure field. `scope` is the procedure it is
  declared in (none in an include outside one), `parent` the enclosing
  structure, `qualified` the dotted name (`KUNDE.ADRESSE.ORT`), `storage`
  `STATIC`, `AUTOMATIC`, `BASED`/`DEFINED` (with `base`), `CONTROLLED`,
  `CONSTANT` for `VALUE` or `PARAMETER` (with its position in `parameter`).
  `comment` holds the comments right above the declaration and after it on
  its line; `symbols.comment` a procedure's, from right above it.
  A parameter that is never declared still gets a row.
- `steps(id, file, job, name, program, procedure, psb, parm, line)`: every
  JCL `EXEC`, `job` being its job or procedure. `program` is what runs: `PGM=`,
  `MBR=`, or for `DFSRRC00` the program in its `PARM`, where `psb` comes from
  too (or from `PSB=`).
- `dds(id, file, step, name, dsn, member, disp, attributes, line)`: every DD
  statement. `dsn` without the PDS member or GDG generation, which go to
  `member` (`+1`, `0`, `KDMEMBER`); `disp` as written (`NEW,CATLG,DELETE`,
  `SHR`), `NEW` when a DSN has none. A concatenation repeats the DD name;
  `//STEP.DD` overrides belong to the step running the procedure.
- `meta(name, value)`: `graph_version` grows with every change;
  `indexer_version` names what the indexer reads, and a graph of an older
  one is built again from scratch.

## Error codes

- `PLG004E` a file from the tree could not be opened.
- `PLG005E` this VS Code has no `node:sqlite`; update VS Code.
- `PLG006E` Show Graph: there is no graph yet (first sync still running).
- `PLG007E` Show Graph: reading the graph failed.
- `PLG008E` Show Graph: **Go to source** could not open the file.
- `PLG009E` reading the declarations of a file failed (Go to Definition, Find All References).
- `PLG010E` completion failed.
- `PLG011E` a sync failed; the output has the error. The graph keeps its last state.
- `PLG012E` the indexer worker stopped; reload the window.
- `PLG013E` the graph file could not be opened.
- `PLG014E` the grammars for highlighting could not be loaded; only the TextMate colors remain.
- `PLG015E` highlighting a file failed; the output has the error.
- `PLG016E` Show 3270 Screen: the file has no MFS format (`FMT`).
- `PLG017E` Show 3270 Screen: opening a field's `DFLD` failed.
- `PLG018E` (on the screen page) drawing the screen failed.
- `PLG019E` (on the screen page) the format is no longer in the source.
- `PLG020E` (MCP server) a tool call failed, e.g. a bad SQL query; the
  message is the tool's answer.
- `PLG021E` (MCP server's log) a line from the client was not JSON.
- `PLG022E` reading a file failed on a shape the indexer does not handle;
  the sync goes on without that file's facts. Please report it with the file.
- `PLG023W` a file has syntax the grammar does not know, one line per file
  and a count per sync. Everything around it is still read;
  `SELECT path, syntax_errors, error_line FROM files WHERE syntax_errors > 0`
  lists them all.
- `PLG024E` resolving a file's field accesses failed; they stay unresolved.

Don't install it next to the pli-lsp extension: both define the `pli`
language, so highlighting would clash and trees would show twice.
