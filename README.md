# PL/I Graph

A VS Code extension for an IMS / MVS z/OS code base in PL/I, JCL, IMS MFS
(HLASM) and Db2 DDL. It keeps a code graph of each workspace folder in a
SQLite file and answers Go to Definition, Find All References, completion
and dependency trees from it, and offers it to Copilot as an MCP server. The same grammars also do the highlighting. The parsers are tree-sitter grammars compiled
to WebAssembly, which are separate projects:
[tree-sitter-pli](https://github.com/Simon-Peleska/tree-sitter-pli),
[tree-sitter-jcl](https://github.com/Simon-Peleska/tree-sitter-jcl),
[tree-sitter-hlasm](https://github.com/Simon-Peleska/tree-sitter-hlasm) and
[tree-sitter-db2](https://github.com/Simon-Peleska/tree-sitter-db2).

The extension is plain JavaScript (types in JSDoc, checked by `tsc`), so one
`pli-graph.vsix` of about 600 KB serves every platform and needs nothing
else installed. What it does, its settings, the graph's tables and the error
codes (`PLG004E`-`PLG049E`) are in [`vscode/README.md`](vscode/README.md).

## What ends up in the graph

Each file is parsed once, and that one parse gives two kinds of rows: the
structure that ties files together (definitions, references and what they
resolve to), and the facts inside a program (declarations, statements, data
access, interfaces). They are exact: read from the code, nothing guessed or
summarized. Every table and column is described in
[`vscode/README.md`](vscode/README.md#the-graphs-tables).

### Definitions and references

- `name: PROC` / `name: ENTRY` are procedures, `name: PACKAGE` a package
  holding its procedures. Names come from the label, uppercased. Nested
  procedures and ENTRY points have their enclosing procedure as parent.
- `CALL x`, `FETCH x` and `x(...)` are references from the enclosing
  procedure. `x(...)` links only to a procedure of the file or of a file it
  includes, so `ARR(2)` on an array links to nothing.
- `%INCLUDE member`, `%INCLUDE ddname(member)` and `EXEC SQL INCLUDE member`
  are includes. A member is the file named `member` (with or without an
  extension).
- Fixed-format files (carriage control in column 1, sequence numbers in
  columns 73-80) are detected, and those columns are blanked before parsing.
  Lines and columns stay the same.

The other languages are linked to PL/I and to each other:

| Source | Definitions | References from the enclosing definition to |
|---|---|---|
| JCL (`.jcl`, `.cntl`) | `JOB`, named `PROC` | `PGM=X`, `MBR=X` (IMS procedures), the program and PSB in `PGM=DFSRRC00,PARM='BMP,X,PSB'`, `RUN PROGRAM(X)` in SYSTSIN data, `EXEC X` / `EXEC PROC=X` (in-stream or cataloged procedure) |
| MFS (`.mfs`, `.asm`, `.hlasm`, `.mlc`) | `FMT`, `MSG` | `SOR=` format and `NXT=` message of a MSG |
| PSB and DBD gens, IMS system definition | `PSBGEN`, `DBD`, `SEGM`, `TRANSACT` | a PSB's DBDs and, by `SENSEG`, their segments; a transaction's PSB and the program named like it (on its `APPLCTN`) |
| Db2 DDL (`.ddl`, `.db2`) | `CREATE TABLE` / `VIEW` / `ALIAS` | tables a view selects from, `REFERENCES` tables (the foreign key's columns in `detail`, as `REFERENCES (A, B)`), the alias target |
| PL/I | (above) | tables in `EXEC SQL` (with `SELECT`, `INSERT`, `UPDATE`, `DELETE`), MFS formats and messages named in string literals (`'CUSTO   '`), a cursor's `DECLARE` from its `OPEN`, `FETCH` and `CLOSE` (in the same file) |

A JCL dataset's definition is the DD creating it (`DISP=NEW` or `MOD`), and
its references are every DD naming it. Every reference points at the name
itself, and every definition at its name, so Go to Definition and Find All
References land on the word, both ways.

PSB, DBD and system definition sources are recognized by their first
statement (`PSBGEN`, `PCB`, `DBD`, `SEGM`, `APPLCTN`, `TRANSACT`, ...), with
or without an extension. JCL `INCLUDE MEMBER=X` and HLASM `COPY X` are
includes.

A program `X` is the member named `X`; the reference goes to its procedure
named `X`, or to all of its top-level procedures when none is. Tables are
matched by name and, when it matches, schema.

When several files define the same name, as dev and prod copies side by
side do, a reference means the nearest: the referrer's own folder, then its
subfolders (shallowest first), then the parent folder and its subfolders,
and so on outward. Equal distances go by path for a member; screens,
tables, PSBs and DBDs keep every definition at the nearest distance.

### Facts

| Source | Facts | Tables |
|---|---|---|
| PL/I declarations | every variable and structure field: level, parent, qualified name, type, size, dimensions, storage (`STATIC`, `BASED(p)`, `DEFINED`, `CONTROLLED`, `VALUE`, ...), `INIT`, `LIKE`, `EXTERNAL`, the procedure it is in, a parameter's position, and the comments on it | `variables` |
| PL/I statements | every executable statement, and the `DECLARE`, `DEFAULT`, `DEFINE` and `FORMAT` statements, as a tree: what it is in, which branch of an `IF`, its `WHEN`s and `OTHERWISE`; the head (condition, `CALL` entry, `RETURN` value, ...); the comments above procedures | `statements`, `symbols.comment` |
| PL/I data flow | the fields each statement reads, writes (with the literal written) or passes to a `CALL` or function (by position), and the host variables an `EXEC SQL` sets (`INTO`) or reads, each resolved to its declaration by PL/I's scope rules, includes and `LIKE` copies counted | `accesses` |
| PL/I conditions | every comparison in a condition, and a `SELECT` subject against each `WHEN` value | `comparisons` |
| PL/I text | every string literal of a statement: messages, report text, codes | `literals` |
| PL/I record I/O | `OPEN`, `READ`, `WRITE`, `REWRITE`, `DELETE`, `LOCATE`, `GET`, `PUT`, `CLOSE` with the file, record, key and title | `file_io` |
| Embedded SQL | every column used, how (select, where, join, set, insert, ...), the host variable it goes to or comes from, cursors and their `FETCH`es | `sql_columns` |
| DL/I calls | `PLITDLI`, `CEETDLI`, `AIBTDLI`: function (`GU`, `ISRT`, ...), PCB and its position among the main procedure's parameters, I/O area, and the SSA segment path, from literals or the `INIT` of the variables passed | `dli_calls` |
| JCL | every step with the program it runs and its PSB; every DD with dataset, PDS member or GDG generation, and `DISP` | `steps`, `dds` |
| PSB and DBD gens | a PSB's PCBs in order with type, DBD and `PROCOPT`, and their sensitive segments; a DBD's segment hierarchy, lengths and fields with the key | `pcbs`, `sensegs`, `segments`, `segment_fields` |
| MFS | a format's screen fields with row, column, length and the label left of them; a message's fields in order with the screen field each maps and its offset in the segment | `mfs_fields` |
| Db2 DDL | every table's columns with type, `NOT NULL` and key position | `columns` |
| Every file | how many places the grammar could not read and the first one; why reading it failed, if it did | `files` |

Derived from these rows when asked, not stored: who writes and reads a
dataset across jobs (MCP tool `dataset`), a program's files with their DDs
and datasets (`program_files`), a table's columns with every SQL statement
using each and its host variable (`table_columns`), a PSB's layout and users (`psb`), a screen's fields and
the programs naming it (`screen`), the variable each input field lands in
and the checks on it (`screen_input`), where a column's value comes from
and goes, from screen field to batch output (`column_path`), which PCB of the PSB a DL/I call uses
(`dli`), what each transaction inserts, reads, updates and deletes
(`transaction`) and each procedure with its callees (`data_use`), which
branches, procedures and variables are dead (`dead_code`), which messages
and codes are produced under which conditions (`messages`), what follows
from each value of a code field across the programs (`decision_table`), where a field is set, passed or compared and under which
conditions (`field`), where its value comes from and goes, one step each
way (`lineage`), and which comments and literals contain a text (`text`).

## Extensionless members

Sources named like z/OS members (`ABMAIN01`, no extension) are indexed while
`pliGraph.extensionlessMembers` is on (the default). A file whose name
matches `^[A-Z@#$][A-Z0-9@#$]{6,7}$` gets its language by its third
character: `J` is JCL, `F` an HLASM MFS screen, `T` a Db2 table definition,
anything else PL/I. Any other extensionless file is skipped.

## Building

```sh
cd vscode
npm install
npm run package        # type check, bundle, write pli-graph.vsix
```

Install it with **Extensions → ... → Install from VSIX**. Every push to
`main`/`master` also builds it (`.github/workflows/vscode.yml`, artifact
`pli-graph-vsix`) and opens it on Windows and Linux in a real VS Code with no
settings.

The grammars are committed as `vscode/grammars/*.wasm`, each with a copy of
its `highlights.scm`;
`grammars/VERSIONS` records the commit of each. After changing a grammar,
rebuild them from the checkouts next to this repository (needs the
tree-sitter CLI, in `nix develop`):

```sh
vscode/build-grammars.sh
```

## Graph page

**PL/I Graph: Show Graph** opens the graph in VS Code. The page is
`viz/graph.template.html` with Cytoscape.js and its fcose layout
(`viz/vendor/`) and the [vscode-elements](https://github.com/vscode-elements/elements)
components it uses inlined, so it needs no server and no network. It asks the
extension for what each view draws, and `vscode/src/graphpage.js` answers in a
worker thread from the database (`Graph.page*` in `vscode/src/graph.js`): a
graph of 20,000 files is far too big to hand to a page whole. Its
controls, colors and font follow the VS Code theme. It has three views:

- **Modules:** one folder at a time, its subfolders and modules with the
  calls and includes between them, placed by a force-directed layout (fcose:
  edges pull, nodes push apart), so modules that call each other end up close
  together. Past 300 modules only the most connected are drawn.
- **Module:** callers above, the module's procedures in source order in the
  middle, callees below. Each outside procedure sits straight above or below
  the procedures it connects to.
- **Procedure:** callers above and callees below, 1-3 levels deep or all
  the way, one row per level. Rows are sorted by barycenter (each node goes
  to the average place of its neighbours), which keeps edges short and
  crossings few.
- **Dependencies** (the button in a module's view or details): every module
  the module uses, through calls, includes or any other link, all the way
  down, and every module using it all the way up, laid out like a procedure.

In the procedure and dependency views, *uses ↓*, *used by ↑* and *both*
choose which way to walk. Past 60 nodes a row says how many more there are.
**Save list…** writes every module or procedure found that way, all the way
down or up, to a tab-separated file with its distance (direction, level,
module, procedure, line) and opens it.

**Flow diagram** (in a procedure's or module's details, or the flow button
of the *PL/I Dependencies* view for the procedure at the cursor) opens a UML
activity diagram of the procedure in a tab of its own, *PL/I Flow*: its
statements in source order, top to bottom, with IF, SELECT and DO shown in
full above their decision, an IF's and a loop's branches as true and false
in the theme's green and red (a loop's body comes back to its decision and
false leaves it), a WHEN's values on its branch, and a lane for
every procedure and include the flow passes through. A call flows into the callee's lane and back; the *Calls deep* slider (0-10, or full) sets
how many calls deep that goes, and a call past it is cut off and drawn as an
action with ⋔ (↻ for a call back into a procedure already on the way). A
flow stops expanding calls at 3000 steps. Statements, conditions and loop
specs are shown in full, wrapped over as many lines as they need. Click a
step to open its source, a procedure's lane to show its flow, an include's
lane to open it. *PL/I Graph: Show Flow Diagram of Procedure…* or the
search field in the tab draws any procedure by name, and the lightbulb
(Ctrl+.) on a procedure's name, declared or called, draws that one.

Edges are S-curves that leave a node downwards and enter the next from above.

Search (`/`) finds procedures and modules. The sidebar lists modules and
called names that don't resolve to anything in the repo. The URL hash holds
the view, so the back button works. Click shows details; double-click opens.

Error codes on the page: `VIZ-101` unknown id in the URL, `VIZ-102` a view
failed to draw, `VIZ-103` details, `VIZ-104` the sidebar list, `VIZ-105`
search could not be read, `VIZ-106` the list to save could not be read,
`VIZ-107` the flow could not be read, `VIZ-108` the flow's procedure is not in
the graph, `VIZ-109` the flow could not be drawn, `VIZ-110` the data model
could not be read, `VIZ-111` its file creates no tables, `VIZ-112` the data
model could not be drawn, `VIZ-113` a variable's data flow could not be read, `VIZ-114` the variable is
not in the graph, `VIZ-115` the data flow could not be drawn as a diagram,
`VIZ-116` as the table of tests, `VIZ-118` as the table of sets.

The same tab draws a DDL file's data model (*PL/I Graph: Show Data Model*,
the table icon on a DDL editor): a UML class diagram of its tables, views and
aliases with their columns, keys and the foreign keys, FROMs and FORs between
them, with the *Relations deep* slider adding other files' tables.

## 3270 screens

**PL/I Graph: Show 3270 Screen** shows an MFS format as the 3270 screen it
describes, typed into like the real one, with the input fields' contents in a
sidebar. The terminal is
[tn3270](https://github.com/Simon-Peleska/tn3270)'s canvas and in-page host,
copied unchanged into `vscode/screen/vendor/tn3270/`; `vscode/src/mfs.js`
reads the format.

## Tests

```sh
cd vscode
npm test                                   # indexer, graph queries, declarations
npm run build && node test/e2e/run.mjs <sources>   # the extension in a real VS Code
```

`npm run check` type-checks the JavaScript.

## The code-graph-rag patch set

The extension started out driving
[code-graph-rag](https://github.com/vitali87/code-graph-rag) (cgr) in Python.
`patches/0001-pli-support.patch` (against upstream `ed322ab`) still adds the
same languages to cgr, and `viz/build_graph_site.py` turns an offline
`cgr index` into a standalone `graph.html`, with the page from before it asked
the extension (`viz/site.template.html`). Neither is used by the extension
any more. To try them:

```sh
git clone https://github.com/vitali87/code-graph-rag upstream   # gitignored
cd upstream && git checkout ed322ab
git apply --index ../patches/0001-pli-support.patch
git submodule update --init grammars/tree-sitter-pli grammars/tree-sitter-jcl \
  grammars/tree-sitter-hlasm grammars/tree-sitter-db2
nix develop .. -c uv sync --extra treesitter-full --extra test
CGR_PLI_EXTENSIONLESS_MEMBERS=true uv run cgr index --repo-path /path/to/sources -o /tmp/idx
uv run python ../viz/build_graph_site.py /tmp/idx -o ../graph.html
```
