# code-graph-rag-pli

PL/I, JCL, IMS MFS (HLASM) and Db2 DDL support for
[code-graph-rag](https://github.com/vitali87/code-graph-rag) (cgr), kept as a
local patch set on top of upstream, for an IMS / MVS z/OS code base. The
grammars are separate projects:
[tree-sitter-pli](https://github.com/Simon-Peleska/tree-sitter-pli),
[tree-sitter-jcl](https://github.com/Simon-Peleska/tree-sitter-jcl),
[tree-sitter-hlasm](https://github.com/Simon-Peleska/tree-sitter-hlasm) and
[tree-sitter-db2](https://github.com/Simon-Peleska/tree-sitter-db2).

`patches/0001-pli-support.patch` applies to upstream `ed322ab` with grammar
submodule `grammars/tree-sitter-pli` at `4b4dc00` and the other three
grammars under `grammars/tree-sitter-{jcl,hlasm,db2}`.

## What ends up in the graph

- `name: PROC` / `name: ENTRY` become Functions, `name: PACKAGE` a Class
  whose procedures are its Methods (`file.PKG.PROC`). Names come from the
  label, uppercased. Nested procedures and ENTRY points are DEFINED by their
  enclosing procedure.
- `OPTIONS(...)` items and attributes such as `RECURSIVE` become the
  procedure's modifiers.
- `CALL x` and `x(...)` references to known procedures become CALLS edges
  from the enclosing procedure (calls inside BEGIN blocks count for it too).
  `ARR(2)` on an array produces no edge. `FETCH x` counts as a call to `x`.
- `%INCLUDE member`, `%INCLUDE ddname(member)` and `EXEC SQL INCLUDE member`
  become IMPORTS edges. A member resolves to a file named `member` (with or
  without a PL/I extension): same directory first, then elsewhere in the repo.
- Fixed-format files (carriage control in column 1, sequence numbers in
  columns 73-80) are detected, and those columns are blanked before parsing.
  Byte offsets stay the same.

The other three languages are linked to PL/I and to each other. All links are
CALLS edges between Functions, so the graph website and the VS Code trees
show them like procedure calls:

| Source | Functions | CALLS from the enclosing definition to |
|---|---|---|
| JCL (`.jcl`, `.cntl`) | `JOB`, named `PROC` | `PGM=X`, `MBR=X` (IMS procedures), the program in `PGM=DFSRRC00,PARM='BMP,X,...'`, `RUN PROGRAM(X)` in SYSTSIN data, `EXEC X` / `EXEC PROC=X` (in-stream or cataloged procedure) |
| MFS (`.mfs`, `.asm`, `.hlasm`, `.mlc`) | `FMT`, `MSG` | `SOR=` format and `NXT=` message of a MSG |
| Db2 DDL (`.ddl`, `.db2`) | `CREATE TABLE` / `VIEW` / `ALIAS` | tables a view selects from, `REFERENCES` tables, the alias target |
| PL/I | (above) | tables in `EXEC SQL`, MFS formats and messages named in string literals (`'CUSTO   '`) |

A program `X` is the member named `X` (as for `%INCLUDE`); the edge goes to
its procedure named `X`, or to all of its top-level procedures when none is.
Tables and screens are found by name across the repository, without the Db2
schema. JCL `INCLUDE MEMBER=X` and HLASM `COPY X` are IMPORTS edges.

## Setup

```sh
git clone https://github.com/vitali87/code-graph-rag upstream   # gitignored
cd upstream && git checkout ed322ab
git apply --index ../patches/0001-pli-support.patch
git submodule update --init grammars/tree-sitter-pli grammars/tree-sitter-jcl \
  grammars/tree-sitter-hlasm grammars/tree-sitter-db2
nix develop .. -c uv sync --extra treesitter-full --extra test
```

cgr builds the grammars' Python bindings in place on first use.

## Extensionless members

Sources named like z/OS members (`ABMAIN01`, no extension) are only indexed
when this is set:

```sh
CGR_PLI_EXTENSIONLESS_MEMBERS=true cgr ...
```

With the flag on, an extensionless file whose name matches
`^[A-Z@#$][A-Z0-9@#$]{6,7}$` is indexed by its third character: `J` is JCL,
`F` an HLASM MFS screen, `T` a Db2 table definition, anything else PL/I. Any
other extensionless file is skipped.

## Graph website

`viz/` turns an offline `cgr index` into one self-contained `graph.html`. The
graph data and Cytoscape.js (plus its fcose layout, all in `viz/vendor/`) are
inlined, so the page needs no server, no network and no Memgraph:

```sh
cd upstream
uv run cgr index --repo-path /path/to/sources -o /tmp/idx
uv run python ../viz/build_graph_site.py /tmp/idx -o ../graph.html
```

The page has three views:

- **Modules:** one folder at a time, its subfolders and modules with the
  calls and includes between them, placed by a force-directed layout (fcose:
  edges pull, nodes push apart), so modules that call each other end up close
  together. Past 300 modules only the most connected are drawn.
- **Module:** callers on the left, the module's procedures in source order in
  the middle, callees on the right. Each outside procedure sits level with the
  procedures it connects to.
- **Procedure:** callers and callees, 1-3 levels deep, one column per level.
  Columns are sorted by barycenter (each node goes to the average row of its
  neighbours), which keeps edges short and crossings few.

Search (`/`) finds procedures and modules. The sidebar lists modules, `OPTIONS(MAIN)` entry
points, and called names that don't resolve to anything in the repo. The URL
hash holds the view, so the back button and bookmarks work. Click shows details;
double-click opens.

Error codes: `VIZ-001` no index found, `VIZ-002` index unreadable (build
script); `VIZ-101` unknown id in the URL, `VIZ-102` a view failed to draw
(page).

## Windows bundle

`.github/workflows/windows-bundle.yml` builds `cgr-pli-windows-x64.zip` on
every push to `main`/`master` (or by hand: Actions → Windows bundle → Run
workflow). The zip holds an embeddable Python, all dependencies as prebuilt
Windows binaries and the compiled PL/I grammar, so the Windows machine needs
no compiler, uv, Python install or admin rights. The workflow indexes a small
PL/I sample and talks to the MCP server before it uploads anything.

Download it from the run's Artifacts, unzip anywhere (e.g.
`C:\Users\<you>\tools\cgr`), then:

```bat
set CGR_PLI_EXTENSIONLESS_MEMBERS=true
C:\Users\<you>\tools\cgr\cgr.cmd index --repo-path C:\path\to\sources -o C:\temp\idx
C:\Users\<you>\tools\cgr\graph-site.cmd C:\temp\idx -o C:\temp\graph.html
```

As an MCP server for Claude Code:

```bat
claude mcp add --transport stdio code-graph-rag --env TARGET_REPO_PATH=C:\path\to\sources --env CGR_PLI_EXTENSIONLESS_MEMBERS=true -- C:\Users\<you>\tools\cgr\cgr.cmd mcp-server
```

## VS Code extension

`vscode/` is an extension that reads the same graph: PL/I highlighting, Go to
Definition (F12) on calls and `%INCLUDE` members, and **PL/I Dependencies** /
**PL/I Dependents** trees in the Explorer that follow the active file, and
**PL/I Graph: Show Graph**, the graph website's page inside VS Code. For each
workspace folder it runs `cgr watch`, which keeps the folder's project in
cgr's SQLite graph (`~/.cgr/graph.sqlite`) in sync as files change, and it
answers every question straight from that database. On Windows it only needs
the bundle above. Details and error codes (`PLG001E`-`PLG008E`) are in
`vscode/README.md`.

The workflow builds `pli-graph.vsix` (artifact `pli-graph-vsix`) and tests it
in a real VS Code against the bundle. Install it with **Extensions → ... →
Install from VSIX**, then set `pliGraph.command` to
`C:\Users\<you>\tools\cgr\cgr.cmd`. The first sync of a large workspace
takes about 3 minutes for 20,000 files and needs about 1.2 GB of memory while
it runs; later starts only re-read changed files (about a second when nothing
changed). Don't close VS Code during that first sync: an unfinished sync starts
over from scratch.

Don't install it together with the pli-lsp extension: both define the `pli`
language.

Building it locally:

```sh
cd vscode && npm install && npm run package   # writes pli-graph.vsix
```

## Tests

```sh
cd upstream && uv run pytest codebase_rag/tests/test_pli.py codebase_rag/tests/test_mainframe.py ../viz
cd ../vscode && npm test    # syncs test/fixture with ../upstream
```

## Refreshing the patch

After changing the checkout:

```sh
cd upstream
git add -N <new files>
git diff --binary HEAD > ../patches/0001-pli-support.patch
```
