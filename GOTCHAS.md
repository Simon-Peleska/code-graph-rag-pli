# Gotchas

## The indexer (`vscode/src/indexer.js`)

- **Names come from labels.** The grammar puts `MAIN: PROC;`'s name on the
  enclosing `labeled_statement`, not on the `procedure_statement`.
- **Bodies need the grammar's `body` field** (tree-sitter-pli `4b4dc00`).
  Older grammar commits attribute every call to the module and flatten
  packages.
- **The bundle must take web-tree-sitter's CommonJS build.** esbuild picks
  the ESM build, which finds its `.wasm` through `import.meta.url` and fails
  inside a CommonJS bundle; `build.mjs` aliases `web-tree-sitter` to
  `web-tree-sitter.cjs`.
- **The grammar `.wasm` files are committed.** CI doesn't build them;
  rebuild with `vscode/build-grammars.sh` after a grammar change and check
  `grammars/VERSIONS` for "(uncommitted changes)".
- **`LICENSE` counts as a member name.** With extensionless members on, any
  7-8-character uppercase name passes the rule, so `LICENSE` is indexed as an
  (empty) PL/I module. Accepted.
- **Fixed-format detection is a heuristic** (`blankMargins` in
  `vscode/src/source.js`). A file counts as fixed-format when:
  - no line is longer than 80 characters;
  - every code line starts with a blank, `0`, `1`, `-`, `+` or `*PROCESS` /
    `%PROCESS`.

  Columns 73-80 are blanked only when at least 90% of code lines have
  something there. A `MARGINS(...)` compiler option is not read. On the Zowe
  samples this brings parse errors from 3336 down to 134.
- **Tables and screens resolve by name.** Two DDL files defining `CUSTOMER`
  both get the link; a schema only narrows it when one of them matches. A
  PL/I string literal that happens to equal a format or message name links
  to it.
- **A program links to its procedure named like the member**, or else to
  every procedure of the member outside a package, internal ones included.
- **A cataloged procedure needs a named `PROC` statement** to be a
  definition. An `EXEC` of a member whose PROC is unnamed links to nothing.
- **Unknown programs link to nothing.** `PGM=IEFBR14`, `SORT`, `IDCAMS` etc.
  have no member in the repository; their references stay without a link,
  as do the unresolved screen literals (most string literals look like one).
- **Symbolic parameters aren't substituted.** `PGM=&PROG` and other `&`
  values link to nothing.
- **Db2 DDL with sequence numbers in columns 73-80 doesn't parse.** The JCL
  and HLASM grammars handle the columns themselves, the Db2 grammar reads
  free-format SQL.
- **A new fact needs `INDEXER_VERSION` raised.** Unchanged files are not read
  again, so without it they never get the new rows; with it `openGraph`
  drops the tables and the next sync reads everything.
- **`INIT((12)0)` parses with an ERROR node.** The grammar lacks repetition
  factors; `variables.init` still holds the text `(12)0`.
- **`VARYING` has no node of its own.** It is found in the attribute text.
- **DSNs are kept as written.** `&&TEMP`, `*.STEP1.DD` back references and
  `&SYM` symbolic parameters are not resolved, so a dataset chain through
  them breaks; a procedure's DDs are not merged with the overrides of the
  step running it.
- **PSB references link only to PSB gens.** PSB names usually equal program
  names, so `psb` refs must not fall back to member lookup like programs;
  the other way round, `program()` skips the members of PSB and DBD gens, or
  `PGM=KDDRUCK` would find the PSB gen `KDDRUCK`.
- **IMS gens are found by their first statement.** A member that would be
  PL/I is read as assembler when its first statement is `PRINT`, `TITLE`,
  `PCB`, `PSBGEN`, `DBD`, `DATASET`, `SEGM`, `IMSCTRL`, `APPLCTN`,
  `TRANSACT` or `DATABASE`. Only the indexer does this; the editor still
  colors such a member as PL/I.
