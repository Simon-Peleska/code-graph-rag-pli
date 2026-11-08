# PL/I Graph (cgr)

PL/I support for VS Code built on the code-graph-rag (cgr) index:

- **Highlighting** for PL/I (`.pli`, `.pl1`, `.pco`, `.inc`), JCL (`.jcl`,
  `.cntl`), IMS MFS and HLASM (`.mfs`, `.asm`, `.hlasm`, `.mlc`) and Db2 SQL
  (`.ddl`, `.db2`). An extensionless z/OS member gets its language once cgr
  has it in the graph, by the same rule cgr reads it with: a third character
  `J` is JCL, `F` MFS, `T` Db2, anything else PL/I.
- **Go to Definition** (F12, Ctrl+click) on a called procedure or an
  `%INCLUDE` member, a job's programs and procedures, a screen's formats and
  messages and the tables a program or view uses. It uses the calls cgr
  resolved for the procedure around the cursor, then falls back to a plain
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
  files and the names cgr could not resolve; and the files that include it
  or call into it, for a DDL file with what each program does to each table. They
  work for the JCL jobs, MFS screens and Db2 tables cgr indexed too (a job
  "calls" its programs, a program its tables and screens). Each row
  expands into its file. Files that already appear further up are marked
  `(repeated)` and don't expand.
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
  - When cgr updates the graph, a **graph changed · reload** button appears;
    reloading keeps the current view.

  For 20,000 files the page holds about 24 MB of graph data: reading it takes
  about a second, and each view draws in under half a second.

## Setup

On Windows, install `pli-graph-win32-x64.vsix`: it carries cgr (Python, its
libraries and the compiled grammars) and uses it when `pliGraph.command` is
empty, so nothing else needs installing. `pli-graph.vsix` has no cgr: set
`pliGraph.command` to one, e.g. `uv run --project /path/to/upstream cgr` on
Linux or another bundle's `cgr.cmd`. The setting also overrides the
carried cgr.

For each workspace folder the extension runs
`cgr watch --repo-path <folder> --debounce 1 --no-start-stack` with
`GRAPH_BACKEND=sqlite`. cgr keeps the folder's project in its SQLite graph
(`SQLITE_GRAPH_PATH`, else `CGR_HOME/graph.sqlite`, else
`~/.cgr/graph.sqlite`) in sync, and the extension reads that file read-only,
checking cgr's `graph_version` every second. There is no separate index to
rebuild.

- The first sync of a workspace parses every file once: about 3 minutes and
  1.2 GB of memory for 20,000 PL/I files. The status bar spins until the
  project shows up, and the trees fill in as cgr writes. Don't close VS Code
  during it: an unfinished first sync starts over.
- Later starts compare file hashes and only re-read what changed.
- A saved, added or deleted file is in the graph about a second later.

The status bar item and **PL/I Graph: Restart cgr watch** restart the
watchers. Their output and errors go to the **PL/I Graph** output.

`pliGraph.extensionlessMembers` (default on) indexes files named like
`ABMAIN01` as PL/I.

Needs VS Code 1.101 or newer, whose Node has `node:sqlite`.

## Error codes

- `PLG001E` the package carries no cgr and `pliGraph.command` is not set.
- `PLG002E` `cgr watch` stopped; the output channel has cgr's messages.
- `PLG004E` a file from the tree could not be opened.
- `PLG005E` this VS Code has no `node:sqlite`; update VS Code.
- `PLG006E` Show Graph: there is no graph yet (first sync still running).
- `PLG007E` Show Graph: reading the graph failed.
- `PLG008E` Show Graph: **Go to source** could not open the file.
- `PLG009E` reading the declarations of a file failed (Go to Definition, Find All References).
- `PLG010E` completion failed.

Don't install it next to the pli-lsp extension: both define the `pli`
language, so highlighting would clash and trees would show twice.
