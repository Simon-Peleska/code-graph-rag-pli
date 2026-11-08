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
  `F` MFS, `T` Db2, anything else PL/I.
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
  `(repeated)` and don't expand.
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

## How the graph is kept

Install `pli-graph.vsix`; it needs nothing else, on any platform. A worker
thread in the extension parses the sources with tree-sitter grammars compiled
to WebAssembly (`grammars/`, built by `build-grammars.sh` from the
`tree-sitter-*` checkouts next to this repository) and keeps one SQLite
graph per workspace folder in the extension's workspace storage. The
extension only reads it.

- The first sync of a workspace reads every file once: about 4 seconds and
  300 MB of memory for 20,000 files.
- Later starts open the last session's graph at once and re-read only the
  files whose time or size changed (about 0.2 seconds when nothing changed).
- A saved, added or deleted file is in the graph a moment later: the worker
  re-reads it and re-links the references whose targets may have moved.
  Changes that arrive while a sync runs, such as a git checkout's, are
  synced together when it ends.

The status bar item and **PL/I Graph: Rebuild Graph** throw the graph away
and read every file again. Messages and errors go to the **PL/I Graph**
output.

`pliGraph.extensionlessMembers` (default on) indexes files named like
`ABMAIN01`, by their third character as above.

Needs VS Code 1.101 or newer, whose Node has `node:sqlite`.

### The graph's tables

The graph is a plain SQLite file, so other tools (an MCP server, scripts)
can read it while VS Code runs:

- `files(id, path, language, member, mtime, size)`: every indexed file,
  `path` relative to the folder with `/`.
- `symbols(id, file, parent, kind, name, qualifier, line, end_line)`:
  procedures, packages, jobs, procedures in JCL, formats, messages, tables,
  views and aliases; `parent` is the enclosing symbol.
- `refs(id, file, caller, kind, name, qualifier, detail, line, col, end_line, end_col)`:
  every call, fetch, include, program, table and screen reference, `caller`
  being the symbol it is in.
- `links(ref, target_file, target_symbol)`: what a reference resolved to, one
  row per target; none when it did not resolve. Includes link to a file only.
- `meta(name, value)`: `graph_version` grows with every change.

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

Don't install it next to the pli-lsp extension: both define the `pli`
language, so highlighting would clash and trees would show twice.