- **A transaction's program is its `APPLCTN`'s PSB name.** That is how IMS
  names MPP programs; `GPSB=` with `PGM=` is not read, so such transactions
  have no PSB and no program.
- **`pcbs.position` counts the PCBs as written.** An online or BMP program
  (or `CMPAT=YES`) gets the I/O PCB first, so its parameter *n* is PCB
  *n - 1*.
- **DL/I constants come from `INIT`.** The resolve pass looks the function
  code, SSAs and PCB mask up like any access, so includes count; one set at
  run time leaves `function` or the SSA's segment unknown, and the call's
  `arguments` still show the names. `PLITDLI` and `AIBTDLI` are read with the parameter count first, `CEETDLI`
  without. An `AIBTDLI` call names its PCB inside the AIB, so it has no
  `pcb_parameter`.
- **An MFS label is the literal left of its field on the same row.** A
  label above a column of fields, or on another device or page, is not
  found. Only a format's first `DEV` is read.
- **An `ISRT` on the I/O PCB passes a MOD name where SSAs go.** The indexer
  cannot tell them apart, so `dli_calls.segment` holds the MOD name; the
  `dli` tool shows it as `MOD` once the PCB resolves to an I/O or TP PCB.
- **`accesses.name` is the field as written; `variable` is what it names.**
  `resolveAccesses` runs after `link()` and follows PL/I's rules: the
  innermost procedure first, then outer ones, then the member; an include's
  declarations belong to the procedure the `%INCLUDE` is in. Qualifiers may
  skip levels (`KD.ORT` for `KD.ADRESSE.ORT`); a fully qualified match wins,
  otherwise the first declaration, so an ambiguous name is not reported.
  A field of a `LIKE` copy resolves to the template's field, with the copy
  in `through`. A built-in (`SUBSTR`) or an undeclared name stays NULL.
  Only the members that changed, or whose includes did, are resolved again.
  The `field` tool still matches names as written. A function call and an
  array element look alike, so `F(X)` is a read of `F` too. A `GOTO` label, an `ON`
  condition's file and an I/O statement's `FILE(...)` are no accesses;
  `INTO`, `KEYTO`, `SET` and `GET`'s data are writes.
- **A comment belongs to what is right below it.** Only comment lines with
  no gap down to a procedure or declaration count (box lines of `*` join the
  block), plus one after a declaration on its line. A comment above a
  statement, or separated by a blank line, is not kept.
- **`lineage` is one step.** It lists a variable's direct sources and
  targets: assignments in the same statement, and arguments bound to the
  callee's parameters by position. An argument that is an expression, not a
  plain reference, binds nothing. Following a chain means calling it again.
- **The sample has no assignments.** zos-sample's statements are calls,
  IFs, DOs and SQL, so its `accesses` count is far below real code's.
- **I/O statements are read from their text.** The grammar ends `REWRITE`
  before a `KEY(...)` and knows no `LOCATE`, so `readFileIo` takes the
  source up to the next `;` and picks the options out by regex. A `;` inside
  a string literal in an I/O statement cuts it short.
- **`root.text` starts at the first token.** Slice it with
  `node.startIndex - root.startIndex`, not `node.startIndex`.
- **A program's files are only its own member's.** `programFiles` and the
  `program_files` tool miss I/O done in procedures it calls in other members.
- **Embedded SQL columns are paired by position.** Select item *i* goes into
  `INTO` host variable *i*, insert column *i* takes `VALUES` entry *i*, and a
  `FETCH` takes its columns from the last `DECLARE` of that cursor earlier in
  the same file; a cursor declared in another member or after the `FETCH`
  leaves the columns empty. Columns of a subquery's select list are counted
  as select items too, which shifts the pairing.
- **Walking the Db2 tree is costly in web-tree-sitter.** Every node access
  crosses into wasm, so `readSql` collects what it needs in one walk instead
  of calling `descendantsOfType` per clause. It still adds about 0.7 s to a
  full sync of the 20k-file sample.
