# code-graph-rag-pli

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
codes (`PLG004E`-`PLG024E`) are in [`vscode/README.md`](vscode/README.md).

## What ends up in the graph

- `name: PROC` / `name: ENTRY` are procedures, `name: PACKAGE` a package
  holding its procedures. Names come from the label, uppercased. Nested
  procedures and ENTRY points have their enclosing procedure as parent.
- `CALL x`, `FETCH x` and `x(...)` are references from the enclosing
  procedure. `x(...)` links only to a procedure of the file or of a file it
  includes, so `ARR(2)` on an array links to nothing.
- `%INCLUDE member`, `%INCLUDE ddname(member)` and `EXEC SQL INCLUDE member`
  are includes. A member is the file named `member` (with or without an
  extension); when several are, the one sharing the most folders with the
  includer.
- Fixed-format files (carriage control in column 1, sequence numbers in
  columns 73-80) are detected, and those columns are blanked before parsing.
  Lines and columns stay the same.

The other three languages are linked to PL/I and to each other:

| Source | Definitions | References from the enclosing definition to |
|---|---|---|
| JCL (`.jcl`, `.cntl`) | `JOB`, named `PROC` | `PGM=X`, `MBR=X` (IMS procedures), the program in `PGM=DFSRRC00,PARM='BMP,X,...'`, `RUN PROGRAM(X)` in SYSTSIN data, `EXEC X` / `EXEC PROC=X` (in-stream or cataloged procedure) |
| MFS (`.mfs`, `.asm`, `.hlasm`, `.mlc`) | `FMT`, `MSG` | `SOR=` format and `NXT=` message of a MSG |
| Db2 DDL (`.ddl`, `.db2`) | `CREATE TABLE` / `VIEW` / `ALIAS` | tables a view selects from, `REFERENCES` tables, the alias target |
| PL/I | (above) | tables in `EXEC SQL` (with `SELECT`, `INSERT`, `UPDATE`, `DELETE`), MFS formats and messages named in string literals (`'CUSTO   '`) |

A program `X` is the member named `X`; the reference goes to its procedure
named `X`, or to all of its top-level procedures when none is. Screens are
found by name across the repository, tables by name and, when it matches,
schema. JCL `INCLUDE MEMBER=X` and HLASM `COPY X` are includes.

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

**PL/I Graph: Show Graph** opens the whole graph in VS Code. The page is
`viz/graph.template.html` with Cytoscape.js and its fcose layout
(`viz/vendor/`) and the [vscode-elements](https://github.com/vscode-elements/elements)
components it uses inlined, so it needs no server and no network. Its
controls, colors and font follow the VS Code theme. It has three views:

- **Modules:** one folder at a time, its subfolders and modules with the
  calls and includes between them, placed by a force-directed layout (fcose:
  edges pull, nodes push apart), so modules that call each other end up close
  together. Past 300 modules only the most connected are drawn.
- **Module:** callers above, the module's procedures in source order in the
  middle, callees below. Each outside procedure sits straight above or below
  the procedures it connects to.
- **Procedure:** callers above and callees below, 1-3 levels deep, one row
  per level. Rows are sorted by barycenter (each node goes to the average
  place of its neighbours), which keeps edges short and crossings few.

Edges are S-curves that leave a node downwards and enter the next from above.

Search (`/`) finds procedures and modules. The sidebar lists modules and
called names that don't resolve to anything in the repo. The URL hash holds
the view, so the back button works. Click shows details; double-click opens.

Error codes on the page: `VIZ-101` unknown id in the URL, `VIZ-102` a view
failed to draw.

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
`cgr index` into a standalone `graph.html`. Neither is used by the extension
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
