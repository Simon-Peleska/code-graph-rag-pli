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
- **PL/I margins**: rulers after columns 1, 72 and 80 mark the carriage
  control column, the code in 2-72 and the sequence numbers in 73-80. Tab
  stops at column 2 and then every 3 columns (*PL/I Graph: Indent to the
  Next PL/I Tab Stop*, bound to Tab). Tab takes its blanks from the padding
  after the cursor, so the sequence number and a comment's `*/` in column 72
  stay put: trailing blanks first, then the filler in front of the `*/`
  (`*****/`, `----*/`, `====*/`, blanks), then each run of blanks from the
  right, keeping one blank between words and every blank in a string.
  Indenting selected lines moves them by 3.
- **Format Document** (Shift+Alt+F) for all four languages, in the style
  of IBM's language references. Statements are laid out anew from their
  tokens, and the words in them are normalized too; what a string holds
  never changes. Sequence numbers (columns 73-80) are dropped, and in PL/I
  the carriage control in column 1. No blank lines at the top or bottom,
  one line break at the end.
  - PL/I words: keywords in `pliGraph.format.keywordCase`, names in
    `pliGraph.format.identifierCase` (both upper case by default).
    `pliGraph.format.abbreviations` writes keywords the Language Reference's
    short way (`DCL`, `PROC`, `CHAR`, `BIN`, `DEC`, `INIT`, `VAR`, `PTR`,
    `GOTO`, `OTHER`, conditions as `CONV`, `NOFOFL`, ...; the default) or
    long (`DECLARE`, ..., `GO TO`, `CONVERSION`). Strings get single quotes
    (`"it's"` becomes `'it''s'`), their suffix and numbers' letters the
    keyword case (`'1'B`, `1E5`). NOT and OR are written `¬`/`^` and `|`/`!`
    as the file mostly does (IBM's `¬` and `|` if even). A comment gets a
    blank after `/*` and before `*/`, a one-line one just one; boxes and
    rules (`/****`, `/*----`) stay as they are. A procedure's or package's
    bare END gets its name (`END P;`). No blank line at the start of a
    block or before END, one before a nested procedure (before its comment,
    if it has one), at most one elsewhere.
  - PL/I layout: code from column 2, each statement one indent (the tab size, 3)
    in from the DO, BEGIN, SELECT, WHEN, OTHERWISE, PROC, ON or IF it is in,
    END and ELSE level with it. One blank between tokens (`CALL X(KEY, RC);`,
    `IF A > 0 & B ^= 'X' THEN`), a statement on one line when it fits, else
    wrapped after a comma or before an operator, aligned after its
    parenthesis. A short statement stays after its IF, ELSE, WHEN or ON, a
    DO or BEGIN too. A structure's members go one per line, level 2 under
    the level-1 name and 2 further in per level. EXEC SQL goes a clause per
    line (INTO, FROM, WHERE, ...) under the first, AND and OR 2 further in.
    Comments stay on their line. A statement with a string running over a
    line end keeps its lines, and a file the parser can't read is not
    formatted (`PLG039W`).
  - JCL: upper case but for strings and comments, the operation in column 12, its operands one blank after it. A
    statement goes on one line when it fits, else a parameter per line from
    column 16. Comment statements, in-stream data, IF/THEN/ELSE and a string
    continued on the next line are left alone.
  - HLASM, MFS, PSB and DBD gens: in the keyword case but for strings and
    remarks, the operation in column 10, operands in 16, remarks in 40.
    Comment and continuation lines are left alone.
  - Db2 DDL and EXEC SQL: words in the keyword case, host variables
    (`:KDNR`) in the name case, strings and `"delimited"` names as they are.
    A statement in column 1, its clauses (IN, USING, FROM, WHERE,
    ...) on lines of their own 2 in; a CREATE TABLE's columns one per line,
    names, types and the rest lined up.
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
- **PL/I Graph: Show Flow Diagram** (also the flow icon beside the graph icon
  on PL/I Dependencies) opens the flow diagram of the procedure at the
  cursor, else of the file's main or first procedure, in the *PL/I Flow* tab.
  It is the graph page showing only the flow, with a worker of its own; its
  search field shows the flow of another procedure.
- **PL/I Graph: Show Flow Diagram of Procedure…** asks for a procedure in a
  quick pick that searches as you type and shows its flow. A caller can pass
  the name: `executeCommand("pliGraph.flowOf", "KDP00006")`.
- **Show Flow Diagram of NAME** is a code action (lightbulb, Ctrl+.) on a
  procedure's name, where it is declared or called.
- **PL/I Graph: Show Data Model** (the table icon in a DDL file's editor
  title, or the explorer's context menu on one) draws the file's tables,
  views and aliases as a UML class diagram in the same tab as the flow: a box
  per table with its columns, `PK` and `FK` marks, types and `[0..1]` for a
  column that may be NULL. A foreign key is a solid arrow to the table it
  references, labeled with its columns (column-level `REFERENCES` and
  `FOREIGN KEY (..) REFERENCES`); a view's FROM and an alias's FOR are dashed.
  Referenced tables sit above the tables that reference them. The *Relations
  deep* slider adds the tables of other files that many relations away, in
  either direction, up to 150. Click one of the file's own boxes to open its
  `CREATE`, another file's box to draw that file's data model.
- **Show Data Flow of NAME** is a code action on a variable's or field's
  name, where it is declared or used (also the command *PL/I Graph: Show
  Data Flow of the Variable* at the cursor). It follows the variable end to
  end: under a `CALL` into the callee with the parameter in that place, or
  with the parameter's field in the same position when a structure around
  the variable is passed; into a function's parameter when it is an argument
  of `F(X)`; into `Y` when an assignment `Y = ...X...` reads it, and into the
  `INTO` host variables of an `EXEC SQL` whose `WHERE` or values read it; and
  from a `RETURN(X)` into what the function's result is assigned to. A
  parameter holds the value everywhere, a copy only from the copy on, until a
  statement that reads nothing followed overwrites it: in the procedure of the
  copy that is by line, a loop around both counting both ways, and the
  overwrite ends it for what follows in its own block (an `IF` branch or a
  `DO` group, say). Other procedures that use a copied global count
  everywhere. A field of a `LIKE` copy means the copy. The tab
  draws every statement that sets, reads, passes or tests it, its structure
  or one of its fields, inside the IFs, SELECTs, loops and ON-units it
  happens in, one branch per procedure, each framed by what it does, and
  the statements a test of it leads to. A test is a comparison in an `IF`,
  `WHEN` or loop condition, also inside `SUBSTR` or with a subscript, or the
  `WHERE` of an `EXEC SQL`. The names holding the value are in bold yellow.
  *Tests* shows the tests instead: when each is
  reached at all (the conditions around it and, where the value got there
  under another name, the conditions and the `CALL`s, copies and function
  calls on the way), and what happens when it holds and when not, with the
  conditions in between. *Sets* shows every statement that sets it, or what
  it goes on to, with the same conditions: where a message text or return
  code comes from. A click opens the statement.
- **Show Data Model of NAME** is a code action on a table, view or alias name,
  in a PL/I program's SQL or in DDL; anywhere else in a DDL file it is **Show
  Data Model of FILE**.
- The flow, data flow and data model diagrams follow the editor's cursor: one
  opens with the box of the cursor's line in focus (the last one at or before
  it; with the cursor scrolled out of view, the first line in view), and
  moving the cursor moves the focus. The arrow keys move the focus to the
  nearest box that way, Home and End to the first and last, and the cursor
  follows: in the file's editor if one is in view, else in one opened beside
  the diagram, which keeps the keyboard. Enter or Space does what a click does.
- **PL/I Graph: Show Graph** (also the graph icon on those views) opens the
  graph in the editor, starting at the active file's module. It is the page
  from `viz/`; it asks for what each view draws, and a worker thread of its
  own reads that from the database:
  - the overview is one folder at a time: its subfolders and its modules,
    with the calls and includes between them summed up. A folder with more
    than 300 modules shows the 300 most connected; search (`/`) and the
    module list reach every one.
  - a module shows its procedures with callers left and callees right, at
    most 60 a side (the most connected); the details list all of them.
  - **Go to source** in the details opens the file at that line.
  - When the graph changes, a **graph changed · reload** button appears;
    reloading keeps the current view.

  For 20,000 files a module or procedure view reads in under 60 ms. The first
  overview after a sync takes about 2 seconds, because it sums up every call;
  the sums are kept until the next sync changes the graph.
- **PL/I Graph: Coverage Report** (also in the status bar menu) opens a
  Markdown document on how much of the code the graph understood: files the
  grammars could not read and the shapes of those lines, references and
  field accesses that resolve to nothing, DL/I calls without a known
  function or segment, and other incomplete facts. Part 1 has only counts
  and line shapes, which keep the grammars' keywords and turn every name
  into `x`, number into `9` and string into `'…'`, so it can be shared
  without the code; part 2 has the names and paths. It takes about 8
  seconds for 6 million lines, in a worker thread.
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
extension only reads it. A sync of 100 files or more parses them in up to
three more threads while the worker writes.

- The first sync of a workspace reads every file once: about 8 seconds and
  350 MB of memory for 20,000 files, giving a 60 MB graph.
- Later starts open the last session's graph at once and re-read only the
  files whose time or size changed (about 0.2 seconds when nothing changed).
- A saved, added or deleted file is in the graph a moment later: the worker
  re-reads it and re-links the references whose targets may have moved.
  Changes that arrive while a sync runs, such as a git checkout's, are
  synced together when it ends.
- A sync reads the file in the active editor first, then the members it
  uses (includes, calls, fetches, programs, ... by member name), then what
  those use, transitively, then the rest. The editor gets the graph twice
  before the sync ends: once the file and what it uses directly are read,
  and once all it uses is. Switching editors mid-sync starts over from the
  new file. On the 20,000-member sample, where one program reaches half of
  all members, that is after 0.13 and 2.6 seconds of a 4.4-second sync
  (3.7 without an open file).

Clicking the status bar item opens a menu: Show Graph, Show Log and Rebuild
Graph. **Rebuild Graph** (also in the command palette) throws the graph away
and reads every file again. Messages and errors go to the **PL/I Graph**
output.

`pliGraph.extensionlessMembers` (default on) indexes files named like
`ABMAIN01`, by their third character as above. `pliGraph.format.keywordCase`,
`pliGraph.format.identifierCase` (`upper`, `lower`, `keep`) and
`pliGraph.format.abbreviations` (`short`, `long`, `keep`) set how Format
Document writes words, as above.

Needs VS Code 1.101 or newer, whose Node has `node:sqlite`.

### The graph's tables

The graph is a plain SQLite file, so other tools (the MCP server, scripts)
can read it while VS Code runs:

- `files(id, path, language, member, mtime, size, syntax_errors, error_line, failure)`:
  every indexed file, `path` relative to the folder with `/`.
  `syntax_errors` counts the places the grammar could not read (from
  `error_line` on; facts there may be missing), `failure` says why reading
  the file failed, which leaves it without facts until it changes.
- `symbols(id, file, parent, kind, name, qualifier, detail, comment, line, end_line, name_line, name_col)`:
  procedures, packages, jobs, procedures in JCL, formats, messages, tables,
  views, aliases, PSBs, DBDs, a DBD's segments and IMS transactions; `parent`
  is the enclosing symbol, `detail` a procedure's `OPTIONS(...)` and
  `RETURNS(...)`, or the operands of a PSB, DBD or transaction (with its
  `APPLCTN`'s `PSB=` and `PGMTYPE=`). `line`-`end_line` is the whole
  definition, `name_line` and `name_col` (from 0) where its name stands, which
  Go to Definition lands on.
- `refs(id, file, caller, kind, name, qualifier, detail, line, col, end_line, end_col)`:
  every call, fetch, include, program, procedure, table, screen, PSB, DBD,
  segment and cursor reference, `caller` being the symbol it is in. The
  span is the name itself, not the statement around it. A transaction
  refers to its PSB and to the program named like it (on its `APPLCTN`), a
  PSB to the DBDs of its PCBs and to the segments of its `SENSEG`s (the DBD in
  `qualifier`). A `cursor` is an SQL cursor's `DECLARE`, `OPEN`, `FETCH` or
  `CLOSE` (in `detail`); cursors belong to their file and are not linked.
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
  passes to a `CALL` (`arg`, `position` from 1), by name as written; a read
  in `F(X)` or `A(I)` has its `position` too, the parameter it binds to when
  `F` is a procedure; an
  `EXEC SQL` writes its `INTO` host variables and their indicators and reads
  the others. `variable` is the declaration the name resolves to by PL/I's scope rules,
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
- `dds(id, file, step, name, dsn, member, disp, attributes, line, dsn_line, dsn_col)`: every DD
  statement, with where its `dsn` stands. `dsn` without the PDS member or GDG generation, which go to
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
- `PLG007E` no longer raised; it was Show Graph reading the whole graph.
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
- `PLG025E` a parser thread stopped (crashed or ran out of memory) while
  reading a file; the sync goes on without that file's facts. Please report
  it with the file.
- `PLG026E` Show Graph: a question of the page failed (a view, the details,
  search or a list); the page shows it, the output has the stack.
- `PLG027E` Show Graph: the page's worker thread stopped; close and reopen the page.
- `PLG028E` the coverage report failed; the output has the stack.
- `PLG029E` there is no graph to make a coverage report of yet: it is still
  being built, or no folder is open.
- `PLG030E` the model explaining a procedure answered with an error (HTTP
  status or an error in the stream); the procedure is left unexplained.
- `PLG031E` the model's answer is not JSON or lacks the summary or rules; it
  is asked once more.
- `PLG032E` the model is not reachable at its URL (not running, wrong port).
- `PLG033E` Show Graph: saving a list of dependencies failed (no permission,
  disk full); the message names the file.
- `PLG034E` Show Flow Diagram: the active file has no procedure, or no PL/I
  file is open.
- `PLG035E` Show Flow Diagram of Procedure: no procedure has the name passed
  to the command.
- `PLG036W` Tab in a PL/I file: the line has not enough blanks or comment
  filler after the cursor to give up before column 72, so nothing is inserted.
- `PLG037E` Show Data Model: the file is not a Db2 DDL file of the graph, or
  no file is open.
- `PLG038E` Show Data Flow of the Variable: the cursor is on no variable the
  graph knows, or no PL/I file is open.
- `PLG039W` Format Document: the PL/I parser can't read the line named, so
  nothing is changed.
- `PLG040E` Format Document failed with an exception; the log has it.
- `PLG041E` Format Document would have changed what the code means, so
  nothing is changed. A bug in the formatter. For PL/I the result is parsed
  again and must have the same words as the source but for blanks, case,
  quotes, abbreviations, `¬`/`^`, `|`/`!` and END's names; for the other
  languages the same text but for blanks and case.
- `PLG042E` Format Document: the grammars did not load (see `PLG014E`).
- `PLG043E` Format Document: the PL/I parser gave no tree.
- `PLG044E` A diagram's focus moved to a statement whose file could not
  be shown beside it.

The graph page's own codes: `VIZ-101` the id in the URL is not in the graph,
`VIZ-102` a view could not be drawn, `VIZ-103` the details, `VIZ-104` the
sidebar list, `VIZ-105` search could not be read, `VIZ-106` the list to save,
`VIZ-107` the flow diagram could not be read, `VIZ-108` its procedure is not
in the graph, `VIZ-109` it could not be drawn, `VIZ-110` the data model could
not be read, `VIZ-111` its file creates no tables, views or aliases,
`VIZ-112` it could not be drawn, `VIZ-113` a variable's data flow could not be read, `VIZ-114` the variable is
not in the graph, `VIZ-115` the data flow could not be drawn as a diagram,
`VIZ-116` as the table of tests, `VIZ-118` as the table of sets.

Don't install it next to the pli-lsp extension: both define the `pli`
language, so highlighting would clash and trees would show twice.