- **Two declaration readers.** `pliDeclarations` in `source.js` (text-based,
  for Go to Definition and completion) and `readDeclaration` in the indexer
  (tree-based, for `variables`) can disagree.

## The extension

- **Highlighting is semantic tokens over TextMate.** The extension turns
  `editor.semanticHighlighting.enabled` on for its languages; a theme
  without semantic colors still shows the TextMate grammars' colors
  (`syntaxes/`), which are kept for the moment before the first parse.
  Punctuation is left to TextMate.
- **The highlights queries are copies.** `grammars/*-highlights.scm` come
  from each grammar's `queries/highlights.scm` through `build-grammars.sh`;
  edit them in the grammar repository.
- **It needs `node:sqlite`**, so VS Code 1.101 or newer.
- **The declaration reader is not a parser.** `vscode/src/source.js` splits
  PL/I at semicolons and reads `DCL` lists with their level numbers; HLASM by
  columns (label in 1, continuation in 72, operands from 16). It doesn't
  evaluate `%` preprocessor statements (`%IF`, `%DCL` substitutions), knows
  no `DEFINE STRUCTURE` / `TYPE`, and takes procedure scopes from the graph,
  so a `BEGIN` block's declarations count for the whole procedure. An
  unsaved edit that moves lines puts declarations in the wrong procedure
  until the file is saved and synced.
- **Column references need the graph's table links.** A program's SQL names
  count as columns only of the tables it is linked to; a table it reaches
  through a view or an alias leaves its columns out.
- **The graph page sets its pane widths from script.** vscode-elements'
  split layout measures its width before the page is laid out, so sizes in
  its attributes come out wrong; the page sets `handlePosition` on the first
  animation frame instead.
- **The graph page's controls are vscode-elements**, bundled by `build.mjs`
  from the components it names. A component the page starts using must be
  added to that list, or its tag stays an unknown element. They read the
  `--vscode-*` variables, so outside VS Code the page falls back to dark
  defaults.
- **The 3270 terminal is a copy.** `vscode/screen/vendor/tn3270/` holds
  tn3270's `public/` modules unchanged, at the commit in its `VERSION`; copy
  them again to update, don't edit them here. `Screen.layout()` does nothing
  until `resize()` has given it a size.
- **The MFS reader shows only the screen.** `vscode/src/mfs.js` takes the
  first `DEV` of a format and page 1 of `POS=`; `MSG`/`MFLD` are ignored, so
  output fields are shown blank and nothing maps fields to a message.
- **Dot paths are not watched.** Changes under `.git` and other dot folders
  never reach the indexer.
- **The MCP server API is cast to `any`.** The installed `@types/vscode`
  is 1.85, older than `lm.registerMcpServerDefinitionProvider` (1.101).
  The server runs on VS Code's own Node (`ELECTRON_RUN_AS_NODE`), so it
  needs no Node install and has `node:sqlite`. It opens the graph
  read-only, so a `query_graph` cannot write even if Copilot tries.
  VSCodium has the API but no Copilot; test the server over stdio
  (`test/mcp.test.js`) or with another MCP chat extension.

## The cgr patch set (`patches/`, no longer used by the extension)

- **cgr reads names from a `name` field in many places.** PL/I needs
  `pli_label()` at each: the handler, the FQN spec, the call pass's caller
  name and `_resolve_method_name`.
- **`codebase_rag/queries/highlights/pli.scm` is cgr's own query.** cgr
  treats every highlights capture in a procedure header as a modifier, so
  the grammar's full file would turn PROC, RETURNS, FIXED etc. into
  modifiers.
- **Editing tools see blanked bytes.** An edit through cgr to a fixed-format
  file would write it back without its sequence numbers.
- **Every new cgr language moves the fuzz seeds**: rerun
  `fuzz/build_corpus.py`.
- **Running cgr's tests needs the full grammar set**, and some fail on this
  machine for environment reasons (Go/.NET oracles, Memgraph without Docker,
  English git messages, `/tmp` project roots, nested `TMPDIR`).
